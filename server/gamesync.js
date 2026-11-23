/* EARNest · story-game library sync — cloud publishes bundle a snapshot of the
   researcher-built story games. Applied at boot AFTER Supabase hydration with
   INSERT OR IGNORE so the persistent cloud DB keeps its own plays/created_at
   for rows that already exist. The FIRST boot carrying the story snapshot also
   retires the entire pre-revamp game library (every old kind, every old row):
   the Games tab is story games only. Local builds apply the same snapshot via
   scripts/seed-story-games.js; this is a no-op when the file is absent. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { q, tx } = require("./db");
const gamemedia = require("./gamemedia");

function mediaFor(g) {
  let ctx = (g.spec && g.spec.study && g.spec.study.context) || "";
  if (!ctx) { try { ctx = JSON.parse(g.prompt || "{}").research_context || ""; } catch {} }
  return gamemedia.assign(g.kind, ctx);
}
function artFor(g) {
  const spec = g.spec || {};
  const logo = g.logo || spec.logo || null;
  const poster = g.poster || spec.poster || ((spec.backgrounds || [])[0] || {}).url || null;
  return { logo, poster };
}

function sync() {
  const p = path.join(__dirname, "seed-data", "cloud-games.json");
  if (!fs.existsSync(p)) return;
  let snap;
  try { snap = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { console.error("game sync: bad snapshot —", e.message); return; }
  const games = snap.games || [];
  if (!games.length) return;
  let added = 0, media = 0, retired = 0;
  tx(() => {
    /* one-time retirement of the pre-revamp library: when none of the story
       snapshot rows exist yet, wipe ALL old games (plays cascade) first */
    const present = q.get(`SELECT COUNT(*) n FROM games WHERE id IN (${games.map(() => "?").join(",")})`, ...games.map((g) => g.id)).n;
    if (!present) {
      q.run("DELETE FROM game_plays");
      retired = q.run("DELETE FROM games").changes;
    }
    /* standing guard: Earnest games are story games only */
    q.run("DELETE FROM game_plays WHERE game_id IN (SELECT id FROM games WHERE kind<>'story')");
    q.run("DELETE FROM games WHERE kind<>'story'");
    for (const g of games) {
      /* snapshot rows may carry title/premise only inside the spec */
      if (!g.title) g.title = (g.spec && g.spec.title) || "Story game";
      if (!g.premise) g.premise = (g.spec && g.spec.premise) || "";
      const m = g.video ? { video: g.video, credit: g.credit, chip: g.chip, minutes: g.minutes } : mediaFor(g);
      const h = gamemedia.headlineFor(g);
      const art = artFor(g);
      const r = q.run(`INSERT OR IGNORE INTO games (id,researcher_id,kind,title,premise,reward_cents,spec,plays,created_at,prompt,provider,model,status,error,video,credit,chip,minutes,headline,logo,poster)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        g.id, g.researcher_id, g.kind, g.title, g.premise || "", g.reward_cents || 0, JSON.stringify(g.spec), g.plays || 0,
        g.created_at, g.prompt || "", g.provider || "", g.model || "", g.status || "published", g.error || null,
        m.video, m.credit, m.chip, m.minutes, h, art.logo, art.poster);
      if (r.changes) added += 1;
      else {
        /* existing rows keep their plays/created_at; the authored spec, media,
           headlines and art are refreshed from the snapshot so content
           improvements (blurbs, context pages) ship with each publish */
        const u = q.run(`UPDATE games SET spec=?, premise=?, video=?, credit=?, chip=?, minutes=?, headline=?, logo=COALESCE(?,logo), poster=COALESCE(?,poster) WHERE id=?`,
          JSON.stringify(g.spec), g.premise || "", m.video, m.credit, m.chip, m.minutes, h, art.logo, art.poster, g.id);
        if (u.changes) media += 1;
      }
    }
    /* games built before research media/headlines existed (researcher drafts
       included) get the same treatment, matched to their own research context */
    const rest = q.all("SELECT id,kind,prompt,spec,headline,logo,poster FROM games WHERE video IS NULL OR headline IS NULL OR logo IS NULL");
    for (const g of rest) {
      let ctx = "";
      try { ctx = JSON.parse(g.prompt || "{}").research_context || ""; } catch {}
      let spec = null;
      try { spec = JSON.parse(g.spec); } catch {}
      if (!ctx && spec) ctx = (spec.study || {}).context || "";
      const m = gamemedia.assign(g.kind, ctx);
      const h = gamemedia.headlineFor({ id: g.id, kind: g.kind, spec, headline: g.headline });
      const art = artFor({ ...g, spec });
      media += q.run("UPDATE games SET video=?, credit=?, chip=?, minutes=?, headline=?, logo=COALESCE(?,logo), poster=COALESCE(?,poster) WHERE id=?",
        m.video, m.credit, m.chip, m.minutes, h, art.logo, art.poster, g.id).changes;
    }
  });
  if (retired) console.log("game sync: retired " + retired + " pre-revamp games");
  if (added) console.log("game sync: " + added + " story games added");
  if (media) console.log("game sync: " + media + " story games given research media");
}

module.exports = { sync };