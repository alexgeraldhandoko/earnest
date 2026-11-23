/* EARNest · researcher-demo sync — cloud publishes bundle a snapshot of the
   demo researcher account (researcher@earnest.app), its 5 assigned pool
   studies + 2 pool games, and realistic seeded responses/plays scored by the
   app's own bot model. Applied at boot AFTER Supabase hydration and the
   study/game syncs. SELF-HEALING: every insert is idempotent (OR IGNORE or
   dedup-guarded), so each boot tops up anything the Supabase mirror lost to a
   suspended cold start — a version marker alone once left 3 studies empty.
   Local builds apply the same snapshot via scripts/build-demo-snapshot.cjs +
   this module; absent file = no-op. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { q, tx } = require("./db");

function sync() {
  const p = path.join(__dirname, "seed-data", "cloud-demo.json");
  if (!fs.existsSync(p)) return;
  let snap;
  try { snap = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { console.error("demo sync: bad snapshot —", e.message); return; }
  const a = snap.account;
  const existing = q.get("SELECT id FROM users WHERE email=?", a.email);
  if (existing && existing.id !== a.id) { console.error("demo sync: email already owned by another account — skipped"); return; }
  tx(() => {
    /* account + researcher profile */
    q.run(`INSERT OR IGNORE INTO users (id,name,email,password_hash,salt,photo,initials,interests,answer_windows,researcher_mode,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      a.id, a.name, a.email, a.password_hash, a.salt, a.photo, a.initials, a.interests || "", a.answer_windows || "", a.researcher_mode ? 1 : 0, a.created_at);
    q.run("INSERT OR IGNORE INTO settings (user_id) VALUES (?)", a.id);
    const r = snap.researcher;
    q.run(`INSERT INTO researchers (id,name,org,initials,photo,since,avatar_class) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, org=excluded.org, initials=excluded.initials, photo=excluded.photo, since=excluded.since`,
      r.id, r.name, r.org, r.initials, r.photo, r.since, r.avatar_class || "");
    /* respondents */
    for (const u of snap.respondents || []) {
      q.run("INSERT OR IGNORE INTO users (id,name,email,photo,initials,created_at) VALUES (?,?,?,?,?,?)",
        u.id, u.name, u.email, u.photo, u.initials, u.created_at);
    }
    /* assign the pool studies + games to the demo researcher */
    for (const sid of snap.assignments.studies) q.run("UPDATE studies SET researcher_id=? WHERE id=?", r.id, sid);
    for (const gid of snap.assignments.games) q.run("UPDATE games SET researcher_id=? WHERE id=?", r.id, gid);
    for (const sv of snap.surveys || []) {
      q.run("INSERT OR IGNORE INTO researcher_surveys (id,researcher_id,title,month) VALUES (?,?,?,?)", sv.id, sv.researcher_id, sv.title, sv.month);
    }
    /* responses + plays (dedup per respondent/item so re-runs never double) */
    let nr = 0, np = 0;
    for (const resp of snap.responses || []) {
      if (q.get("SELECT 1 x FROM responses WHERE study_id=? AND user_id=?", resp.study_id, resp.user_id)) continue;
      q.run(`INSERT INTO responses (study_id,user_id,answers,timings,notes,quality_score,flagged,flag_reasons,reward_cents,boosted,paradata,bot_prob,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        resp.study_id, resp.user_id, resp.answers, resp.timings, resp.notes, resp.quality_score, resp.flagged,
        resp.flag_reasons, resp.reward_cents, resp.boosted || 0, resp.paradata, resp.bot_prob, resp.created_at);
      nr++;
    }
    for (const pl of snap.plays || []) {
      if (q.get("SELECT 1 x FROM game_plays WHERE game_id=? AND user_id=?", pl.game_id, pl.user_id)) continue;
      q.run(`INSERT INTO game_plays (game_id,user_id,responses,timings,score,quality_score,flagged,reward_cents,paradata,bot_prob,replay,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        pl.game_id, pl.user_id, pl.responses, pl.timings, pl.score, pl.quality_score, pl.flagged,
        pl.reward_cents, pl.paradata, pl.bot_prob, pl.replay || 0, pl.created_at);
      np++;
    }
    /* play counts reflect the actual recorded plays */
    for (const gid of snap.assignments.games) {
      q.run("UPDATE games SET plays=(SELECT COUNT(*) FROM game_plays WHERE game_id=?) WHERE id=?", gid, gid);
    }
    q.run("INSERT OR REPLACE INTO config (key,value) VALUES ('demo_seed_version',?)", String(snap.version));
    if (nr || np) console.log(`demo sync: researcher ${a.email} live — ${snap.assignments.studies.length} studies, ${snap.assignments.games.length} games, ${nr} responses, ${np} plays seeded`);
  });
}

module.exports = { sync };