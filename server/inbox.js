/* EARNest · Social Inbox — durable DM history + founder takeover.
   Every inbound DM (Outstand webhook or the bridge poller) lands here, and
   every outbound reply (AI or founder) is recorded, so the cockpit shows full
   threads. History can be backfilled from Outstand's Conversations API.

   The bridge poller drains the frozen sibling page's webhook queue so DMs
   flow to THIS page's responder + inbox without re-registering anything:
   the sibling keeps receiving webhooks, we poll its queue server-side. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { q } = require("./db");
const qw = require("./qwenwork");

const iso = (ms) => new Date(ms || Date.now()).toISOString();
function webhookCfg() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(path.join(__dirname, "igwebhook-config.json"), "utf8")); } catch (_) {}
  return { ...file, poll_token: file.poll_token || kvGet("ig_poll_token"), outstand_signing_secret: file.outstand_signing_secret || kvGet("ig_signing_secret") };
}
function kvGet(k) { const r = q.get("SELECT value FROM config WHERE key=?", k); return r && r.value ? r.value : ""; }
function kvSet(k, v) {
  if (v == null || v === "") q.run("DELETE FROM config WHERE key=?", k);
  else q.run("INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, String(v));
}

function upsertConv(id, f = {}) {
  q.run(`INSERT INTO social_conversations (id, platform, handle, display_name, avatar, last_message_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           handle=COALESCE(excluded.handle, social_conversations.handle),
           display_name=COALESCE(excluded.display_name, social_conversations.display_name),
           avatar=COALESCE(excluded.avatar, social_conversations.avatar),
           last_message_at=MAX(COALESCE(excluded.last_message_at,''), COALESCE(social_conversations.last_message_at,''))`,
    id, f.platform || "instagram", f.handle || null, f.display_name || null, f.avatar || null, f.last_message_at || null);
}

/* inbound customer message (webhook item + raw Outstand data) */
function recordIn(item, d = {}) {
  const id = item.conversation_id;
  if (!id || !item.text) return;
  upsertConv(id, {
    handle: d.senderUsername || d.senderHandle || d.sender_username || null,
    display_name: d.senderDisplayName || d.senderName || d.sender_display_name || null,
    avatar: d.senderProfilePicture || d.senderAvatar || null,
    last_message_at: iso(item.ts),
  });
  const r = q.run(`INSERT OR IGNORE INTO social_messages (conversation_id,direction,actor,external_mid,text,created_at)
                   VALUES (?,?,?,?,?,?)`, id, "in", "customer", item.mid || null, String(item.text).slice(0, 2000), iso(item.ts));
  if (r.changes) {
    q.run(`UPDATE social_conversations SET unread=unread+1, last_message_at=?,
           needs_human=CASE WHEN bot_paused=1 THEN 1 ELSE needs_human END WHERE id=?`, iso(item.ts), id);
  }
}

/* outbound reply — actor "ai" (responder) or "admin" (founder) */
function recordOut(convId, text, actor, mid) {
  if (!convId || !text) return;
  upsertConv(convId, { last_message_at: iso() });
  q.run(`INSERT OR IGNORE INTO social_messages (conversation_id,direction,actor,external_mid,text,created_at)
         VALUES (?,?,?,?,?,?)`, convId, "out", actor, mid || null, String(text).slice(0, 2000), iso());
  q.run("UPDATE social_conversations SET last_message_at=? WHERE id=?", iso(), convId);
}

function isPaused(convId) { const r = q.get("SELECT bot_paused FROM social_conversations WHERE id=?", convId); return !!(r && r.bot_paused); }
function flagHuman(convId) { q.run("UPDATE social_conversations SET needs_human=1 WHERE id=?", convId); }
function setPaused(convId, paused) {
  upsertConv(convId, {});
  q.run("UPDATE social_conversations SET bot_paused=?, needs_human=? WHERE id=?", paused ? 1 : 0, paused ? 1 : 0, convId);
}
function markRead(convId) { q.run("UPDATE social_conversations SET unread=0, needs_human=0 WHERE id=?", convId); }

