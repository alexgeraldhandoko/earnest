/* EARNest · server entry — static frontend + JSON API, zero npm dependencies.
   Requires Node.js >= 22.13 (built-in node:sqlite). */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

/* Minimal .env loader (zero dependencies). Real env vars always win. */
(function loadEnv() {
  const file = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
})();

const { seed } = require("./seed");
const auth = require("./auth");
const api = require("./api");
const pipeline = require("./pipeline");
const persist = require("./persist");
const recommend = require("./recommend");

(async () => {
  await persist.init();          // hydrate SQLite from the Page database (if configured)
  seed();                        // no-op when data already exists
  /* Cloud publishes bundle a post → streamed-footage map; local builds don't. */
  const cvPath = path.join(__dirname, "seed-data", "cloud-videos.json");
  if (fs.existsSync(cvPath)) {
    try {
      const { q } = require("./db");
      const list = JSON.parse(fs.readFileSync(cvPath, "utf8"));
      for (const e of list) {
        /* a post id can exist in both tables — wire whichever rows exist */
        q.run("UPDATE studies SET video=?, image=NULL WHERE id=?", e.url, e.id);
        q.run("UPDATE discoveries SET video=?, media_kind='video', image=NULL WHERE id=?", e.url, e.id);
      }
      console.log(`cloud videos: ${list.length} posts pointed at streamed footage`);
    } catch (e) { console.error("cloud videos:", e.message); }
  }
  require("./studysync").sync(); // curated paid-study content snapshot (cloud builds only)
  require("./discoverysync").sync(); // plain-English discovery content snapshot (cloud builds only)
  require("./gamesync").sync();  // researcher game-library snapshot (INSERT OR IGNORE)
  require("./demosync").sync();  // researcher-demo account + seeded responses (self-healing)
  require("./migratesync").sync(); // live-only rows carried over from the previous cloud page
  /* Mirror boot-seeded rows to the Page DB immediately — a suspended cold
     start must not leave the durable store behind the local SQLite state. */
  await persist.flush();
  recommend.loadItems();         // build the ranking index
  require("./impacts").sync();   // study-derived impacts (rebuilds placeholders/stale rows)
  pipeline.start();              // hourly scrape → discover
  require("./videohost").ensureTable().then((r) => {
    console.log("videohost:", JSON.stringify(r));
    if (r && r.ready) require("./videohost").prewarm(24).then((p) => console.log("videohost prewarm:", JSON.stringify(p))).catch(() => {});
  });
  require("./qwenwork").boot().catch((e) => console.error("qwenwork boot:", e.message));
  require("./inbox").startBridge();
  require("./inbox").startPoller();
  require("./gamebuilder").start();
})().catch((e) => console.error("boot failed (server stays up):", e));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

