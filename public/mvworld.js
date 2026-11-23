/* EARNest · MVWorld — the Monument-Valley-style world module.
   Procedural isometric dioramas of modern-day Earth, flat-shaded pastel faces.
   The three hero settings are drawn straight from the reference art:
     school  → "The Courtyard"  (cream U-block, coral stair tower, sage lawn)
     metro   → "The Commute"    (lilac cutaway station, silver train, red doors)
     office  → "After Hours"   (minimalist open office, pixel-faithful reference)
   White-based skies with soft blue / lavender / apricot hues. Tap anywhere and
   the robed figure walks there (no puzzles). The selection screen is a round
   hall: the character stands on a central tower while a ring of arched,
   statue-topped pillars rotates around them. Zero image assets — all drawn. */
"use strict";
window.MVWorld = (function () {
  const TW = 64, TH = 32, ZH = 26;
  const iso = (x, y, z) => ({ x: (x - y) * TW / 2, y: (x + y) * TH / 2 - (z || 0) * ZH });

  /* ---------------- palettes (white base + soft hues) ---------------- */
  const TIME = {
    day:   { sky: ["#ffffff", "#eaf2fb", "#f0eaf8"], top: "#f6f4ef", left: "#dfe6f2", right: "#c3cfe4", water: "#a8d8e8", haze: "#ffffff", glow: 0 },
    dusk:  { sky: ["#fdf3ea", "#f6e2e8", "#e6def4"], top: "#f8f2ec", left: "#e8dada", right: "#cdbcc8", water: "#b8c8e8", haze: "#ffe9d8", glow: 0.3 },
    night: { sky: ["#2a2f5e", "#4a4280", "#7a6aae"], top: "#d8d0e8", left: "#b0a4cc", right: "#8a7ca8", water: "#6f8fc8", haze: "#9a8ac0", glow: 1 },
  };
  const ACCENTS = ["#8fb8e8", "#b8a8e0", "#f2c8a0", "#a8d8d8", "#e8a0c0", "#f2d49b"];
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const shade = (hex, f) => {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
    const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
    const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
    return `rgb(${r},${g},${b})`;
  };
  const mix = (h1, h2, u) => {
    const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
    const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * u);
    const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * u);
    const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * u);
    return `rgb(${r},${g},${bl})`;
  };

  /* ---------------- world builders ---------------- */
  const W = 16, D = 13;
  function blank() {
    return { W, D, h: new Array(W * D).fill(null), kind: new Array(W * D).fill(""), block: new Set(), decor: [], water: new Set(), setting: "courtyard", time: "day", pal: TIME.day, mat: {}, zones: [], spawn: { x: 7, y: 9 } };
  }
  const at = (w, x, y) => (x < 0 || y < 0 || x >= W || y >= D) ? null : w.h[y * W + x];
  function slab(w, x0, y0, x1, y1, h, kind) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { w.h[y * W + x] = h; if (kind) w.kind[y * W + x] = kind; }
  }
  function wall(w, x0, y0, x1, y1, h, kind) {
    slab(w, x0, y0, x1, y1, h, kind || "wall");
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.block.add(x + "," + y);
  }
  function plateau(w, x0, y0, x1, y1, h, stairs) {
    slab(w, x0, y0, x1, y1, h);
    for (const [sx, sy, sh] of stairs || []) w.h[sy * W + sx] = sh;
  }
  function put(w, type, x, y, opts) { w.decor.push({ type, x, y, ...(opts || {}) }); if (!["rug", "line", "lights", "awning", "laundry", "glassrail", "lawn"].includes(type)) w.block.add(x + "," + y); }
  function water(w, x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { w.h[y * W + x] = null; w.water.add(x + "," + y); }
  }

  const BUILDERS = {
    /* "The Courtyard" — cream U-shaped block, coral zig-zag stair tower,
       pilotis, striped-awning café, sage lawn, scalloped tree, white benches. */
    school(w) {
      w.mat = {
        wall: { top: "#fdf6e3", left: "#f0e6cf", right: "#d8cbae", win: "#4a6363" },
        coral: { top: "#f0a08c", left: "#e88d76", right: "#c8705c" },
        lawn: { top: "#a3c9a8", left: "#8fb894", right: "#7aa480" },
      };
      slab(w, 1, 1, 14, 11, 0);
      slab(w, 4, 4, 11, 9, 0, "lawn");
      wall(w, 2, 1, 13, 2, 3, "wall");           // back block
      wall(w, 1, 3, 2, 10, 3, "wall");           // left wing
      wall(w, 13, 3, 14, 10, 3, "wall");         // right wing
      wall(w, 7, 3, 8, 3, 4, "coral");           // stair tower core
      put(w, "stairtower", 7, 4);
      put(w, "columns", 3, 3, { x1: 12 });       // pilotis under the block
      put(w, "cafe", 3, 10, { awning: "#e88d76" });
      put(w, "tree", 7, 6, { v: 2 });            // scalloped canopy
      put(w, "bench", 5, 8, { white: true }); put(w, "bench", 10, 8, { white: true });
      put(w, "balcony", 4, 2, { x1: 12 });
      put(w, "planter", 9, 5); put(w, "flag", 12, 6);
      w.zones = [{ x: 5, y: 5 }, { x: 10, y: 6 }, { x: 7, y: 9 }]; w.spawn = { x: 7, y: 10 };
    },
    /* "The Commute" — lilac cutaway station: arched concourse, turnstiles,
       hanging signs, glass-railed stair, silver train with red doors. */
    metro(w) {
      w.mat = {
        wall: { top: "#e4dcf0", left: "#d8c8e8", right: "#9d8cb8", win: "#5a4a78", arch: true },
        platform: { top: "#ece6f4", left: "#d8c8e8", right: "#b0a0c8" },
        coral: { top: "#f0a08c", left: "#e88d76", right: "#c8705c" },
      };
      slab(w, 1, 4, 14, 9, 0, "platform");       // main platform
      slab(w, 1, 1, 14, 3, 1, "platform");       // concourse (raised)
      wall(w, 1, 1, 14, 1, 3, "wall");           // arched back wall
      slab(w, 6, 3, 7, 3, 1); w.h[3 * W + 6] = 1; w.h[3 * W + 7] = 1;
      w.h[4 * W + 6] = 0; w.h[4 * W + 7] = 0;    // stair mouth
      put(w, "roofstair", 6, 3, { wide: true });
      put(w, "glassrail", 5, 3, { x1: 8 });
      put(w, "turnstile", 4, 2); put(w, "turnstile", 10, 2);
      put(w, "hangsign", 5, 4); put(w, "hangsign", 10, 4);
      put(w, "bench", 3, 7); put(w, "bench", 11, 7);
      put(w, "vending", 13, 5);
      put(w, "busstop", 2, 1);
      slab(w, 1, 10, 14, 11, null, "rail");
      put(w, "train", 1, 10, { x1: 14 });
      put(w, "line", 1, 9, { x1: 14 });
      w.zones = [{ x: 4, y: 5 }, { x: 8, y: 7 }, { x: 11, y: 6 }]; w.spawn = { x: 7, y: 8 };
    },
    /* "Above the City" — periwinkle tower with lit windows, peach roof deck,
       straight stair, utility room, AC units, legged water tank, laundry. */
    office(w) {
      w.mat = {
        wall: { top: "#9d98c4", left: "#7a75a8", right: "#5d5680", win: "#4a4a6a", lit: "#f4b958" },
        roof: { top: "#e8c3b6", left: "#d8b0a4", right: "#c09888" },
        parapet: { top: "#9d98c4", left: "#7a75a8", right: "#5d5680" },
      };
      slab(w, 1, 1, 14, 11, 0, "roof");
      wall(w, 1, 1, 14, 2, 4, "wall");           // tower top with windows
      for (let x = 1; x <= 14; x++) { w.h[11 * W + x] = 1; w.block.add(x + ",11"); w.kind[11 * W + x] = "parapet"; }
      for (let y = 3; y <= 10; y++) { w.h[y * W + 1] = 1; w.block.add("1," + y); w.kind[y * W + 1] = "parapet"; w.h[y * W + 14] = 1; w.block.add("14," + y); w.kind[y * W + 14] = "parapet"; }
      plateau(w, 9, 4, 12, 6, 1, []);
      put(w, "roofstair", 8, 5);
      put(w, "utility", 3, 4);
      put(w, "ac", 6, 4); put(w, "ac", 7, 6);
      put(w, "tank", 12, 3);
      put(w, "laundry", 4, 8, { x2: 8, y2: 8 });
      put(w, "bench", 10, 9);
      put(w, "sitter", 13, 9);
      put(w, "planter", 3, 9);
      w.zones = [{ x: 6, y: 7 }, { x: 10, y: 7 }, { x: 4, y: 6 }]; w.spawn = { x: 7, y: 9 };
    },
    courtyard(w) {
      w.mat = { wall: { top: "#fdf6e3", left: "#f0e6cf", right: "#d8cbae", win: "#4a6363" }, coral: { top: "#f0a08c", left: "#e88d76", right: "#c8705c" } };
      slab(w, 1, 1, 14, 11, 0);
      wall(w, 1, 1, 14, 2, 3, "wall"); wall(w, 1, 3, 2, 11, 3, "wall");
      put(w, "planter", 5, 5); put(w, "planter", 8, 7); put(w, "planter", 5, 9);
      put(w, "lantern", 7, 4); put(w, "lantern", 10, 8); put(w, "tree", 12, 4, { v: 2 });
      put(w, "bench", 9, 5, { white: true }); put(w, "door", 8, 2);
      water(w, 11, 9, 13, 10);
      w.zones = [{ x: 7, y: 6 }, { x: 10, y: 4 }, { x: 5, y: 8 }]; w.spawn = { x: 8, y: 10 };
    },
    rooftop(w) {
      w.mat = { roof: { top: "#e8c3b6", left: "#d8b0a4", right: "#c09888" }, parapet: { top: "#9d98c4", left: "#7a75a8", right: "#5d5680" } };
      slab(w, 1, 1, 14, 11, 0, "roof");
      for (let x = 1; x <= 14; x++) { w.h[1 * W + x] = 1; w.block.add(x + ",1"); w.h[11 * W + x] = 1; w.block.add(x + ",11"); w.kind[1 * W + x] = "parapet"; w.kind[11 * W + x] = "parapet"; }
      for (let y = 2; y <= 10; y++) { w.h[y * W + 1] = 1; w.block.add("1," + y); w.h[y * W + 14] = 1; w.block.add("14," + y); w.kind[y * W + 1] = "parapet"; w.kind[y * W + 14] = "parapet"; }
      plateau(w, 6, 6, 9, 8, 1, []);
      put(w, "tank", 3, 3); put(w, "ac", 11, 3); put(w, "ac", 12, 5);
      put(w, "planter", 3, 8); put(w, "planter", 4, 9); put(w, "planter", 5, 10);
      put(w, "lamp", 3, 5); put(w, "lamp", 10, 5); put(w, "lights", 3, 5, { x2: 10, y2: 5 });
      w.zones = [{ x: 7, y: 7 }, { x: 4, y: 6 }, { x: 11, y: 8 }]; w.spawn = { x: 7, y: 9 };
    },
    street(w) {
      w.mat = { wall: { top: "#f5d0b5", left: "#e8b498", right: "#dca085", win: "#7a9e7e", shutter: true } };
      slab(w, 1, 1, 14, 11, 0);
      wall(w, 1, 1, 14, 2, 3, "wall");
      slab(w, 1, 8, 14, 9, 0, "road");
      water(w, 1, 10, 14, 11);
      put(w, "stall", 5, 5, { awning: "#7a9e7e" }); put(w, "stall", 9, 5, { awning: "#e88d76" });
      put(w, "lamp", 3, 7); put(w, "lamp", 12, 7); put(w, "car", 10, 8);
      put(w, "awning", 4, 2, { x1: 6, color: "#7a9e7e" }); put(w, "awning", 9, 2, { x1: 12, color: "#e88d76" });
      put(w, "cross", 7, 8, { x1: 8 });
      w.zones = [{ x: 6, y: 4 }, { x: 10, y: 6 }, { x: 3, y: 6 }]; w.spawn = { x: 7, y: 7 };
    },
    house(w) {
      w.mat = { wall: { top: "#f5d0b5", left: "#e8b498", right: "#dca085", win: "#7a9e7e", shutter: true } };
      slab(w, 1, 1, 14, 11, 0);
      wall(w, 1, 1, 14, 2, 3, "wall"); wall(w, 1, 3, 2, 11, 3, "wall");
      put(w, "rug", 6, 5, { x1: 9, y1: 8, color: "#e8e4f2" });
      put(w, "sofa", 4, 5); put(w, "table", 7, 6); put(w, "planter", 12, 3); put(w, "planter", 3, 9);
      put(w, "lamp", 11, 8); put(w, "shelf", 12, 6); put(w, "door", 9, 2);
      w.zones = [{ x: 6, y: 5 }, { x: 10, y: 6 }, { x: 5, y: 8 }]; w.spawn = { x: 8, y: 9 };
    },
    park(w) {
      w.mat = { lawn: { top: "#a3c9a8", left: "#8fb894", right: "#7aa480" } };
      slab(w, 1, 1, 14, 11, 0, "lawn");
      plateau(w, 3, 3, 5, 5, 1, []);
      water(w, 9, 7, 12, 9);
      slab(w, 9, 8, 12, 8, 0, "bridge");
      put(w, "tree", 7, 3, { v: 2 }); put(w, "tree", 13, 4, { v: 1 }); put(w, "tree", 3, 10); put(w, "tree", 14, 10, { v: 1 });
      put(w, "lamp", 6, 7); put(w, "lamp", 10, 5); put(w, "bench", 5, 9, { white: true });
      w.zones = [{ x: 4, y: 4 }, { x: 7, y: 6 }, { x: 11, y: 5 }]; w.spawn = { x: 7, y: 10 };
    },
  };

  /* ---------------- image worlds (pixel-faithful reference art) ----------------
     The three hero settings use the actual Monument-Valley-style reference
     illustrations as the scene. The same tap-to-walk / tap-to-talk mechanics
     run on a fine walkable grid mapped over the artwork; robed figures are
     drawn on top at a finger-friendly size. Coordinates below are normalized
     (0..1) against the 1536x1024 reference images. */
  const IMAGE_WORLDS = {
    school: {
      src: "worlds/school.png", w: 1600, h: 1071, bg: "#aec6b6",
      /* "11 SCHOOL DAY" reference as the scene (pixel parity). Multi-level logic
         grid derived from its pixels: ground courtyard+court (h0), upper covered
         walkway (h1), climbable external stair (gradient); buildings, columns,
         tree, hoop, bikes, bushes solid. Same method as the metro. */
      grid: ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,1,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,1,1,,,,,,,,1,,0.99,0.99,0.99,0.99,0.99,0.99,0.99,,,,,,,,,,,,,,,,,,,,,,,1,,,,,,,,1,,,0.86,0.86,1,0.86,0.86,0.86,0.86,,,,,,,,,,,,,,,,,,,,,,,1,,,,1,1,1,,,,,,1,0.73,1,0.73,0.73,0.73,,,,,,,,,,,,,,,,,,,,,,,1,,1,,,,,,,,,,0.6,1,0.6,1,0.6,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,0.48,0.48,0.48,0.48,0.48,0.48,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,0.35,0.35,0.35,0.35,0.35,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,0.22,0.22,0.22,0.22,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,0.09,0.09,0.09,0.09,,0.09,0.09,,,,,,,,,,,,,,,,,,,,,0,,0,,,,,,,,0,0,0,0,0,0,0,0,0,0,,,0,,,,,,,,,,,,,,,,,,0,,,,,,,,,,0,0,0,0,0,0,0,0,0,0,,,0,,,,,,,,,,,,,,,,0,0,,,,,,,,,,,,,,0,0,0,0,0,0,0,,,0,,,,,,,,,,,,,,,,,,,,0,,,,,,,,,,,0,0,0,0,0,0,0,,,0,,,,,,,,,,,,,,,,,,,0,0,,,,,,,,0,0,0,0,0,0,0,0,0,0,,,0,0,0,0,0,,,,,,,,,,,,0,0,0,0,0,,,,,,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,,0,0,0,,,,,,,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,,0,0,0,0,0,0,,,,,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,0,,,,,,,,,,,,,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,,,,,,0,,,0,,,,,,,,,,,,,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,,,,,,0,0,0,0,,,,,,,,,,,,,,,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,,,,,,,,0,0,,,,,,,,,,,,,,,,,,,,0,0,0,0,0,0,0,0,0,0,0,,,,,,,,,,",
      occluders: [
        [[0.29, 0.44], [0.47, 0.63]],   // tree canopy hides figures behind it
      ],
      spawn: [0.50, 0.90], zones: [[0.40, 0.86], [0.62, 0.88], [0.63, 0.37]],
      view: { zoom: 1.5, cx: 0.50, cy: 0.62 },
    },
    metro: {
      src: "worlds/commute.png", w: 1370, h: 906, bg: "#b5a0d0",
      /* walkable grid DERIVED offline from the reference pixels (cream paint =
         floor; train/pillars/walls/glass/void = solid; painted switchback stair
         carries a height gradient). Art is the reference itself → pixel parity. */
      grid: ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,2,2,2,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,2,2,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,2,2,,2,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,2,2,2,2,2,2,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,2,2,2,2,2,2,2,2,2,2,2,2,2,,,,,,,,,,,,,,,,,,,,,,,,,2,2,2,2,2,2,2,2,2,2,2,2,2,,,,,,,,,,,,,,,,,,,,,,,,,,2,2,2,2,2,2,2,2,2,2,2,2,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,1,1,1,1,1,1,1,1,,,1,,,,,,,1,1,,,,,,,,,,,,,,,,,,,,,,,,,1,1,,,,,,1,,,,,,1,1,1,1,,,,,,,,,,1,,,,,,,,,,,,,,,,,,,,,1,1,1,1,,1,,1,1,1,0.98,0.98,0.94,0.89,0.85,,,,,1,,,,,,,,,,,,,,,,,1,1,,,1,1,1,1,,1,,1,1,1,1,0.92,0.87,0.83,0.79,0.74,,,,1,,,,,,,,,,,,,,,,,1,1,1,1,1,,1,1,1,1,1,1,1,,,,,0.77,0.72,0.68,0.63,,,1,,,,,,,,,,,,,,,,,1,1,1,1,,,,1,1,1,,,,,,,,,0.66,0.61,0.57,0.52,,1,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,0.55,0.5,0.5,0.5,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,0.5,0.5,0.5,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,0.33,0.37,0.41,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,0.24,0.28,0.32,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,0.08,0.11,0.15,0.19,0.23,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,0,0,0.02,0.06,0.1,0.13,,,,,0.32,0,0,,,,,,,,,,,,,,,,,,,,,,,,,,,,0,0,0,0,0.04,0.08,,0.16,0.19,0.23,0.27,0,,,,,,,,,,,,,,,,,,,,,,,,,,,,,0,0,0,0,0,0.03,0.06,0.1,0.14,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,0,0,0,0,0,0,,,,,,,,,,,,,,,,,,,,,,,,,,,,,0,0,0,0,0,0,0,0,0,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
      blocked: [
        [[0.375, 0.0], [0.585, 0.275]],    // entrance structure roof
        [[0.545, 0.19], [0.90, 0.42]],     // right wall cream cap
        [[0.185, 0.65], [0.52, 0.93]],     // train + trench
        [[0.345, 0.595], [0.405, 0.92]],   // pillar A
        [[0.525, 0.575], [0.575, 0.80]],   // pillar B
        [[0.39, 0.44], [0.42, 0.52]],      // turnstile 1
        [[0.44, 0.45], [0.475, 0.53]],     // turnstile 2
        [[0.28, 0.96], [0.86, 1.0]],       // base front edge
      ],
      occluders: [
        [[0.345, 0.595], [0.405, 0.92]],   // pillar A hides figures behind it
        [[0.525, 0.575], [0.575, 0.80]],   // pillar B
        [[0.185, 0.65], [0.52, 0.90]],     // train hides figures behind it
      ],
      spawn: [0.55, 0.86], zones: [[0.47, 0.88], [0.42, 0.50], [0.68, 0.86]],
      view: { zoom: 1.6, cx: 0.52, cy: 0.62 },
    },
    office: {
      src: "worlds/office.png", w: 1536, h: 1024, bg: "#fdeadd",
      /* "Spacious minimalist office" reference as the scene (pixel parity).
         Walkable grid DERIVED offline from its pixels (cream/pink/mauve/sage
         floor paint = walkable; desks, monitors, chairs, partitions, planters,
         glass meeting room, coffee counter, lounge = solid). Same method as
         the metro. Single level; occluders give real depth behind objects. */
      grid: ",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,0,,,,,,,,,,,,0,,,,,,,,,,,,,,,,,,,,,,,,,,,,0,,,,,,,,,,,0,0,,,,,,,,,,,,,,,,,,,,,,,,0,0,0,0,0,,,0,0,0,0,0,0,0,0,0,0,0,0,,,,,,,,,,,,,,,,,,,,0,0,0,0,0,0,0,,,0,0,0,0,0,0,0,0,0,0,,,,,,0,0,0,,,,,,,,,,,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,,,,,0,0,0,0,0,,,,,,,,,0,0,0,,,,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,,,,,0,0,0,0,0,0,,,,,,,,0,0,0,,,,,,,,,,,,,0,0,0,0,0,0,0,,,,,,0,0,0,0,0,0,0,,,,,,,0,0,0,,,,,,,,,,,,,0,0,0,0,,,,,,,,,0,0,0,0,0,0,0,0,,,,0,0,0,0,0,,,,,,,,,,,,,0,0,0,0,,,,,,,,,0,0,0,0,0,0,0,0,0,,0,0,0,0,0,0,0,0,0,0,,,,,,,,,0,0,0,0,,,,,,,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,,,,,,,,0,0,0,0,,,,,,,,,0,0,0,0,,,0,0,0,0,0,0,0,0,0,0,0,0,,,,,,,,,,,,0,0,0,,,,,,,,,0,0,,,,,0,0,0,0,0,0,0,,,,0,0,,,0,0,0,0,0,0,,,,0,0,0,,,,,,,,,,,,,,,,0,0,0,0,0,0,,,,0,0,0,0,0,0,0,0,0,0,0,,,,,,0,0,0,0,0,0,0,,,,,,,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,,,,,0,0,0,0,0,0,0,0,,,,,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,,,,,0,0,0,0,0,0,0,0,,,,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,,,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,,0,0,0,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0",
      occluders: [
        [[0.142, 0.428], [0.268, 0.584]],   // left desk cluster
        [[0.622, 0.354], [0.742, 0.500]],   // right desk cluster
        [[0.422, 0.711], [0.555, 0.871]],   // bottom desk cluster
        [[0.257, 0.467], [0.441, 0.666]],   // coral partition
        [[0.561, 0.496], [0.754, 0.701]],   // green partition
        [[0.318, 0.256], [0.370, 0.383]],   // mid planter
        [[0.742, 0.672], [0.867, 0.828]],   // lounge armchairs
        [[0.854, 0.607], [0.906, 0.740]],   // lounge planter
      ],
      spawn: [0.28, 0.75], zones: [[0.50, 0.62], [0.72, 0.86], [0.18, 0.62]],
      view: { zoom: 1.6, cx: 0.50, cy: 0.55 },
    },
  };
  function pointInPoly(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function buildImageWorld(cfg, setting, time) {
    const W = 40, D = 28;
    const w = {
      imageMode: true, W, D, setting, time, pal: TIME[time] || TIME.day,
      h: new Array(W * D).fill(null), kind: new Array(W * D).fill(""), block: new Set(), water: new Set(),
      decor: [], mat: {}, zones: [], spawn: { x: 20, y: 20 },
      imgW: cfg.w, imgH: cfg.h, view: cfg.view, bg: cfg.bg, bgColor: cfg.bg,
      moveSpeed: 9, npcSpeed: 4, wanderSpan: 6, step: 2, figPx: 44,
    };
    const img = new Image();
    img.decoding = "async"; img.src = cfg.src;
    w.img = img; w.imgReady = false;
    const ready = () => {
      w.imgReady = true; w.imgW = img.naturalWidth || cfg.w; w.imgH = img.naturalHeight || cfg.h;
      try {
        const oc = document.createElement("canvas"); oc.width = 4; oc.height = 4;
        const octx = oc.getContext("2d"); octx.drawImage(img, 0, 0, 4, 4);
        const d = octx.getImageData(0, 0, 1, 1).data;
        w.bgColor = `rgb(${d[0]},${d[1]},${d[2]})`;
      } catch {}
    };
    if (img.complete && img.naturalWidth) ready(); else img.addEventListener("load", ready);
    w.debug = /[?&]mvdebug/.test(location.search);
    w.occluders = cfg.occluders || [];
    const setH = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < D) w.h[y * W + x] = v; };
    if (cfg.levels) {
      /* multi-level 3D logic grid: floors at distinct heights, stairs bridge them */
      w.maxStep = 0.34;
      for (const lv of cfg.levels)
        for (let y = 0; y < D; y++) for (let x = 0; x < W; x++)
          if (pointInPoly(lv.poly, (x + 0.5) / W, (y + 0.5) / D)) setH(x, y, lv.h);
      for (const st of cfg.stairs || []) {
        const [fx, fy] = st.from, [tx, ty] = st.to, steps = 72;
        const rw = st.width * W / 2, rh = st.width * D / 2;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps, px = (fx + (tx - fx) * t) * W, py = (fy + (ty - fy) * t) * D;
          const hv = st.h0 + (st.h1 - st.h0) * t;
          for (let y = Math.floor(py - rh); y <= Math.ceil(py + rh); y++)
            for (let x = Math.floor(px - rw); x <= Math.ceil(px + rw); x++) setH(x, y, hv);
        }
      }
      for (const b of cfg.blocked || [])
        for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
          const nx = (x + 0.5) / W, ny = (y + 0.5) / D;
          if (nx >= b[0][0] && nx <= b[1][0] && ny >= b[0][1] && ny <= b[1][1]) setH(x, y, null);
        }
    } else if (cfg.poly) {
      w.maxStep = 1;
      for (let y = 0; y < D; y++) for (let x = 0; x < W; x++)
        if (pointInPoly(cfg.poly, (x + 0.5) / W, (y + 0.5) / D)) setH(x, y, 0);
    }
    if (cfg.grid) {
      /* pixel-derived logic grid, embedded offline: solid collision + heights */
      const g = cfg.grid.split(",");
      for (let i = 0; i < W * D; i++) w.h[i] = g[i] === "" ? null : +g[i];
      w.maxStep = 0.34;
    }
    w.walk = (x, y) => (x >= 0 && y >= 0 && x < W && y < D) && w.h[y * W + x] != null && !w.block.has(x + "," + y);
    w.proj = (x, y) => ({ x: x / W * w.imgW, y: y / D * w.imgH });
    const snap = (nx, ny) => {
      let cx = Math.min(W - 1, Math.max(0, Math.floor(nx * W)));
      let cy = Math.min(D - 1, Math.max(0, Math.floor(ny * D)));
      if (w.walk(cx, cy)) return { x: cx, y: cy };
      let best = null, bd = 1e9;
      for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
        if (!w.walk(x, y)) continue;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bd) { bd = d; best = { x, y }; }
      }
      return best || { x: cx, y: cy };
    };
    w.spawn = snap(cfg.spawn[0], cfg.spawn[1]);
    w.zones = cfg.zones.map(([nx, ny]) => snap(nx, ny));
    w.bounds = { minX: 0, maxX: w.imgW, minY: 0, maxY: w.imgH };
    return w;
  }

  function buildWorld(spec) {
    const world = (spec && spec.world) || {};
    const setting = world.setting;
    const time = TIME[world.time] ? world.time : "day";
    /* metro renders the reference art itself (pixel parity) with a logic grid
       derived from its pixels — solid collision, climbable painted stairs */
    if (IMAGE_WORLDS[setting]) return buildImageWorld(IMAGE_WORLDS[setting], setting, time);
    const w = blank();
    w.setting = BUILDERS[setting] ? setting : "courtyard";
    w.time = time;
    w.pal = TIME[w.time];
    BUILDERS[w.setting](w);
    w.proj = iso;
    w.maxStep = 1;
    w.walk = (x, y) => { const h = at(w, x, y); return h != null && !w.block.has(x + "," + y) && !w.water.has(x + "," + y); };
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
      const h = w.h[y * W + x]; if (h == null && !w.water.has(x + "," + y)) continue;
      for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
        const p = iso(cx, cy, h == null ? -0.4 : h); const pb = iso(cx, cy, -2);
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y - 60); maxY = Math.max(maxY, pb.y);
      }
    }
    w.bounds = { minX, maxX, minY, maxY };
    return w;
  }

  /* ---------------- drawing primitives ---------------- */
  function diamond(ctx, x, y, z, fill) {
    const a = iso(x, y, z), b = iso(x + 1, y, z), c = iso(x + 1, y + 1, z), d = iso(x, y + 1, z);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  }
  function face(ctx, p1, p2, zTop, zBot, fill) {
    const a = { x: p1.x, y: p1.y - zTop * ZH }, b = { x: p2.x, y: p2.y - zTop * ZH };
    const c = { x: p2.x, y: p2.y - zBot * ZH }, d = { x: p1.x, y: p1.y - zBot * ZH };
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  }
  function box(ctx, x, y, w, d, z0, z1, pal) {
    const pB = iso(x + w, y, 0), pC = iso(x + w, y + d, 0), pD = iso(x, y + d, 0);
    face(ctx, pB, pC, z1, z0, pal.right);
    face(ctx, pD, pC, z1, z0, pal.left);
    const a = iso(x, y, z1), b = iso(x + w, y, z1), c = iso(x + w, y + d, z1), dd = iso(x, y + d, z1);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(dd.x, dd.y); ctx.closePath();
    ctx.fillStyle = pal.top; ctx.fill();
  }
  function faceWindows(ctx, p1, p2, zTop, zBot, cols, rows, color, lit, shutter) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const u0 = (c + 0.28) / cols, u1 = (c + 0.72) / cols;
      const v0 = zTop - (r + 0.3) / rows * (zTop - zBot), v1 = zTop - (r + 0.78) / rows * (zTop - zBot);
      const q = (u, v) => ({ x: p1.x + (p2.x - p1.x) * u, y: p1.y + (p2.y - p1.y) * u - v * ZH });
      const a = q(u0, v0), b = q(u1, v0), cc = q(u1, v1), d = q(u0, v1);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(cc.x, cc.y); ctx.lineTo(d.x, d.y); ctx.closePath();
      ctx.fillStyle = lit && (r * cols + c) % 3 === 0 ? lit : color; ctx.fill();
      if (shutter) {
        ctx.fillStyle = "#7a9e7e";
        const sw = (b.x - a.x) * 0.28;
        ctx.fillRect(a.x - sw, a.y, sw, d.y - a.y); ctx.fillRect(b.x, b.y, sw, cc.y - b.y);
      }
    }
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* ---------------- decor painters ---------------- */
  function paintDecor(ctx, w, d, t) {
    const h = at(w, d.x, d.y) || 0;
    const c = iso(d.x + 0.5, d.y + 0.5, h);
    const pal = w.pal, night = w.time === "night";
    const A = ACCENTS[hash(d.type + d.x + "," + d.y) % ACCENTS.length];
    ctx.save(); ctx.translate(c.x, c.y);
    switch (d.type) {
      case "tree": {
        ctx.fillStyle = "#8a6f5a"; ctx.fillRect(-2.5, -16, 5, 16);
        const g = d.v === 1 ? "#9fc48f" : d.v === 2 ? "#7fb89a" : "#8fb894";
        if (d.v === 2) { /* scalloped cloud canopy (courtyard ref) */
          ctx.fillStyle = g;
          for (const [ox, oy, r] of [[0, -30, 15], [-11, -24, 10], [11, -24, 10], [-6, -38, 9], [7, -37, 9]]) { ctx.beginPath(); ctx.arc(ox, oy, r, 0, 7); ctx.fill(); }
          ctx.fillStyle = shade(g, 1.1); ctx.beginPath(); ctx.arc(-4, -34, 8, 0, 7); ctx.fill();
        } else {
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -28, 14, 0, 7); ctx.fill();
          ctx.fillStyle = shade(g, 0.88); ctx.beginPath(); ctx.arc(6, -20, 10, 0, 7); ctx.fill();
          ctx.fillStyle = shade(g, 1.08); ctx.beginPath(); ctx.arc(-6, -34, 9, 0, 7); ctx.fill();
        }
        break;
      }
      case "lamp": case "lantern": {
        const ht = d.type === "lamp" ? 36 : 24;
        ctx.strokeStyle = "#6a5a70"; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -ht); ctx.stroke();
        if (night || w.time === "dusk") { const g = ctx.createRadialGradient(0, -ht, 2, 0, -ht, 28); g.addColorStop(0, "rgba(255,224,150,.55)"); g.addColorStop(1, "rgba(255,224,150,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -ht, 28, 0, 7); ctx.fill(); }
        ctx.fillStyle = "#f2d49b"; ctx.beginPath(); ctx.arc(0, -ht, d.type === "lamp" ? 5.5 : 5, 0, 7); ctx.fill();
        break;
      }
      case "bench": {
        const bp = d.white ? { top: "#fdf6e3", left: "#e8e0cc", right: "#cfc6ae" } : { top: "#d9b88f", left: "#c09a72", right: "#a8845e" };
        box(ctx, d.x - 0.34, d.y - 0.18, 0.68, 0.36, h, h + 0.34, bp);
        const b = iso(d.x + 0.5, d.y + 0.02, h + 0.64);
        ctx.fillStyle = bp.left; ctx.fillRect(b.x - 15, b.y - 4, 30, 5);
        break;
      }
      case "planter": {
        box(ctx, d.x - 0.3, d.y - 0.3, 0.6, 0.6, h, h + 0.36, { top: "#e8b498", left: "#dca085", right: "#c08868" });
        ctx.fillStyle = "#7fb89a"; ctx.beginPath(); ctx.arc(0, -15, 10, 0, 7); ctx.fill();
        ctx.fillStyle = "#9fc48f"; ctx.beginPath(); ctx.arc(-6, -19, 6, 0, 7); ctx.arc(6, -18, 5, 0, 7); ctx.fill();
        break;
      }
      case "columns": { /* pilotis row under the block */
        for (let x = d.x; x <= (d.x1 || d.x); x += 2) {
          const p = iso(x + 0.5, d.y + 0.5, h);
          ctx.fillStyle = "#e8e0cc"; ctx.fillRect(p.x - 3, p.y - 26, 6, 26);
          ctx.fillStyle = "#cfc6ae"; ctx.fillRect(p.x + 1, p.y - 26, 2, 26);
        }
        break;
      }
      case "stairtower": { /* coral zig-zag external stair */
        const cp = w.mat.coral || { top: "#f0a08c", left: "#e88d76", right: "#c8705c" };
        for (let i = 0; i < 5; i++) {
          const sx = d.x + (i % 2 ? 0.9 : 0.1), sy = d.y + 0.4;
          box(ctx, sx - 0.3, sy - 0.3, 0.7, 0.6, h + i * 0.5, h + i * 0.5 + 0.5, cp);
        }
        ctx.strokeStyle = shade(cp.right, 0.8); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-14, -8); ctx.lineTo(10, -34); ctx.stroke();
        break;
      }
      case "balcony": { /* potted plants on the ledge */
        for (let x = d.x; x <= (d.x1 || d.x); x += 2) {
          const p = iso(x + 0.5, d.y + 1, h + 1.1);
          ctx.fillStyle = "#7fb89a"; ctx.beginPath(); ctx.arc(p.x, p.y - 4, 5, 0, 7); ctx.fill();
          ctx.fillStyle = "#e8b498"; ctx.fillRect(p.x - 4, p.y - 1, 8, 4);
        }
        break;
      }
      case "cafe": { /* striped awning + tables */
        const aw = d.awning || A;
        box(ctx, d.x - 0.4, d.y - 0.3, 0.8, 0.6, h, h + 0.5, { top: "#fdf6e3", left: "#e8e0cc", right: "#cfc6ae" });
        ctx.fillStyle = aw; ctx.beginPath(); ctx.moveTo(-24, -30); ctx.lineTo(24, -30); ctx.lineTo(17, -42); ctx.lineTo(-17, -42); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.85)"; for (let i = -16; i < 16; i += 8) ctx.fillRect(i, -41, 4, 11);
        ctx.strokeStyle = "#8a6f5a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-20, -30); ctx.lineTo(-20, -10); ctx.moveTo(20, -30); ctx.lineTo(20, -10); ctx.stroke();
        break;
      }
      case "turnstile": { /* grey gate + red flap */
        box(ctx, d.x - 0.3, d.y - 0.2, 0.6, 0.4, h, h + 0.7, { top: "#d8d8e0", left: "#b8b8c4", right: "#9898a8" });
        ctx.fillStyle = "#e88d76"; ctx.fillRect(-2, -22, 16, 4);
        break;
      }
      case "hangsign": { /* dark teal sign, white train icon */
        ctx.strokeStyle = "#6a5a70"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-10, -40); ctx.lineTo(-10, -30); ctx.moveTo(10, -40); ctx.lineTo(10, -30); ctx.stroke();
        ctx.fillStyle = "#3a5a5a"; roundRect(ctx, -16, -30, 32, 16, 3); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.fillRect(-9, -26, 12, 7); ctx.fillRect(5, -24, 5, 3);
        ctx.beginPath(); ctx.arc(-5, -17, 1.6, 0, 7); ctx.arc(0, -17, 1.6, 0, 7); ctx.fill();
        break;
      }
      case "train": { /* silver metro train, red doors, on the rails */
        const z = -0.5;
        for (let x = d.x; x <= (d.x1 || d.x); x++) {
          const pB = iso(x + 1, d.y + 0.2, 0), pC = iso(x + 1, d.y + 0.9, 0), pD = iso(x, d.y + 0.9, 0);
          face(ctx, pB, pC, z + 1.3, z, "#c8c8d4");
          face(ctx, pD, pC, z + 1.3, z, "#d8d8e0");
          const a = iso(x, d.y + 0.2, z + 1.3), b = iso(x + 1, d.y + 0.2, z + 1.3), cc = iso(x + 1, d.y + 0.9, z + 1.3), dd = iso(x, d.y + 0.9, z + 1.3);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(cc.x, cc.y); ctx.lineTo(dd.x, dd.y); ctx.closePath(); ctx.fillStyle = "#e8e8f0"; ctx.fill();
          /* windows + red door on the platform-facing side */
          const q = (u, v) => ({ x: pD.x + (pC.x - pD.x) * u, y: pD.y + (pC.y - pD.y) * u - v * ZH });
          if (x % 3 === 1) { const w1 = q(0.3, z + 1.05), w2 = q(0.7, z + 1.05), w3 = q(0.7, z + 0.25), w4 = q(0.3, z + 0.25); ctx.beginPath(); ctx.moveTo(w1.x, w1.y); ctx.lineTo(w2.x, w2.y); ctx.lineTo(w3.x, w3.y); ctx.lineTo(w4.x, w4.y); ctx.closePath(); ctx.fillStyle = "#e88d76"; ctx.fill(); }
          else { const w1 = q(0.25, z + 1.0), w2 = q(0.75, z + 1.0), w3 = q(0.75, z + 0.6), w4 = q(0.25, z + 0.6); ctx.beginPath(); ctx.moveTo(w1.x, w1.y); ctx.lineTo(w2.x, w2.y); ctx.lineTo(w3.x, w3.y); ctx.lineTo(w4.x, w4.y); ctx.closePath(); ctx.fillStyle = "#5a4a78"; ctx.fill(); }
        }
        break;
      }
      case "glassrail": { /* translucent cyan railing */
        for (let x = d.x; x <= (d.x1 || d.x); x++) {
          const p1 = iso(x, d.y + 0.9, h + 0.9), p2 = iso(x + 1, d.y + 0.9, h + 0.9), p3 = iso(x + 1, d.y + 0.9, h + 0.1), p4 = iso(x, d.y + 0.9, h + 0.1);
          ctx.fillStyle = "rgba(168,216,216,.5)"; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = "rgba(120,170,170,.8)"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        }
        break;
      }
      case "busstop": { /* red roof shelter */
        ctx.strokeStyle = "#6a5a70"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-12, -28); ctx.moveTo(12, 0); ctx.lineTo(12, -28); ctx.stroke();
        ctx.fillStyle = "rgba(168,216,216,.4)"; ctx.fillRect(-12, -26, 24, 20);
        ctx.fillStyle = "#e88d76"; ctx.beginPath(); ctx.moveTo(-16, -28); ctx.lineTo(16, -28); ctx.lineTo(12, -34); ctx.lineTo(-12, -34); ctx.closePath(); ctx.fill();
        break;
      }
      case "roofstair": { /* straight stair with solid stringers */
        const cp = w.mat.coral || w.mat.parapet || { top: "#d8b0a4", left: "#c09888", right: "#a88070" };
        const n = d.wide ? 4 : 3;
        for (let i = 0; i < n; i++) box(ctx, d.x + 0.1, d.y + 0.1 + i * 0.22, 0.8, 0.24, h + i * 0.34, h + i * 0.34 + 0.34, cp);
        break;
      }
      case "utility": { /* rooftop utility room */
        box(ctx, d.x - 0.4, d.y - 0.35, 0.8, 0.7, h, h + 1.0, { top: "#9d98c4", left: "#7a75a8", right: "#5d5680" });
        const p = iso(d.x + 0.4, d.y + 0.35, h);
        ctx.fillStyle = "#4a4a6a"; ctx.fillRect(p.x - 5, p.y - 18, 10, 18);
        ctx.fillStyle = "#f4b958"; ctx.fillRect(p.x + 7, p.y - 20, 7, 7);
        break;
      }
      case "laundry": { /* line with hanging rectangles */
        const a = iso(d.x + 0.5, d.y + 0.5, h + 1.5), b = iso(d.x2 + 0.5, d.y2 + 0.5, h + 1.5);
        ctx.strokeStyle = "#6a5a70"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = "#8a6f5a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, a.y + 30); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x, b.y + 30); ctx.stroke();
        const cols = ["#fdf6e3", "#b8a8e0", "#8fb8e8"];
        for (let i = 0; i < 3; i++) { const u = (i + 1) / 4, x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u; ctx.fillStyle = cols[i]; ctx.fillRect(x - 6, y, 12, 16); }
        break;
      }
      case "sitter": { /* person sitting on the roof edge, legs dangling */
        const p = iso(d.x + 0.5, d.y + 0.5, h);
        ctx.fillStyle = "#f2c8a0"; ctx.beginPath(); ctx.arc(p.x, p.y - 16, 5, 0, 7); ctx.fill();
        ctx.fillStyle = "#8fb8e8"; ctx.fillRect(p.x - 5, p.y - 12, 10, 10);
        ctx.strokeStyle = "#5d5680"; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(p.x - 2, p.y - 2); ctx.lineTo(p.x - 2, p.y + 8); ctx.moveTo(p.x + 2, p.y - 2); ctx.lineTo(p.x + 2, p.y + 8); ctx.stroke();
        break;
      }
      case "car": { /* rounded white hatchback */
        box(ctx, d.x - 0.4, d.y - 0.25, 0.8, 0.5, h + 0.1, h + 0.45, { top: "#fdf6e3", left: "#e8e0cc", right: "#cfc6ae" });
        box(ctx, d.x - 0.2, d.y - 0.2, 0.45, 0.4, h + 0.45, h + 0.7, { top: "#fdf6e3", left: "#a8d8e8", right: "#8fb8c8" });
        ctx.fillStyle = "#3a3350"; ctx.beginPath(); ctx.arc(-12, -2, 3.4, 0, 7); ctx.arc(12, -2, 3.4, 0, 7); ctx.fill();
        break;
      }
      case "pillar": {
        box(ctx, d.x - 0.16, d.y - 0.16, 0.32, 0.32, h, h + 2.6, { top: shade(pal.top, 1.02), left: pal.left, right: pal.right });
        box(ctx, d.x - 0.26, d.y - 0.26, 0.52, 0.52, h + 2.6, h + 2.78, { top: shade(pal.top, 1.05), left: pal.left, right: pal.right });
        break;
      }
      case "vending": {
        box(ctx, d.x - 0.34, d.y - 0.26, 0.68, 0.52, h, h + 1.15, { top: "#e8a0a8", left: "#d08890", right: "#b87080" });
        const f = iso(d.x + 0.68, d.y + 0.26, h + 0.9);
        ctx.fillStyle = "#f6ecd9"; ctx.fillRect(f.x - 12, f.y - 2, 10, 16);
        ctx.fillStyle = "#8fd4d9"; ctx.fillRect(f.x - 10, f.y, 6, 4); ctx.fillRect(f.x - 10, f.y + 6, 6, 4);
        break;
      }
      case "sign": {
        ctx.strokeStyle = "#6a5a70"; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -30); ctx.stroke();
        ctx.fillStyle = "#8fb8e8"; roundRect(ctx, -16, -44, 32, 16, 4); ctx.fill();
        ctx.fillStyle = "#f6ecd9"; ctx.fillRect(-11, -39, 22, 2.4); ctx.fillRect(-11, -34, 14, 2.4);
        break;
      }
      case "tank": { /* water tank on four legs */
        ctx.strokeStyle = shade(pal.right, 0.8); ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(-10, 0); ctx.moveTo(10, -10); ctx.lineTo(10, 0); ctx.moveTo(-4, -8); ctx.lineTo(-4, 0); ctx.moveTo(4, -8); ctx.lineTo(4, 0); ctx.stroke();
        ctx.fillStyle = shade(pal.right, 0.95); ctx.fillRect(-13, -36, 26, 26);
        ctx.fillStyle = pal.left; ctx.beginPath(); ctx.ellipse(0, -36, 13, 6, 0, 0, 7); ctx.fill();
        ctx.fillStyle = shade(pal.top, 1.02); ctx.beginPath(); ctx.ellipse(0, -38, 13, 6, 0, 0, 7); ctx.fill();
        break;
      }
      case "ac": {
        box(ctx, d.x - 0.3, d.y - 0.26, 0.6, 0.52, h, h + 0.5, { top: "#d8d8e0", left: "#b8b8c4", right: "#9898a8" });
        ctx.strokeStyle = "#78788a"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, -16, 6, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-4, -16); ctx.lineTo(4, -16); ctx.moveTo(0, -20); ctx.lineTo(0, -12); ctx.stroke();
        break;
      }
      case "stall": {
        box(ctx, d.x - 0.36, d.y - 0.3, 0.72, 0.6, h, h + 0.55, { top: "#e8d8c0", left: "#d0bc9e", right: "#b8a488" });
        const aw = d.awning || A;
        ctx.fillStyle = aw; ctx.beginPath(); ctx.moveTo(-22, -30); ctx.lineTo(22, -30); ctx.lineTo(16, -40); ctx.lineTo(-16, -40); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.5)"; for (let i = -16; i < 16; i += 8) ctx.fillRect(i, -39, 4, 9);
        ctx.strokeStyle = "#8a6f5a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-18, -30); ctx.lineTo(-18, -12); ctx.moveTo(18, -30); ctx.lineTo(18, -12); ctx.stroke();
        break;
      }
      case "sofa": {
        box(ctx, d.x - 0.42, d.y - 0.28, 0.84, 0.56, h, h + 0.34, { top: "#b8a8e0", left: "#a090cc", right: "#8878b4" });
        box(ctx, d.x - 0.42, d.y - 0.28, 0.84, 0.16, h + 0.34, h + 0.72, { top: "#c4b6e8", left: "#a090cc", right: "#8878b4" });
        break;
      }
      case "table": {
        box(ctx, d.x - 0.34, d.y - 0.3, 0.68, 0.6, h + 0.28, h + 0.36, { top: "#e8d8c0", left: "#d0bc9e", right: "#b8a488" });
        ctx.strokeStyle = "#a8845e"; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-12, -8); ctx.lineTo(-12, 0); ctx.moveTo(12, -8); ctx.lineTo(12, 0); ctx.stroke();
        break;
      }
      case "shelf": {
        box(ctx, d.x - 0.3, d.y - 0.24, 0.6, 0.48, h, h + 1.0, { top: "#d9b88f", left: "#c09a72", right: "#a8845e" });
        ctx.fillStyle = "#f2a08c"; ctx.fillRect(-8, -26, 5, 8); ctx.fillStyle = "#7fd4c1"; ctx.fillRect(-1, -26, 5, 8); ctx.fillStyle = "#f2d49b"; ctx.fillRect(6, -26, 5, 8);
        break;
      }
      case "flag": {
        ctx.strokeStyle = "#6a5a70"; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -46); ctx.stroke();
        const wv = Math.sin(t / 400) * 3;
        ctx.fillStyle = "#e88d76"; ctx.beginPath(); ctx.moveTo(0, -46); ctx.lineTo(20, -42 + wv); ctx.lineTo(0, -36); ctx.closePath(); ctx.fill();
        break;
      }
      case "hoop": {
        ctx.strokeStyle = "#6a5a70"; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -40); ctx.stroke();
        ctx.fillStyle = "#f6ecd9"; ctx.fillRect(-10, -52, 20, 14);
        ctx.strokeStyle = "#f2a08c"; ctx.lineWidth = 2; ctx.strokeRect(-5, -48, 10, 8);
        ctx.beginPath(); ctx.ellipse(0, -37, 7, 2.6, 0, 0, 7); ctx.stroke();
        break;
      }
      case "door": {
        const p = iso(d.x + 0.5, d.y + 1, h);
        ctx.fillStyle = shade(pal.right, 0.72); ctx.beginPath();
        ctx.moveTo(p.x - 9, p.y); ctx.lineTo(p.x - 9, p.y - 26); ctx.arc(p.x, p.y - 26, 9, Math.PI, 0); ctx.lineTo(p.x + 9, p.y); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#f2d49b"; ctx.beginPath(); ctx.arc(p.x + 4, p.y - 13, 1.6, 0, 7); ctx.fill();
        break;
      }
      case "arch": {
        const p = iso(d.x + 0.5, d.y + 1, h);
        ctx.fillStyle = shade(pal.right, 0.6); ctx.beginPath();
        ctx.moveTo(p.x - 20, p.y); ctx.lineTo(p.x - 20, p.y - 30); ctx.arc(p.x, p.y - 30, 20, Math.PI, 0); ctx.lineTo(p.x + 20, p.y); ctx.closePath(); ctx.fill();
        ctx.fillStyle = shade(pal.right, 0.42); ctx.beginPath();
        ctx.moveTo(p.x - 14, p.y); ctx.lineTo(p.x - 14, p.y - 28); ctx.arc(p.x, p.y - 28, 14, Math.PI, 0); ctx.lineTo(p.x + 14, p.y); ctx.closePath(); ctx.fill();
        break;
      }
      case "line": {
        for (let x = d.x; x <= (d.x1 || d.x); x++) { const p = iso(x + 0.5, d.y + 0.86, h); ctx.fillStyle = "#f2d49b"; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(TH, TW)); ctx.fillRect(-TW / 2, -2, TW, 4); ctx.restore(); }
        break;
      }
      case "cross": {
        for (let x = d.x; x <= (d.x1 || d.x); x++) for (let i = 0; i < 3; i++) { const p = iso(x + 0.2 + i * 0.28, d.y + 0.5, h); ctx.fillStyle = "rgba(253,246,227,.85)"; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(TH, TW)); ctx.fillRect(-3, -12, 6, 24); ctx.restore(); }
        break;
      }
      case "rug": {
        for (let y = d.y; y <= (d.y1 || d.y); y++) for (let x = d.x; x <= (d.x1 || d.x); x++) diamond(ctx, x, y, (at(w, x, y) || 0) + 0.01, d.color || "#e8c8d8");
        break;
      }
      case "awning": {
        for (let x = d.x; x <= (d.x1 || d.x); x++) {
          const p1 = iso(x, d.y + 1, 1.5), p2 = iso(x + 1, d.y + 1, 1.5), p3 = iso(x + 1, d.y + 1.45, 1.15), p4 = iso(x, d.y + 1.45, 1.15);
          ctx.fillStyle = x % 2 ? shade(d.color || A, 0.92) : (d.color || A);
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath(); ctx.fill();
        }
        break;
      }
      case "lights": {
        const a = iso(d.x + 0.5, d.y + 0.5, (at(w, d.x, d.y) || 0) + 1.3), b = iso(d.x2 + 0.5, d.y2 + 0.5, (at(w, d.x2, d.y2) || 0) + 1.3);
        ctx.strokeStyle = "rgba(106,90,112,.7)"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2, Math.max(a.y, b.y) + 16, b.x, b.y); ctx.stroke();
        for (let i = 1; i < 7; i++) {
          const u = i / 7, x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u + Math.sin(Math.PI * u) * 16;
          if (night || w.time === "dusk") { const g = ctx.createRadialGradient(x, y, 1, x, y, 9); g.addColorStop(0, "rgba(255,224,150,.6)"); g.addColorStop(1, "rgba(255,224,150,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill(); }
          ctx.fillStyle = "#f2d49b"; ctx.beginPath(); ctx.arc(x, y + 2, 2.2, 0, 7); ctx.fill();
        }
        break;
      }
    }
    ctx.restore();
  }

  /* ---------------- figures ---------------- */
  function drawFigure(ctx, sx, sy, s, o) {
    const robe = o.robe || "#f6f2ea", accent = o.accent || "#f2a08c", skin = o.skin || "#f6e7d7";
    const walk = o.walk || 0, moving = o.moving, bob = moving ? Math.abs(Math.sin(walk * Math.PI)) * 2.2 * s : Math.sin((o.t || 0) / 900) * 0.8 * s;
    const face = o.face || 1, expr = o.expr || "neutral";
    ctx.save(); ctx.translate(sx, sy - bob);
    ctx.strokeStyle = shade(robe, 0.62); ctx.lineWidth = 2.6 * s; ctx.lineCap = "round";
    const lp = moving ? Math.sin(walk * Math.PI * 2) * 3.4 * s : 0;
    ctx.beginPath(); ctx.moveTo(-3 * s, -6 * s); ctx.lineTo(-3 * s + lp, 0); ctx.moveTo(3 * s, -6 * s); ctx.lineTo(3 * s - lp, 0); ctx.stroke();
    ctx.fillStyle = robe; ctx.beginPath();
    ctx.moveTo(-5.5 * s, -22 * s); ctx.quadraticCurveTo(-8.5 * s, -10 * s, -8 * s, -5 * s);
    ctx.quadraticCurveTo(0, -2.6 * s, 8 * s, -5 * s); ctx.quadraticCurveTo(8.5 * s, -10 * s, 5.5 * s, -22 * s);
    ctx.quadraticCurveTo(0, -25 * s, -5.5 * s, -22 * s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = accent; ctx.fillRect(-7.4 * s, -8.4 * s, 14.8 * s, 2 * s);
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, -28.5 * s, 6 * s, 0, 7); ctx.fill();
    const hat = o.hat || "short";
    if (hat === "point") { ctx.fillStyle = robe; ctx.beginPath(); ctx.moveTo(-6.4 * s, -30 * s); ctx.lineTo(0, -44 * s); ctx.lineTo(6.4 * s, -30 * s); ctx.closePath(); ctx.fill(); }
    else if (hat === "cap") { ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(0, -30 * s, 6.2 * s, Math.PI, 0); ctx.fill(); ctx.fillRect(face > 0 ? 0 : -9 * s, -30.6 * s, 9 * s, 1.8 * s); }
    else if (hat === "bun") { ctx.fillStyle = shade(accent, 0.55); ctx.beginPath(); ctx.arc(0, -30.5 * s, 6.2 * s, Math.PI, 0); ctx.fill(); ctx.beginPath(); ctx.arc(-face * 4 * s, -35 * s, 2.6 * s, 0, 7); ctx.fill(); }
    else if (hat === "beanie") { ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(0, -30 * s, 6.4 * s, Math.PI, 0); ctx.fill(); ctx.fillStyle = shade(accent, 0.85); ctx.fillRect(-6.4 * s, -31 * s, 12.8 * s, 2 * s); }
    else { ctx.fillStyle = shade(accent, 0.5); ctx.beginPath(); ctx.arc(0, -30.6 * s, 6.1 * s, Math.PI * 0.95, Math.PI * 0.05); ctx.fill(); }
    if (o.back) { ctx.restore(); return; }   /* viewed from behind — no face */
    const ex = face * 1.8 * s;
    ctx.fillStyle = "#2b2330"; ctx.strokeStyle = "#2b2330";
    if (expr === "happy") { ctx.lineWidth = 1.3 * s; ctx.beginPath(); ctx.arc(ex - 2.2 * s, -28.4 * s, 1.5 * s, Math.PI, 0); ctx.arc(ex + 2.2 * s, -28.4 * s, 1.5 * s, Math.PI, 0); ctx.stroke(); }
    else if (expr === "surprised") { ctx.beginPath(); ctx.arc(ex - 2.2 * s, -28.6 * s, 1.5 * s, 0, 7); ctx.arc(ex + 2.2 * s, -28.6 * s, 1.5 * s, 0, 7); ctx.fill(); }
    else if (expr === "thinking") { ctx.fillRect(ex - 3.4 * s, -28.8 * s, 2.6 * s, 1.2 * s); ctx.fillRect(ex + 0.9 * s, -28.8 * s, 2.6 * s, 1.2 * s); }
    else { ctx.beginPath(); ctx.arc(ex - 2.2 * s, -28.6 * s, 1.1 * s, 0, 7); ctx.arc(ex + 2.2 * s, -28.6 * s, 1.1 * s, 0, 7); ctx.fill(); }
    if (expr === "worried") { ctx.lineWidth = 1.1 * s; ctx.beginPath(); ctx.moveTo(ex - 3.6 * s, -31.4 * s); ctx.lineTo(ex - 1 * s, -30.6 * s); ctx.moveTo(ex + 3.6 * s, -31.4 * s); ctx.lineTo(ex + 1 * s, -30.6 * s); ctx.stroke(); }
    if (o.talking) { ctx.beginPath(); ctx.ellipse(ex, -25.4 * s, 1.4 * s, 1.8 * s, 0, 0, 7); ctx.fill(); }
    else if (expr === "happy") { ctx.lineWidth = 1.2 * s; ctx.beginPath(); ctx.arc(ex, -26 * s, 1.8 * s, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
    else { ctx.lineWidth = 1.1 * s; ctx.beginPath(); ctx.moveTo(ex - 1.4 * s, -25.6 * s); ctx.lineTo(ex + 1.4 * s, -25.6 * s); ctx.stroke(); }
    ctx.restore();
  }

  /* statue totems for the pillar niches */
  function drawStatue(ctx, variant, s, t) {
    const stone = { top: "#fdf6e3", left: "#e8e0cc", right: "#cfc6ae" };
    if (variant === 0) { drawFigure(ctx, 0, 0, s * 1.4, { robe: "#fdf6e3", accent: "#b8a8e0", hat: "point", face: 1, t }); return; }
    if (variant === 1) {
      ctx.fillStyle = stone.left; ctx.fillRect(-6 * s, -8 * s, 12 * s, 8 * s);
      ctx.fillStyle = "#5a5a72"; ctx.beginPath(); ctx.ellipse(0, -20 * s, 8 * s, 11 * s, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(4 * s, -30 * s, 5 * s, 0, 7); ctx.fill();
      ctx.fillStyle = "#f2d49b"; ctx.beginPath(); ctx.moveTo(8 * s, -31 * s); ctx.lineTo(15 * s, -29 * s); ctx.lineTo(8 * s, -27 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#f6ecd9"; ctx.beginPath(); ctx.arc(5.5 * s, -31 * s, 1.3 * s, 0, 7); ctx.fill();
      return;
    }
    if (variant === 2) {
      box(ctx, -0.4, -0.4, 0.8, 0.8, 0, 0.5, stone);
      ctx.fillStyle = "#b8a8e0"; ctx.beginPath(); ctx.arc(0, -0.5 * ZH - 9 * s, 8 * s, 0, 7); ctx.fill();
      ctx.fillStyle = "#8fb8e8"; ctx.beginPath(); ctx.moveTo(-6 * s, -0.5 * ZH - 16 * s); ctx.lineTo(0, -0.5 * ZH - 30 * s); ctx.lineTo(6 * s, -0.5 * ZH - 16 * s); ctx.closePath(); ctx.fill();
      return;
    }
    if (variant === 3) {
      ctx.fillStyle = stone.left; ctx.fillRect(-14 * s, -30 * s, 7 * s, 30 * s); ctx.fillRect(7 * s, -30 * s, 7 * s, 30 * s);
      ctx.fillStyle = stone.top; ctx.fillRect(-16 * s, -36 * s, 32 * s, 7 * s);
      ctx.fillStyle = "#f2c8a0"; ctx.beginPath(); ctx.arc(0, -20 * s, 4 * s, 0, 7); ctx.fill();
      return;
    }
    ctx.strokeStyle = "#7fb89a"; ctx.lineWidth = 2.4 * s; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(3 * s, -14 * s, 0, -26 * s); ctx.stroke();
    ctx.fillStyle = "#e8a0c0"; for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + t / 4000; ctx.beginPath(); ctx.ellipse(Math.cos(a) * 6 * s, -26 * s + Math.sin(a) * 6 * s, 4.5 * s, 4.5 * s, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = "#f2d49b"; ctx.beginPath(); ctx.arc(0, -26 * s, 3.4 * s, 0, 7); ctx.fill();
  }

  /* ---------------- sky ---------------- */
  function paintSky(ctx, cw, ch, pal, t, time) {
    const g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, pal.sky[0]); g.addColorStop(0.55, pal.sky[1]); g.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
    if (time === "night") {
      for (let i = 0; i < 40; i++) {
        const x = (hash("sx" + i) % 1000) / 1000 * cw, y = (hash("sy" + i) % 1000) / 1000 * ch * 0.6;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t / 1200 + i));
        ctx.fillStyle = `rgba(246,240,225,${0.25 + 0.5 * tw})`; ctx.fillRect(x, y, 1.6, 1.6);
      }
      ctx.fillStyle = "#f6ecd9"; ctx.beginPath(); ctx.arc(cw * 0.82, ch * 0.14, 16, 0, 7); ctx.fill();
      ctx.fillStyle = pal.sky[0]; ctx.beginPath(); ctx.arc(cw * 0.82 + 7, ch * 0.14 - 4, 14, 0, 7); ctx.fill();
    } else {
      ctx.fillStyle = time === "dusk" ? "rgba(255,236,210,.5)" : "rgba(255,255,255,.7)";
      for (let i = 0; i < 4; i++) {
        const sp = 14 + i * 6, x = ((t / 1000 * sp + i * 340) % (cw + 260)) - 130, y = ch * (0.08 + i * 0.08);
        ctx.beginPath(); ctx.ellipse(x, y, 54 + i * 10, 12 + i * 2, 0, 0, 7); ctx.ellipse(x + 34, y - 7, 30, 9, 0, 0, 7); ctx.fill();
      }
      if (time === "dusk") { ctx.fillStyle = "rgba(255,214,150,.7)"; ctx.beginPath(); ctx.arc(cw * 0.78, ch * 0.18, 20, 0, 7); ctx.fill(); }
    }
  }

  /* ---------------- image-world renderer (reference art + figures) ---------------- */
  function createImageRenderer(canvas, world) {
    const ctx = canvas.getContext("2d");
    let cw = 0, ch = 0, dpr = 1, scale = 1;
    let zoom = 1, zoomT = 1, focusT = null, cam = null, lastState = null;
    const FIGPX = world.figPx || 74;
    function resize() {
      const r = canvas.parentElement.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cw = Math.max(50, r.width); ch = Math.max(50, r.height);
      canvas.width = cw * dpr; canvas.height = ch * dpr;
      canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
      scale = (cw / world.imgW) * (world.view.zoom || 1.5);
    }
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);
    window.__mvimg = { world, tileAt, tileScreen, get cam() { return cam; }, get k() { return scale * zoom; }, get anchor() { return anchor(); }, get dpr() { return dpr; }, get size() { return { cw, ch }; }, get state() { return lastState; } };
    const anchor = () => ({ x: cw / 2, y: ch * 0.58 });
    function clampCam(c) {
      const k = scale * zoom, a = anchor();
      const minX = a.x / k, maxX = world.imgW - (cw - a.x) / k;
      const minY = a.y / k, maxY = world.imgH - (ch - a.y) / k;
      return {
        x: minX > maxX ? world.imgW / 2 : Math.min(Math.max(c.x, minX), maxX),
        y: minY > maxY ? world.imgH / 2 : Math.min(Math.max(c.y, minY), maxY),
      };
    }
    function setFocus(p) { focusT = p; zoomT = p ? 1.12 : 1; }
    function applyTransform() {
      const a = anchor(), k = scale * zoom;
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (a.x - cam.x * k), dpr * (a.y - cam.y * k));
    }
    function screenToWorld(px, py) {
      const a = anchor(), k = scale * zoom;
      return { x: (px - a.x) / k + cam.x, y: (py - a.y) / k + cam.y };
    }
    function tileAt(px, py) {
      const p = screenToWorld(px, py);
      const gx = Math.floor(p.x / world.imgW * world.W), gy = Math.floor(p.y / world.imgH * world.D);
      return world.walk(gx, gy) ? { x: gx, y: gy } : null;
    }
    function tileScreen(x, y) {
      const p = world.proj(x + 0.5, y + 0.5), a = anchor(), k = scale * zoom;
      return { x: (p.x - cam.x) * k + a.x, y: (p.y - cam.y) * k + a.y };
    }
    function draw(state, t) {
      lastState = state;
      zoom += (zoomT - zoom) * 0.08;
      const player = state.figures.find((f) => f.id === "player");
      const viewC = world.proj(world.view.cx * world.W, world.view.cy * world.D);
      let camT = focusT || (player ? world.proj(player.x + 0.5, player.y + 0.5) : viewC);
      if (!cam) cam = { x: camT.x, y: camT.y };
      cam.x += (camT.x - cam.x) * 0.08; cam.y += (camT.y - cam.y) * 0.08;
      cam = clampCam(cam);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = world.bgColor || world.bg; ctx.fillRect(0, 0, cw, ch);
      if (!world.imgReady) return;
      applyTransform();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(world.img, 0, 0);
      if (world.debug) {
        const cw2 = world.imgW / world.W, ch2 = world.imgH / world.D;
        for (let y = 0; y < world.D; y++) for (let x = 0; x < world.W; x++) {
          const h = world.h[y * world.W + x];
          if (h == null) continue;
          const col = h >= 1.6 ? "rgba(80,140,255,.4)" : h >= 0.6 ? "rgba(255,210,80,.4)" : "rgba(90,220,120,.4)";
          ctx.fillStyle = col; ctx.fillRect(x * cw2, y * ch2, cw2 - 1, ch2 - 1);
        }
      }
      const k = scale * zoom, s = FIGPX / (44 * k);
      /* painter's algorithm: figures AND solid occluders depth-sorted by image-y,
         so a character walking behind a pillar/train is hidden by it (real depth). */
      const items = state.figures.map((fig) => ({ d: fig.y, f: () => {
        const p = world.proj(fig.x + 0.5, fig.y + 0.5);
        ctx.fillStyle = "rgba(43,35,48,.18)"; ctx.beginPath(); ctx.ellipse(p.x, p.y + 1, 12 * s, 4.4 * s, 0, 0, 7); ctx.fill();
        drawFigure(ctx, p.x, p.y, s, fig);
        if (fig.marker) {
          const by = p.y - 46 * s + Math.sin(t / 380) * 3 * s;
          ctx.fillStyle = fig.markerColor || "#f2d49b";
          ctx.save(); ctx.translate(p.x, by); ctx.rotate(Math.PI / 4); ctx.fillRect(-5 * s, -5 * s, 10 * s, 10 * s); ctx.restore();
          ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.save(); ctx.translate(p.x, by); ctx.rotate(Math.PI / 4); ctx.fillRect(-2 * s, -2 * s, 4 * s, 4 * s); ctx.restore();
        }
      } }));
      for (const oc of world.occluders || []) items.push({ d: oc[1][1] * world.D, f: () => {
        const sx = oc[0][0] * world.imgW, sy = oc[0][1] * world.imgH;
        const sw = (oc[1][0] - oc[0][0]) * world.imgW, sh = (oc[1][1] - oc[0][1]) * world.imgH;
        ctx.drawImage(world.img, sx, sy, sw, sh, sx, sy, sw, sh);
      } });
      items.sort((a, b) => a.d - b.d);
      for (const it of items) it.f();
      if (state.ripple) {
        const r = state.ripple, age = (t - r.t0) / 600;
        if (age < 1) {
          const p = world.proj(r.x + 0.5, r.y + 0.5);
          ctx.strokeStyle = `rgba(255,255,255,${0.75 * (1 - age)})`; ctx.lineWidth = 2 / k;
          ctx.beginPath(); ctx.ellipse(p.x, p.y, (6 + age * 16) / k, (6 + age * 16) / (2 * k), 0, 0, 7); ctx.stroke();
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return { draw, resize, tileAt, tileScreen, setFocus, get zoom() { return scale * zoom; }, get figH() { return FIGPX; }, destroy() { ro.disconnect(); } };
  }

  /* ---------------- scene renderer (zoomed + camera follow) ---------------- */
  function createRenderer(canvas, world) {
    if (world.mode3d) return window.MV3D.createRenderer(canvas, world);
    if (world.imageMode) return createImageRenderer(canvas, world);
    const ctx = canvas.getContext("2d");
    let cw = 0, ch = 0, dpr = 1, scale = 1;
    let zoom = 1, zoomT = 1, focus = null, focusT = null;
    let cam = null, camT = null;
    const FIG = 1.28;                          /* bigger, finger-friendly people */
    function resize() {
      const r = canvas.parentElement.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cw = Math.max(50, r.width); ch = Math.max(50, r.height);
      canvas.width = cw * dpr; canvas.height = ch * dpr;
      canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
      const b = world.bounds, bw = b.maxX - b.minX, bh = b.maxY - b.minY;
      const fit = Math.min((cw - 24) / bw, (ch - 24) / bh);
      /* zoom in so a tile is ~56px wide (tappable); camera follows the player */
      scale = Math.min(Math.max(fit, 56 / TW), fit * 2.6);
    }
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);

    function setFocus(p) { focusT = p; zoomT = p ? 1.16 : 1; }
    function anchor() { return { x: cw / 2, y: ch * 0.56 }; }
    function applyTransform() {
      const a = anchor(), k = scale * zoom;
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (a.x - cam.x * k), dpr * (a.y - cam.y * k));
    }
    function screenToWorld(px, py) {
      const a = anchor(), k = scale * zoom;
      return { x: (px - a.x) / k + cam.x, y: (py - a.y) / k + cam.y };
    }
    function tileAt(px, py) {
      const p = screenToWorld(px, py);
      let best = null, bestDepth = -1e9;
      for (let y = 0; y < world.D; y++) for (let x = 0; x < world.W; x++) {
        const h = world.h[y * world.W + x]; if (h == null) continue;
        const c = iso(x + 0.5, y + 0.5, h);
        const dx = Math.abs(p.x - c.x) / (TW / 2), dy = Math.abs(p.y - c.y) / (TH / 2);
        if (dx + dy <= 1.15 && x + y > bestDepth) { best = { x, y }; bestDepth = x + y; }
      }
      return best;
    }
    function tileScreen(x, y) {
      const h = at(world, x, y) || 0;
      const p = iso(x + 0.5, y + 0.5, h);
      const a = anchor(), k = scale * zoom;
      return { x: (p.x - cam.x) * k + a.x, y: (p.y - cam.y) * k + a.y };
    }

    function draw(state, t) {
      zoom += (zoomT - zoom) * 0.08;
      const player = state.figures.find((f) => f.id === "player");
      camT = focusT || (player ? iso(player.x + 0.5, player.y + 0.5, player.z) : iso(world.spawn.x, world.spawn.y, 0));
      if (!cam) cam = { x: camT.x, y: camT.y };
      cam.x += (camT.x - cam.x) * 0.06; cam.y += (camT.y - cam.y) * 0.06;
      if (focusT) { focus = focusT; } else focus = null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintSky(ctx, cw, ch, world.pal, t, world.time);
      applyTransform();
      const pal = world.pal;
      const items = [];
      for (let y = 0; y < world.D; y++) for (let x = 0; x < world.W; x++) {
        const key = x + "," + y, h = world.h[y * world.W + x];
        const kind = world.kind[y * world.W + x];
        if (world.water.has(key)) { items.push({ d: x + y, f: () => {
          diamond(ctx, x, y, -0.35, pal.water);
          const c = iso(x + 0.5, y + 0.5, -0.35), sh = Math.sin(t / 700 + x * 1.7 + y * 2.3);
          ctx.fillStyle = `rgba(255,255,255,${0.14 + 0.12 * sh})`;
          ctx.beginPath(); ctx.ellipse(c.x + sh * 5, c.y, 12, 3.4, 0, 0, 7); ctx.fill();
        } }); continue; }
        if (h == null) {
          if (kind === "rail") items.push({ d: x + y, f: () => {
            diamond(ctx, x, y, -0.6, shade(pal.right, 0.55));
            const a = iso(x, y + 0.32, -0.6), b = iso(x + 1, y + 0.32, -0.6), c2 = iso(x, y + 0.68, -0.6), d2 = iso(x + 1, y + 0.68, -0.6);
            ctx.strokeStyle = shade(pal.top, 0.8); ctx.lineWidth = 1.8;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(c2.x, c2.y); ctx.lineTo(d2.x, d2.y); ctx.stroke();
          } });
          continue;
        }
        items.push({ d: x + y, f: () => {
          const mat = world.mat[kind] || pal;
          const hr = at(world, x + 1, y), hl = at(world, x, y + 1);
          const baseR = hr == null ? (world.water.has((x + 1) + "," + y) ? -0.4 : -2) : hr;
          const baseL = hl == null ? (world.water.has(x + "," + (y + 1)) ? -0.4 : -2) : hl;
          const pB = iso(x + 1, y, 0), pC = iso(x + 1, y + 1, 0), pD = iso(x, y + 1, 0);
          const isWall = kind === "wall";
          if (h > baseR) {
            face(ctx, pB, pC, h, baseR, mat.right);
            if (isWall) faceWindows(ctx, pB, pC, h, Math.max(baseR, h - 3), 1, 3, mat.win || shade(mat.right, 0.62), world.time === "night" ? (mat.lit || "#f2d49b") : mat.lit, mat.shutter);
          }
          if (h > baseL) {
            face(ctx, pD, pC, h, baseL, mat.left);
            if (isWall) faceWindows(ctx, pD, pC, h, Math.max(baseL, h - 3), 1, 3, mat.win || shade(mat.left, 0.66), world.time === "night" ? (mat.lit || "#f2d49b") : mat.lit, mat.shutter);
          }
          let top = mat.top;
          if (kind === "road") top = shade(pal.top, 0.72);
          else if (kind === "bridge") top = "#d9b88f";
          else if ((x + y) % 2) top = shade(mat.top, 0.985);
          diamond(ctx, x, y, h, top);
          if (kind === "bridge") { ctx.strokeStyle = "rgba(138,111,90,.5)"; ctx.lineWidth = 1.2; const a = iso(x + 0.5, y, h), b = iso(x + 0.5, y + 1, h); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        } });
      }
      for (const d of world.decor) items.push({ d: d.x + d.y + 0.4, f: () => paintDecor(ctx, world, d, t) });
      for (const fig of state.figures) {
        items.push({ d: fig.x + fig.y + 0.6, f: () => {
          const p = iso(fig.x + 0.5, fig.y + 0.5, fig.z);
          ctx.fillStyle = "rgba(43,35,48,.16)"; ctx.beginPath(); ctx.ellipse(p.x, p.y + 1, 11, 4.2, 0, 0, 7); ctx.fill();
          drawFigure(ctx, p.x, p.y, FIG, fig);
          if (fig.marker) {
            const by = p.y - 64 + Math.sin(t / 380) * 3;
            ctx.fillStyle = fig.markerColor || "#f2d49b";
            ctx.save(); ctx.translate(p.x, by); ctx.rotate(Math.PI / 4); ctx.fillRect(-5, -5, 10, 10); ctx.restore();
            ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.save(); ctx.translate(p.x, by); ctx.rotate(Math.PI / 4); ctx.fillRect(-2, -2, 4, 4); ctx.restore();
          }
        } });
      }
      if (state.ripple) {
        const r = state.ripple, age = (t - r.t0) / 600;
        if (age < 1) items.push({ d: r.x + r.y + 0.55, f: () => {
          const p = iso(r.x + 0.5, r.y + 0.5, (at(world, r.x, r.y) || 0) + 0.02);
          ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - age)})`; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.ellipse(p.x, p.y, 6 + age * 14, (6 + age * 14) / 2, 0, 0, 7); ctx.stroke();
        } });
      }
      items.sort((a, b) => a.d - b.d);
      for (const it of items) it.f();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return { draw, resize, tileAt, tileScreen, setFocus, get zoom() { return zoom * scale; }, get figH() { return 44 * FIG * zoom * scale; }, destroy() { ro.disconnect(); } };
  }

  /* ---------------- selection: the round hall of pillars ---------------- */
  /* The character stands on a central tower; a ring of arched, statue-topped
     pillars surrounds them. Swipe OR arrows rotate the ring (same easing);
     the pillar that settles at the far centre is selected and framed. */
  const PILLAR_PALS = [
    { a: "#b8a8e0", b: "#ece8f6", niche: "#8878b4" },
    { a: "#8fb8e8", b: "#e0eef8", niche: "#5f88b8" },
    { a: "#f2c8a0", b: "#f9efe4", niche: "#d09868" },
    { a: "#a8d8d8", b: "#e6f4f4", niche: "#68a8a8" },
    { a: "#e8a0c0", b: "#f8e8f0", niche: "#b87090" },
  ];
  const SEL_SKY = { sky: ["#ffffff", "#eaf2fb", "#f0eaf8"], haze: "#ffffff" };

  function mountCarousel(canvas, items, onSelect, initial) {
    const ctx = canvas.getContext("2d");
    const N = Math.max(1, items.length);
    const step = Math.PI * 2 / N;
    const start = ((Number(initial) || 0) % N + N) % N;
    let theta = -start * step, target = theta, vel = 0, dragging = false, lastX = 0, lastT = 0;
    let selected = start, settled = true;
    let cw = 0, ch = 0, dpr = 1, raf = 0, destroyed = false;
    function resize() {
      const r = canvas.parentElement.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cw = Math.max(50, r.width); ch = Math.max(50, r.height);
      canvas.width = cw * dpr; canvas.height = ch * dpr;
      canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
    }
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);

    function pillar(x, y, s, alpha, pal, variant, t, isSel) {
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.globalAlpha = alpha;
      const hw = 30, H = 230;
      /* soft ground shadow */
      ctx.fillStyle = "rgba(90,80,120,.12)"; ctx.beginPath(); ctx.ellipse(0, 6, hw + 12, 10, 0, 0, 7); ctx.fill();
      /* arched silhouette with vertical pastel gradient */
      const g = ctx.createLinearGradient(0, -H - hw, 0, 0);
      g.addColorStop(0, pal.b); g.addColorStop(1, pal.a);
      ctx.beginPath();
      ctx.moveTo(-hw, 0); ctx.lineTo(-hw, -H + hw);
      ctx.quadraticCurveTo(-hw, -H, 0, -H - hw * 0.7);
      ctx.quadraticCurveTo(hw, -H, hw, -H + hw);
      ctx.lineTo(hw, 0); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      /* right face shading for depth */
      ctx.save(); ctx.clip();
      ctx.fillStyle = "rgba(60,50,90,.10)"; ctx.fillRect(0, -H - hw, hw + 2, H + hw + 8);
      ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(-hw, -H - hw, 5, H + hw + 8);
      ctx.restore();
      /* niche: arched recess + pedestal + statue */
      const ny = -H + hw * 0.55;
      ctx.fillStyle = pal.niche; ctx.globalAlpha = alpha * 0.28;
      ctx.beginPath(); ctx.moveTo(-hw * 0.62, ny + 40); ctx.lineTo(-hw * 0.62, ny);
      ctx.quadraticCurveTo(-hw * 0.62, ny - hw * 0.5, 0, ny - hw * 0.62);
      ctx.quadraticCurveTo(hw * 0.62, ny - hw * 0.5, hw * 0.62, ny);
      ctx.lineTo(hw * 0.62, ny + 40); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.beginPath(); ctx.ellipse(0, ny + 40, hw * 0.6, 6, 0, 0, 7); ctx.fill();
      ctx.save(); ctx.translate(0, ny + 38); drawStatue(ctx, variant, 0.95, t); ctx.restore();
      /* base slab */
      ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.beginPath(); ctx.ellipse(0, 0, hw + 4, 7, 0, 0, 7); ctx.fill();
      /* ornate selection frame */
      if (isSel) {
        ctx.strokeStyle = "rgba(58,51,80,.85)"; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-hw - 8, 4); ctx.lineTo(-hw - 8, -H + hw);
        ctx.quadraticCurveTo(-hw - 8, -H - 8, 0, -H - hw * 0.7 - 12);
        ctx.quadraticCurveTo(hw + 8, -H - 8, hw + 8, -H + hw);
        ctx.lineTo(hw + 8, 4); ctx.stroke();
        ctx.strokeStyle = "rgba(58,51,80,.4)"; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-hw - 14, 4); ctx.lineTo(-hw - 14, -H + hw);
        ctx.quadraticCurveTo(-hw - 14, -H - 14, 0, -H - hw * 0.7 - 20);
        ctx.quadraticCurveTo(hw + 14, -H - 14, hw + 14, -H + hw);
        ctx.lineTo(hw + 14, 4); ctx.stroke();
        /* flourishes */
        ctx.fillStyle = "rgba(58,51,80,.85)";
        ctx.beginPath(); ctx.arc(0, -H - hw * 0.7 - 16, 3, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(-hw - 8, -H + hw, 2.4, 0, 7); ctx.arc(hw + 8, -H + hw, 2.4, 0, 7); ctx.fill();
      }
      ctx.restore();
    }

    function tower(t) {
      const cx = cw / 2, by = ch * 0.56;
      const s = Math.min(1, ch / 620);
      ctx.save(); ctx.translate(cx, by); ctx.scale(s, s);
      const tp = { top: "#f6e4dc", left: "#e8c8bc", right: "#d0a898" };
      const tp2 = { top: "#f0d8cc", left: "#e0b8a8", right: "#c89888" };
      /* stepped tiers */
      box(ctx, -1.6, -1.0, 3.2, 2.0, -1.2, 0, tp);
      box(ctx, -1.2, -0.7, 2.4, 1.5, 0, 0.9, tp2);
      box(ctx, -0.8, -0.5, 1.6, 1.1, 0.9, 1.7, tp);
      /* side stair */
      for (let i = 0; i < 4; i++) box(ctx, -1.9 + i * 0.12, 0.6 - i * 0.18, 0.5, 0.4, -1.2 + i * 0.5, -0.7 + i * 0.5, tp2);
      /* doorway */
      const dp = iso(0, 0.62, 0.9);
      ctx.fillStyle = "rgba(90,60,70,.5)"; ctx.beginPath();
      ctx.moveTo(dp.x - 7, dp.y); ctx.lineTo(dp.x - 7, dp.y - 16); ctx.arc(dp.x, dp.y - 16, 7, Math.PI, 0); ctx.lineTo(dp.x + 7, dp.y); ctx.closePath(); ctx.fill();
      /* the character, seen from behind, gazing at the pillars */
      const cp = iso(0, 0, 1.7);
      ctx.fillStyle = "rgba(43,35,48,.15)"; ctx.beginPath(); ctx.ellipse(cp.x, cp.y + 1, 9, 3.4, 0, 0, 7); ctx.fill();
      drawFigure(ctx, cp.x, cp.y, 1.15, { robe: "#b8a8e0", accent: "#8fb8e8", hat: "point", back: true, t });
      ctx.restore();
    }

    function frame(t) {
      if (destroyed || !canvas.isConnected) { destroy(); return; }
      if (!dragging) {
        theta += (target - theta) * 0.11;
        if (Math.abs(target - theta) < 0.001) {
          theta = target;
          const idx = ((Math.round(-theta / step) % N) + N) % N;
          if (idx !== selected || !settled) { selected = idx; settled = true; onSelect(idx); }
        } else settled = false;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintSky(ctx, cw, ch, SEL_SKY, t, "day");
      /* faint distant monuments */
      ctx.globalAlpha = 0.25;
      for (let i = 0; i < 3; i++) {
        const x = cw * (0.1 + i * 0.4), y = ch * (0.22 + (i % 2) * 0.06) + Math.sin(t / 2600 + i * 2) * 5;
        ctx.fillStyle = "#dfe6f2"; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 22, y + 10); ctx.lineTo(x, y + 20); ctx.lineTo(x - 22, y + 10); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#c3cfe4"; ctx.fillRect(x - 10, y + 12, 20, 22);
      }
      ctx.globalAlpha = 1;
      /* pillars sit lower so their arches never collide with the floating head */
      const cx = cw / 2, cy = ch * 0.60;
      const Rx = Math.min(cw * 0.46, 330), Ry = Rx * 0.20;
      const far = [], near = [];
      for (let i = 0; i < N; i++) {
        let a = theta + i * step;
        a = Math.atan2(Math.sin(a), Math.cos(a));   /* normalize [-π,π] */
        const c = Math.cos(a);
        if (c < -0.9) continue;                     /* behind the camera */
        const prox = (1 - c) / 2;
        const x = cx + Math.sin(a) * Rx;
        const y = cy - c * Ry;
        const s = (0.95 + 0.25 * prox) * Math.min(1, ch / 620);
        const alpha = c < 0 ? Math.max(0, (c + 0.9) / 0.9) : 1;
        const pal = PILLAR_PALS[hash(items[i].id || String(i)) % PILLAR_PALS.length];
        const variant = hash(items[i].id || String(i)) % 5;
        const rec = { x, y, s, alpha, pal, variant, sel: i === selected && settled, c };
        (c >= 0 ? far : near).push(rec);
      }
      far.sort((p, q) => p.y - q.y);
      for (const p of far) pillar(p.x, p.y, p.s, p.alpha, p.pal, p.variant, t, p.sel);
      tower(t);
      near.sort((p, q) => p.y - q.y);
      for (const p of near) pillar(p.x, p.y, p.s, p.alpha * 0.9, p.pal, p.variant, t, false);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function down(e) { dragging = true; settled = false; lastX = e.clientX; lastT = performance.now(); vel = 0; canvas.setPointerCapture(e.pointerId); }
    function move(e) {
      if (!dragging) return;
      const dx = e.clientX - lastX; lastX = e.clientX;
      const now = performance.now(), dt = Math.max(8, now - lastT); lastT = now;
      const dth = dx * 0.0052;
      theta += dth; target = theta;
      vel = dth * (16 / dt) * 0.6;
    }
    function up() {
      if (!dragging) return;
      dragging = false;
      target = Math.round((theta + vel * 8) / step) * step;
    }
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    function destroy() {
      if (destroyed) return; destroyed = true;
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up);
    }
    onSelect(start);
    return {
      /* arrows use the SAME eased rotation as a swipe settle */
      rotate(dir) { target = (Math.round(target / step) - dir) * step; settled = false; },
      get selected() { return selected; },
      destroy,
    };
  }

  return { buildWorld, createRenderer, mountCarousel, drawFigure, drawStatue, paintSky, iso, TIME, ACCENTS, hash, shade, TW, TH, ZH };
})();