function list() {
  const convs = q.all(`SELECT c.*, (SELECT text FROM social_messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_text,
                       (SELECT actor FROM social_messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_actor
                       FROM social_conversations c ORDER BY c.last_message_at DESC LIMIT 100`);
  return convs;
}
function thread(convId) {
  const conversation = q.get("SELECT * FROM social_conversations WHERE id=?", convId);
  if (!conversation) return null;
  const messages = q.all("SELECT * FROM social_messages WHERE conversation_id=? ORDER BY id LIMIT 500", convId);
  markRead(convId);
  return { conversation, messages };
}
function summary() {
  const s = q.get("SELECT COUNT(*) AS n, COALESCE(SUM(unread),0) AS unread, COALESCE(SUM(needs_human),0) AS needs_human, COALESCE(SUM(bot_paused),0) AS paused FROM social_conversations");
  return { conversations: s.n, unread: s.unread, needs_human: s.needs_human, paused_threads: s.paused, bot_enabled: qw.enabled() };
}

/* ---- backfill / refresh from Outstand's Conversations API ---- */
let syncing = null;
async function syncFromOutstand() {
  if (syncing) return syncing;
  syncing = (async () => {
    const key = qw.outstandKey();
    if (!key) return { ok: false, error: "Outstand key not configured" };
    const base = qw.outstandBase();
    const H = { Authorization: "Bearer " + key, Accept: "application/json" };
    let convs = 0, msgs = 0;
    try {
      const r = await fetch(base + "/conversations?limit=50", { headers: H, signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: "Outstand HTTP " + r.status };
      for (const c of j.data || []) {
        upsertConv(c.id, {
          platform: c.network || "instagram",
          handle: c.participantUsername || c.participantHandle || null,
          display_name: c.participantDisplayName || null,
          avatar: c.participantProfilePicture || null,
          last_message_at: c.lastMessageAt || null,
        });
        convs++;
        const mr = await fetch(base + `/conversations/${encodeURIComponent(c.id)}/messages?limit=50`, { headers: H, signal: AbortSignal.timeout(20000) });
        const mj = await mr.json().catch(() => ({}));
        for (const m of mj.data || []) {
          const out = m.direction === "outbound";
          const res = q.run(`INSERT OR IGNORE INTO social_messages (conversation_id,direction,actor,external_mid,text,created_at)
                             VALUES (?,?,?,?,?,?)`,
            c.id, out ? "out" : "in", out ? (m.source === "api" ? "ai" : "admin") : "customer",
            m.id, String(m.content || "").slice(0, 2000), m.createdAt || m.platformSentAt || iso());
          msgs += res.changes ? 1 : 0;
        }
      }
      kvSet("inbox_last_sync", iso());
      return { ok: true, conversations: convs, new_messages: msgs };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
    finally { syncing = null; }
  })();
  return syncing;
}
function syncIfStale(maxAgeMs = 5 * 60000) {
  const last = Date.parse(kvGet("inbox_last_sync") || 0);
  if (!last || Date.now() - last > maxAgeMs) syncFromOutstand().catch(() => {});
}

/* ---- bridge poller: drain the frozen sibling's webhook queue ----
   Runs automatically whenever the responder is authorized on THIS page
   (opt out with config kv ig_bridge_disabled=1). Skips the backlog on first
   start so already-answered DMs aren't re-answered. */
const BRIDGE_SOURCE_DEFAULT = "https://xuw6xcjq.qwenwork.page";
let bridgeTimer = null;
let bridging = false;
async function bridgeTick() {
  if (bridging || !qw.enabled() || kvGet("ig_bridge_disabled") === "1") return;
  bridging = true;
  try {
    const pt = webhookCfg().poll_token;
    if (!pt) return;
    const src = (kvGet("ig_bridge_source") || BRIDGE_SOURCE_DEFAULT).replace(/\/+$/, "");
    let after = Number(kvGet("ig_bridge_seq") || 0);
    const r = await fetch(`${src}/api/ig-webhook/poll?token=${encodeURIComponent(pt)}&after=${after}`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(j.events)) return;
    if (!after && j.latest_seq) {
      /* first start: adopt the current cursor, backfill history via Outstand */
      kvSet("ig_bridge_seq", String(j.latest_seq));
      syncFromOutstand().catch(() => {});
      return;
    }
    for (const item of j.events) {
      if (item.seq > after) after = item.seq;
      if (!item.conversation_id || item.sender_id === "token-handoff-probe") continue;
      recordIn(item, {});
      try { await qw.onIncoming(item); } catch (_) {}
    }
    kvSet("ig_bridge_seq", String(after));
  } catch (_) { /* source unreachable — retry next tick */ }
  finally { bridging = false; }
}
function startBridge() {
  if (bridgeTimer) return;
  bridgeTimer = setInterval(() => bridgeTick().catch(() => {}), 2000);
  bridgeTimer.unref();
}

/* ---- live inbound poller (cloud responder) ----
   The frozen sibling polls Outstand directly; on this backend we do the same
   so new DMs arrive without re-pointing any webhook. Records new inbound
   messages and hands them to the responder (which honours per-thread takeover).
   The first run adopts a cursor at the newest message so the historical
   backlog is backfilled but never auto-answered. */
let pollTimer = null, polling = false;
async function pollOutstand() {
  if (polling || !qw.enabled() || kvGet("ig_poll_disabled") === "1") return;
  const key = qw.outstandKey();
  if (!key) return;
  polling = true;
  try {
    const base = qw.outstandBase();
    const H = { Authorization: "Bearer " + key, Accept: "application/json" };
    const since = Number(kvGet("ig_poll_since") || 0);
    const firstRun = !since;
    const r = await fetch(base + "/conversations?limit=50", { headers: H, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    let maxTs = since || Date.now();
    for (const c of j.data || []) {
      upsertConv(c.id, {
        platform: c.network || "instagram",
        handle: c.participantUsername || c.participantHandle || null,
        display_name: c.participantDisplayName || null,
        avatar: c.participantProfilePicture || null,
        last_message_at: c.lastMessageAt || null,
      });
      const mr = await fetch(base + `/conversations/${encodeURIComponent(c.id)}/messages?limit=50`, { headers: H, signal: AbortSignal.timeout(20000) });
      const mj = await mr.json().catch(() => ({}));
      for (const m of mj.data || []) {
        const ts = Date.parse(m.createdAt || m.platformSentAt || "") || Date.now();
        if (ts > maxTs) maxTs = ts;
        const out = m.direction === "outbound";
        const text = String(m.content || "").slice(0, 2000);
        if (!text) continue;
        const res = q.run(`INSERT OR IGNORE INTO social_messages (conversation_id,direction,actor,external_mid,text,created_at)
                           VALUES (?,?,?,?,?,?)`,
          c.id, out ? "out" : "in", out ? (m.source === "api" ? "ai" : "admin") : "customer", m.id, text, new Date(ts).toISOString());
        if (res.changes && !out) {
          q.run(`UPDATE social_conversations SET unread=unread+1, last_message_at=?,
                 needs_human=CASE WHEN bot_paused=1 THEN 1 ELSE needs_human END WHERE id=?`, new Date(ts).toISOString(), c.id);
          if (!firstRun && ts > since) {
            try { await qw.onIncoming({ source: "outstand", conversation_id: c.id, mid: m.id, text, ts }); } catch (_) {}
          }
        }
      }
    }
    kvSet("ig_poll_since", String(maxTs));
  } catch (_) { /* retry next tick */ }
  finally { polling = false; }
}
function startPoller() {
  if (pollTimer) return;
  pollTimer = setInterval(() => pollOutstand().catch(() => {}), 45000);
  pollTimer.unref();
  pollOutstand().catch(() => {});
}

module.exports = { recordIn, recordOut, isPaused, flagHuman, setPaused, markRead, list, thread, summary, syncFromOutstand, syncIfStale, startBridge, bridgeTick, startPoller, pollOutstand };