/* EARNest · research collection pipeline — the hourly loop the product asks for:
   scrape breakthrough research / news / publications (+ appropriate media) →
   parse & format into a discovery post → save to the database → shown in Discover.
   There is no separate "research" section: everything lands in the discover feed.
   Sources: arXiv (publications), Hacker News (tech news), NASA image library
   (media-rich findings). Summaries are extractive so no facts are invented. */
"use strict";
const { q } = require("./db");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ARXIV_CATS = ["cs.AI", "q-bio.NC", "physics.med-ph", "astro-ph.EP", "cond-mat.mtrl-sci", "eess.IV", "stat.ML", "physics.ao-ph", "cs.RO", "q-fin.ST"];
const NASA_TOPICS = ["galaxy", "mars", "earth", "ocean", "sun", "aurora", "rocket", "climate"];
const taxonomy = require("./discovery-taxonomy");
const CURSOR_FILE = path.join(__dirname, "pipeline-cursor.json");
const TOPICS_PER_RUN = 4; // rotate through all 22 topics evenly (~5-6 runs per full cycle)
function readCursor() { try { return JSON.parse(fs.readFileSync(CURSOR_FILE, "utf8")).i || 0; } catch { return 0; } }
function writeCursor(i) { try { fs.writeFileSync(CURSOR_FILE, JSON.stringify({ i })); } catch {} }
const UA = { "User-Agent": "EARNest-research-pipeline/1.0 (research discovery feed)" };

const state = { last_run: null, last_added: 0, added_total: 0, errors: [], running: false, next_run: null, paused: false };

/* Temporary pause switch: create server/pipeline-paused (or set PIPELINE_PAUSED=1)
   to stop the hourly scrape; delete the file to resume on the next tick — no
   restart needed. The flag rides along in cloud publishes (server/ is bundled). */
const PAUSE_FILE = path.join(__dirname, "pipeline-paused");
function isPaused() {
  if (String(process.env.PIPELINE_PAUSED || "") === "1") return true;
  /* cockpit toggle: durable kv flag (the server dir is read-only on cloud) */
  try { if (require("./config").get("pipeline_paused") === "1") return true; } catch {}
  try { return fs.existsSync(PAUSE_FILE); } catch { return false; }
}

