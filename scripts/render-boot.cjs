/* Render boot prep: fresh one-time upload token + clip wiring map.
   The 5 demo reels are hosted in this deployment's own Supabase video_clips
   (same-origin relative URLs); the rest of the library streams from the
   legacy QW Page, which stays live. Runs before server/index.js. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ROOT = path.join(__dirname, "..");
const sd = path.join(ROOT, "server", "seed-data");
fs.mkdirSync(sd, { recursive: true });
fs.writeFileSync(path.join(sd, "upload-token.json"), JSON.stringify({ token: crypto.randomBytes(24).toString("hex") }));
const DEMO = ["s-2001", "s-2029", "s-2091", "s-2241", "s-2350"];
let map = {};
try { map = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "videos", "real", "_hosted_urls.json"), "utf8")); } catch {}
const out = Object.entries(map).map(([id, url]) => ({
  id, table: id.startsWith("s-") ? "studies" : "discoveries",
  url: DEMO.includes(id) ? "/videos/real/" + id + ".mp4" : url,
}));
fs.writeFileSync(path.join(sd, "cloud-videos.json"), JSON.stringify(out));
console.log("render-boot: " + out.length + " clip URLs wired (" + DEMO.length + " same-origin)");
