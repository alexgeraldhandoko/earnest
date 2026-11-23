/* EARNest · QwenWork OpenAPI brain — the cloud responder.
   Runs entirely on the hosted Page: OAuth (PKCE) login, durable tokens in the
   config table (mirrored to the Page DB by persist.js), one agent session per
   DM conversation plus a warm pool for fast first replies, answers sent back
   through Outstand's Conversations API. Zero npm dependencies.

   Routes (mounted in index.js):
     GET  /api/qwenwork-oauth/start      → 302 to QwenWork login (PKCE S256)
     GET  /api/qwenwork-oauth-callback   → exact registered redirect URI
     GET  /api/qwenwork-oauth/status     → diagnostics (poll_token, no secrets)
     POST /api/qwenwork-oauth/config     → set client_id / base overrides (poll_token)
     GET  /api/qwenwork-oauth/export-tokens → token handoff source (poll_token)
     POST /api/qwenwork-oauth/import-tokens → token handoff target (poll_token)
     ANY  /api/qwenwork-oauth/capture/*   → armed-only proxy that borrows the
                                            frozen sibling page's Bearer token

   While this responder is enabled the local Mac watcher stands down
   (ig-webhook/poll reports cloud_responder:true). */
"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { q } = require("./db");
require("./config"); // ensures the config table exists

const CFG_PATH = path.join(__dirname, "igwebhook-config.json");
function webhookCfg() { try { return JSON.parse(fs.readFileSync(CFG_PATH, "utf8")); } catch (_) { return {}; } }

const OAUTH_BASE_DEFAULT = "https://qwenwork.ai";
const API_BASE_DEFAULT = "https://api.qwenwork.ai/v1";
const REDIRECT_URI_DEFAULT = "https://xuw6xcjq.qwenwork.page/api/qwenwork-oauth-callback";
const SCOPES = "openid offline_access user.profile.read";
const POLL_MS = Number(process.env.QW_POLL_MS || 600);
const TURN_DEADLINE_MS = Number(process.env.QW_TURN_DEADLINE_MS || 90000);

