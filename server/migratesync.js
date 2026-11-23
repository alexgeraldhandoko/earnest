/* EARNest · one-time migration from the previous cloud page.
   v1 source: xuw6xcjq · v2 source: ptc2aptn (founder export via live API).
   The app's own seed + content snapshots recreate almost everything; this
   carries over the few rows that were genuinely live-only: topic picks,
   study history, social graph, wallet state, generated games and runtime
   config. Applied at boot AFTER the other syncs. Idempotent: every insert
   is OR IGNORE / dedup-guarded; wallet/settings apply once behind a config
   marker so later live edits are never clobbered. Absent file = no-op. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { q } = require("./db");

function sync() {
  const p = path.join(__dirname, "seed-data", "cloud-migrate.json");
  if (!fs.existsSync(p)) return;
  let snap;
  try { snap = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { console.error("migrate sync: bad snapshot —", e.message); return; }
  let n = 0;
  /* founder's explicit interest picks (seed leaves preferences empty) */
  const pref = snap.preferences;
  if (pref && q.get("SELECT id FROM users WHERE id=?", pref.user_id)) {
    q.run(`INSERT INTO user_preferences (user_id,topics,fields,goals,formats,windows,updated_at)
      VALUES (?,?,?,?,?,?,datetime('now')) ON CONFLICT(user_id) DO NOTHING`,
      pref.user_id, pref.topics, pref.fields, pref.goals, pref.formats, pref.windows || "");
    n++;
  }
  /* founder's study history — dedup per study/user so re-runs never double.
     Self-healing: a concurrent cold start can hydrate mid-flush and mirror a
     partial responses table back; every boot tops this up again. */
  for (const r of snap.responses || []) {
    try {
      if (!q.get("SELECT id FROM users WHERE id=?", r.user_id)) continue;
      if (!q.get("SELECT id FROM studies WHERE id=?", r.study_id)) continue;
      if (q.get("SELECT 1 x FROM responses WHERE study_id=? AND user_id=?", r.study_id, r.user_id)) continue;
      q.run(`INSERT INTO responses (study_id,user_id,answers,notes,reward_cents,created_at) VALUES (?,?,?,?,?,?)`,
        r.study_id, r.user_id, r.answers, r.notes || "[]", r.reward_cents, r.created_at);
      n++;
    } catch (e) { console.error("migrate sync: response", r.study_id, "—", e.message); }
  }
  /* generated draft game that only existed in the old page DB */
  const insertGame = (g) => {
    if (!g || q.get("SELECT id FROM games WHERE id=?", g.id)) return false;
    q.run(`INSERT OR IGNORE INTO games (id,researcher_id,kind,title,premise,reward_cents,spec,plays,created_at,
        prompt,status,error,video,credit,chip,minutes,headline,logo,poster)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      g.id, g.researcher_id, g.kind, g.title, g.premise, g.reward_cents, g.spec, g.plays || 0, g.created_at,
      g.prompt || "", g.status || "draft", g.error || null, g.video || null, g.credit || null,
      g.chip || null, g.minutes || null, g.headline || null, g.logo || null, g.poster || null);
    return true;
  };
  if (insertGame(snap.game)) n++;
  /* v2: any number of live-only games */
  for (const g of snap.games || []) { if (insertGame(g)) n++; }
  /* v2: founder social graph (dedup by composite PK) */
  const uid = (snap.preferences && snap.preferences.user_id) || (snap.wallet && snap.wallet.user_id);
  if (uid && q.get("SELECT id FROM users WHERE id=?", uid)) {
    for (const item of snap.hearts || []) { q.run("INSERT OR IGNORE INTO hearts (user_id,item_id) VALUES (?,?)", uid, item); n++; }
    for (const r of snap.follows || []) { if (q.get("SELECT id FROM researchers WHERE id=?", r)) { q.run("INSERT OR IGNORE INTO follows (user_id,researcher_id) VALUES (?,?)", uid, r); n++; } }
    for (const item of snap.reposts || []) { q.run("INSERT OR IGNORE INTO reposts (user_id,item_id) VALUES (?,?)", uid, item); n++; }
    if (snap.settings) { q.run("INSERT OR IGNORE INTO settings (user_id,autoplay,streak_reminders) VALUES (?,?,?)", uid, snap.settings.autoplay == null ? 1 : snap.settings.autoplay, snap.settings.streak_reminders == null ? 1 : snap.settings.streak_reminders); n++; }
    /* wallet state applies ONCE — a marker keeps later live earnings safe */
    const w = snap.wallet;
    if (w && !q.get("SELECT value FROM config WHERE key='migrate_wallet_applied'")) {
      q.run("UPDATE users SET wallet_cents=?, streak_day=?, multiplier_left=? WHERE id=?", w.wallet_cents, w.streak_day || 0, w.multiplier_left || 0, uid);
      q.run("INSERT OR IGNORE INTO config (key,value) VALUES ('migrate_wallet_applied','1')");
      n++;
    }
  }
  /* runtime config carried over (never overwrite values set on this page) */
  for (const [key, value] of Object.entries(snap.config || {})) {
    if (typeof value === "string" && value) { q.run("INSERT OR IGNORE INTO config (key,value) VALUES (?,?)", key, value); n++; }
  }
  if (n) console.log(`migrate sync: ${n} live-only rows carried over from the previous page`);
}

module.exports = { sync };