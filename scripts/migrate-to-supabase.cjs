/* Push the local curated DB + the 5 demo reels into a fresh Supabase
   project (the durable store Render hydrates from at boot). Idempotent.
   Run from the WORKSPACE root (needs data/earnest.db + the clip files):
     SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... \
       node --experimental-sqlite deploy-render/scripts/migrate-to-supabase.cjs
   Apply scripts/supabase-schema.sql in the Supabase SQL editor first. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
if (!URL || !KEY) { console.error("Set SUPABASE_URL and SUPABASE_ANON_KEY."); process.exit(1); }
const ROOT = path.join(__dirname, "..", "..");
const TABLES = [
  "config", "researchers", "users", "oauth_accounts", "sessions", "awards", "papers",
  "studies", "questions", "discoveries", "impact_items", "responses", "hearts", "follows",
  "reposts", "unlocked_papers", "payment_methods", "withdrawals", "wallet_ledger",
  "games", "game_plays", "comments", "comment_likes", "settings", "researcher_surveys",
  "user_preferences", "user_vectors", "item_stats", "seen_items", "feed_events",
  "social_conversations", "social_messages", "audit_log",
];
const CAPS = { feed_events: 6000, seen_items: 6000, social_messages: 4000, audit_log: 2000 };
const CHUNK = 600 * 1024;
const DEMO = ["s-2001", "s-2029", "s-2091", "s-2241", "s-2350"];
const headers = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
async function upsert(table, rows, conflict) {
  const r = await fetch(URL + "/rest/v1/" + table + "?on_conflict=" + conflict, {
    method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows), signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(table + " upsert HTTP " + r.status + " " + (await r.text()).slice(0, 200));
}
function splitChunks(rows) {
  const chunks = []; let cur = [], size = 0;
  for (const row of rows) {
    const n = JSON.stringify(row).length + 1;
    if (cur.length && size + n > CHUNK - 4096) { chunks.push(cur); cur = []; size = 0; }
    cur.push(row); size += n;
  }
  chunks.push(cur);
  return chunks;
}
(async () => {
  const db = new DatabaseSync(path.join(ROOT, "data", "earnest.db"), { readOnly: true });
  let total = 0;
  for (const t of TABLES) {
    let rows;
    try { rows = db.prepare("SELECT * FROM " + t + (CAPS[t] ? " ORDER BY rowid DESC LIMIT " + CAPS[t] : "")).all(); }
    catch { continue; }
    if (!rows.length) continue;
    const chunks = splitChunks(rows);
    const now = new Date().toISOString();
    for (let i = 0; i < chunks.length; i++) {
      await upsert("app_tables", [{ name: t + "~" + String(i).padStart(3, "0"), data: chunks[i], updated_at: now }], "name");
    }
    await upsert("app_tables", [{ name: t + "~meta", data: { chunks: chunks.length, rows: rows.length }, updated_at: now }], "name");
    total += rows.length;
    console.log(t + ": " + rows.length + " rows (" + chunks.length + " chunks)");
  }
  db.close();
  console.log("app_tables: " + total + " rows mirrored");
  /* demo reels → video_clips (base64 parts + meta commit row) */
  const dir = path.join(ROOT, "public", "videos", "real");
  for (const id of DEMO) {
    const f = path.join(dir, id + ".mp4");
    if (!fs.existsSync(f)) { console.log("clip missing: " + id); continue; }
    const buf = fs.readFileSync(f);
    const parts = Math.ceil(buf.length / CHUNK);
    const now = new Date().toISOString();
    for (let p = 0; p < parts; p++) {
      const piece = buf.subarray(p * CHUNK, Math.min((p + 1) * CHUNK, buf.length));
      await upsert("video_clips", [{ id: id + "~" + String(p).padStart(3, "0"), data: piece.toString("base64"), bytes: piece.length, updated_at: now }], "id");
    }
    await upsert("video_clips", [{ id: id + "~meta", data: JSON.stringify({ parts, bytes: buf.length }), bytes: 0, updated_at: now }], "id");
    console.log("clip " + id + ": " + (buf.length / 1e6).toFixed(1) + "MB (" + parts + " parts)");
  }
  console.log("MIGRATION DONE — set SUPABASE_URL / SUPABASE_ANON_KEY in Render and deploy.");
})().catch((e) => { console.error("MIGRATION FAILED:", e.message); process.exit(1); });
