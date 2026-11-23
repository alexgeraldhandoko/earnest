/* EARNest · Instagram messages webhook receiver.
   Meta pushes EVERY incoming DM here — including message requests from
   non-followers, which the Conversations polling API never lists. Replying
   via the Send API auto-accepts the request, so no human tap is ever needed.

   Routes (mounted at /api/ig-webhook in index.js):
     GET  /api/ig-webhook              Meta subscription verification (hub.challenge)
     POST /api/ig-webhook              signed event delivery (X-Hub-Signature-256)
     GET  /api/ig-webhook/poll         local responder drains the queue (poll_token)
     GET  /api/ig-webhook/debug        recent raw events for diagnostics (poll_token)

   Zero npm dependencies. Queue persists to the writable data dir so a cloud
   restart never drops a customer message. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CFG_PATH = path.join(__dirname, "igwebhook-config.json");
function cfg() {
  try { return JSON.parse(fs.readFileSync(CFG_PATH, "utf8")); } catch (_) { return {}; }
}
function appSecret() {
  if (process.env.IG_APP_SECRET) return process.env.IG_APP_SECRET;
  try {
    for (const line of fs.readFileSync(path.join(__dirname, "instagram.env"), "utf8").split("\n")) {
      const m = line.match(/^IG_APP_SECRET=(.*)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch (_) {}
  return null;
}

const QUEUE_CAP = 500;
const RAW_CAP = 30;
let seq = 0;
let queue = [];
let rawEvents = [];
let queueFile = null;
try { queueFile = path.join(require("./db").DATA_DIR, "ig-webhook-queue.json"); } catch (_) {}

function loadQueue() {
  if (!queueFile) return;
  try {
    const s = JSON.parse(fs.readFileSync(queueFile, "utf8"));
    queue = Array.isArray(s.queue) ? s.queue : [];
    seq = Number(s.seq) || 0;
  } catch (_) {}
}
function saveQueue() {
  if (!queueFile) return;
  try { fs.writeFileSync(queueFile, JSON.stringify({ seq, queue })); } catch (_) {}
}
loadQueue();

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function validSignature(raw, header) {
  const secret = appSecret();
  if (!secret || !header || !raw) return false;
  const expect = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expect);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function ingest(body) {
  const added = [];
  for (const entry of body.entry || []) {
    for (const m of entry.messaging || []) {
      rawEvents.push({ at: new Date().toISOString(), event: m });
      if (rawEvents.length > RAW_CAP) rawEvents.shift();
      const msg = m.message;
      if (!msg || msg.is_echo || !msg.text) continue;   // skip our own sends / non-text
      if (queue.some((q) => q.mid === msg.mid)) continue;
      const item = {
        seq: ++seq,
        mid: msg.mid,
        sender_id: m.sender && m.sender.id,
        recipient_id: m.recipient && m.recipient.id,
        text: String(msg.text).slice(0, 2000),
        ts: m.timestamp || Date.now(),
      };
      queue.push(item);
      added.push(item);
    }
  }
  if (queue.length > QUEUE_CAP) queue = queue.slice(queue.length - QUEUE_CAP);
  if (added.length) saveQueue();
  return added.length;
}

async function handle(req, res, url, raw) {
  const c = cfg();
  const sub = url.pathname.replace(/^\/api\/ig-webhook\/?/, "");

  if (req.method === "GET" && sub === "") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === c.verify_token) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(challenge || "");
    }
    return json(res, 403, { error: "verify failed" });
  }

  if (req.method === "POST" && sub === "") {
    if (!validSignature(raw, req.headers["x-hub-signature-256"])) {
      return json(res, 403, { error: "bad signature" });
    }
    let body;
    try { body = JSON.parse(raw.toString("utf8")); } catch (_) { return json(res, 400, { error: "bad json" }); }
    const n = ingest(body);
    return json(res, 200, { received: n });
  }

  const token = url.searchParams.get("token");
  if (!c.poll_token || token !== c.poll_token) return json(res, 403, { error: "bad token" });

  if (req.method === "GET" && sub === "poll") {
    const after = Number(url.searchParams.get("after") || 0);
    const events = queue.filter((q) => q.seq > after);
    let cloud = false;
    try { cloud = require("./qwenwork").enabled(); } catch (_) {}
    return json(res, 200, { events, latest_seq: seq, cloud_responder: cloud });
  }

  if (req.method === "GET" && sub === "debug") {
    return json(res, 200, {
      configured: { verify: !!c.verify_token, poll: !!c.poll_token, app_secret: !!appSecret() },
      queue_len: queue.length, latest_seq: seq, raw_tail: rawEvents.slice(-10),
    });
  }

  return json(res, 404, { error: "not found" });
}

// ---- Outstand bridge (rented Advanced Access) ----
// Outstand holds Meta Advanced Access on its own app; it forwards every inbound
// DM here as message.received. Same queue/poll interface as the Meta webhook,
// so the watcher and responder work unchanged. Replies go back via Outstand's
// Conversations API (see ig-mcp.cjs ig_reply).
function validOutstandSignature(raw, header) {
  const secret = cfg().outstand_signing_secret;
  if (!secret || !header || !raw) return false;
  const expect = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expect);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handleOutstand(req, res, url, raw) {
  if (req.method === "GET") {
    // OAuth redirect landing page after the founder approves the connection.
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end("<!doctype html><meta charset=\"utf-8\"><title>Earnest</title><body style=\"font-family:sans-serif;padding:40px\"><h2>Instagram connected.</h2><p>You can close this tab and return to QwenWork.</p></body>");
  }
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
  if (!validOutstandSignature(raw, req.headers["x-outstand-signature"])) {
    return json(res, 403, { error: "bad signature" });
  }
  let body;
  try { body = JSON.parse(raw.toString("utf8")); } catch (_) { return json(res, 400, { error: "bad json" }); }
  if (body.event === "test") return json(res, 200, { ok: true });
  if (body.event !== "message.received" || !body.data) return json(res, 200, { received: 0 });
  const d = body.data;
  const att = Array.isArray(d.attachments) && d.attachments[0];
  const text = String(d.content || (att ? `[${att.type}] ${att.title || att.url || ""}` : "")).slice(0, 2000);
  if (!d.messageId || !d.senderId || !text) return json(res, 200, { received: 0 });
  if (queue.some((q) => q.mid === d.messageId)) return json(res, 200, { received: 0 });
  rawEvents.push({ at: new Date().toISOString(), event: { outstand: body.event, data: d } });
  if (rawEvents.length > RAW_CAP) rawEvents.shift();
  const item = {
    seq: ++seq,
    mid: d.messageId,
    sender_id: d.senderId,
    recipient_id: null,
    conversation_id: d.conversationId,
    source: "outstand",
    text,
    ts: Date.parse(d.sentAt) || Date.now(),
  };
  queue.push(item);
  if (queue.length > QUEUE_CAP) queue = queue.slice(queue.length - QUEUE_CAP);
  saveQueue();
  /* Cockpit inbox: durable history + unread counts, independent of the bot. */
  try { require("./inbox").recordIn(item, d); } catch (_) {}
  /* Cloud brain: when QwenWork OpenAPI is authorized, answer right here on the
     hosted server (Mac-independent). No-op otherwise — the local watcher path
     keeps working unchanged. */
  try { require("./qwenwork").onIncoming(item).catch(() => {}); } catch (_) {}
  return json(res, 200, { received: 1 });
}

module.exports = { handle, handleOutstand };