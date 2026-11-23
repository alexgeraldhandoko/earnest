/* EARNest · game key art. Every story game ships with a Monument-Valley-style
   SVG monument (pillar + waterfall + statue) generated from its spec — used as
   the card logo and the detail poster. Procedural, deterministic, zero assets. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const SKY = {
  day: ["#bfe3ee", "#e9f0e4", "#f6ecd9"],
  dusk: ["#f6c8a0", "#e0a0b4", "#8f7bb8"],
  night: ["#20264e", "#3c3670", "#6a5a9e"],
};
const STONE = { day: ["#f7f0e1", "#e2d3bf", "#c6b39e"], dusk: ["#f2e2d0", "#d9b8a8", "#b08ea0"], night: ["#cfc4e0", "#a898c4", "#7f70a4"] };
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

function statue(variant, accent) {
  if (variant === 0) return `
    <path d="M236 150 L256 96 L276 150 Z" fill="#f6f2ea"/>
    <circle cx="256" cy="150" r="14" fill="#f6e7d7"/>
    <path d="M240 162 Q232 196 236 208 Q256 216 276 208 Q280 196 272 162 Q256 154 240 162 Z" fill="#f6f2ea"/>
    <rect x="238" y="198" width="36" height="5" fill="${accent}"/>`;
  if (variant === 1) return `
    <rect x="244" y="192" width="24" height="16" fill="#e2d3bf"/>
    <ellipse cx="256" cy="168" rx="18" ry="26" fill="#5a5a72"/>
    <circle cx="266" cy="142" r="12" fill="#5a5a72"/>
    <path d="M276 138 L294 144 L276 150 Z" fill="#f2d49b"/>
    <circle cx="269" cy="140" r="3" fill="#f6ecd9"/>
    <path d="M240 164 L220 184 L242 184 Z" fill="#4a4a60"/>`;
  if (variant === 2) return `
    <path d="M226 208 L256 194 L286 208 L256 222 Z" fill="#f7f0e1"/>
    <path d="M226 208 L256 222 L256 238 L226 224 Z" fill="#e2d3bf"/>
    <path d="M286 208 L256 222 L256 238 L286 224 Z" fill="#c6b39e"/>
    <circle cx="256" cy="176" r="18" fill="#b8a8e0"/>
    <path d="M242 160 L256 128 L270 160 Z" fill="#7fd4c1"/>`;
  if (variant === 3) return `
    <rect x="222" y="140" width="16" height="68" fill="#e2d3bf"/>
    <rect x="274" y="140" width="16" height="68" fill="#e2d3bf"/>
    <rect x="214" y="124" width="84" height="18" fill="#f7f0e1"/>
    <circle cx="256" cy="176" r="9" fill="${accent}"/>`;
  return `
    <path d="M256 208 Q262 178 256 152" stroke="#7fb89a" stroke-width="5" fill="none"/>
    <circle cx="242" cy="146" r="10" fill="#e8a0c0"/><circle cx="270" cy="146" r="10" fill="#e8a0c0"/>
    <circle cx="248" cy="162" r="10" fill="#e8a0c0"/><circle cx="264" cy="162" r="10" fill="#e8a0c0"/>
    <circle cx="256" cy="136" r="10" fill="#e8a0c0"/><circle cx="256" cy="152" r="8" fill="#f2d49b"/>`;
}

function svgFor(spec, id) {
  const world = (spec && spec.world) || {};
  const time = SKY[world.time] ? world.time : "dusk";
  const sky = SKY[time], stone = STONE[time];
  const accent = ((spec.characters || [])[0] || {}).colors?.accent || "#f2a08c";
  const variant = hash(id || spec.title || "mv") % 5;
  const stars = time === "night" ? Array.from({ length: 26 }, (_, i) => {
    const x = (hash("x" + i) % 480) + 16, y = (hash("y" + i) % 200) + 12;
    return `<rect x="${x}" y="${y}" width="2" height="2" fill="#f6ecd9" opacity="${0.3 + (i % 5) * 0.14}"/>`;
  }).join("") : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${sky[0]}"/><stop offset="0.55" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/>
    </linearGradient>
    <clipPath id="wf"><path d="M336 226 L268 258 L268 420 L336 388 Z"/></clipPath>
  </defs>
  <rect width="512" height="512" fill="url(#sky)"/>
  ${stars}
  <g opacity="0.35">
    <path d="M84 120 L112 133 L84 146 L56 133 Z" fill="${sky[1]}"/><rect x="70" y="136" width="28" height="30" fill="${stone[1]}"/>
    <path d="M428 96 L456 109 L428 122 L400 109 Z" fill="${sky[1]}"/><rect x="414" y="112" width="28" height="30" fill="${stone[1]}"/>
  </g>
  <ellipse cx="256" cy="432" rx="130" ry="34" fill="${time === "night" ? "#5f7fc0" : "#8fd4d9"}" opacity="0.6"/>
  <ellipse cx="256" cy="432" rx="96" ry="24" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.5"/>
  <path d="M166 210 L256 252 L256 428 L166 386 Z" fill="${stone[1]}"/>
  <path d="M346 210 L256 252 L256 428 L346 386 Z" fill="${stone[2]}"/>
  <g clip-path="url(#wf)">
    <rect x="260" y="220" width="90" height="220" fill="#bfe3ee" opacity="0.85"/>
    <g fill="#ffffff" opacity="0.75">
      <rect x="276" y="230" width="5" height="34"/><rect x="292" y="260" width="5" height="34"/><rect x="308" y="240" width="5" height="34"/><rect x="324" y="272" width="5" height="34"/>
      <rect x="284" y="320" width="5" height="34"/><rect x="300" y="350" width="5" height="34"/><rect x="316" y="330" width="5" height="34"/>
    </g>
  </g>
  <ellipse cx="300" cy="424" rx="30" ry="9" fill="#ffffff" opacity="0.7"/>
  <path d="M256 168 L346 210 L256 252 L166 210 Z" fill="${stone[0]}"/>
  <path d="M256 168 L346 210 L256 252 L166 210 Z" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.55"/>
  ${statue(variant, accent)}
</svg>`;
}

/* Return the public URL paths for a game's logo + poster. The SVG is
   deterministic from the spec, so the server also renders it on demand from
   the DB (see serveStatic in index.js) — that path works on read-only cloud
   runtimes. Writing the static files is a best-effort local cache only and
   must never fail a build. */
function ensureArt(id, spec) {
  try {
    const dir = path.join(__dirname, "..", "public", "story-art", id);
    fs.mkdirSync(dir, { recursive: true });
    const svg = svgFor(spec, id);
    fs.writeFileSync(path.join(dir, "logo.svg"), svg);
    fs.writeFileSync(path.join(dir, "poster.svg"), svg);
  } catch { /* read-only runtime — art is served from the DB spec instead */ }
  return { logo: `/story-art/${id}/logo.svg`, poster: `/story-art/${id}/poster.svg` };
}

module.exports = { svgFor, ensureArt };