function readBody(req) {
  const limit = req.url.startsWith("/api/upload") ? 60e6 : req.url.startsWith("/api/videohost/upload") ? 8e6 : 1e6;
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("Body too large."), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
const UPLOAD_DIR = path.join(require("./db").DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
/* on read-only runtimes, bring the bundled uploads into the writable dir */
const BUNDLED_UPLOADS = path.join(__dirname, "..", "data", "uploads");
if (UPLOAD_DIR !== BUNDLED_UPLOADS && fs.existsSync(BUNDLED_UPLOADS)) {
  try { fs.cpSync(BUNDLED_UPLOADS, UPLOAD_DIR, { recursive: true, force: false }); } catch {}
}
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  if (rel === "/admin" || rel === "/admin/") rel = "/admin/index.html";
  let baseDir = PUBLIC_DIR;
  if (rel.startsWith("/uploads/")) { baseDir = UPLOAD_DIR; rel = rel.slice("/uploads".length); }
  const file = path.normalize(path.join(baseDir, rel));
  if (!file.startsWith(baseDir)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.stat(file, async (err, st) => {
    if (err || !st.isFile()) {
      /* game key art is deterministic from the spec — render it from the DB so
         builds work on read-only cloud runtimes (no story-art file needed) */
      const art = rel.match(/^\/story-art\/([\w-]+)\/(logo|poster)\.svg$/);
      if (art) {
        try {
          const g = require("./storage").load(art[1]);
          if (g && g.spec) {
            const svg = require("./gameart").svgFor(g.spec, g.id);
            res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
            return res.end(svg);
          }
        } catch (e) { console.error("story-art serve:", e.message); }
      }
      /* cloud: audited clips live in the Page DB, not the runtime bundle */
      const m = rel.match(/^\/videos\/real\/([a-z0-9-]+)\.mp4$/i);
      if (m && require("./videohost").ENABLED) {
        try { if (await require("./videohost").serve(req, res, m[1])) return; } catch (e) { console.error("videohost serve:", e.message); }
      }
      /* SPA fallback for non-file paths */
      if (!path.extname(rel)) return serveStatic(req, res, new URL("/index.html", "http://x"));
      res.writeHead(404); return res.end("Not found");
    }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    /* Finished video clips are immutable (the encode batch never rewrites an
       existing file), so let the browser cache them for a day — revisiting a
       reel then plays from cache instead of re-fetching. */
    const cache = rel.startsWith("/videos/") ? "public, max-age=86400" : "no-cache";
    const range = req.headers.range;
    if (range && /^bytes=/.test(range)) {
      const [startS, endS] = range.replace("bytes=", "").split("-");
      let start = parseInt(startS, 10), end = endS ? parseInt(endS, 10) : st.size - 1;
      if (isNaN(start)) { start = 0; }
      if (isNaN(end) || end >= st.size) end = st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Cache-Control": cache });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes", "Cache-Control": cache });
      fs.createReadStream(file).pipe(res);
    }
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/ig-webhook" || url.pathname.startsWith("/api/ig-webhook/")) {
        const raw = req.method === "POST" ? await readBody(req) : null;
        return await require("./igwebhook").handle(req, res, url, raw);
      }
      if (url.pathname === "/api/outstand-webhook" || url.pathname === "/api/outstand-callback") {
        const raw = req.method === "POST" ? await readBody(req) : null;
        return await require("./igwebhook").handleOutstand(req, res, url, raw);
      }
      if (url.pathname === "/api/qwenwork-oauth-callback" || url.pathname === "/api/qwenwork-oauth-callback/" || url.pathname.startsWith("/api/qwenwork-oauth/")) {
        const raw = req.method === "POST" ? await readBody(req) : null;
        return await require("./qwenwork").handle(req, res, url, raw);
      }
      if (url.pathname.startsWith("/api/videohost/")) {
        const raw = (req.method === "POST" || req.method === "PUT") ? await readBody(req) : null;
        return await require("./videohost").handle(req, res, url, raw);
      }
      let body = null;
      if (req.method === "POST" || req.method === "PUT") {
        const raw = await readBody(req);
        const ct = String(req.headers["content-type"] || "");
        if (url.pathname === "/api/upload") { body = { raw, ct }; }
        else if (ct.includes("application/json")) { try { body = JSON.parse(raw.toString("utf8") || "{}"); } catch { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "Invalid JSON." })); } }
        else if (ct.includes("application/x-www-form-urlencoded")) { body = Object.fromEntries(new URLSearchParams(raw.toString("utf8"))); }
        else body = {};
      }
      const token = parseCookies(req)[auth.COOKIE] || null;
      const user = auth.sessionUser(token);
      if (url.pathname.startsWith("/api/admin/")) {
        return await require("./admin").handle(req, res, url, body, user);
      }
      await api.handle(req, res, url, body, user, token);
      return;
    }
    serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(e.status || 500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.status ? e.message : "Server error." }));
  }
});
server.listen(PORT, process.env.HOST || "0.0.0.0", () => console.log(`EARNest running at http://localhost:${PORT} (demo login: demo@earnest.app / demo1234)`));