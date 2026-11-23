/* EARNest · game storage adapter. Narrow interface: save / load / list.
   Game metadata always lives in the SQLite `games` table; the payload (spec JSON)
   lives either in the same row (`sqlite`, default) or in a JSON file per game
   (`local`, directory via storage_dir config). The future Alibaba OSS swap is a
   third implementation of this same interface, selected by config only. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const { q } = require("./db");

const META = "id,researcher_id,kind,title,premise,reward_cents,plays,created_at,prompt,provider,model,status,error,video,credit,chip,minutes,headline,logo,poster";

function payloadDir() {
  const d = config.get("storage_dir") || path.join(require("./db").DATA_DIR, "game-payloads");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function upsertMeta(g, specSql) {
  q.run(`INSERT INTO games (id,researcher_id,kind,title,premise,reward_cents,spec,prompt,provider,model,status,error,video,credit,chip,minutes,headline,logo,poster)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      researcher_id=excluded.researcher_id, kind=excluded.kind, title=excluded.title,
      premise=excluded.premise, reward_cents=excluded.reward_cents, spec=excluded.spec,
      prompt=excluded.prompt, provider=excluded.provider, model=excluded.model, status=excluded.status, error=excluded.error,
      video=COALESCE(excluded.video, games.video), credit=COALESCE(excluded.credit, games.credit),
      chip=COALESCE(excluded.chip, games.chip), minutes=COALESCE(excluded.minutes, games.minutes),
      headline=COALESCE(excluded.headline, games.headline), logo=COALESCE(excluded.logo, games.logo),
      poster=COALESCE(excluded.poster, games.poster)`,
    g.id, g.researcher_id, g.kind, g.title, g.premise || "", g.reward_cents || 0, specSql,
    g.prompt || "", g.provider || "", g.model || "", g.status || "published", g.error || null,
    g.video || null, g.credit || null, g.chip || null, g.minutes || null, g.headline || null,
    g.logo || null, g.poster || null);
}
function metaRow(id) {
  return q.get(`SELECT ${META} FROM games WHERE id=?`, id) || null;
}

const sqlite = {
  save(g) { upsertMeta(g, JSON.stringify(g.spec)); },
  load(id) {
    const row = q.get(`SELECT ${META},spec FROM games WHERE id=?`, id);
    if (!row || !row.spec) return null; // empty spec: payload lives in another adapter
    const { spec, ...meta } = row;
    return { ...meta, spec: JSON.parse(spec) };
  },
  list() { return q.all(`SELECT ${META} FROM games ORDER BY rowid DESC`); },
};

const local = {
  save(g) {
    upsertMeta(g, "");
    fs.writeFileSync(path.join(payloadDir(), g.id + ".json"), JSON.stringify(g.spec));
  },
  load(id) {
    const meta = metaRow(id);
    if (!meta) return null;
    const file = path.join(payloadDir(), id + ".json");
    if (!fs.existsSync(file)) return null;
    return { ...meta, spec: JSON.parse(fs.readFileSync(file, "utf8")) };
  },
  list() { return q.all(`SELECT ${META} FROM games ORDER BY rowid DESC`); },
};

function adapter() {
  return (config.get("storage_adapter") || "sqlite").toLowerCase() === "local" ? local : sqlite;
}
module.exports = {
  name: () => (config.get("storage_adapter") || "sqlite").toLowerCase(),
  save: (g) => adapter().save(g),
  load: (id) => adapter().load(id),
  loadMeta: (id) => metaRow(id),
  list: () => adapter().list(),
};