/* EARNest · feed ranking service — the production funnel at pocket scale:
   candidate generation (TF-IDF two-tower dot product + item-item CF) →
   weighted-linear ranker (X Heavy Ranker pattern) → MMR diversity re-rank →
   Thompson-sampling exploration slots. User vector = explicit onboarding picks
   blended with an EMA of implicit events (TikTok/Monolith-style fast adaptation).
   Posts carry NO enum topic: affinity is computed from content text. */
"use strict";
const { q } = require("./db");
const E = require("./embed");
const { TOPICS } = require("./topics");

const W = { content: 0.45, cf: 0.20, wilson: 0.15, fresh: 0.10, type: 0.10, neg: 0.50, follow: 0.06 };
const EMA_ALPHA = 0.10, EXPLICIT_TAU = 30, EXPLICIT_FLOOR = 0.05;
const HALF_LIFE = { study: 168, post: 72 };           // hours — research ≠ breaking news
const SEEN_WINDOW_HOURS = 72, MMR_LAMBDA = 0.7;
const EVENT_W = { dwell: 0.5, watch: 1.0, complete: 2.0, heart: 1.5, repost: 3.0, follow: 4.0, skip: -1.0, not_interested: -8.0 };

const items = new Map();      // id → {id,type,vec,tags,researcher,published,genre}
let idf = new Map();
let simCache = { at: 0, map: new Map() };
const vecCache = new Map();   // userId → {u, at, npos}

function itemText(s) {
  return [s.title, s.sub, s.abstract, s.genre, s.credit, s.source_name, s.author].filter(Boolean).join(" ");
}
/* Video-speed test mode (2026-11-22): EARNEST_VIDEO_ONLY=1 restricts the
   candidate pool to posts whose audited promo video is wired (videos/real/).
   The pull-based personalized flow is unchanged — only the pool is filtered.
   On the cloud Page the same mode activates automatically once the hosted
   clip map (cloud-videos.json) is non-empty; clips there are served by the
   app itself at /videos/real/{id}.mp4 from the Page DB. Restart without the
   env var / with an empty map to restore the full corpus. */
const VIDEO_ONLY = process.env.EARNEST_VIDEO_ONLY === "1" || require("./videohost").HOSTED_COUNT > 0;
function loadItems() {
  items.clear();
  const videoFilter = VIDEO_ONLY ? " AND video LIKE '%videos/real/%'" : "";
  const studies = q.all("SELECT * FROM studies WHERE active=1" + videoFilter);
  const posts = q.all("SELECT * FROM discoveries WHERE COALESCE(active,1)=1" + videoFilter);
  const docs = [];
  const raw = [];
  for (const s of studies) {
    const tags = [s.genre, s.chip].filter(Boolean);
    raw.push({ id: s.id, type: "study", text: itemText(s), tags, researcher: s.researcher_id, published: s.published_at || s.created_at, genre: s.genre });
  }
  for (const d of posts) {
    let tags = [];
    try { tags = JSON.parse(d.tags || "[]"); } catch {}
    raw.push({ id: d.id, type: "post", text: itemText(d), tags: tags.concat([d.chip, d.genre].filter(Boolean)), researcher: d.researcher_id, published: d.published_at || d.created_at, genre: d.genre });
  }
  for (const r of raw) docs.push(E.tokens(r.text).concat(r.tags.flatMap((t) => E.tokens(t))));
  idf = E.buildIdf(docs);
  for (const r of raw) {
    items.set(r.id, { ...r, vec: E.vectorize(r.text, r.tags, idf), ts: Date.parse(String(r.published || "").replace(" ", "T") + (String(r.published || "").includes("Z") ? "" : "Z")) || Date.now() });
  }
  vecCache.clear();
}

function explicitVector(userId) {
  const pref = q.get("SELECT topics, fields FROM user_preferences WHERE user_id=?", userId);
  if (!pref) return {};
  let topics = [], fields = [];
  try { topics = JSON.parse(pref.topics || "[]"); fields = JSON.parse(pref.fields || "[]"); } catch {}
  const labels = [];
  const tags = [];
  for (const t of TOPICS) if (topics.includes(t.id)) { labels.push(t.label); tags.push(t.label); labels.push(t.fields.join(" ")); }
  labels.push(fields.join(" "));
  tags.push(...fields);
  if (!labels.length) return {};
  return E.vectorize(labels.join(" "), tags, idf);
}

