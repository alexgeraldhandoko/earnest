/* EARNest · curated-study sync — cloud publishes bundle a snapshot of the
   founder-curated paid studies (goal headers, natural pitch, tailored
   questionnaires) plus the retired seed-study ids. Applied at boot AFTER
   Supabase hydration so the persistent cloud DB picks up content edits that
   INSERT OR IGNORE seeding would never overwrite. Media fields (video/image)
   and created_at are preserved on existing rows — the cloud keeps its own
   footage state (see cloud-videos.json). Local builds have no snapshot file,
   so this is a no-op there. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { q, tx } = require("./db");

const MEDIA_COLS = new Set(["id", "video", "image", "created_at"]);

function upsert(table, row, skipUpdate) {
  const cols = Object.keys(row);
  const sets = cols.filter((c) => !skipUpdate.has(c)).map((c) => `${c}=excluded.${c}`);
  q.run(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})
     ON CONFLICT(id) DO UPDATE SET ${sets.join(",")}`,
    ...cols.map((c) => (row[c] === undefined ? null : row[c]))
  );
}

function sync() {
  const p = path.join(__dirname, "seed-data", "cloud-studies.json");
  if (!fs.existsSync(p)) return;
  let snap;
  try { snap = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { console.error("study sync: bad snapshot —", e.message); return; }
  const studies = snap.studies || [];
  if (!studies.length) return;
  tx(() => {
    for (const r of snap.researchers || []) upsert("researchers", r, new Set(["id"]));
    for (const s of studies) upsert("studies", s, MEDIA_COLS);
    for (const s of studies) {
      q.run("DELETE FROM questions WHERE study_id=?", s.id);
      for (const qq of (snap.questions || {})[s.id] || []) {
        q.run("INSERT INTO questions (study_id,ord,q,type,placeholder,options,meta) VALUES (?,?,?,?,?,?,?)",
          s.id, qq.ord, qq.q, qq.type, qq.placeholder ?? null, qq.options ?? null, qq.meta ?? null);
      }
    }
    for (const id of snap.deactivate || []) q.run("UPDATE studies SET active=0 WHERE id=?", id);
  });
  console.log(`study sync: ${studies.length} curated studies live, ${(snap.deactivate || []).length} seed studies retired`);
}

module.exports = { sync };