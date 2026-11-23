/* EARNest · StoryPlayer — the ONE game engine, Monument Valley style.
   A pastel isometric diorama of modern-day Earth (built by MVWorld from
   spec.world). The player taps the ground and the little robed figure walks
   there (BFS pathfinding over the heightmap — every area is reachable, no
   walking puzzles). Characters wander their zones; tapping one opens the
   conversation screen: scene on top, paper panel below with an oval name
   plate, typewriter dialogue and a continue arrow — exactly the shared
   concept sketch. Questions (choice / free text / timed) are asked in-story
   and every answer, hesitation, timeout and tap is recorded as research data.

   Contract: StoryPlayer.open(gameSession, bodyEl, hooks) / .close() / .isOpen()
     hooks.record(evt), hooks.progress(done,total), hooks.finish() */
"use strict";
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MV = window.MVWorld;

  let S = null; // live session state

  /* ============================ AUDIO ============================
     Synthesized WebAudio — no files, works offline. A calm pentatonic pad
     loops under the world; short SFX mark taps, steps, choices and the end. */
  const Audio = {
    ctx: null, master: null, musicGain: null, sfxGain: null,
    muted: localStorage.getItem("earnest.storyAudio") === "off",
    musicTimer: null, nextNote: 0, step: 0, _drone: null,
    ensure() {
      if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {}); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.16; this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.5; this.sfxGain.connect(this.master);
    },
    setMuted(m) {
      this.muted = m;
      try { localStorage.setItem("earnest.storyAudio", m ? "off" : "on"); } catch {}
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.03);
    },
    tone({ freq = 440, type = "sine", dur = 0.2, gain = 0.2, at = 0, slide = 0, filter = 0 }) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime + at;
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = o;
      if (filter) { const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = filter; o.connect(f); node = f; }
      node.connect(g); g.connect(this.sfxGain);
      o.start(t); o.stop(t + dur + 0.05);
    },
    blip() { this.tone({ freq: 560 + Math.random() * 220, type: "triangle", dur: 0.035, gain: 0.05, filter: 1800 }); },
    footstep() { this.tone({ freq: 240 + Math.random() * 60, type: "sine", dur: 0.05, gain: 0.035, filter: 900 }); },
    advance() { this.tone({ freq: 340, type: "sine", dur: 0.09, gain: 0.10, slide: -120, filter: 1200 }); },
    choose() { this.tone({ freq: 523, type: "sine", dur: 0.12, gain: 0.14 }); this.tone({ freq: 784, type: "sine", dur: 0.16, gain: 0.12, at: 0.07 }); },
    talk() { this.tone({ freq: 660, type: "sine", dur: 0.1, gain: 0.1 }); this.tone({ freq: 880, type: "sine", dur: 0.12, gain: 0.08, at: 0.06 }); },
    tick() { this.tone({ freq: 980, type: "square", dur: 0.025, gain: 0.045, filter: 2200 }); },
    timeout() { this.tone({ freq: 320, type: "sine", dur: 0.3, gain: 0.12, slide: -140, filter: 1000 }); },
    finish() { [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, type: "sine", dur: 0.5, gain: 0.10, at: i * 0.06, filter: 2600 })); },
    startMusic() {
      this.ensure();
      if (!this.ctx || this.musicTimer) return;
      this.nextNote = this.ctx.currentTime + 0.1; this.step = 0;
      const scale = [220, 261.6, 293.7, 329.6, 392, 440, 523.3];
      const pattern = [0, 2, 4, 6, 4, 2, 3, 1];
      const drone = this.ctx.createOscillator(); const dg = this.ctx.createGain();
      drone.type = "sine"; drone.frequency.value = 110; dg.gain.value = 0.05;
      drone.connect(dg); dg.connect(this.musicGain); drone.start();
      this._drone = drone;
      const schedule = () => {
        if (!this.ctx) return;
        while (this.nextNote < this.ctx.currentTime + 0.4) {
          const f = scale[pattern[this.step % pattern.length]];
          const t = this.nextNote;
          const o = this.ctx.createOscillator(); const g = this.ctx.createGain(); const fl = this.ctx.createBiquadFilter();
          o.type = "triangle"; o.frequency.value = f;
          fl.type = "lowpass"; fl.frequency.value = 1400;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.09, t + 0.06);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
          o.connect(fl); fl.connect(g); g.connect(this.musicGain);
          o.start(t); o.stop(t + 1.0);
          this.nextNote += 0.55; this.step += 1;
        }
      };
      schedule();
      this.musicTimer = setInterval(schedule, 200);
    },
    stopMusic() {
      if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
      if (this._drone) { try { this._drone.stop(); } catch {} this._drone = null; }
    },
  };

  /* ============================ PATHFINDING ============================ */
  function bfs(world, from, to) {
    if (!world.walk(to.x, to.y)) return null;
    const key = (x, y) => x + "," + y;
    const prev = new Map([[key(from.x, from.y), null]]);
    const queue = [from];
    while (queue.length) {
      const c = queue.shift();
      if (c.x === to.x && c.y === to.y) {
        const path = [];
        let k = key(c.x, c.y);
        while (prev.get(k)) { const [px, py] = k.split(",").map(Number); path.unshift({ x: px, y: py }); k = prev.get(k); }
        return path;
      }
      const h0 = world.h[c.y * world.W + c.x];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.x + dx, ny = c.y + dy, nk = key(nx, ny);
        if (prev.has(nk) || !world.walk(nx, ny)) continue;
        if (Math.abs(world.h[ny * world.W + nx] - h0) > (world.maxStep || 1)) continue;
        prev.set(nk, key(c.x, c.y));
        queue.push({ x: nx, y: ny });
      }
    }
    return null;
  }

  /* ============================ SESSION ============================ */
  const HATS = ["cap", "bun", "beanie"];
  const SKINS = ["#f6e7d7", "#e8c8a8", "#c99a72", "#f2d3b3"];

  /* Pre-game context pages: the story setup in words, ≤50 words per page,
     tapped through over the blurred scene before play begins. */
  function chunkWords(text, max) {
    const out = [];
    const count = (s) => s.trim().split(/\s+/).filter(Boolean).length;
    const sentences = String(text || "").match(/[^.!?]+[.!?]*/g) || [];
    let cur = "";
    const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
    for (let s of sentences) {
      s = s.trim(); if (!s) continue;
      while (count(s) > max) {
        push();
        const words = s.split(/\s+/);
        out.push(words.slice(0, max).join(" "));
        s = words.slice(max).join(" ");
      }
      if (count(cur) + count(s) > max) push();
      cur = cur ? cur + " " + s : s;
    }
    push();
    return out;
  }
  function buildContextPages(spec) {
    if (Array.isArray(spec.contextPages) && spec.contextPages.length) return spec.contextPages.map(String);
    const pages = [];
    pages.push(...chunkWords(spec.premise, 50));
    pages.push(...chunkWords(spec.study && spec.study.context, 50));
    pages.push("Tap the ground to walk. Talk to the person with the floating mark — the story moves in order, one person at a time. Answer honestly: your choices are the research data.");
    return pages;
  }

  function open(session, bodyEl, hooks) {
    close();
    const spec = session.d.spec;
    const world = MV.buildWorld(spec);
    const scenes = spec.scenes || [];
    const questions = scenes.filter((sc) => sc.input).length;

    /* per-character conversation queues, in script order */
    const queues = new Map();
    for (const c of spec.characters || []) queues.set(c.id, []);
    for (const sc of scenes) if (queues.has(sc.character)) queues.get(sc.character).push(sc);

    S = {
      session, spec, hooks, body: bodyEl, world, queues,
      pending: scenes.slice(),
      answered: 0, questions, closed: false,
      typing: null, qTimer: null, tickTimer: null, mouth: null, nudgeTimer: null,
      conv: null, beatT0: Date.now(), raf: 0, lastT: 0,
      figures: [], npcs: [], player: null, ripple: null,
      intro: true, introPage: 0, introPages: buildContextPages(spec), talked: false, walked: false,
    };

    bodyEl.classList.add("gp-body-story", "js");
    bodyEl.innerHTML = `
      <div class="mv-root">
        <div class="mv-stage"><canvas id="mv-canvas"></canvas></div>
        <div class="mv-obj" id="mv-obj" hidden></div>
        <div class="mv-hint" id="mv-hint">Tap the ground to walk · tap the glowing person to talk</div>
        <canvas class="mv-portrait" id="mv-portrait" hidden></canvas>
        <div class="mv-panel" id="mv-panel" hidden>
          <div class="mv-name"><b id="mv-name"></b><small id="mv-role"></small></div>
          <div class="mv-timer" id="mv-timer" hidden><i></i></div>
          <div class="mv-scroll" id="mv-scroll">
            <div class="mv-text"><span id="mv-typed"></span><span class="mv-caret" id="mv-caret" hidden>▾</span></div>
            <div class="mv-input" id="mv-input" hidden></div>
          </div>
          <button type="button" class="mv-next" id="mv-next" aria-label="Continue">${arrowSVG()}</button>
        </div>
        <div class="mv-intro" id="mv-intro">
          <span class="mv-intro-kicker">A research story</span>
          <h2>${esc(spec.title || "")}</h2>
          <p id="mv-intro-text">${esc(S.introPages[0] || "")}</p>
          <div class="mv-intro-dots" id="mv-intro-dots">${S.introPages.map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("")}</div>
          <span class="mv-intro-tap" id="mv-intro-tap">${S.introPages.length > 1 ? "Tap to continue" : "Tap to begin"}</span>
        </div>
      </div>`;
    S.canvas = bodyEl.querySelector("#mv-canvas");
    S.renderer = MV.createRenderer(S.canvas, world);
    S.panel = bodyEl.querySelector("#mv-panel");
    S.nameEl = bodyEl.querySelector("#mv-name");
    S.roleEl = bodyEl.querySelector("#mv-role");
    S.typedEl = bodyEl.querySelector("#mv-typed");
    S.caretEl = bodyEl.querySelector("#mv-caret");
    S.inputEl = bodyEl.querySelector("#mv-input");
    S.timerEl = bodyEl.querySelector("#mv-timer");
    S.scrollEl = bodyEl.querySelector("#mv-scroll");
    S.nextBtn = bodyEl.querySelector("#mv-next");
    S.objEl = bodyEl.querySelector("#mv-obj");
    S.hintEl = bodyEl.querySelector("#mv-hint");
    S.introEl = bodyEl.querySelector("#mv-intro");

    /* figures */
    const spawn = world.spawn;
    S.player = {
      id: "player", cx: spawn.x, cy: spawn.y, x: spawn.x, y: spawn.y, z: world.h[spawn.y * world.W + spawn.x] || 0,
      path: [], p: 0, face: 1, walk: 0, moving: false, robe: "#f6f2ea", accent: "#f2a08c", hat: "point", skin: "#f6e7d7", expr: "neutral", marker: false,
    };
    S.figures.push(S.player);
    (spec.characters || []).forEach((c, i) => {
      const zone = world.zones[i % world.zones.length];
      const col = c.colors || {};
      const npc = {
        id: c.id, c, cx: zone.x, cy: zone.y, x: zone.x, y: zone.y, z: world.h[zone.y * world.W + zone.x] || 0,
        path: [], p: 0, face: -1, walk: 0, moving: false,
        robe: col.robe || MV.ACCENTS[i % MV.ACCENTS.length], accent: col.accent || MV.ACCENTS[(i + 2) % MV.ACCENTS.length],
        hat: HATS[i % HATS.length], skin: SKINS[i % SKINS.length], expr: (c.expressions && c.expressions[0]) || "neutral",
        marker: false, markerColor: col.accent || "#f2d49b",
        zone, nextWander: Date.now() + 2500 + i * 1800,
      };
      S.npcs.push(npc); S.figures.push(npc);
    });
    S.portrait = bodyEl.querySelector("#mv-portrait");
    S.pctx = S.portrait.getContext("2d");
    updateActive();

    /* input */
    S.onTap = (e) => {
      Audio.ensure();
      if (S.intro) { introTap(); return; }
      if (S.conv || S.ended) return;
      const r = S.canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      /* NPC hit first */
      let hit = null, hd = 1e9;
      for (const n of S.npcs) {
        const p = S.renderer.tileScreen(n.cx, n.cy);
        const d = Math.hypot(px - p.x, py - (p.y - S.renderer.figH * 0.5));
        if (d < 48 && d < hd) { hit = n; hd = d; }
      }
      if (hit) {
        const act = activeNpc();
        if (act && hit !== act) { nudge(`${hit.c.name} isn't ready yet — talk to ${act.c.name} first`); return; }
        openConv(hit); return;
      }
      const tile = S.renderer.tileAt(px, py);
      if (tile && world.walk(tile.x, tile.y)) {
        const path = bfs(world, { x: S.player.cx, y: S.player.cy }, tile);
        if (path && path.length) {
          S.player.path = path; S.player.p = 0;
          S.ripple = { x: tile.x, y: tile.y, t0: performance.now() };
          S.walked = true; maybeHideHint();
        }
      }
    };
    S.canvas.addEventListener("pointerdown", S.onTap);
    S.onPanelTap = (e) => {
      if (e.target.closest(".mv-input") || e.target.closest("button")) return;
      advance();
    };
    S.panel.addEventListener("pointerdown", S.onPanelTap);
    bodyEl.querySelector("#mv-next").addEventListener("click", (e) => { e.stopPropagation(); advance(); });
    S.onIntroTap = () => { Audio.ensure(); introTap(); };
    S.introEl.addEventListener("pointerdown", S.onIntroTap);

    hooks.progress(0, questions);
    S.lastT = performance.now();
    const loop = (t) => {
      if (!S || S.closed) return;
      const dt = Math.min(0.05, (t - S.lastT) / 1000); S.lastT = t;
      update(dt, t);
      S.renderer.draw({ figures: S.figures, ripple: S.ripple }, t);
      drawPortrait(t);
      S.raf = requestAnimationFrame(loop);
    };
    S.raf = requestAnimationFrame(loop);
  }

  function arrowSVG() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 4.5 19 12 6 19.5 8.4 12Z"/></svg>`;
  }
  function introTap() {
    if (!S || !S.intro) return;
    if (S.introPage < S.introPages.length - 1) {
      S.introPage += 1;
      Audio.advance();
      const p = S.introEl.querySelector("#mv-intro-text");
      p.textContent = S.introPages[S.introPage];
      p.classList.remove("swap"); void p.offsetWidth; p.classList.add("swap");
      S.introEl.querySelectorAll("#mv-intro-dots i").forEach((d, i) => d.classList.toggle("on", i === S.introPage));
      S.introEl.querySelector("#mv-intro-tap").textContent = S.introPage === S.introPages.length - 1 ? "Tap to begin" : "Tap to continue";
      return;
    }
    dismissIntro();
  }
  function dismissIntro() {
    if (!S || !S.intro) return;
    S.intro = false;
    S.introEl.classList.add("is-off");
    setTimeout(() => { if (S && S.introEl) S.introEl.hidden = true; }, 450);
    Audio.ensure(); Audio.startMusic();
  }
  function maybeHideHint() {
    if (S.walked && S.talked && S.hintEl) S.hintEl.classList.add("is-off");
  }
  function nudge(msg) {
    if (!S.hintEl) return;
    Audio.blip();
    S.hintEl.textContent = msg;
    S.hintEl.classList.remove("is-off");
    if (S.nudgeTimer) clearTimeout(S.nudgeTimer);
    S.nudgeTimer = setTimeout(() => {
      if (!S || !S.hintEl) return;
      S.hintEl.textContent = "Tap the ground to walk · tap the glowing person to talk";
      maybeHideHint();
    }, 2400);
  }
  /* Chronological story: exactly one NPC is active at a time — the character
     of the next unconsumed beat in script order. Everyone else is disabled. */
  function activeNpc() {
    const id = S.pending.length ? S.pending[0].character : null;
    return S.npcs.find((n) => n.id === id) || null;
  }
  function consume(sc) {
    const i = S.pending.indexOf(sc);
    if (i >= 0) S.pending.splice(i, 1);
  }
  function updateActive() {
    const act = activeNpc();
    for (const n of S.npcs) n.marker = !!act && n === act;
    if (!S.objEl) return;
    if (act) { S.objEl.hidden = false; S.objEl.textContent = `Talk to ${act.c.name}`; }
    else S.objEl.hidden = true;
  }
  /* after a beat is consumed: continue with the same NPC only while they are
     still the active character; otherwise close so the next person lights up */
  function continueStory() {
    if (!S || S.closed || !S.conv) return;
    const q = S.queues.get(S.conv.npc.id) || [];
    if (!q.length || (S.pending.length && S.pending[0].character !== S.conv.npc.id)) { closeConv(); return; }
    showBeat();
  }

  /* ============================ PORTRAIT ============================
     Large talking version of the NPC, standing on the conversation panel.
     Mouth flaps while the typewriter text runs; expression follows the beat. */
  function showPortrait() {
    const c = S.portrait; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    S.pw = 190; S.ph = 216; S.pdpr = dpr;
    c.width = S.pw * dpr; c.height = S.ph * dpr;
    c.hidden = false;
    requestAnimationFrame(() => { if (S && S.portrait) S.portrait.classList.add("is-on"); });
  }
  function hidePortrait() {
    if (!S.portrait) return;
    S.portrait.classList.remove("is-on");
    setTimeout(() => { if (S && S.portrait && !S.conv) S.portrait.hidden = true; }, 320);
  }
  function drawPortrait(t) {
    if (!S.conv || !S.portrait || S.portrait.hidden) return;
    const npc = S.conv.npc, ctx = S.pctx, w = S.pw, h = S.ph;
    ctx.setTransform(S.pdpr, 0, 0, S.pdpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const s = 4.3;
    ctx.fillStyle = "rgba(43,35,48,.16)";
    ctx.beginPath(); ctx.ellipse(w / 2, h - 5, 34, 8, 0, 0, 7); ctx.fill();
    MV.drawFigure(ctx, w / 2, h - 8, s, {
      robe: npc.robe, accent: npc.accent, hat: npc.hat, skin: npc.skin,
      expr: npc.expr, face: 1, t,
      talking: !!(S.typing && Math.floor(t / 160) % 2 === 0),
    });
  }

  /* ============================ MOVEMENT ============================ */
  function moveEntity(en, dt, speed, t) {
    if (!en.path.length) { en.moving = false; return; }
    const target = en.path[0];
    const h0 = S.world.h[en.cy * S.world.W + en.cx] || 0;
    const h1 = S.world.h[target.y * S.world.W + target.x] || 0;
    en.p += dt * speed;
    if (en.p >= 1) {
      en.cx = target.x; en.cy = target.y; en.x = target.x; en.y = target.y; en.z = h1; en.p = 0;
      en.path.shift();
      if (en === S.player && en.path.length) Audio.footstep();
      if (!en.path.length) en.moving = false;
      return;
    }
    en.moving = true;
    en.x = en.cx + (target.x - en.cx) * en.p;
    en.y = en.cy + (target.y - en.cy) * en.p;
    en.z = h0 + (h1 - h0) * en.p;
    en.walk += dt * speed * 1.6;
    const a = S.world.proj(en.cx + 0.5, en.cy + 0.5, 0), b = S.world.proj(target.x + 0.5, target.y + 0.5, 0);
    if (Math.abs(b.x - a.x) > 0.5) en.face = b.x > a.x ? 1 : -1;
  }
  function update(dt, t) {
    moveEntity(S.player, dt, S.world.moveSpeed || 3.6, t);
    for (const n of S.npcs) {
      const inConv = S.conv && S.conv.npc === n;
      if (!inConv) {
        moveEntity(n, dt, S.world.npcSpeed || 1.5, t);
        if (!n.path.length && Date.now() > n.nextWander && !S.ended) {
          n.nextWander = Date.now() + 6000 + Math.random() * 8000;
          const span = S.world.wanderSpan || 4;
          for (let i = 0; i < 8; i++) {
            const tx = n.zone.x + Math.round((Math.random() - 0.5) * span);
            const ty = n.zone.y + Math.round((Math.random() - 0.5) * span);
            if (S.world.walk(tx, ty) && !(tx === S.player.cx && ty === S.player.cy)) {
              const p = bfs(S.world, { x: n.cx, y: n.cy }, { x: tx, y: ty });
              if (p && p.length && p.length <= (S.world.imageMode ? 14 : 6)) { n.path = p; n.p = 0; break; }
            }
          }
        }
      }
      /* mouth flap while typing */
      n.talking = !!(S.typing && S.conv && S.conv.npc === n && Math.floor(t / 160) % 2 === 0);
    }
    S.player.talking = false;
  }

  /* ============================ CONVERSATION ============================ */
  function openConv(npc) {
    const queue = S.queues.get(npc.id) || [];
    Audio.talk();
    S.talked = true; maybeHideHint();
    /* player strolls over to the character */
    const st = S.world.step || 1;
    const spots = [[st, 0], [-st, 0], [0, st], [0, -st]].map(([dx, dy]) => ({ x: npc.cx + dx, y: npc.cy + dy })).filter((p) => S.world.walk(p.x, p.y));
    if (spots.length) {
      spots.sort((a, b) => (Math.abs(a.x - S.player.cx) + Math.abs(a.y - S.player.cy)) - (Math.abs(b.x - S.player.cx) + Math.abs(b.y - S.player.cy)));
      const p = bfs(S.world, { x: S.player.cx, y: S.player.cy }, spots[0]);
      if (p) { S.player.path = p; S.player.p = 0; }
    }
    npc.path = []; npc.moving = false;
    npc.face = S.player.x < npc.x ? -1 : 1;
    S.conv = { npc, tapOnly: !queue.length };
    S.renderer.setFocus(S.world.proj(npc.x + 0.5, npc.y + 0.5, npc.z));
    S.panel.hidden = false;
    S.nextBtn.hidden = false;
    requestAnimationFrame(() => S.panel.classList.add("is-on"));
    showPortrait();
    S.nameEl.textContent = npc.c.name || "";
    S.roleEl.textContent = npc.c.role || "";
    if (queue.length) showBeat();
    else {
      const lines = (npc.c.tap && npc.c.tap.lines) || ["Good to see you.", "Ha! Hello again.", "The world is better with company."];
      S.conv.line = lines[Math.floor(Math.random() * lines.length)];
      npc.expr = "happy";
      typeText(S.conv.line, () => { S.caretEl.hidden = false; });
      S.hooks.record({ event: "tap", character: npc.id, line: S.conv.line, t_ms: Date.now() - S.session.t0 });
    }
  }
  function closeConv() {
    if (!S.conv) return;
    const npc = S.conv.npc;
    const wasTap = S.conv.tapOnly;
    S.conv = null;
    stopTyping();
    if (S.qTimer) { clearTimeout(S.qTimer); S.qTimer = null; }
    if (S.tickTimer) { clearInterval(S.tickTimer); S.tickTimer = null; }
    S.timerEl.hidden = true;
    S.inputEl.hidden = true; S.inputEl.innerHTML = "";
    S.panel.classList.remove("is-on");
    hidePortrait();
    setTimeout(() => { if (S && !S.conv) S.panel.hidden = true; }, 320);
    S.renderer.setFocus(null);
    npc.expr = (npc.c.expressions && npc.c.expressions[0]) || "neutral";
    npc.nextWander = Date.now() + 3000;
    if (!wasTap) {
      updateActive();
      const remaining = S.npcs.some((n) => (S.queues.get(n.id) || []).length);
      if (!remaining) setTimeout(() => { if (S && !S.closed && !S.conv) endScreen(); }, 650);
    }
  }

  function showBeat() {
    const npc = S.conv.npc;
    const queue = S.queues.get(npc.id);
    if (!queue.length) { closeConv(); return; }
    const sc = queue[0];
    S.beatT0 = Date.now();
    S.conv.scene = sc;
    npc.expr = sc.expression || npc.expr;
    S.inputEl.hidden = true; S.inputEl.innerHTML = "";
    S.timerEl.hidden = true;
    S.nextBtn.hidden = false;
    if (S.tickTimer) { clearInterval(S.tickTimer); S.tickTimer = null; }
    S.caretEl.hidden = true;
    typeText(sc.text || "", () => {
      if (!S || S.closed || !S.conv) return;
      if (sc.input) setTimeout(() => { if (S && !S.closed && S.conv && S.conv.scene === sc) showQuestion(sc); }, 260);
      else S.caretEl.hidden = false;
    });
  }

  function typeText(text, done) {
    stopTyping();
    S.typedEl.textContent = "";
    S.currentText = text; S.typeDone = done;
    if (reduceMotion()) { S.typedEl.textContent = text; done(); return; }
    let n = 0;
    S.typing = setInterval(() => {
      n += 1;
      S.typedEl.textContent = text.slice(0, n);
      if (n % 2 === 0) Audio.blip();
      if (n >= text.length) { stopTyping(); done(); }
    }, 24);
  }
  function stopTyping() { if (S.typing) { clearInterval(S.typing); S.typing = null; } }
  function finishTyping() {
    if (!S.typing) return false;
    stopTyping();
    S.typedEl.textContent = S.currentText;
    const done = S.typeDone; S.typeDone = null;
    if (done) done();
    return true;
  }

  function advance() {
    if (!S || S.closed || !S.conv) return;
    if (finishTyping()) return;
    if (S.conv.tapOnly) { Audio.advance(); closeConv(); return; }
    const sc = S.conv.scene;
    if (!sc || sc.input) return; // questions must be answered, not tapped past
    Audio.advance();
    S.hooks.record({ scene: sc.id, character: sc.character, dialogue: true, ms: Date.now() - S.beatT0 });
    S.queues.get(S.conv.npc.id).shift();
    consume(sc);
    updateActive();
    continueStory();
  }

  /* ============================ QUESTIONS ============================ */
  function showQuestion(sc) {
    const inp = sc.input;
    const limit = inp.timeLimitMs ? Math.max(5000, Math.min(30000, Number(inp.timeLimitMs))) : 0;
    S.qT0 = Date.now();
    if (S.hooks.questionStart) S.hooks.questionStart(sc);
    S.caretEl.hidden = true;
    let html = `<b class="mv-q">${esc(inp.question || "")}</b>`;
    if (inp.type === "choice") {
      html += `<div class="mv-opts">${(inp.options || []).map((o, oi) => `<button type="button" class="mv-opt" data-oi="${oi}">${esc(o)}</button>`).join("")}</div>`;
    } else {
      html += `<div class="mv-textrow"><input class="mv-textinput" id="mv-text" data-text placeholder="${esc(inp.placeholder || "Your answer")}" autocomplete="off" maxlength="400"><button type="button" class="mv-send" id="mv-send" aria-label="Send answer">${arrowSVG()}</button></div>`;
    }
    S.inputEl.innerHTML = html;
    S.inputEl.hidden = false;
    S.nextBtn.hidden = true;
    S.scrollEl.scrollTop = S.scrollEl.scrollHeight;
    const answer = (value, timedOut) => {
      if (S.answeredBeat === sc.id) return;
      S.answeredBeat = sc.id;
      if (S.qTimer) { clearTimeout(S.qTimer); S.qTimer = null; }
      if (S.tickTimer) { clearInterval(S.tickTimer); S.tickTimer = null; }
      S.timerEl.hidden = true;
      S.answered += 1;
      S.hooks.record({
        scene: sc.id, character: sc.character, question: inp.question,
        answer: value, timed_out: !!timedOut, ms: Date.now() - S.qT0,
        ...(timedOut ? { trait: "no-decision" } : {}),
      });
      S.hooks.progress(S.answered, S.questions);
      const next = () => {
        if (!S || S.closed || !S.conv) return;
        /* consume the answered beat from the queue */
        const q = S.queues.get(S.conv.npc.id);
        if (q[0] === sc) { q.shift(); consume(sc); }
        S.conv.scene = null;
        updateActive();
        continueStory();
      };
      if (timedOut) {
        Audio.timeout();
        S.inputEl.innerHTML = `<p class="mv-timeup">Time ran out — the moment passed. That counts too.</p>`;
        setTimeout(next, 1100);
      } else {
        Audio.choose();
        const btn = S.inputEl.querySelector(`.mv-opt[data-oi="${CSS.escape(String(S.chosenOi))}"]`);
        if (btn) btn.classList.add("is-chosen");
        S.inputEl.querySelectorAll(".mv-opt,.mv-send").forEach((b) => { b.disabled = true; });
        setTimeout(next, 380);
      }
    };
    if (inp.type === "choice") {
      S.inputEl.querySelectorAll(".mv-opt").forEach((b) => b.addEventListener("click", () => {
        S.chosenOi = Number(b.dataset.oi);
        answer(inp.options[S.chosenOi], false);
      }));
    } else {
      const field = S.inputEl.querySelector("#mv-text");
      const send = () => {
        const v = field.value.trim();
        if (!v) { field.focus(); field.classList.add("is-empty"); setTimeout(() => field.classList.remove("is-empty"), 500); return; }
        answer(v, false);
      };
      S.inputEl.querySelector("#mv-send").addEventListener("click", send);
      field.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
      setTimeout(() => field.focus({ preventScroll: true }), 80);
    }
    if (limit) {
      S.timerEl.hidden = false;
      const bar = S.timerEl.querySelector("i");
      bar.style.animation = "none";
      void bar.offsetWidth;
      bar.style.animation = `mv-countdown ${limit}ms linear forwards`;
      S.qTimer = setTimeout(() => answer(null, true), limit);
      S.tickTimer = setInterval(() => {
        const remain = limit - (Date.now() - S.qT0);
        if (remain > 0 && remain < 5000) Audio.tick();
      }, 1000);
    }
  }

  /* ============================ END ============================ */
  function endScreen() {
    if (S.ended) return;
    S.ended = true;
    Audio.finish();
    S.hooks.progress(S.answered, S.questions);
    const d = S.session.d;
    const btnLabel = S.session.finishLabel || (d.preview ? "Finish playtest" : S.session.replay ? "Finish replay · no reward" : "Finish");
    S.body.innerHTML = `
      <div class="gp-end mv-end">
        <div class="milestone-disc"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m4.8 12.6 4.6 4.6L19.2 7"/></svg></div>
        <h2>${esc(S.spec.title || "The end")}</h2>
        <p>${esc(S.spec.closing || "That is the whole story. Your answers go straight to the researcher.")}</p>
        <button class="btn btn-ink btn-wide" data-act="gp-finish">${btnLabel}</button>
      </div>`;
  }

  function close() {
    if (!S) return;
    S.closed = true;
    cancelAnimationFrame(S.raf);
    stopTyping();
    if (S.qTimer) clearTimeout(S.qTimer);
    if (S.tickTimer) clearInterval(S.tickTimer);
    if (S.nudgeTimer) clearTimeout(S.nudgeTimer);
    if (S.canvas) S.canvas.removeEventListener("pointerdown", S.onTap);
    if (S.renderer) S.renderer.destroy();
    if (S.body) S.body.classList.remove("gp-body-story", "js");
    Audio.stopMusic();
    S = null;
  }

  window.StoryPlayer = {
    open, close, isOpen: () => !!S,
    toggleAudio() { Audio.ensure(); Audio.setMuted(!Audio.muted); return Audio.muted; },
    isMuted: () => Audio.muted,
  };
})();