function implicitRow(userId) {
  let row = q.get("SELECT * FROM user_vectors WHERE user_id=?", userId);
  if (!row) {
    q.run("INSERT INTO user_vectors (user_id) VALUES (?)", userId);
    row = { user_id: userId, implicit: "{}", n_pos: 0, type_affinity: 0.5, neg_topics: "{}" };
  }
  return row;
}

function userVector(userId) {
  const cached = vecCache.get(userId);
  if (cached && Date.now() - cached.at < 15000) return cached.u;
  const row = implicitRow(userId);
  let implicit = {};
  try { implicit = JSON.parse(row.implicit || "{}"); } catch {}
  const explicit = explicitVector(userId);
  const w = Math.max(EXPLICIT_FLOOR, Math.exp(-(row.n_pos || 0) / EXPLICIT_TAU));
  const u = {};
  E.addScaled(u, explicit, w);
  E.addScaled(u, implicit, 1 - w);
  E.normalize(u);
  vecCache.set(userId, { u, at: Date.now() });
  return u;
}

function statsOf(itemId) {
  return q.get("SELECT * FROM item_stats WHERE item_id=?", itemId) || { impressions: 0, positives: 0, negatives: 0 };
}
function wilson(pos, n, z = 1.28) {
  if (!n) return 0.3; // unexposed items get a neutral prior, not zero
  const p = pos / n, z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}
function freshness(item) {
  const ageH = Math.max(0, (Date.now() - item.ts) / 3600e3);
  return Math.exp(-Math.LN2 * ageH / (HALF_LIFE[item.type] || 96));
}

/* item-item collaborative filtering over co-engagement (Amazon pattern),
   rebuilt lazily every 2 minutes — a few hundred items make this trivial. */
function coengage() {
  if (Date.now() - simCache.at < 120e3) return simCache.map;
  const rows = q.all("SELECT user_id, item_id FROM feed_events WHERE kind IN ('heart','repost','complete','follow') OR (kind='dwell' AND value>=8)");
  const byUser = new Map(), count = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, new Set());
    byUser.get(r.user_id).add(r.item_id);
    count.set(r.item_id, (count.get(r.item_id) || 0) + 1);
  }
  const co = new Map();
  for (const set of byUser.values()) {
    const arr = [...set];
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const key = arr[i] < arr[j] ? arr[i] + "|" + arr[j] : arr[j] + "|" + arr[i];
      co.set(key, (co.get(key) || 0) + 1);
    }
  }
  const map = new Map();
  for (const [key, n] of co) {
    const [a, b] = key.split("|");
    const s = (n / Math.sqrt((count.get(a) || 1) * (count.get(b) || 1))) * (n / (n + 5));
    if (!map.has(a)) map.set(a, []);
    if (!map.has(b)) map.set(b, []);
    map.get(a).push([b, s]); map.get(b).push([a, s]);
  }
  simCache = { at: Date.now(), map };
  return map;
}
function cfScore(userId, itemId, sim) {
  const recent = q.all("SELECT item_id, created_at FROM feed_events WHERE user_id=? AND kind IN ('heart','repost','complete','follow') ORDER BY id DESC LIMIT 20", userId);
  if (!recent.length) return 0;
  let s = 0;
  for (const r of recent) {
    const neigh = sim.get(r.item_id);
    if (!neigh) continue;
    for (const [id, w] of neigh) if (id === itemId) { s += w; break; }
  }
  return Math.min(1, s);
}

function negPenalty(userId, item) {
  const row = implicitRow(userId);
  let neg = {};
  try { neg = JSON.parse(row.neg_topics || "{}"); } catch {}
  let p = 0;
  for (const [t, w] of Object.entries(item.vec)) if (neg[t]) p += w * neg[t];
  return Math.min(1, p * 4);
}