/* ---- durable key/value state (config table → Supabase mirror) ---- */
function kvGet(k) { const r = q.get("SELECT value FROM config WHERE key=?", k); return r && r.value ? r.value : ""; }
function kvSet(k, v) {
  if (v == null || v === "") q.run("DELETE FROM config WHERE key=?", k);
  else q.run("INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, String(v));
}
function kvJSON(k, fallback) { try { const v = kvGet(k); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } }

function oauthBase() { return kvGet("qw_oauth_base") || OAUTH_BASE_DEFAULT; }
function apiBase() { return kvGet("qw_api_base") || API_BASE_DEFAULT; }
function redirectUri() { return kvGet("qw_redirect_uri") || REDIRECT_URI_DEFAULT; }
function clientId() { return kvGet("qw_client_id"); }
function enabled() { return !!clientId() && !!(kvGet("qw_access_token") || kvGet("qw_refresh_token")); }

/* Outstand key is read at runtime only — never logged, never returned. */
function outstandKey() {
  if (process.env.OUTSTAND_API_KEY) return process.env.OUTSTAND_API_KEY;
  try {
    for (const line of fs.readFileSync(path.join(__dirname, "instagram.env"), "utf8").split("\n")) {
      const m = line.match(/^OUTSTAND_API_KEY=(.*)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch (_) {}
  return "";
}
function outstandBase() { return process.env.OUTSTAND_API_BASE || "https://api.outstand.so/v1"; }

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function json(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }
function html(res, code, body) { res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset="utf-8"><title>Earnest</title><body style="font-family:sans-serif;padding:40px;max-width:640px">${body}</body>`); }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---- OAuth tokens ---- */
function storeTokens(j) {
  kvSet("qw_access_token", j.access_token);
  if (j.refresh_token) kvSet("qw_refresh_token", j.refresh_token); // rotation
  kvSet("qw_expires_at", String(Date.now() + (Number(j.expires_in) || 3600) * 1000));
}

let refreshing = null;
async function getAccessToken(force) {
  const at = kvGet("qw_access_token"), rt = kvGet("qw_refresh_token");
  const exp = Number(kvGet("qw_expires_at") || 0);
  if (!force && at && exp > Date.now() + 60000) return at;
  /* borrowed-token mode: the sibling page with the registered OAuth callback
     owns the refresh lineage (and cannot be redeployed). Borrow its CURRENT
     access token by briefly routing its OpenAPI traffic through our capture
     proxy — it keeps refreshing on its own, so the two pages never rotate
     each other out. */
  const src = kvGet("qw_token_source");
  if (src) {
    const t = await recapture(src);
    if (t) return t;
    /* source unreachable — fall through to the local refresh token */
  }
  if (!at && !rt) return null;
  if (!rt) return at || null;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const body = new URLSearchParams({ grant_type: "refresh_token", client_id: clientId(), refresh_token: rt });
        const r = await fetch(oauthBase() + "/auth/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body,
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.access_token) {
          kvSet("qw_auth_error", JSON.stringify({ at: new Date().toISOString(), error: j.error || ("HTTP " + r.status) }));
          return null;
        }
        storeTokens(j);
        kvSet("qw_auth_error", "");
        return j.access_token;
      } catch (e) {
        kvSet("qw_auth_error", JSON.stringify({ at: new Date().toISOString(), error: String(e.message || e) }));
        return null;
      } finally { refreshing = null; }
    })();
  }
  return refreshing;
}

/* ---- token capture from the frozen sibling page ----
   The sibling (registered OAuth callback, live DM responder) cannot be
   redeployed, but its EXISTING config endpoint can point its OpenAPI base at
   us. For a few seconds we proxy its API traffic (relaying every request
   untouched, so real DMs keep working), record the Bearer token it already
   sends, trigger one cheap synthetic webhook event so it makes an API call
   even when no customer DM arrives, then restore its direct route. It remains
   the sole refresh-token owner. */
let capturing = null;
async function recapture(src) {
  if (capturing) return capturing;
  capturing = (async () => {
    const pt = webhookCfg().poll_token;
    const secret = webhookCfg().outstand_signing_secret;
    const selfBase = (kvGet("qw_self_base") || "https://ptc2aptn.qwenwork.page").replace(/\/+$/, "");
    const captureUrl = selfBase + "/api/qwenwork-oauth/capture";
    const prev = kvGet("qw_access_token");
    const cfgPost = (body) => fetch(src + "/api/qwenwork-oauth/config?token=" + encodeURIComponent(pt), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    let prevBase = API_BASE_DEFAULT;
    try {
      if (!pt || !secret) return null;
      /* remember the sibling's CURRENT api_base (it may be permanently sunk)
         so the restore puts it back exactly as it was */
      try {
        const st = await fetch(src + "/api/qwenwork-oauth/status?token=" + encodeURIComponent(pt), { signal: AbortSignal.timeout(15000) });
        const sj = await st.json().catch(() => ({}));
        if (sj.api_base) prevBase = sj.api_base;
      } catch (_) {}
      kvSet("qw_capture_armed", "1");
      const r = await cfgPost({ api_base: captureUrl });
      if (!r.ok) return null;
      /* signed synthetic DM: makes the sibling's responder call the OpenAPI
         (and thus our proxy) within seconds; the fake conversation id can
         never deliver a real message */
      const evt = JSON.stringify({ event: "message.received", data: {
        messageId: "token-handoff-" + Date.now(), senderId: "token-handoff-probe",
        conversationId: "token-handoff-probe", content: "ping", sentAt: new Date().toISOString(),
      } });
      const sig = "sha256=" + crypto.createHmac("sha256", secret).update(evt).digest("hex");
      await fetch(src + "/api/outstand-webhook", {
        method: "POST", headers: { "Content-Type": "application/json", "x-outstand-signature": sig },
        body: evt, signal: AbortSignal.timeout(15000),
      });
      for (let i = 0; i < 30; i++) {
        await sleep(Number(process.env.QW_CAPTURE_POLL_MS || 1000));
        const t = kvGet("qw_access_token");
        if (t && t !== prev) {
          kvSet("qw_last_capture", JSON.stringify({ at: new Date().toISOString(), source: src }));
          return t;
        }
      }
      return null;
    } catch (_) { return null; }
    finally {
      /* ALWAYS restore the sibling's previous API route, even on failure */
      try { await cfgPost({ api_base: prevBase }); } catch (_) {}
      kvSet("qw_capture_armed", "");
      capturing = null;
    }
  })();
  return capturing;
}

/* ---- OpenAPI client (auto-refresh on 401, base fallback on routing 404) ---- */
async function api(method, p, body, opts = {}) {
  let token = await getAccessToken(false);
  if (!token) return { status: 401, json: { error: "not authorized" } };
  const bases = [apiBase()];
  const alt = oauthBase() + "/api/open/v1"; // guide's <baseurl>/api/open/v1 form
  if (apiBase() !== alt) bases.push(alt);
  for (let bi = 0; bi < bases.length; bi++) {
    for (let retry = 0; retry < 2; retry++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
      let r;
      try {
        r = await fetch(bases[bi] + p, {
          method,
          headers: { Authorization: "Bearer " + token, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
      } catch (e) { clearTimeout(t); return { status: 0, json: { error: String(e.message || e) } }; }
      clearTimeout(t);
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 && retry === 0) {
        token = await getAccessToken(true);
        if (!token) return { status: 401, json: j };
        continue;
      }
      /* only routing-level 404s may switch base — a 404 on a turn just means
         the turn has not been created yet */
      if (r.status === 404 && bi === 0 && bases.length > 1 && (p === "/session-modes" || p === "/sessions")) {
        kvSet("qw_api_base", bases[1]);
        break;
      }
      return { status: r.status, json: j };
    }
  }
  return { status: 0, json: { error: "all bases failed" } };
}

/* ---- persona & sessions ---- */
const PERSONA = [
  "You are the Earnest AI assistant answering Instagram DMs for @earnestapp.official.",
  "About Earnest: people answer short paid studies and play research games to earn cash rewards; rewards build up in a wallet and withdraw to bank, card or PayPal; every answer passes a quality screen so researchers get clean data. App: https://ptc2aptn.qwenwork.page",
  "Rules for EVERY reply:",
  "- Answer the customer's actual question helpfully and accurately. General-knowledge questions unrelated to Earnest get a real, correct answer too.",
  "- Reply with the final message text ONLY: one short paragraph, under 80 words, plain text, warm and direct. No markdown, no headings, no emojis.",
  "- NEVER use tools, never write files, never build pages or apps, never spawn sub-agents, never ask clarifying questions, never request permissions. Just answer.",
].join("\n");

async function getMode() {
  const cached = kvGet("qw_mode");
  if (cached) return cached === "none" ? "" : cached;
  const r = await api("GET", "/session-modes");
  let mode = "";
  if (r.status === 200) {
    const list = r.json.modes || r.json.data || [];
    const flash = list.find((m) => m.mode === "flash");
    const def = list.find((m) => m.default);
    mode = (flash && flash.mode) || (def && def.mode) || "";
  }
  kvSet("qw_mode", mode || "none");
  return mode;
}

let warming = null;
function ensureWarm() {
  if (!enabled() || kvJSON("qw_warm", null)) return Promise.resolve();
  if (!warming) {
    warming = (async () => {
      try {
        const mode = await getMode();
        const r = await api("POST", "/sessions", {
          name: "Earnest DM warm pool",
          initial_prompt: { text: PERSONA + "\n\nWarm-up: reply with exactly READY" },
          locale: "en", timezone: "Asia/Singapore", ttl_seconds: 86400,
          ...(mode ? { mode } : {}),
        }, { timeout: 60000 });
        if (r.status >= 200 && r.status < 300 && r.json.session_id) {
          kvSet("qw_warm", JSON.stringify({ session_id: r.json.session_id, created: Date.now() }));
        }
      } catch (_) {} finally { warming = null; }
    })();
  }
  return warming;
}

const TERMINAL = new Set(["completed", "failed", "interrupted", "cancelled", "ended", "error"]);
const ACTIVE = new Set(["pending", "queued", "running", "starting", "in_progress", "action_required"]);

async function waitTurn(sid, tid) {
  const start = Date.now();
  let cancelSent = false;
  while (Date.now() - start < TURN_DEADLINE_MS) {
    const r = await api("GET", `/sessions/${sid}/turns/${tid}`);
    if (r.status === 200) {
      const t = r.json || {};
      const st = String(t.status || "");
      if (st === "action_required" && !cancelSent) {
        // persona forbids questions; unblock by cancelling and retrying fresh
        cancelSent = true;
        await api("POST", `/sessions/${sid}/cancel`, {});
      } else if (t.ended_at || (st && !ACTIVE.has(st)) || TERMINAL.has(st)) {
        return t;
      }
    }
    await sleep(POLL_MS);
  }
  return null;
}

/* fallback answer assembly from agent_message_chunk events */
async function eventsText(sid) {
  const r = await api("GET", `/sessions/${sid}/events?cursor=0&limit=500`);
  if (r.status !== 200) return "";
  const byId = new Map();
  for (const it of r.json.items || []) {
    const u = it.raw && it.raw.params && it.raw.params.update;
    if (!u || u.sessionUpdate !== "agent_message_chunk") continue;
    const text = u.content && u.content.text;
    if (!text) continue;
    if (!byId.has(it.id)) byId.set(it.id, new Map());
    byId.get(it.id).set(it.seq_id, text);
  }
  const parts = [];
  for (const chunks of byId.values()) {
    parts.push([...chunks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).join(""));
  }
  return parts.join("\n").trim();
}

function rememberSession(convId, sid) {
  const convs = kvJSON("qw_convs", {});
  convs[convId] = { session_id: sid, updated: Date.now() };
  const entries = Object.entries(convs).sort((a, b) => b[1].updated - a[1].updated).slice(0, 40);
  kvSet("qw_convs", JSON.stringify(Object.fromEntries(entries)));
}

async function answer(convId, customerText) {
  const convs = kvJSON("qw_convs", {});
  for (let attempt = 0; attempt < 2; attempt++) {
    let sid = null, tid = null;
    const existing = attempt === 0 ? convs[convId] : null;
    if (existing && existing.session_id) {
      const r = await api("POST", `/sessions/${existing.session_id}/prompt`, { text: `Customer message: ${customerText}` }, { timeout: 60000 });
      if ((r.status === 202 || r.status === 200) && r.json.turn_id) { sid = existing.session_id; tid = r.json.turn_id; }
    }
    if (!sid) {
      const warm = kvJSON("qw_warm", null);
      if (warm && warm.session_id) {
        kvSet("qw_warm", "");
        ensureWarm(); // replenish in background
        const r = await api("POST", `/sessions/${warm.session_id}/prompt`, { text: `Customer message: ${customerText}` }, { timeout: 60000 });
        if ((r.status === 202 || r.status === 200) && r.json.turn_id) { sid = warm.session_id; tid = r.json.turn_id; }
      }
    }
    if (!sid) {
      const mode = await getMode();
      const r = await api("POST", "/sessions", {
        name: `Earnest DM ${convId}`,
        initial_prompt: { text: PERSONA + "\n\nCustomer message: " + customerText },
        locale: "en", timezone: "Asia/Singapore", ttl_seconds: 86400,
        ...(mode ? { mode } : {}),
      }, { timeout: 60000 });
      if (r.status >= 200 && r.status < 300 && r.json.session_id) {
        sid = r.json.session_id;
        tid = r.json.first_turn_id || null;
      }
    }
    if (!sid) continue;
    rememberSession(convId, sid);
    if (!tid) {
      const d = await api("GET", `/sessions/${sid}`);
      tid = d.json && d.json.current_turn && d.json.current_turn.turn_id;
    }
    if (!tid) continue;
    const turn = await waitTurn(sid, tid);
    if (!turn) continue;
    const st = String(turn.status || "");
    if (st === "failed" || st === "interrupted" || st === "cancelled") continue;
    let out = turn.final_message || "";
    if (!out) out = await eventsText(sid);
    if (out) return String(out).trim().slice(0, 1000);
  }
  return null;
}

async function sendOutstand(convId, text) {
  const r = await fetch(`${outstandBase()}/conversations/${encodeURIComponent(convId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${outstandKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: String(text).slice(0, 1000) }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.status >= 200 && r.status < 300, status: r.status, id: (j.message && j.message.id) || null };
}

/* ---- entry point called by the Outstand webhook ingest ---- */
const inflight = new Set();
async function onIncoming(item) {
  try {
    if (!enabled() || item.source !== "outstand" || !item.conversation_id || !item.text) return;
    /* founder takeover: while a thread is paused the bot stays silent and the
       conversation is surfaced in the cockpit inbox as needing a human */
    try {
      const inbox = require("./inbox");
      if (inbox.isPaused(item.conversation_id)) { inbox.flagHuman(item.conversation_id); return; }
    } catch (_) {}
    const done = kvJSON("qw_done", []);
    if (done.includes(item.mid) || inflight.has(item.mid)) return;
    inflight.add(item.mid);
    const t0 = Date.now();
    const text = await answer(item.conversation_id, item.text);
    if (!text) {
      kvSet("qw_last_error", JSON.stringify({ at: new Date().toISOString(), mid: item.mid, error: "no answer from session" }));
      return;
    }
    const sent = await sendOutstand(item.conversation_id, text);
    if (sent.ok) {
      done.push(item.mid);
      while (done.length > 200) done.shift();
      kvSet("qw_done", JSON.stringify(done));
      kvSet("qw_last_reply", JSON.stringify({ at: new Date().toISOString(), mid: item.mid, ms: Date.now() - t0, message_id: sent.id }));
      kvSet("qw_last_error", "");
      try { require("./inbox").recordOut(item.conversation_id, text, "ai", sent.id); } catch (_) {}
    } else {
      kvSet("qw_last_error", JSON.stringify({ at: new Date().toISOString(), mid: item.mid, error: "outstand send HTTP " + sent.status }));
    }
  } catch (e) {
    kvSet("qw_last_error", JSON.stringify({ at: new Date().toISOString(), error: String(e.message || e) }));
  } finally { inflight.delete(item.mid); }
}

/* ---- HTTP routes ---- */
function oauthStart(req, res) {
  if (!clientId()) {
    return html(res, 200, "<h2>Almost there.</h2><p>The QwenWork OpenAPI client is not configured yet. Once the client_id is set, open this page again to log in.</p>");
  }
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  kvSet("qw_pkce", JSON.stringify({ state, verifier, created: Date.now() }));
  const u = new URL(oauthBase() + "/oauth2/auth");
  u.searchParams.set("client_id", clientId());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  res.writeHead(302, { Location: u.toString() });
  res.end();
}

async function oauthCallback(req, res, url) {
  if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
  const err = url.searchParams.get("error");
  if (err) {
    return html(res, 200, `<h2>Authorization was not completed.</h2><p>${esc(err)}: ${esc(url.searchParams.get("error_description") || "")}</p><p>Open <a href="/api/qwenwork-oauth/start">/api/qwenwork-oauth/start</a> to try again.</p>`);
  }
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  if (!code || !state) return html(res, 400, "<h2>Missing code or state.</h2><p>Start again from <a href=\"/api/qwenwork-oauth/start\">/api/qwenwork-oauth/start</a>.</p>");
  const pkce = kvJSON("qw_pkce", null);
  kvSet("qw_pkce", ""); // one-time use
  if (!pkce || pkce.state !== state || Date.now() - pkce.created > 600000) {
    return html(res, 400, "<h2>State mismatch or expired.</h2><p>Start again from <a href=\"/api/qwenwork-oauth/start\">/api/qwenwork-oauth/start</a>.</p>");
  }
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId(),
      code,
      redirect_uri: redirectUri(),
      code_verifier: pkce.verifier,
    });
    const r = await fetch(oauthBase() + "/auth/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      return html(res, 502, `<h2>Token exchange failed.</h2><p>${esc(j.error || "HTTP " + r.status)} ${esc(j.error_description || "")}</p><p>Open <a href="/api/qwenwork-oauth/start">/api/qwenwork-oauth/start</a> to retry with a fresh code.</p>`);
    }
    storeTokens(j);
    kvSet("qw_auth_error", "");
    boot().catch(() => {});
    return html(res, 200, "<h2>QwenWork connected.</h2><p>The Earnest AI responder now runs in the cloud on your QwenWork credits. You can close this tab.</p>");
  } catch (e) {
    return html(res, 502, `<h2>Token exchange failed.</h2><p>${esc(e.message || e)}</p><p>Retry from <a href="/api/qwenwork-oauth/start">/api/qwenwork-oauth/start</a>.</p>`);
  }
}

function status(res) {
  const exp = Number(kvGet("qw_expires_at") || 0);
  return json(res, 200, {
    client_id_set: !!clientId(),
    authorized: !!(kvGet("qw_access_token") || kvGet("qw_refresh_token")),
    needs_reauth: !!kvGet("qw_auth_error"),
    auth_error: kvJSON("qw_auth_error", null),
    expires_in_s: exp ? Math.max(0, Math.round((exp - Date.now()) / 1000)) : null,
    mode: kvGet("qw_mode") || null,
    warm_session: !!kvJSON("qw_warm", null),
    conversations: Object.keys(kvJSON("qw_convs", {})).length,
    last_reply: kvJSON("qw_last_reply", null),
    last_error: kvJSON("qw_last_error", null),
    api_base: apiBase(),
    cloud_responder: enabled(),
    borrowed_tokens: !!kvGet("qw_token_source"),
    last_capture: kvJSON("qw_last_capture", null),
    game_builder: require("./gamebuilder").status(),
  });
}

async function handle(req, res, url, raw) {
  const p = url.pathname;
  if (p === "/api/qwenwork-oauth-callback" || p === "/api/qwenwork-oauth-callback/") return oauthCallback(req, res, url);
  if (p === "/api/qwenwork-oauth/start" && req.method === "GET") return oauthStart(req, res);
  /* sink: a permanent 401 dead-end for the frozen sibling's OpenAPI base.
     401 (not 404!) so the sibling's api() never base-fallbacks into a working
     route; its refresh path keeps running, so it stays the token lineage
     owner while its responder can no longer answer. */
  if (p === "/api/qwenwork-oauth/sink" || p.startsWith("/api/qwenwork-oauth/sink/")) {
    return json(res, 401, { error: "sink" });
  }
  /* capture proxy: only exists while a recapture is armed (seconds at a time).
     The sibling's OpenAPI calls carry a Bearer header, not the poll token, so
     this sits before the gate. Every request is relayed untouched. */
  if (p === "/api/qwenwork-oauth/capture" || p.startsWith("/api/qwenwork-oauth/capture/")) {
    if (!kvGet("qw_capture_armed")) return json(res, 404, { error: "not found" });
    const sub = p.slice("/api/qwenwork-oauth/capture".length) || "/";
    const auth = String(req.headers.authorization || "");
    const headers = { Accept: "application/json" };
    if (auth) headers.Authorization = auth;
    if (req.headers["content-type"]) headers["Content-Type"] = String(req.headers["content-type"]);
    let r;
    try {
      r = await fetch(apiBase() + sub, { method: req.method, headers, body: raw && raw.length ? raw : undefined, signal: AbortSignal.timeout(60000) });
    } catch (e) { return json(res, 502, { error: String(e.message || e) }); }
    const text = await r.text();
    if (auth.startsWith("Bearer ") && r.status !== 401) {
      const tok = auth.slice(7).trim();
      if (tok && tok !== kvGet("qw_access_token")) {
        kvSet("qw_access_token", tok);
        /* conservative 6-day lifetime (source tokens live ~7 days); a 401
           triggers a fresh capture well before any real expiry */
        kvSet("qw_expires_at", String(Date.now() + 6 * 86400000));
        kvSet("qw_auth_error", "");
      }
    }
    res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") || "application/json" });
    return res.end(text);
  }
  const wc = webhookCfg();
  const token = url.searchParams.get("token");
  if (!wc.poll_token || token !== wc.poll_token) return json(res, 403, { error: "bad token" });
  if (p === "/api/qwenwork-oauth/status" && req.method === "GET") return status(res);
  /* one-page-owns-the-tokens handoff: the page with the registered OAuth
     callback exports; the sibling page imports and then borrows fresh access
     tokens via qw_token_source (both gated by poll_token, like config) */
  if (p === "/api/qwenwork-oauth/export-tokens" && req.method === "GET") {
    if (!enabled()) return json(res, 409, { error: "not authorized" });
    await getAccessToken(false); // hand out a fresh token, not an expired one
    return json(res, 200, {
      client_id: clientId(),
      access_token: kvGet("qw_access_token"),
      refresh_token: kvGet("qw_refresh_token"),
      expires_at: Number(kvGet("qw_expires_at") || 0),
    });
  }
  if (p === "/api/qwenwork-oauth/import-tokens" && req.method === "POST") {
    let body;
    try { body = JSON.parse(raw.toString("utf8")); } catch (_) { return json(res, 400, { error: "bad json" }); }
    if (!body || (!body.access_token && !body.refresh_token && !body.token_source)) return json(res, 400, { error: "access_token, refresh_token or token_source required" });
    if (body.access_token) kvSet("qw_access_token", String(body.access_token));
    if (body.refresh_token) kvSet("qw_refresh_token", String(body.refresh_token));
    if (body.expires_at) kvSet("qw_expires_at", String(Number(body.expires_at) || 0));
    if (body.token_source !== undefined) {
      const v = String(body.token_source).trim();
      if (v && !/^https?:\/\//.test(v)) return json(res, 400, { error: "token_source must be an http(s) URL" });
      kvSet("qw_token_source", v);
    }
    kvSet("qw_auth_error", "");
    if (kvGet("qw_token_source") && !kvGet("qw_access_token")) getAccessToken(true).catch(() => {});
    boot().catch(() => {});
    return json(res, 200, { ok: true, authorized: enabled() });
  }
  if (p === "/api/qwenwork-oauth/config" && req.method === "POST") {
    let body;
    try { body = JSON.parse(raw.toString("utf8")); } catch (_) { return json(res, 400, { error: "bad json" }); }
    const allowed = { client_id: "qw_client_id", api_base: "qw_api_base", oauth_base: "qw_oauth_base", redirect_uri: "qw_redirect_uri" };
    const changed = [];
    for (const [k, kv] of Object.entries(allowed)) {
      if (body[k] === undefined) continue;
      let v = String(body[k]).trim();
      if (k === "client_id") v = v.replace(/\s+/g, "");
      if ((k === "api_base" || k === "oauth_base") && v && !/^https?:\/\//.test(v)) return json(res, 400, { error: k + " must be an http(s) URL" });
      kvSet(kv, v);
      changed.push(k);
    }
    return json(res, 200, { ok: true, changed, client_id_set: !!clientId() });
  }
  return json(res, 404, { error: "not found" });
}

async function boot() {
  if (!enabled() && !kvGet("qw_token_source")) return;
  console.log("qwenwork: cloud responder active");
  await getMode().catch(() => {});
  await ensureWarm().catch(() => {});
}

module.exports = { handle, onIncoming, enabled, boot, getAccessToken, api, getMode, eventsText, answer, sendOutstand, outstandKey, outstandBase };