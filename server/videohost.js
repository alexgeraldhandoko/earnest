/* EARNest · cloud clip hosting — the Pages runtime.zip cannot bundle the
   finished promo clips (size cap) and Supabase Storage is permission-blocked
   for the runtime role, so clips live in the Page DB's video_clips table
   (base64, outside persist.js's snapshot mirror) and the app serves them at
   /videos/real/{id}.mp4 with range support + a warm tmp cache. Clips are
   pushed once from the founder's Mac via scripts/upload-clips-cloud.cjs
   through the token-guarded endpoints below. The token is generated at
   build time into staging only (never committed). */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
const ENABLED = !!(URL && KEY);
const CACHE_DIR = path.join(os.tmpdir(), "earnest-clip-cache");
const CACHE_MAX = 120; // ~450MB of warm clips per runtime instance

let TOKEN = "";
try { TOKEN = JSON.parse(fs.readFileSync(path.join(__dirname, "seed-data", "upload-token.json"), "utf8")).token || ""; } catch {}

/* How many hosted clip URLs this build wires at boot — recommend.js uses it
   to switch the cloud feed into video-only test mode once the map is live. */
let HOSTED_COUNT = 0;
try { HOSTED_COUNT = JSON.parse(fs.readFileSync(path.join(__dirname, "seed-data", "cloud-videos.json"), "utf8")).length; } catch {}

function headers(extra) { return { apikey: KEY, Authorization: `Bearer ${KEY}`, ...(extra || {}) }; }

async function ensureTable() {
  if (!ENABLED) return { enabled: false };
  try {
    const r = await fetch(`${URL}/rest/v1/video_clips?select=id&limit=1`, { headers: headers(), signal: AbortSignal.timeout(15000) });
    return { enabled: true, ready: r.ok, status: r.status };
  } catch (e) { return { enabled: true, ready: false, error: e.message }; }
}

async function list() {
  const r = await fetch(`${URL}/rest/v1/video_clips?select=id&id=like.*~meta`, { headers: headers(), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("list HTTP " + r.status);
  return (await r.json()).map((x) => x.id.replace(/~meta$/, ""));
}

/* The Page gateway caps request bodies at ~1MB, so clips arrive as ≤600KB
   parts (rows "{id}~{NNN}") with a "{id}~meta" row written last. */
async function uploadPart(id, part, parts, totalBytes, buf) {
  const rows = [{ id: `${id}~${String(part).padStart(3, "0")}`, data: buf.toString("base64"), bytes: buf.length, updated_at: new Date().toISOString() }];
  if (part === parts - 1 && totalBytes) rows.push({ id: `${id}~meta`, data: JSON.stringify({ parts, bytes: totalBytes }), bytes: 0, updated_at: new Date().toISOString() });
  const r = await fetch(`${URL}/rest/v1/video_clips?on_conflict=id`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error("upload HTTP " + r.status + " " + (await r.text()).slice(0, 150));
}

function clipUrl(req, id) { return `https://${req.headers.host}/videos/real/${id}.mp4`; }

function evictCache() {
  try {
    const files = fs.readdirSync(CACHE_DIR).map((f) => ({ f, t: fs.statSync(path.join(CACHE_DIR, f)).mtimeMs }));
    if (files.length <= CACHE_MAX) return;
    files.sort((a, b) => a.t - b.t);
    for (const { f } of files.slice(0, files.length - CACHE_MAX)) {
      try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch {}
    }
  } catch {}
}

/* Fetch a clip from the Page DB into the warm tmp cache; true when the file
   is ready. Shared by serve() and the boot prewarm. */
async function warm(id) {
  if (!ENABLED || !/^[a-z0-9-]{1,40}$/i.test(id)) return false;
  const file = path.join(CACHE_DIR, id + ".mp4");
  if (fs.existsSync(file)) return true;
  const r = await fetch(`${URL}/rest/v1/video_clips?id=like.${encodeURIComponent(id)}~*&select=id,data&order=id.asc`, { headers: headers(), signal: AbortSignal.timeout(30000) });
  if (!r.ok) return false;
  const rows = await r.json();
  const meta = rows.find((x) => x.id === id + "~meta");
  if (!meta) return false;
  let info; try { info = JSON.parse(meta.data); } catch { return false; }
  const parts = rows.filter((x) => x.id !== id + "~meta");
  if (parts.length !== info.parts) return false;
  const buf = Buffer.concat(parts.map((x) => Buffer.from(x.data, "base64")));
  if (info.bytes && buf.length !== info.bytes) return false;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, buf);
  evictCache();
  return true;
}

/* Boot prewarm: pull a spread of hosted clips into the cache so the first
   swipes never pay the Page-DB round trip. Sequential + background — never
   blocks boot, never competes with live traffic for more than one fetch. */
async function prewarm(count = 24) {
  if (!ENABLED) return { prewarmed: 0 };
  let ids = [];
  try { ids = JSON.parse(fs.readFileSync(path.join(__dirname, "seed-data", "cloud-videos.json"), "utf8")).map((e) => e.id); } catch {}
  if (!ids.length) return { prewarmed: 0 };
  const step = Math.max(1, Math.floor(ids.length / count));
  const pick = ids.filter((_, i) => i % step === 0).slice(0, count);
  let n = 0;
  for (const id of pick) { try { if (await warm(id)) n++; } catch {} }
  return { prewarmed: n };
}

/* Serve a clip from the warm cache, fetching + decoding from the Page DB on
   a miss. Returns false when the clip is unknown (caller falls through). */
async function serve(req, res, id) {
  if (!ENABLED || !/^[a-z0-9-]{1,40}$/i.test(id)) return false;
  if (!(await warm(id))) return false;
  const file = path.join(CACHE_DIR, id + ".mp4");
  const st = fs.statSync(file);
  const range = req.headers.range;
  if (range && /^bytes=/.test(range)) {
    const [startS, endS] = range.replace("bytes=", "").split("-");
    let start = parseInt(startS, 10), end = endS ? parseInt(endS, 10) : st.size - 1;
    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= st.size) end = st.size - 1;
    if (start > end || start >= st.size) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); res.end(); return true; }
    res.writeHead(206, { "Content-Type": "video/mp4", "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400" });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": st.size, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400" });
    fs.createReadStream(file).pipe(res);
  }
  return true;
}