function scoreItem(userId, item, u, sim, follows) {
  const st = statsOf(item.id);
  const row = implicitRow(userId);
  const typeAff = item.type === "study" ? row.type_affinity : 1 - row.type_affinity;
  let s = W.content * E.cosine(u, item.vec)
    + W.cf * cfScore(userId, item.id, sim)
    + W.wilson * wilson(st.positives, st.impressions)
    + W.fresh * freshness(item)
    + W.type * typeAff
    - W.neg * negPenalty(userId, item);
  if (item.researcher && follows.has(item.researcher)) s += W.follow;
  return s;
}

/* Batches are recommendations, not impressions. Only a reel actually entering
   the viewport starts its 72-hour exclusion; queued clips stay eligible on a
   later session. The client excludes its current bounded window when paging. */
function rankFeed(userId, type, { limit = 30, refresh = false, exclude = [] } = {}) {
  if (!items.size) loadItems();
  limit = Math.max(1, Math.min(40, Math.floor(Number(limit) || 30)));
  const u = userVector(userId);
  const sim = coengage();
  const follows = new Set(q.all("SELECT researcher_id FROM follows WHERE user_id=?", userId).map((r) => r.researcher_id));
  const seen = new Set(q.all("SELECT item_id FROM seen_items WHERE user_id=? AND ts > datetime('now', ?)", userId, `-${SEEN_WINDOW_HOURS} hours`).map((r) => r.item_id));
  const excluded = new Set(exclude);
  const candidates = [...items.values()].filter((it) => it.type === type && !seen.has(it.id) && !excluded.has(it.id));
  const scored = candidates.map((it) => ({ it, s: scoreItem(userId, it, u, sim, follows) }))
    .sort((a, b) => b.s - a.s);
  const top = scored.slice(0, Math.max(limit * 2, 60));

  /* MMR greedy diversity re-rank */
  const picked = [];
  const pool = top.slice();
  const exploreSlots = Math.min(refresh ? 4 : 2, Math.max(0, limit - 4));
  const mainCount = limit - exploreSlots;
  while (picked.length < mainCount && pool.length) {
    let best = null, bestV = -Infinity;
    for (const c of pool) {
      let maxSim = 0;
      for (const p of picked) maxSim = Math.max(maxSim, E.cosine(c.it.vec, p.it.vec));
      const v = MMR_LAMBDA * c.s - (1 - MMR_LAMBDA) * maxSim;
      if (v > bestV) { bestV = v; best = c; }
    }
    picked.push(best);
    pool.splice(pool.indexOf(best), 1);
  }
  /* Thompson-sampled exploration: under-exposed items get a fair draw */
  const rng = E.mulberry32((userId * 2654435761 + Date.now()) >>> 0);
  const explorePool = scored.filter((c) => !picked.includes(c) && statsOf(c.it.id).impressions < 30);
  const explored = [];
  for (let i = 0; i < exploreSlots && explorePool.length; i++) {
    let best = null, bestTheta = -1;
    for (const c of explorePool) {
      if (explored.includes(c)) continue;
      const st = statsOf(c.it.id);
      const theta = E.betaSample(1 + st.positives, 1 + Math.max(0, st.impressions - st.positives), rng);
      if (theta > bestTheta) { bestTheta = theta; best = c; }
    }
    if (best) explored.push(best);
  }
  const out = [];
  let ei = 0;
  for (let i = 0; i < picked.length; i++) {
    out.push(picked[i].it);
    if ((i === 2 || i === 6) && ei < explored.length) out.push(explored[ei++].it);
  }
  while (ei < explored.length) out.push(explored[ei++].it);

  const ids = out.slice(0, limit).map((it) => it.id);
  return ids;
}

function logImpressions(userId, ids) {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  for (const id of new Set(ids)) {
    if (!items.has(id)) continue;
    q.run("INSERT INTO seen_items (user_id,item_id,ts) VALUES (?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET ts=excluded.ts", userId, id, now);
    q.run("INSERT INTO item_stats (item_id,item_type,impressions) VALUES (?,?,1) ON CONFLICT(item_id) DO UPDATE SET impressions=impressions+1", id, items.get(id) ? items.get(id).type : "post");
    q.run("INSERT INTO feed_events (user_id,item_id,item_type,kind,value) VALUES (?,?,?,?,0)", userId, id, items.get(id) ? items.get(id).type : "post", "impression");
  }
  q.run("DELETE FROM seen_items WHERE ts <= datetime('now', ?)", `-${SEEN_WINDOW_HOURS} hours`);
}

