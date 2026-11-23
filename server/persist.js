/* EARNest · durable persistence — the local SQLite file is the working store;
   every mutation is mirrored to the Page's Supabase database (table snapshots)
   so data survives redeploys and cold starts. On boot the SQLite file is
   hydrated from Supabase before seeding. Server-side only: the anon key never
   reaches the browser. No direct Postgres connections.

   The Page gateway caps request bodies at ~1MB, so a table snapshot is split
   into ≤600KB chunk rows ("{table}~{NNN}") with a "{table}~meta" commit marker
   written last (same pattern as videohost.js). Hydration reassembles chunks
   and still reads legacy single-row snapshots ("{table}"). */
"use strict";
const { db, q, onChange } = require("./db");

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
const ENABLED = !!(URL && KEY);

/* hydration order respects foreign keys */
const TABLES = [
  "config", "researchers", "users", "oauth_accounts", "sessions", "awards", "papers",
  "studies", "questions", "discoveries", "impact_items", "responses", "hearts", "follows",
  "reposts", "unlocked_papers", "payment_methods", "withdrawals", "wallet_ledger",
  "games", "game_plays", "comments", "comment_likes", "settings", "researcher_surveys",
  "user_preferences", "user_vectors", "item_stats", "seen_items", "feed_events",
  "social_conversations", "social_messages", "audit_log",
];
const CAPS = { feed_events: 6000, seen_items: 6000, social_messages: 4000, audit_log: 2000 };
const CHUNK_BYTES = 600 * 1024;

const dirty = new Set();
let timer = null;
let flushing = false;

function headers() {
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
}
const chunkName = (table, i) => `${table}~${String(i).padStart(3, "0")}`;
const metaName = (table) => `${table}~meta`;

/* split rows so each serialized chunk body stays under CHUNK_BYTES */
function splitChunks(rows) {
  const chunks = [];
  let cur = [], size = 0;
  for (const row of rows) {
    const n = JSON.stringify(row).length + 1;
    if (cur.length && size + n > CHUNK_BYTES - 4096) { chunks.push(cur); cur = []; size = 0; }
    cur.push(row); size += n;
  }
  chunks.push(cur);
  return chunks;
}

async function hydrate() {
  if (!ENABLED) return { enabled: false };
  try {
    const r = await fetch(`${URL}/rest/v1/app_tables?select=name,data`, { headers: headers(), signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const rows = await r.json();
    let loaded = 0;
    const byName = new Map(rows.map((row) => [row.name, row.data]));
    for (const table of TABLES) {
      let data = null;
      const meta = byName.get(metaName(table));
      if (meta && Number.isInteger(meta.chunks)) {
        const parts = [];
        let complete = true;
        for (let i = 0; i < meta.chunks; i++) {
          const c = byName.get(chunkName(table, i));
          if (!Array.isArray(c)) { complete = false; break; }
          parts.push(...c);
        }
        if (complete) data = parts;
      }
      if (!data) {
        const legacy = byName.get(table);
        if (Array.isArray(legacy)) data = legacy;
      }
      if (!Array.isArray(data) || !data.length) continue;
      const cols = Object.keys(data[0]);
      const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
      for (const row of data) {
        try { stmt.run(...cols.map((c) => row[c] === undefined ? null : row[c])); } catch {}
      }
      loaded += data.length;
      /* yield between tables so cold-start health probes are never starved */
      await new Promise((res) => setImmediate(res));
    }
    console.log(`persist: hydrated ${loaded} rows from Supabase (${rows.length} snapshot rows)`);
    return { enabled: true, rows: loaded };
  } catch (e) {
    console.error("persist: hydration failed —", e.message);
    return { enabled: true, error: e.message };
  }
}

function markDirty(sql) {
  if (!ENABLED) return;
  const m = String(sql).match(/^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?(\w+)/i);
  if (!m) return;
  const table = m[1].toLowerCase();
  if (!TABLES.includes(table)) return;
  dirty.add(table);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => flush().catch((e) => console.error("persist:", e.message)), 1500);
}

async function upsertRows(rows) {
  const r = await fetch(`${URL}/rest/v1/app_tables?on_conflict=name`, {
    method: "POST",
    headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error("upsert HTTP " + r.status);
}

async function flushTable(table) {
  const cap = CAPS[table];
  const rows = cap ? q.all(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT ${cap}`) : q.all(`SELECT * FROM ${table}`);
  const chunks = splitChunks(rows);
  const now = new Date().toISOString();
  /* chunk rows first, meta commit marker last */
  for (let i = 0; i < chunks.length; i++) {
    await upsertRows([{ name: chunkName(table, i), data: chunks[i], updated_at: now }]);
  }
  await upsertRows([{ name: metaName(table), data: { chunks: chunks.length, rows: rows.length }, updated_at: now }]);
  /* drop stale rows: the legacy single-row snapshot and any excess chunks */
  try {
    const keep = new Set([metaName(table), ...chunks.map((_, i) => chunkName(table, i))]);
    const r = await fetch(`${URL}/rest/v1/app_tables?select=name&or=(name.eq.${table},name.like.${table}~*)`, { headers: headers(), signal: AbortSignal.timeout(30000) });
    if (r.ok) {
      const stale = (await r.json()).map((x) => x.name).filter((n) => !keep.has(n));
      if (stale.length) {
        const list = stale.map((n) => `"${n}"`).join(",");
        await fetch(`${URL}/rest/v1/app_tables?name=in.(${encodeURIComponent(list)})`, { method: "DELETE", headers: headers(), signal: AbortSignal.timeout(30000) });
      }
    }
  } catch {}
}

async function flush() {
  if (!ENABLED || flushing || !dirty.size) return;
  flushing = true;
  const tables = [...dirty];
  dirty.clear();
  try {
    for (const table of tables) {
      try { await flushTable(table); }
      catch (e) { dirty.add(table); console.error(`persist: ${table} — ${e.message}`); }
    }
  } finally { flushing = false; }
}

function init() {
  if (!ENABLED) { console.log("persist: Supabase not configured — local SQLite only"); return Promise.resolve({ enabled: false }); }
  onChange(markDirty);
  process.on("SIGTERM", () => { flush().finally(() => process.exit(0)); });
  process.on("beforeExit", () => { if (dirty.size) flush().catch(() => {}); });
  return hydrate();
}

module.exports = { init, flush, markDirty, ENABLED };