async function handle(req, res, url, raw) {
  const p = url.pathname;
  const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (!ENABLED) return send(400, { error: "Supabase not configured." });
  if (p === "/api/videohost/status") return send(200, { enabled: true, table: await ensureTable(), hosted: HOSTED_COUNT });
  if (!TOKEN || String(req.headers["x-upload-token"] || "") !== TOKEN) return send(403, { error: "Bad upload token." });
  if (p === "/api/videohost/list") {
    try { return send(200, { ids: await list() }); } catch (e) { return send(502, { error: e.message }); }
  }
  /* founder-only diagnosis: why does warm() fail for a clip? Reports the
     Supabase HTTP status + row/meta validation without exposing clip data. */
  if (p === "/api/videohost/debug") {
    const id = String(url.searchParams.get("id") || "");
    if (!/^[a-z0-9-]{1,40}$/i.test(id)) return send(400, { error: "Bad id." });
    const out = { id, cached: fs.existsSync(path.join(CACHE_DIR, id + ".mp4")) };
    try {
      const r = await fetch(`${URL}/rest/v1/video_clips?id=like.${encodeURIComponent(id)}~*&select=id&order=id.asc`, { headers: headers(), signal: AbortSignal.timeout(30000) });
      out.idQuery = { status: r.status, ok: r.ok };
      if (!r.ok) { out.body = (await r.text()).slice(0, 300); return send(200, out); }
      const ids = await r.json();
      out.rows = ids.length;
      out.metaFound = ids.some((x) => x.id === id + "~meta");
      const r2 = await fetch(`${URL}/rest/v1/video_clips?id=like.${encodeURIComponent(id)}~*&select=id,data&order=id.asc`, { headers: headers(), signal: AbortSignal.timeout(30000) });
      out.dataQuery = { status: r2.status, ok: r2.ok };
      if (!r2.ok) { out.body = (await r2.text()).slice(0, 300); return send(200, out); }
      const rows = await r2.json();
      const meta = rows.find((x) => x.id === id + "~meta");
      if (meta) {
        try {
          const info = JSON.parse(meta.data);
          const parts = rows.filter((x) => x.id !== id + "~meta");
          const buf = Buffer.concat(parts.map((x) => Buffer.from(x.data, "base64")));
          out.validation = { partsExpected: info.parts, partsGot: parts.length, bytesExpected: info.bytes, bytesGot: buf.length, pass: parts.length === info.parts && (!info.bytes || buf.length === info.bytes) };
        } catch { out.metaParse = false; }
      }
      return send(200, out);
    } catch (e) { out.error = e.message; return send(200, out); }
  }
  if (p === "/api/videohost/map") {
    try { const ids = await list(); const out = {}; for (const id of ids) out[id] = clipUrl(req, id); return send(200, out); }
    catch (e) { return send(502, { error: e.message }); }
  }
  if (p === "/api/videohost/upload" && req.method === "POST") {
    const id = String(url.searchParams.get("id") || "");
    const part = Number(url.searchParams.get("part")), parts = Number(url.searchParams.get("parts"));
    const totalBytes = Number(url.searchParams.get("bytes") || 0);
    if (!/^[a-z0-9-]{1,40}$/i.test(id)) return send(400, { error: "Bad id." });
    if (!Number.isInteger(part) || !Number.isInteger(parts) || part < 0 || part >= parts || parts > 64) return send(400, { error: "Bad part index." });
    if (!raw || !raw.length) return send(400, { error: "Empty body." });
    try { await uploadPart(id, part, parts, totalBytes, raw); return send(200, { id, part, url: clipUrl(req, id) }); } catch (e) { return send(502, { error: e.message }); }
  }
  return send(404, { error: "Unknown videohost route." });
}

module.exports = { handle, serve, ensureTable, prewarm, ENABLED, HOSTED_COUNT };