/* Implicit feedback → EMA user-vector update (the "online training" step). */
function event(userId, itemId, kind, value = 0) {
  if (!items.size) loadItems();
  if (kind === "impression") { logImpressions(userId, [itemId]); return; }
  const item = items.get(itemId);
  const w = EVENT_W[kind];
  if (w === undefined) return;
  const type = item ? item.type : (q.get("SELECT id FROM studies WHERE id=?", itemId) ? "study" : "post");
  q.run("INSERT INTO feed_events (user_id,item_id,item_type,kind,value) VALUES (?,?,?,?,?)", userId, itemId, type, kind, Number(value) || 0);
  q.run("INSERT INTO item_stats (item_id,item_type) VALUES (?,?) ON CONFLICT(item_id) DO NOTHING", itemId, type);

  let dwellPos = 0;
  if (kind === "dwell") dwellPos = Math.min((Number(value) || 0) / 15, 1) * 0.5;
  if (kind === "watch") dwellPos = Math.min(Math.max(Number(value) || 0, 0), 1);
  const positive = w > 0 ? w : dwellPos;
  const st = statsOf(itemId);
  if (positive > 0.4) q.run("UPDATE item_stats SET positives=positives+1 WHERE item_id=?", itemId);
  if (kind === "skip" || kind === "not_interested") q.run("UPDATE item_stats SET negatives=negatives+1 WHERE item_id=?", itemId);

  const row = implicitRow(userId);
  let implicit = {};
  try { implicit = JSON.parse(row.implicit || "{}"); } catch {}
  let neg = {};
  try { neg = JSON.parse(row.neg_topics || "{}"); } catch {}
  let npos = row.n_pos || 0, aff = row.type_affinity == null ? 0.5 : row.type_affinity;

  let target = item ? item.vec : null;
  if (kind === "follow") {
    /* follow = affinity for the researcher's whole body of work */
    const rid = itemId;
    const theirs = [...items.values()].filter((it) => it.researcher === rid);
    if (theirs.length) {
      target = {};
      for (const it of theirs) E.addScaled(target, it.vec, 1 / theirs.length);
      E.normalize(target);
    }
  }
  if (target) {
    if (positive > 0) {
      const step = Math.min(0.30, Math.max(0.02, EMA_ALPHA * positive));
      E.addScaled(implicit, target, step);           // u ← (1−αw)u + αw·d̂ (renormalized)
      E.normalize(implicit);
      npos += 1;
      aff = 0.9 * aff + 0.1 * (type === "study" ? 1 : 0);
    } else if (kind === "skip" || kind === "not_interested") {
      const beta = kind === "not_interested" ? 0.20 : 0.05;
      E.addScaled(implicit, target, -beta);
      E.normalize(implicit);
      if (kind === "not_interested") {
        const topTerms = Object.entries(target).sort((a, b) => b[1] - a[1]).slice(0, 12);
        for (const [t, wv] of topTerms) neg[t] = Math.min(1, (neg[t] || 0) + wv * 2);
      }
    }
  }
  q.run("UPDATE user_vectors SET implicit=?, n_pos=?, type_affinity=?, neg_topics=?, updated_at=datetime('now') WHERE user_id=?",
    JSON.stringify(implicit), npos, aff, JSON.stringify(neg), userId);
  vecCache.delete(userId);
}

function scoreFor(userId, itemId) {
  const item = items.get(itemId);
  if (!item) return 0;
  const follows = new Set(q.all("SELECT researcher_id FROM follows WHERE user_id=?", userId).map((r) => r.researcher_id));
  return scoreItem(userId, item, userVector(userId), coengage(), follows);
}

module.exports = { loadItems, rankFeed, event, scoreFor, userVector, items, logImpressions, invalidate: (userId) => vecCache.delete(userId) };