/* Verified media pool harvested from the seeded real posts (keyword → image). */
let mediaPool = null;
function pool() {
  if (mediaPool) return mediaPool;
  mediaPool = [];
  try {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "seed-data", "discoveries.json"), "utf8"));
    for (const d of seed) if (d.media_kind === "image" && d.media_url) mediaPool.push({ tags: d.tags || [], url: d.media_url });
  } catch {}
  return mediaPool;
}
function matchMedia(text, tags) {
  const words = new Set(String(text).toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  let best = null, bestScore = 0;
  for (const m of pool()) {
    let s = 0;
    for (const t of m.tags) if (words.has(String(t).toLowerCase())) s++;
    if (s > bestScore) { bestScore = s; best = m; }
  }
  if (best && bestScore > 0) return { kind: "image", url: best.url };
  const vids = ["videos/dna.mp4", "videos/coralreef.mp4", "videos/solar.mp4", "videos/citylights.mp4", "videos/artemis.mp4", "videos/isstour.mp4", "videos/antarctic.mp4", "videos/cupola.mp4"];
  return { kind: "video", url: vids[Math.floor(Math.random() * vids.length)] };
}

async function fetchText(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal, redirect: "follow" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
function summaryOf(text, max = 300) {
  const clean = strip(text);
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > max) break;
    out += s.trim() + " ";
  }
  out = out.trim();
  if (!out) out = clean.slice(0, max);
  return out.length > max ? out.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : out;
}
function keywords(text, n = 3) {
  const stop = new Set(["the", "and", "for", "with", "from", "that", "this", "using", "based", "study", "results", "analysis", "approach", "method", "paper", "we", "our"]);
  const freq = new Map();
  for (const w of String(text).toLowerCase().split(/\W+/)) {
    if (w.length < 5 || stop.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

function savePost(p) {
  if (!p.url || !p.title) return false;
  if (q.get("SELECT id FROM discoveries WHERE source_url=?", p.url)) return false;
  const id = "d-live-" + crypto.randomBytes(4).toString("hex");
  const media = p.media || matchMedia(p.title + " " + (p.summary || ""), p.tags);
  q.run(`INSERT INTO discoveries (id,genre,video,image,credit,chip,title,sub,hearts,reposts,comments,ai,paper_id,researcher_id,source_url,media_kind,author,verified,published_at,tags,summary)
    VALUES (?,?,?,?,?,?,?,?,0,0,0,?,NULL,NULL,?,?,?,?,?,?,?)`,
    id, p.genre || "study",
    media.kind === "video" ? media.url : null,
    media.kind === "image" ? media.url : null,
    p.credit, String(p.chip).slice(0, 24), String(p.title).slice(0, 95), p.summary,
    `Scraped ${new Date().toISOString().slice(0, 10)} · ${p.source_name}`,
    p.url, media.kind, p.author || p.source_name, p.verified ? 1 : 0,
    p.published_at || new Date().toISOString(), JSON.stringify(p.tags || []), p.summary);
  return true;
}

async function fromArxiv() {
  const cat = ARXIV_CATS[Math.floor(Math.random() * ARXIV_CATS.length)];
  const xml = await fetchText(`http://export.arxiv.org/api/query?search_query=cat:${cat}&start=0&max_results=8&sortBy=submittedDate&sortOrder=descending`);
  const entries = xml.split("<entry>").slice(1);
  let added = 0;
  for (const en of entries) {
    const grab = (tag) => { const m = en.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return m ? strip(m[1]) : ""; };
    const title = grab("title");
    const summary = grab("summary");
    const url = (en.match(/<id>([^<]+)<\/id>/) || [])[1] || "";
    const authors = [...en.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]).slice(0, 4).join(", ");
    const published = grab("published");
    if (!title || !url) continue;
    if (savePost({
      title, summary: summaryOf(summary), url, tags: keywords(title + " " + summary).concat([cat.split(".")[0]]),
      source_name: "arXiv · " + cat, chip: "arXiv", credit: `${authors || "arXiv"} · ${cat} · open access`,
      author: authors, verified: true, published_at: published, genre: "study",
    })) added++;
  }
  return added;
}

async function fromHN() {
  const ids = JSON.parse(await fetchText("https://hacker-news.firebaseio.com/v0/topstories.json")).slice(0, 12);
  let added = 0;
  for (const id of ids) {
    try {
      const it = JSON.parse(await fetchText(`https://hacker-news.firebaseio.com/v0/item/${id}.json`));
      if (!it || !it.url || !it.title) continue;
      const host = (() => { try { return new URL(it.url).hostname.replace(/^www\./, ""); } catch { return "news.ycombinator.com"; } })();
      if (savePost({
        title: it.title, summary: summaryOf(`${it.title}. Reported by ${host} — ${it.score || 0} points and ${it.descendants || 0} comments on Hacker News.`),
        url: it.url, tags: keywords(it.title), source_name: "Hacker News", chip: "News",
        credit: `${host} · via Hacker News`, author: host, verified: false,
        published_at: new Date((it.time || Date.now() / 1000) * 1000).toISOString(), genre: "earn",
      })) added++;
    } catch {}
  }
  return added;
}

async function fromNASA() {
  const topic = NASA_TOPICS[Math.floor(Math.random() * NASA_TOPICS.length)];
  const data = JSON.parse(await fetchText(`https://images-api.nasa.gov/search?q=${topic}&media_type=image&page_size=6`));
  let added = 0;
  for (const item of (data.collection && data.collection.items || []).slice(0, 4)) {
    const d = (item.data && item.data[0]) || {};
    const img = (item.links && item.links[0]) || {};
    if (!d.title || !img.href) continue;
    const url = d.nasa_id ? `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}` : img.href;
    if (savePost({
      title: d.title, summary: summaryOf(d.description || d.title), url,
      media: { kind: "image", url: img.href }, tags: keywords(d.title + " " + (d.description || "")).concat([topic]),
      source_name: "NASA", chip: "NASA", credit: `NASA${d.photographer ? " · " + d.photographer : ""} · public domain`,
      author: d.photographer || "NASA", verified: true, published_at: d.date_created, genre: "study",
    })) added++;
  }
  return added;
}

async function fromTopic(topicId) {
  const tq = taxonomy.TOPIC_QUERIES[topicId]; if (!tq) return 0;
  let added = 0;
  try {
    const query = encodeURIComponent(tq.arxiv);
    const xml = await fetchText(`http://export.arxiv.org/api/query?search_query=all:${query}&start=0&max_results=4&sortBy=submittedDate&sortOrder=descending`);
    const entries = xml.split("<entry>").slice(1);
    for (const en of entries) {
      const grab = (tag) => { const m = en.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return m ? strip(m[1]) : ""; };
      const title = grab("title"); const summary = grab("summary");
      const url = (en.match(/<id>([^<]+)<\/id>/) || [])[1] || "";
      const authors = [...en.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]).slice(0, 4).join(", ");
      const published = grab("published");
      if (!title || !url) continue;
      const c = taxonomy.classify(title, summary, []);
      if (savePost({
        title, summary: summaryOf(summary), url, tags: keywords(title + " " + summary).concat([c.sub]),
        source_name: "arXiv · " + c.topic, chip: c.sub, credit: `${authors || "arXiv"} · ${c.topic} · open access`,
        author: authors, verified: true, published_at: published, genre: "study",
      })) added++;
    }
  } catch (e) {}
  if (tq.nasa) {
    try {
      const data = JSON.parse(await fetchText(`https://images-api.nasa.gov/search?q=${encodeURIComponent(tq.nasa)}&media_type=image&page_size=4`));
      for (const item of (data.collection && data.collection.items || []).slice(0, 2)) {
        const d = (item.data && item.data[0]) || {}; const img = (item.links && item.links[0]) || {};
        if (!d.title || !img.href) continue;
        const url = d.nasa_id ? `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}` : img.href;
        const c = taxonomy.classify(d.title, d.description || "", [tq.nasa]);
        if (savePost({
          title: d.title, summary: summaryOf(d.description || d.title), url,
          media: { kind: "image", url: img.href }, tags: keywords(d.title + " " + (d.description || "")).concat([c.sub]),
          source_name: "NASA", chip: c.sub, credit: `NASA${d.photographer ? " · " + d.photographer : ""} · public domain`,
          author: d.photographer || "NASA", verified: true, published_at: d.date_created, genre: "study",
        })) added++;
      }
    } catch (e) {}
  }
  return added;
}

async function run() {
  if (state.running) return state;
  state.paused = isPaused();
  if (state.paused) {
    state.next_run = new Date(Date.now() + 3600e3).toISOString();
    return state;
  }
  state.running = true;
  let added = 0;
  const errors = [];
  const ids = taxonomy.TOPICS.map((t) => t.id);
  let ci = readCursor();
  for (let k = 0; k < TOPICS_PER_RUN; k++) {
    const tid = ids[ci % ids.length]; ci++;
    try { added += await fromTopic(tid); } catch (e) { errors.push(`${tid}: ${e.message}`); }
  }
  writeCursor(ci % ids.length);
  state.last_run = new Date().toISOString();
  state.last_added = added;
  state.added_total += added;
  state.errors = errors;
  state.running = false;
  state.next_run = new Date(Date.now() + 3600e3).toISOString();
  if (added) {
    try { require("./recommend").loadItems(); } catch {}
    console.log(`pipeline: +${added} discovery posts (${errors.length ? errors.join("; ") : "clean"})`);
  }
  return state;
}

function start() {
  setTimeout(() => run().catch(() => {}), 4000);
  const t = setInterval(() => run().catch(() => {}), 3600e3);
  if (t.unref) t.unref();
}
function status() { return { ...state, sources: ["arXiv", "Hacker News", "NASA"], interval_minutes: 60 }; }

module.exports = { run, start, status };