/* EARNest · discovery content sync — cloud publishes bundle the plain-English
   revamp (progress headlines, one-line summaries, ≤200-word blog posts) for
   every discovery post. Applied at boot AFTER Supabase hydration so the
   persistent cloud DB picks up content edits that INSERT OR IGNORE seeding
   would never overwrite. Only content columns are updated on existing rows —
   the cloud keeps its own footage, active state and engagement counts. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { q, tx } = require("./db");

const CONTENT = ["title", "sub", "blog", "ai", "orig_title", "orig_sub"];

function sync() {
  const p = path.join(__dirname, "seed-data", "cloud-discoveries.json");
  if (!fs.existsSync(p)) return;
  let snap;
  try { snap = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { console.error("discovery sync: bad snapshot —", e.message); return; }
  const posts = snap.posts || [];
  if (!posts.length) return;
  tx(() => {
    for (const r of posts) {
      const cols = Object.keys(r);
      const sets = CONTENT.filter((c) => cols.includes(c)).map((c) => `${c}=excluded.${c}`);
      q.run(
        `INSERT INTO discoveries (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})
         ON CONFLICT(id) DO UPDATE SET ${sets.join(",")}`,
        ...cols.map((c) => (r[c] === undefined ? null : r[c]))
      );
    }
  });
  console.log(`discovery sync: ${posts.length} plain-English posts live`);
}

module.exports = { sync };