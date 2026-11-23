"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
const ROOT = path.join(__dirname, "..");
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE follows(user_id, researcher_id);
    CREATE TABLE user_preferences(user_id, topics, fields);
    CREATE TABLE user_vectors(user_id PRIMARY KEY,implicit DEFAULT '{}',n_pos DEFAULT 0,type_affinity DEFAULT 0.5,neg_topics DEFAULT '{}',updated_at);
    CREATE TABLE seen_items(user_id,item_id,ts,PRIMARY KEY(user_id,item_id));
    CREATE TABLE feed_events(id INTEGER PRIMARY KEY,user_id,item_id,item_type,kind,value,created_at DEFAULT (datetime('now')));
    CREATE TABLE item_stats(item_id PRIMARY KEY,item_type,impressions DEFAULT 0,positives DEFAULT 0,negatives DEFAULT 0);`);
  const q = { all: (sql, ...a) => db.prepare(sql).all(...a), get: (sql, ...a) => db.prepare(sql).get(...a), run: (sql, ...a) => db.prepare(sql).run(...a) };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "server/recommend.js"), "utf8"), {
    module: mod, process: { env: {} }, require: (name) => name === "./db" ? { q } : name === "./videohost" ? { HOSTED_COUNT: 0 } : require(path.join(ROOT, "server", name)),
  });
  const rec = mod.exports;
  for (const type of ["study", "post"]) for (let i = 0; i < 135; i++) {
    const id = `${type}-${i}`;
    rec.items.set(id, { id, type, vec: { research: 1 }, ts: Date.now(), researcher: "r1" });
  }
  return { db, q, rec };
}
test("both feeds page beyond the old fixed limit without repeating viewed posts", () => {
  const { db, rec, q } = fixture();
  for (const type of ["study", "post"]) {
    const viewed = new Set();
    for (let n = 0; n < 5; n++) {
      const ids = rec.rankFeed(1, type);
      assert.equal(ids.length, n === 4 ? 15 : 30);
      for (const id of ids) { assert.ok(!viewed.has(id)); assert.ok(id.startsWith(type)); viewed.add(id); rec.event(1, id, "impression"); }
    }
    assert.equal(viewed.size, 135);
    assert.equal(rec.rankFeed(1, type, { refresh: true }).length, 0);
  }
  assert.equal(q.get("SELECT COUNT(*) n FROM seen_items").n, 270);
  assert.equal(rec.rankFeed(2, "post").length, 30, "history is per user");
  db.close();
});
test("72-hour exclusion is strict for refresh, ranking, and exploration", () => {
  const { db, q, rec } = fixture();
  q.run("INSERT INTO seen_items VALUES (1,'post-0',datetime('now','-71 hours','-59 minutes'))");
  q.run("INSERT INTO seen_items VALUES (1,'post-1',datetime('now','-72 hours'))");
  q.run("INSERT INTO seen_items VALUES (1,'post-2',datetime('now','-73 hours'))");
  const exclude = [...rec.items.keys()].filter((id) => !["post-0", "post-1", "post-2"].includes(id));
  for (const refresh of [false, true]) {
    const ids = Array.from(rec.rankFeed(1, "post", { refresh, exclude })).sort();
    assert.deepEqual(ids, ["post-1", "post-2"]);
  }
  db.close();
});
test("prefetching never marks unseen posts as viewed; exclusions protect queued batches", () => {
  const { db, rec, q } = fixture();
  const first = rec.rankFeed(1, "study", { limit: 40 });
  assert.equal(q.get("SELECT COUNT(*) n FROM seen_items").n, 0);
  const next = rec.rankFeed(1, "study", { exclude: first });
  assert.equal(next.length, 30);
  assert.ok(next.every((id) => !first.includes(id)));
  rec.event(1, first[0], "impression");
  const refreshed = rec.rankFeed(1, "study", { refresh: true, exclude: [...first.slice(1), ...next] });
  assert.ok(!refreshed.includes(first[0]));
  assert.equal(q.get("SELECT COUNT(*) n FROM seen_items").n, 1);
  db.close();
});
test("invalid impressions do not pollute history and batch limits are bounded", () => {
  const { db, rec, q } = fixture();
  rec.event(1, "missing-post", "impression");
  assert.equal(q.get("SELECT COUNT(*) n FROM seen_items").n, 0);
  assert.equal(rec.rankFeed(1, "post", { limit: 10000 }).length, 40);
  db.close();
});
test("feed API forwards paging exclusions and records actual impressions", async () => {
  const calls = [];
  const q = {
    all: (sql) => sql.startsWith('SELECT * FROM studies') ? [{ id: 's-1', reward_cents: 50 }] : sql.startsWith('SELECT * FROM discoveries') ? [{ id: 'p-1' }] : [],
    get: () => ({ n: 0 }),
  };
  const mod = { exports: {} };
  const rec = { rankFeed: (user, type, opts) => { calls.push({ user, type, opts }); return [type === 'post' ? 'p-1' : 's-1']; }, event: (...args) => calls.push(args) };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'server/api.js'), 'utf8'), {
    module: mod, __dirname: path.join(ROOT, 'server'), process: { env: {} }, console,
    require: name => name === './db' ? { q, DATA_DIR: '/tmp' } : name === './recommend' ? rec : name === './videohost' ? { playbackUrl: v => v } : name.startsWith('./') ? {} : require(name),
  });
  async function request(url, method = 'GET', body = null, user = { id: 7 }) {
    let status, result;
    const res = { writeHead: code => status = code, end: json => result = JSON.parse(json) };
    await mod.exports.handle({ method }, res, new URL(url, 'http://test'), body, user);
    return { status, result };
  }
  let response = await request('/api/feed?tab=gold&exclude=s-2%2Cs-3');
  assert.equal(response.status, 200); assert.equal(response.result[0].id, 's-1');
  assert.deepEqual(Array.from(calls[0].opts.exclude), ['s-2', 's-3']);
  response = await request('/api/feed?tab=discover&refresh=1');
  assert.equal(response.result[0].id, 'p-1'); assert.equal(calls[1].type, 'post'); assert.equal(calls[1].opts.refresh, true);
  response = await request('/api/events', 'POST', { kind: 'impression', item_id: 'p-1' });
  assert.equal(response.status, 200); assert.deepEqual(Array.from(calls[2]), [7, 'p-1', 'impression', 0]);
  assert.equal((await request('/api/feed', 'GET', null, null)).status, 401);
});
