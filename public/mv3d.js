/* EARNest · MV3D — true-3D Monument Valley world engine (Three.js).
   The metro ("The Commute") is modelled as SOLID architecture: every platform,
   stair step, wall, pillar and the train itself is a 3D box column. The walkable
   graph is DERIVED from that geometry (a cell is walkable iff it is the top face
   of a solid column; edges exist only between adjacent tops one step apart), so
   a figure can never float beside a stair or hover over a void — its feet always
   rest on a real modelled surface, and occlusion is real depth (MV's technique:
   navigation graph on solid geometry + orthographic isometric projection).
   ART: flat unlit face colours sampled pixel-exact from the founder's "02 THE
   COMMUTE" reference. No realtime lighting on architecture — MV shades by face
   orientation, light from upper-right (screen-right face brighter).
   Contract matches MVWorld worlds: W/D/h/walk/maxStep/proj/spawn/zones and a
   renderer with draw/resize/tileAt/tileScreen/setFocus/zoom/figH/destroy.
   Scene axes: X/Y ground plane, Z up. proj() takes heights in STEP units. */
"use strict";
window.MV3D = (function () {
  const T = window.THREE;
  const STEP = 0.34;                 /* world units per stair step */
  const A = 1 / Math.SQRT2, B = 1 / Math.sqrt(6), C = 2 / Math.sqrt(6);
  const XAX = new T.Vector3(-1, 1, 0).normalize();
  const YAX = new T.Vector3(-1, -1, 2).normalize();
  const ZAX = new T.Vector3(1, 1, 1).normalize();
  const projW = (x, y, z) => ({ x: (y - x) * A, y: (x + y) * B - (z || 0) * C });
  const proj = (x, y, zSteps) => { const p = projW(x, y, (zSteps || 0) * STEP); p.z = (zSteps || 0) * STEP; return p; };

  /* ---------------- merged vertex-colour geometry ----------------
     col may be a hex string (uniform) or {t,l,r,d}: top / +x face (screen-left)
     / +y face (screen-right) / hidden faces. */
  function MeshBuilder() {
    const pos = [], nor = [], col = [], idx = [];
    const c = new T.Color();
    function quad(p1, p2, p3, p4, n, hex) {
      c.set(hex); const base = pos.length / 3;
      for (const p of [p1, p2, p3, p4]) { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); col.push(c.r, c.g, c.b); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const face = (m, k, fb) => (typeof m === "string" ? m : (m[k] || m[fb] || m.t));
    function box(x0, y0, z0, x1, y1, z1, m, skip) {
      skip = skip || {};
      if (!skip.px) quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], face(m, "l", "t"));
      if (!skip.nx) quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0], face(m, "d", "l"));
      if (!skip.py) quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0], face(m, "r", "t"));
      if (!skip.ny) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], face(m, "d", "l"));
      if (!skip.pz) quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], face(m, "t", "t"));
    }
    /* flat filled arch niche (rectangle + half-disc cap) proud of a wall face */
    function archPanel(cx, cy, z0, r, h, axis, hex, off) {
      off = off || 0.03;
      if (axis === "x") {
        const x = cx + off;
        quad([x, cy - r, z0], [x, cy + r, z0], [x, cy + r, z0 + h], [x, cy - r, z0 + h], [1, 0, 0], hex);
        for (let i = 0; i < 10; i++) {
          const a0 = Math.PI * i / 10, a1 = Math.PI * (i + 1) / 10;
          quad([x, cy - Math.cos(a0) * r, z0 + h + Math.sin(a0) * r], [x, cy - Math.cos(a1) * r, z0 + h + Math.sin(a1) * r], [x, cy, z0 + h], [x, cy, z0 + h], [1, 0, 0], hex);
        }
      } else {
        const y = cy + off;
        quad([cx - r, y, z0], [cx + r, y, z0], [cx + r, y, z0 + h], [cx - r, y, z0 + h], [0, 1, 0], hex);
        for (let i = 0; i < 10; i++) {
          const a0 = Math.PI * i / 10, a1 = Math.PI * (i + 1) / 10;
          quad([cx - Math.cos(a0) * r, y, z0 + h + Math.sin(a0) * r], [cx - Math.cos(a1) * r, y, z0 + h + Math.sin(a1) * r], [cx, y, z0 + h], [cx, y, z0 + h], [0, 1, 0], hex);
        }
      }
    }
    function build() {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new T.Float32BufferAttribute(nor, 3));
      g.setAttribute("color", new T.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      return g;
    }
    return { box, archPanel, quad, build };
  }

  /* ---------------- palette sampled from the reference ---------------- */
  const PAL = {
    bg: "#b5a0d0",
    floor: { t: "#f8e1d3", l: "#a88fb8", r: "#ae9bcb", d: "#9d84ad" },
    grout: "#eec9b9",
    stair: { t: "#f3dccd", l: "#b7a0c6", r: "#c9b0d2", d: "#a88fb8" },
    wall: { t: "#f6e7d9", l: "#bda4c6", r: "#d2b8d2", d: "#a88fb8" },
    shell: { t: "#f6e7d9", l: "#b19dcd", r: "#b39ed0", d: "#a793c4" },
    ground: { t: "#b39ed0", l: "#a793c4", r: "#ab97c8", d: "#a793c4" },
    slate: "#3c546c", slateDeep: "#2f425a",
    glass: "#96c7c6", glassEdge: "#d6efec",
    coral: "#f69294", coralDeep: "#e58080", bench: "#f18a87",
    silver: { t: "#cfc2cc", l: "#b8a9b9", r: "#c0b0ba", d: "#a99aa8" },
    trainWin: "#505d6e", under: "#4e506d", rail: "#8a8aa0",
    cream: "#fbecdc", lamp: "#efeae7",
    grey: { t: "#d8d3de", l: "#b0a8be", r: "#c4bccf", d: "#a29ab0" },
    turnTop: "#424e63", pink: "#e8a0a8", green: "#7fb89a",
    safety: "#e88a80", shadow: "#a793c4",
  };

  /* ---------------- the metro model ----------------
     Grid 24x20. Heights in steps: platform 0, mezzanine 6, street 12. */
  const W = 24, D = 20;
  function buildMetro() {
    const h = new Array(W * D).fill(null);
    const kind = new Array(W * D).fill("");
    const blocked = new Set();
    const set = (x, y, v, k) => { if (x >= 0 && y >= 0 && x < W && y < D) { h[y * W + x] = v; kind[y * W + x] = k || kind[y * W + x]; } };
    const slab = (x0, y0, x1, y1, v, k) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, v, k); };
    const block = (x, y) => blocked.add(x + "," + y);

    slab(0, 2, 2, 5, 12, "ground");
    slab(3, 2, 10, 5, 12, "street");
    slab(3, 6, 16, 11, 6, "mezz");
    slab(3, 14, 18, 18, 0, "platform");
    for (let i = 0; i < 6; i++) { set(8, 6 + i, 11 - i, "stair"); set(9, 6 + i, 11 - i, "stair"); }
    for (let i = 0; i < 6; i++) { set(14, 12 + i, 5 - i, "stair"); set(15, 12 + i, 5 - i, "stair"); }
    slab(3, 1, 10, 1, 16, "wall");
    slab(17, 6, 17, 11, 14, "shell");
    slab(8, 19, 20, 19, 10, "wall");
    slab(2, 6, 2, 11, 10, "wall");
    for (let x = 3; x <= 10; x++) block(x, 1);
    for (let y = 6; y <= 11; y++) { block(17, y); block(2, y); }
    for (let x = 8; x <= 20; x++) block(x, 19);
    for (const [x, y] of [[5, 8], [6, 8], [11, 8], [12, 8], [5, 14], [11, 14], [18, 15], [5, 16], [12, 16], [4, 4]]) block(x, y);

    const walk = (x, y) => x >= 0 && y >= 0 && x < W && y < D && h[y * W + x] != null && !blocked.has(x + "," + y);
    const world = {
      mode3d: true, setting: "metro", time: "day", W, D, h, kind, blocked,
      maxStep: 1, step: 1, moveSpeed: 3.4, npcSpeed: 1.4, wanderSpan: 3,
      spawn: { x: 10, y: 16 },
      zones: [{ x: 6, y: 15 }, { x: 10, y: 9 }, { x: 13, y: 16 }],
      walk, proj,
    };

    const mb = MeshBuilder(), gb = MeshBuilder(), eb = MeshBuilder();
    const BASE = -3;
    const MAT = { street: PAL.floor, mezz: PAL.floor, platform: PAL.floor, ground: PAL.ground, stair: PAL.stair, wall: PAL.wall, shell: PAL.shell };
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= D) ? null : h[y * W + x];
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
      const v = h[y * W + x]; if (v == null) continue;
      const top = v * STEP, k = kind[y * W + x];
      const hr = at(x + 1, y), hl = at(x, y + 1), hb = at(x - 1, y), hf = at(x, y - 1);
      mb.box(x, y, BASE, x + 1, y + 1, top, MAT[k] || PAL.floor, {
        px: hr != null && hr * STEP >= top, nx: hb != null && hb * STEP >= top,
        py: hl != null && hl * STEP >= top, ny: hf != null && hf * STEP >= top,
      });
      if ((k === "street" || k === "mezz" || k === "platform") && !blocked.has(x + "," + y)) {
        if (x % 2 === 0) mb.box(x, y, top, x + 0.035, y + 1, top + 0.004, PAL.grout);
        if (y % 2 === 0) mb.box(x, y, top, x + 1, y + 0.035, top + 0.004, PAL.grout);
      }
    }
    mb.box(3.4, 5.86, 6 * STEP, 16.6, 5.98, 12 * STEP, PAL.slate);
    /* dark cutaway wall behind the train (mezzanine cut face) */
    mb.box(3, 12.02, -1.5, 13.6, 12.16, 6 * STEP, PAL.slate);
    mb.box(3, 12.16, 5.4 * STEP, 13.6, 12.3, 6 * STEP, PAL.slateDeep);
    for (let i = 0; i < 6; i++) {
      const za = (11 - i) * STEP, zb = (5 - i) * STEP;
      /* lilac stringer curbs under the glass so the flights read as structure */
      mb.box(7.7, 6 + i, za - 0.3, 7.86, 7 + i, za, PAL.stair);
      mb.box(10.14, 6 + i, za - 0.3, 10.3, 7 + i, za, PAL.stair);
      mb.box(13.7, 12 + i, zb - 0.3, 13.86, 13 + i, zb, PAL.stair);
      mb.box(16.14, 12 + i, zb - 0.3, 16.3, 13 + i, zb, PAL.stair);
      gb.box(7.86, 6 + i, za, 7.96, 7 + i, za + 0.95, PAL.glass);
      gb.box(10.04, 6 + i, za, 10.14, 7 + i, za + 0.95, PAL.glass);
      gb.box(13.86, 12 + i, zb, 13.96, 13 + i, zb + 0.95, PAL.glass);
      gb.box(16.04, 12 + i, zb, 16.14, 13 + i, zb + 0.95, PAL.glass);
      eb.box(7.86, 6 + i, za + 0.95, 7.96, 7 + i, za + 1.0, PAL.glassEdge);
      eb.box(10.04, 6 + i, za + 0.95, 10.14, 7 + i, za + 1.0, PAL.glassEdge);
      eb.box(13.86, 12 + i, zb + 0.95, 13.96, 13 + i, zb + 1.0, PAL.glassEdge);
      eb.box(16.04, 12 + i, zb + 0.95, 16.14, 13 + i, zb + 1.0, PAL.glassEdge);
    }
    for (const [a, b] of [[3, 8], [10, 14], [16, 17]]) {
      gb.box(a, 11.84, 6 * STEP, b, 11.96, 6 * STEP + 1.0, PAL.glass);
      eb.box(a, 11.84, 6 * STEP + 1.0, b, 11.96, 6 * STEP + 1.05, PAL.glassEdge);
    }
    /* track trench + rails (between dark wall and platform) */
    mb.box(1, 12, -1.7, 19, 14.05, -1.5, PAL.under);
    mb.box(1, 12.35, -1.5, 19, 12.48, -1.4, PAL.rail);
    mb.box(1, 12.95, -1.5, 19, 13.08, -1.4, PAL.rail);
    /* train: silver body, rounded nose, coral double doors FACING the platform
       (+y) so the camera sees them — exactly as in the reference */
    mb.box(2.4, 12.3, -1.35, 13, 13.2, 1.42, PAL.silver);
    mb.box(2.4, 12.3, 1.42, 13, 13.2, 1.56, PAL.silver.t);
    mb.quad([2.4, 12.3, -1.35], [2.4, 13.2, -1.35], [2.05, 13.2, 0.1], [2.05, 12.3, 0.1], [-1, 0, 0.3], PAL.silver.l);
    mb.quad([2.05, 12.3, 0.1], [2.05, 13.2, 0.1], [2.05, 13.2, 0.9], [2.05, 12.3, 0.9], [-1, 0, 0], PAL.silver.l);
    mb.quad([2.05, 12.3, 0.9], [2.05, 13.2, 0.9], [2.4, 13.2, 1.42], [2.4, 12.3, 1.42], [-1, 0, 0.5], PAL.silver.l);
    mb.quad([2.4, 12.3, 1.42], [2.05, 12.3, 0.9], [2.05, 13.2, 0.9], [2.4, 13.2, 1.42], [-0.5, 0, 0.8], PAL.silver.t);
    mb.box(2.1, 12.35, -1.35, 2.4, 13.15, -1.0, PAL.under);
    for (let x = 3; x < 13; x++) {
      if (x % 4 === 1) {
        mb.box(x + 0.12, 13.14, -0.35, x + 0.52, 13.24, 1.12, PAL.coralDeep);
        mb.box(x + 0.56, 13.14, -0.35, x + 0.96, 13.24, 1.12, PAL.coralDeep);
        mb.box(x + 0.2, 13.24, 0.42, x + 0.44, 13.29, 0.95, PAL.trainWin);
        mb.box(x + 0.64, 13.24, 0.42, x + 0.88, 13.29, 0.95, PAL.trainWin);
      } else {
        mb.box(x + 0.15, 13.14, 0.4, x + 0.85, 13.24, 1.02, PAL.trainWin);
      }
    }
    mb.box(2.6, 12.3, -1.36, 13, 13.2, -1.05, PAL.under);
    mb.box(3, 14.02, 0.0, 18, 14.24, 0.035, PAL.safety);
    for (const px of [5, 11]) mb.box(px + 0.22, 13.55, BASE, px + 0.78, 14.05, 6 * STEP, PAL.wall);
    for (const [tx, ty] of [[5, 8], [6, 8], [11, 8], [12, 8]]) {
      mb.box(tx + 0.18, ty + 0.15, 6 * STEP, tx + 0.82, ty + 0.85, 6 * STEP + 0.78, PAL.grey);
      mb.box(tx + 0.22, ty + 0.2, 6 * STEP + 0.78, tx + 0.78, ty + 0.8, 6 * STEP + 0.84, PAL.turnTop);
      mb.box(tx + 0.82, ty + 0.4, 6 * STEP + 0.42, tx + 1.28, ty + 0.6, 6 * STEP + 0.6, PAL.coralDeep);
    }
    function sign(sx, sy, z, arrow) {
      mb.box(sx + 0.42, sy + 0.05, z + 0.9, sx + 0.58, sy + 0.2, z + 1.5, PAL.rail);
      mb.box(sx - 0.45, sy, z, sx + 1.45, sy + 0.28, z + 0.9, PAL.slate);
      /* glyphs proud of the camera-facing (+y) face */
      mb.box(sx - 0.2, sy + 0.28, z + 0.28, sx + 0.35, sy + 0.33, z + 0.72, PAL.cream);
      mb.box(sx - 0.12, sy + 0.33, z + 0.5, sx + 0.27, sy + 0.36, z + 0.64, PAL.slate);
      mb.box(sx - 0.14, sy + 0.28, z + 0.16, sx - 0.04, sy + 0.33, z + 0.24, PAL.cream);
      mb.box(sx + 0.19, sy + 0.28, z + 0.16, sx + 0.29, sy + 0.33, z + 0.24, PAL.cream);
      if (arrow === "down") {
        mb.box(sx + 0.72, sy + 0.28, z + 0.3, sx + 0.84, sy + 0.33, z + 0.72, PAL.cream);
        mb.box(sx + 0.6, sy + 0.28, z + 0.3, sx + 0.96, sy + 0.33, z + 0.42, PAL.cream);
      } else {
        mb.box(sx + 0.6, sy + 0.28, z + 0.44, sx + 1.1, sy + 0.33, z + 0.56, PAL.cream);
        mb.box(sx + 0.6, sy + 0.28, z + 0.3, sx + 0.72, sy + 0.33, z + 0.7, PAL.cream);
      }
    }
    /* ceiling beams the signs hang from (wall to wall) */
    mb.box(3, 9.2, 3.95, 17, 9.6, 4.08, PAL.wall);
    mb.box(3, 13.2, 3.7, 17.5, 13.6, 3.82, PAL.wall);
    sign(7.5, 9.3, 2.5, "down");
    sign(12.5, 13.3, 2.2, "left");
    /* entrance glazing + big sign on the camera-facing (+y) face of the block */
    mb.box(3.6, 2.0, 12 * STEP, 6.4, 2.12, 15.4 * STEP, PAL.glass);
    mb.box(3.6, 2.0, 15.4 * STEP, 6.4, 2.12, 15.55 * STEP, PAL.glassEdge);
    mb.box(7.4, 2.0, 12.6 * STEP, 9.8, 2.14, 15.4 * STEP, PAL.slate);
    mb.box(7.85, 2.14, 13.5 * STEP, 8.75, 2.19, 14.5 * STEP, PAL.cream);
    mb.box(8.0, 2.19, 14.15 * STEP, 8.6, 2.22, 14.35 * STEP, PAL.slate);
    mb.box(8.95, 2.14, 13.3 * STEP, 9.1, 2.19, 14.0 * STEP, PAL.cream);
    mb.box(8.8, 2.14, 13.3 * STEP, 9.25, 2.19, 13.45 * STEP, PAL.cream);
    mb.box(3, 2, 15 * STEP, 7, 3.4, 15 * STEP + 0.3, PAL.coral);
    mb.box(3, 2, 15 * STEP + 0.3, 7, 3.4, 15 * STEP + 0.38, PAL.coralDeep);
    for (const [cx, cy] of [[3.2, 2.2], [6.6, 2.2], [3.2, 3.1], [6.6, 3.1]]) mb.box(cx, cy, 12 * STEP, cx + 0.14, cy + 0.14, 15 * STEP, PAL.rail);
    gb.box(3.3, 2.15, 12 * STEP, 6.7, 2.28, 14.6 * STEP, PAL.glass);
    mb.box(3.6, 2.6, 12 * STEP, 6.2, 3.0, 12 * STEP + 0.42, PAL.bench);
    mb.box(3.6, 2.95, 12 * STEP + 0.42, 6.2, 3.1, 12 * STEP + 0.85, PAL.bench);
    mb.box(1.7, 3.0, 12 * STEP, 1.86, 3.16, 12 * STEP + 2.6, PAL.lamp);
    mb.box(1.7, 3.0, 12 * STEP + 2.6, 2.5, 3.16, 12 * STEP + 2.75, PAL.lamp);
    mb.box(2.3, 2.96, 12 * STEP + 2.5, 2.7, 3.2, 12 * STEP + 2.62, PAL.lamp);
    for (let i = 0; i < 5; i++) mb.box(0.15, 2.2 + i * 0.62, 12 * STEP, 1.9, 2.5 + i * 0.62, 12 * STEP + 0.02, PAL.cream);
    /* arches: mid-tone reveal + deep niche = recessed depth, on three walls */
    for (const ay of [7.2, 9.6]) { mb.archPanel(17, ay, 6 * STEP + 0.3, 0.84, 3.5, "x", PAL.slate, -0.06); mb.archPanel(17, ay, 6 * STEP + 0.4, 0.72, 3.4, "x", PAL.slateDeep, -0.12); }
    for (const ax of [10.5, 14, 17.5]) { mb.archPanel(ax, 19, 0.3, 0.84, 3.1, "y", PAL.slate, -0.06); mb.archPanel(ax, 19, 0.4, 0.72, 3.0, "y", PAL.slateDeep, -0.12); }
    for (const ay of [7.2, 9.6]) { mb.archPanel(2, ay, 6 * STEP + 0.2, 0.7, 2.5, "x", PAL.slate, 0.06); mb.archPanel(2, ay, 6 * STEP + 0.3, 0.6, 2.4, "x", PAL.slateDeep, 0.12); }
    for (const [bx, by] of [[5, 16], [12, 16]]) {
      mb.box(bx + 0.1, by + 0.25, 0, bx + 0.9, by + 0.75, 0.42, PAL.cream);
      mb.box(bx + 0.1, by + 0.7, 0.42, bx + 0.9, by + 0.85, 0.85, PAL.cream);
    }
    mb.box(18.15, 15.2, 0, 18.85, 15.8, 1.25, PAL.pink);
    mb.box(18.1, 15.3, 0.5, 18.16, 15.7, 1.0, PAL.cream);
    mb.box(4.2, 4.2, 12 * STEP, 4.8, 4.8, 12 * STEP + 0.4, PAL.coralDeep);
    mb.box(4.3, 4.3, 12 * STEP + 0.4, 4.7, 4.7, 12 * STEP + 0.85, PAL.green);
    mb.box(-2.5, 1, BASE - 0.4, 3, 19.6, BASE - 0.3, PAL.shadow);
    /* crisp cast shadows (light upper-right → shadows fall screen-left/+x) */
    const SF = "#e2c0b3", sz = 12 * STEP;
    mb.box(1.86, 3.0, sz + 0.01, 4.4, 3.18, sz + 0.016, SF);          // lamp
    mb.box(3.9, 2.5, sz + 0.01, 7.7, 3.7, sz + 0.016, SF);            // canopy
    mb.box(5.78, 14.05, 0.01, 8.3, 14.5, 0.016, SF);                  // pillar A
    mb.box(11.78, 14.05, 0.01, 14.3, 14.5, 0.016, SF);                // pillar B

    world.solidGeo = mb.build();
    world.glassGeo = gb.build();
    world.glassEdgeGeo = eb.build();
    return world;
  }
  /* ---------------- figures (low-poly robed characters, Z up) ---------------- */
  function makeFigure(fig) {
    const g = new T.Group();
    const mat = (hex) => new T.MeshLambertMaterial({ color: hex });
    const robeM = mat(fig.robe), accM = mat(fig.accent), skinM = mat(fig.skin || "#f6e7d7");
    const body = new T.Mesh(new T.CylinderGeometry(0.16, 0.3, 0.6, 10), robeM);
    body.rotation.x = Math.PI / 2; body.position.z = 0.42; g.add(body);
    const belt = new T.Mesh(new T.CylinderGeometry(0.285, 0.295, 0.07, 10), accM);
    belt.rotation.x = Math.PI / 2; belt.position.z = 0.16; g.add(belt);
    const head = new T.Mesh(new T.SphereGeometry(0.17, 12, 10), skinM);
    head.position.z = 0.86; g.add(head);
    let hat;
    const half = () => new T.SphereGeometry(0.175, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    if (fig.hat === "point") { hat = new T.Mesh(new T.ConeGeometry(0.19, 0.42, 10), robeM); hat.rotation.x = Math.PI / 2; hat.position.z = 1.16; }
    else if (fig.hat === "bun") {
      hat = new T.Group();
      const cap = new T.Mesh(half(), mat("#6a4a3a")); cap.rotation.x = Math.PI / 2; cap.position.z = 0.88; hat.add(cap);
      const bun = new T.Mesh(new T.SphereGeometry(0.07, 8, 8), mat("#6a4a3a")); bun.position.set(0, -0.12, 1.02); hat.add(bun);
    } else { hat = new T.Mesh(half(), accM); hat.rotation.x = Math.PI / 2; hat.position.z = 0.88; }
    g.add(hat);
    const eyeM = mat("#2b2330");
    for (const s of [-1, 1]) {
      const eye = new T.Mesh(new T.SphereGeometry(0.028, 6, 6), eyeM);
      eye.position.set(s * 0.065, 0.155, 0.88); g.add(eye);
    }
    const mouth = new T.Mesh(new T.SphereGeometry(0.035, 6, 6), eyeM);
    mouth.position.set(0, 0.16, 0.79); mouth.visible = false; g.add(mouth);
    const legM = mat("#4a4266");
    const legs = [];
    for (const s of [-1, 1]) {
      const leg = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 0.2, 6), legM);
      leg.rotation.x = Math.PI / 2; leg.position.set(s * 0.09, 0, 0.1); g.add(leg); legs.push(leg);
    }
    const marker = new T.Mesh(new T.OctahedronGeometry(0.16), new T.MeshLambertMaterial({ color: fig.markerColor || "#f2d49b" }));
    marker.position.z = 1.62; marker.visible = !!fig.marker; g.add(marker);
    const shadow = new T.Mesh(new T.CircleGeometry(0.3, 14), new T.MeshBasicMaterial({ color: "#2b2330", transparent: true, opacity: 0.22 }));
    shadow.position.z = 0.015; g.add(shadow);
    g.scale.setScalar(1.45);
    g.userData = { robeM, accM, skinM, legs, mouth, marker };
    return g;
  }

  /* ---------------- renderer ---------------- */
  function createRenderer(canvas, world) {
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false });
    const scene = new T.Scene();
    scene.background = new T.Color(PAL.bg);
    const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    camera.matrixAutoUpdate = false;
    const quat = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(XAX, YAX, ZAX));
    /* lights affect ONLY the figures — architecture is unlit flat colour (MV) */
    scene.add(new T.HemisphereLight(0xffffff, 0xb0a0c8, 0.9));
    const sun = new T.DirectionalLight(0xfff2e0, 0.5);
    sun.position.set(-0.3, 0.8, 0.9); scene.add(sun);
    scene.add(new T.Mesh(world.solidGeo, new T.MeshBasicMaterial({ vertexColors: true })));
    scene.add(new T.Mesh(world.glassGeo, new T.MeshBasicMaterial({ color: PAL.glass, transparent: true, opacity: 0.5, depthWrite: false })));
    scene.add(new T.Mesh(world.glassEdgeGeo, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })));
    const ripple = new T.Mesh(new T.RingGeometry(0.2, 0.3, 24), new T.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0 }));
    ripple.visible = false; scene.add(ripple);

    let cw = 0, ch = 0, dpr = 1, k = 46, zoom = 1, zoomT = 1;
    let cam = null, focusT = null, lastState = null;
    const figMeshes = new Map();
    if (/[?&]mvdebug/.test(location.search)) window.__mv3d = { world, tileAt, tileScreen, get state() { return lastState; }, get cam() { return cam; } };
    function resize() {
      const r = canvas.parentElement.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cw = Math.max(50, r.width); ch = Math.max(50, r.height);
      renderer.setPixelRatio(dpr); renderer.setSize(cw, ch, false);
      canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
      k = Math.min(42, Math.max(26, cw / 13));
    }
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);
    const anchor = () => ({ x: cw / 2, y: ch * 0.56 });
    function setFocus(p) { focusT = p; zoomT = p ? 1.16 : 1; }
    function placeCamera(target) {
      const kk = k * zoom, a = anchor();
      camera.left = -a.x / kk; camera.right = (cw - a.x) / kk;
      camera.top = a.y / kk; camera.bottom = -(ch - a.y) / kk;
      camera.updateProjectionMatrix();
      const eye = new T.Vector3(target.x, target.y, target.z).add(ZAX.clone().multiplyScalar(80));
      camera.matrixWorld.compose(eye, quat, new T.Vector3(1, 1, 1));
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    }
    function toScreen(p3) {
      const a = anchor(), kk = k * zoom;
      const pr = projW(p3.x, p3.y, p3.z), pc = projW(cam.x, cam.y, cam.z);
      return { x: a.x + (pr.x - pc.x) * kk, y: a.y + (pr.y - pc.y) * kk };
    }
    function tileScreen(x, y) {
      return toScreen({ x: x + 0.5, y: y + 0.5, z: (world.h[y * world.W + x] || 0) * STEP });
    }
    function tileAt(px, py) {
      /* exact pick: pointer ray = -ZAX; nearest walkable top face it hits */
      const a = anchor(), kk = k * zoom, r3 = Math.sqrt(3);
      const o = new T.Vector3(cam.x, cam.y, cam.z)
        .add(XAX.clone().multiplyScalar((px - a.x) / kk))
        .add(YAX.clone().multiplyScalar((a.y - py) / kk))
        .add(ZAX.clone().multiplyScalar(80));
      let best = null, bestS = 1e9;
      for (let y = 0; y < world.D; y++) for (let x = 0; x < world.W; x++) {
        if (!world.walk(x, y)) continue;
        const s = (o.z - world.h[y * world.W + x] * STEP) * r3;
        if (s < 0 || s >= bestS) continue;
        if (Math.floor(o.x - s / r3) === x && Math.floor(o.y - s / r3) === y) { best = { x, y }; bestS = s; }
      }
      return best;
    }
    function draw(state, t) {
      lastState = state;
      zoom += (zoomT - zoom) * 0.08;
      const player = state.figures.find((f) => f.id === "player");
      const tgt = focusT || (player ? proj(player.x + 0.5, player.y + 0.5, player.z) : proj(world.spawn.x, world.spawn.y, 0));
      const z3 = tgt.z || 0, sx = tgt.x, sy = tgt.y + z3 * C;
      const target3 = { x: (sy / B - sx / A) / 2, y: (sy / B + sx / A) / 2, z: z3 };
      if (!cam) cam = { ...target3 };
      cam.x += (target3.x - cam.x) * 0.07; cam.y += (target3.y - cam.y) * 0.07; cam.z += (target3.z - cam.z) * 0.07;
      placeCamera(cam);
      for (const fig of state.figures) {
        let m = figMeshes.get(fig.id);
        if (!m) { m = makeFigure(fig); figMeshes.set(fig.id, m); scene.add(m); }
        const u = m.userData;
        u.robeM.color.set(fig.robe); u.accM.color.set(fig.accent); u.skinM.color.set(fig.skin || "#f6e7d7");
        const bob = fig.moving ? Math.abs(Math.sin(fig.walk * Math.PI)) * 0.05 : Math.sin(t / 900) * 0.012;
        m.position.set(fig.x + 0.5, fig.y + 0.5, fig.z * STEP + bob);
        m.rotation.z = fig.face > 0 ? Math.PI / 4 : Math.PI * 1.25;
        const sw = fig.moving ? Math.sin(fig.walk * Math.PI * 2) * 0.09 : 0;
        u.legs[0].position.y = sw; u.legs[1].position.y = -sw;
        u.mouth.visible = !!fig.talking;
        u.marker.visible = !!fig.marker;
        if (fig.marker) { u.marker.position.z = 1.62 + Math.sin(t / 380) * 0.06; u.marker.rotation.z = t / 900; }
      }
      if (state.ripple) {
        const r = state.ripple, age = (t - r.t0) / 600;
        if (age < 1) {
          ripple.visible = true;
          ripple.position.set(r.x + 0.5, r.y + 0.5, (world.h[r.y * world.W + r.x] || 0) * STEP + 0.02);
          const s = 1 + age * 2.4; ripple.scale.set(s, s, s);
          ripple.material.opacity = 0.7 * (1 - age);
        } else ripple.visible = false;
      } else ripple.visible = false;
      renderer.render(scene, camera);
    }
    return {
      draw, resize, tileAt, tileScreen, setFocus,
      get zoom() { return k * zoom; },
      get figH() { return 1.35 * 1.45 * C * k * zoom; },
      destroy() {
        ro.disconnect();
        scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        renderer.dispose();
      },
    };
  }

  return { buildMetro, createRenderer, proj, STEP };
})();