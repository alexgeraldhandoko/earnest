/* EARNest v2.1 · specimen light · full-stack: reels feed, auth, wallet, payments */
"use strict";

/* ---------- state (populated from /api/bootstrap) ---------- */
let me = { name: "", initials: "E", photo: null };
let researchers = {}, papers = {}, studies = [], discoveries = [], impact = [];
const state = {
  user: null,
  wallet: 0,
  streakDay: 0,
  multiplier: { active: false, left: 0 },
  researcherMode: false,
  follows: {},
  hearts: {},
  reposts: {},
  answered: {},
  unlockedPapers: {},
  reelIndex: 0,
  completed: [],
  methods: [],
  withdrawals: [],
  ledger: [],
  settings: { autoplay: 1, streak_reminders: 1 },
  oauth: { google: { configured: false }, apple: { configured: false } },
  withdrawRules: { min_cents: 1000, fee_rate: 0.02, min_fee_cents: 25 },
  feedTab: "gold",
  feedPositions: { gold: 0, discover: 0 },
  sound: true,
  preferences: null,
  feedLoading: false,
};

/* ---------- api client ---------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
    keepalive: path === "/api/events",
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { status: res.status });
  return data;
}
/* Tab speed: warm in-memory cache for tab payloads. Views paint instantly
   from cache, then revalidate in the background (stale-while-revalidate). */
const apiCache = new Map();
function prefetchTabs() {
  for (const p of ["/api/games", "/api/search?q="]) {
    api(p).then((d) => apiCache.set(p, d)).catch(() => {});
  }
}
function applyWallet(d) {
  if (typeof d.wallet_cents === "number") state.wallet = d.wallet_cents / 100;
  if (typeof d.streak_day === "number") state.streakDay = d.streak_day;
  if (typeof d.multiplier_left === "number") state.multiplier = { active: d.multiplier_left > 0, left: d.multiplier_left };
  if (d.completed) state.completed = d.completed;
  if (d.answered) state.answered = d.answered;
  if (d.methods) state.methods = d.methods;
  if (d.withdrawals) state.withdrawals = d.withdrawals;
  if (d.ledger) state.ledger = d.ledger;
}
function applyBootstrap(d) {
  state.user = d.user;
  me = { name: d.user.name, initials: d.user.initials || "E", photo: d.user.photo };
  researchers = d.researchers; papers = d.papers; studies = d.studies; discoveries = d.discoveries; impact = d.impact;
  state.follows = d.follows; state.hearts = d.hearts; state.reposts = d.reposts || {};
  state.answered = d.answered; state.unlockedPapers = d.unlocked;
  state.completed = d.completed; state.methods = d.methods; state.withdrawals = d.withdrawals; state.ledger = d.ledger;
  state.settings = d.settings; state.oauth = d.oauth; state.withdrawRules = d.withdraw;
  state.config = d.config;
  state.preferences = d.preferences || null;
  state.researcherMode = d.user.researcher_mode;
  applyWallet(d);
  prefetchTabs();
}
async function refreshWallet() { applyWallet(await api("/api/wallet")); }

/* ---------- utils ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const icon = (id, cls = "") => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => `$${n.toFixed(2)}`;
function photoAvatar(p, cls = "") {
  return p && p.photo
    ? `<img class="avatar-img ${cls}" src="${p.photo}" alt="Portrait of ${esc(p.name || "profile")}" loading="lazy" decoding="async">`
    : `<span class="avatar ${cls}" aria-hidden="true">${p && p.initials ? p.initials : "E"}</span>`;
}

function toast(msg, earn = false) {
  const wrap = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `${icon(earn ? "bolt" : "check", earn ? "" : "i-check")}<span>${esc(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => { el.classList.add("toast-out"); setTimeout(() => el.remove(), 300); }, 2800);
}

let modalCleanup = null;
function openModal(html, opts = {}) {
  const root = $("#modal-root");
  closeModal();
  root.hidden = false;
  root.className = `modal-root${opts.sheet ? " sheet-backdrop" : ""}`;
  root.innerHTML = `<div class="modal${opts.sheet ? " bottom-sheet" : ""}${opts.cls ? " " + opts.cls : ""}" role="dialog" aria-modal="true">${html}</div>`;
  const onKey = (e) => { if (e.key === "Escape") closeModal(); };
  root.addEventListener("click", (e) => { if (e.target === root) closeModal(); });
  document.addEventListener("keydown", onKey);
  const f = root.querySelector("button, input, textarea");
  if (f) f.focus();
  modalCleanup = () => { document.removeEventListener("keydown", onKey); modalCleanup = null; };
  return root;
}
function closeModal() {
  const root = $("#modal-root");
  if (!root.hidden) { root.hidden = true; root.innerHTML = ""; }
  if (modalCleanup) modalCleanup();
}

/* ---------- router ---------- */
const routes = {};
let navDirection = "none";   // push | back | tab | none
let routeSerial = 0;
const routePositions = new Map();
function routeState(trail) { return { earnest: { id: `${Date.now()}-${++routeSerial}`, trail } }; }
function go(hash) {
  if (location.hash === hash) return;
  navDirection = "push";
  history.pushState(routeState([...navStack, hash]), "", hash);
  render();
}
function switchTab(hash) {
  navDirection = "tab";
  history.replaceState(routeState([hash]), "", hash);
  render();
}
function back() {
  if (swipeBusy && !popAnim) return;
  if (navStack.length > 1) { navDirection = "back"; history.back(); }
  else switchTab(`#/${routes[$("#screen").dataset.view]?.tab || "feed"}`);
}

const AUTH_ROUTES = ["welcome", "login", "register"];
let renderSeq = 0;
let feedKeep = null; // kept-alive feed DOM + reel handle, so tab switches never re-buffer videos
let navStack = [];      // hash trail of pushed pages; tab switches reset it
let underlays = [];     // detached page snapshots, one per navStack level below the top
let popAnim = false;    // an interactive swipe already animated the pop — land instantly
let swipe = null;       // live swipe-back gesture
let swipeEpoch = 0;
let swipeBusy = false;  // settle spring running — no new gesture until it lands
async function render() {
  const seq = ++renderSeq;
  const hash = location.hash || "#/feed";
  const parts = hash.slice(2).split("/").filter(Boolean);
  const name = parts[0] || "feed";
  params = parts.slice(1);
  if (!state.user && !AUTH_ROUTES.includes(name)) { location.hash = "#/welcome"; return; }
  if (state.user && AUTH_ROUTES.includes(name)) { location.hash = "#/feed"; return; }
  if (state.user && !state.preferences && name !== "onboarding") { location.hash = "#/onboarding"; return; }
  const key = routes[name] ? name : (routes[name + "/:id"] ? name + "/:id" : "feed");
  const view = routes[key] || routes.feed;
  let screen = $("#screen");
  if (screen._routeId) {
    routePositions.set(screen._routeId, { scroll: screen.scrollTop, reelIndex: state.reelIndex, feedTab: state.feedTab });
    if (routePositions.size > 100) routePositions.delete(routePositions.keys().next().value);
  }
  let entry = history.state?.earnest;
  if (!entry || entry.trail[entry.trail.length - 1] !== hash) {
    history.replaceState(routeState([hash]), "", hash);
    entry = history.state.earnest;
  }
  const restore = routePositions.get(entry.id);
  const dir = navDirection; navDirection = "none";
  /* swipe-back bookkeeping: a repaint mid-gesture aborts it; the trail tells
     us whether a pop is possible and which page waits underneath */
  if (swipe || (swipeBusy && !popAnim)) { swipe = null; resetSwipeLayers(); }
  if (popAnim && dir !== "back") { popAnim = false; resetSwipeLayers(); }
  if (dir === "back") {
    if (!popAnim) while (underlays.length > Math.max(0, entry.trail.length - 1)) discardUnderlay();
  } else if (dir === "tab" || (dir === "none" && navStack[navStack.length - 1] !== hash)) {
    clearUnderlays();
  }
  navStack = entry.trail.slice();
  if (dir === "back" && restore && key === "feed") {
    state.reelIndex = restore.reelIndex;
    state.feedTab = restore.feedTab;
  }
  const prevKey = screen.dataset.view || "";
  const hadChildren = screen.children.length > 0;

  /* Instant tab feedback: highlight the destination tab before any data loads. */
  const navTab = view.tab || (["play", "search", "feed", "impact", "profile"].includes(name) ? name : null);
  document.querySelectorAll(".tab").forEach((t) => {
    if (t.dataset.nav === navTab) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  /* the Games tab carries its own black, futuristic surface — tabbar follows */
  const tabbar = document.querySelector(".tabbar");
  if (tabbar) tabbar.classList.toggle("tabbar-dark", navTab === "play");
  /* Games scenes run full-bleed under the status bar (no white band). */
  $("#device").classList.toggle("play-mode", navTab === "play");

  /* Feed keep-alive: dropping the reel DOM on every tab switch forced videos
     to re-buffer and re-decode on return — the main source of tab lag. Instead
     detach the feed (videos paused, scroll + header state intact) and reattach
     it when the feed tab is opened again. Invalidated when the feed tab or its
     data changes (pull-to-refresh, gold/discover switch, re-login). */
  if (feedKeep && (!state.user || feedKeep.tab !== state.feedTab || feedKeep.items !== feedItems())) {
    feedKeep.handle(); feedKeep = null;
  }
  if (key === "feed" && feedKeep) {
    teardownReels();
    screen.innerHTML = "";
    while (feedKeep.holder.firstChild) screen.appendChild(feedKeep.holder.firstChild);
    reelTeardown = feedKeep.handle;
    feedKeep = null;
    screen.dataset.view = key;
    screen._routeId = entry.id;
    screen.scrollTop = 0;
    screen.style.overflowY = "hidden";
    document.body.classList.toggle("authed", !!state.user);
    reelTeardown.resume();
    if (modalCleanup) closeModal();
    return;
  }
  if (prevKey === "feed" && key !== "feed" && dir === "tab" && reelTeardown && reelTeardown.suspend) {
    /* suspend BEFORE detaching: a detached element's scrollTop resets to 0,
       so the scroll offset must be captured while the strip is still live. */
    reelTeardown.suspend();
    const holder = document.createElement("div");
    while (screen.firstChild) holder.appendChild(screen.firstChild);
    feedKeep = { holder, handle: reelTeardown, tab: state.feedTab, items: feedItems() };
    reelTeardown = null;
  }
  /* Tab switches wipe the outgoing view: release its media first. Detached
     <video> elements can keep downloading on iOS, and a search grid full of
     live loaders was saturating the media engine and freezing tab taps. */
  if (dir === "tab") {
    screen.querySelectorAll("video").forEach((v) => { v.pause(); if (v.getAttribute("src")) { v.removeAttribute("src"); v.load(); } });
  }
  closeViewer();
  if (screen._stopPoll) screen._stopPoll();
  teardownReels();
  screen.querySelectorAll(".nav-ghost").forEach((g) => { g.remove(); g.className = "swipe-under"; });
  screen.dataset.view = key;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animate = dir !== "none" && !reduceMotion && hadChildren && !popAnim;
  /* freeze the outgoing page as a ghost layer so the new one can slide over it.
     On a push the ghost also becomes the swipe-back underlay, so it is captured
     even when motion is reduced (the gesture itself is finger-driven). */
  let ghost = null;
  if (hadChildren && (dir === "push" || (animate && dir === "back"))) {
    ghost = document.createElement("div");
    ghost._scroll = screen.scrollTop;
    const liveStrip = screen.querySelector(".reels");
    ghost._stripScroll = liveStrip ? liveStrip.scrollTop : 0;
    while (screen.firstChild) ghost.appendChild(screen.firstChild);
    ghost.querySelectorAll("video").forEach((v) => v.pause());
    if (dir === "push") underlays.push(ghost);
  }
  /* Each async view owns its screen. A late response can only paint its
     detached element after navigation, never overwrite the current page. */
  const nextScreen = screen.cloneNode(false);
  screen.replaceWith(nextScreen);
  screen = nextScreen;
  screen._routeId = entry.id;
  screen.style.transform = ""; screen.style.transition = ""; screen.style.zIndex = "";
  screen.classList.remove("swiping");
  screen.scrollTop = 0;
  screen.style.overflowY = key === "feed" ? "hidden" : "auto";
  document.body.classList.toggle("authed", !!state.user);
  await view(screen, ...params);
  if (seq !== renderSeq) return; // a newer navigation took over while this view loaded
  if (dir === "back" && restore) screen.scrollTop = restore.scroll;
  if (popAnim) {
    /* the interactive swipe already carried the old page out and revealed the
       previous one — land the re-rendered page instantly, drop the snapshot */
    popAnim = false;
    swipeBusy = false;
    resetSwipeLayers();
    while (underlays.length > Math.max(0, navStack.length - 1)) discardUnderlay();
  }
  if (ghost && !animate) {
    /* reduced-motion push: no slide, but keep the snapshot for swipe-back */
    ghost.className = "swipe-under";
  }
  if (animate) {
    const cls = dir === "tab" ? "view-tab" : dir === "back" ? "view-back" : "view-enter";
    [...screen.children].forEach((el) => {
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      /* raise plain content above the ghost, but never demote elements that
         carry their own layer (e.g. the feed controls at --z-sticky) */
      const z = getComputedStyle(el).zIndex;
      if (z === "auto" || Number(z) < 2) el.style.zIndex = "2";
      el.classList.add(cls);
    });
    if (ghost) {
      ghost.className = "nav-ghost " + (dir === "back" ? "ghost-back" : "ghost-push");
      screen.appendChild(ghost);
      ghost.scrollTop = ghost._scroll;
      const gs = ghost.querySelector(".reels");
      if (gs) gs.scrollTop = ghost._stripScroll;
      /* flush layout so the ghost's transition starts on the same frame as the
         incoming view's animation — the two screens tile edge-to-edge */
      ghost.getBoundingClientRect();
      ghost.classList.add("go");
      setTimeout(() => {
        if (dir === "push" && seq === renderSeq) {
          /* keep the outgoing page as the swipe-back underlay: paused videos
             hold their last frame, and the snapshot stays detached until a
             gesture reveals it */
          ghost.querySelectorAll("video").forEach((v) => v.pause());
          ghost.remove();
          ghost.className = "swipe-under";

        } else {
          /* the ghost kept its last frame for the slide; now free its media too */
          ghost.querySelectorAll("video").forEach((v) => { v.pause(); if (v.getAttribute("src")) { v.removeAttribute("src"); v.load(); } });
          ghost.remove();
        }
      }, 380);
    }
  }
  const glowView = screen.querySelector(".view[data-glow]");
  const device = $("#device");
  if (device) device.dataset.glow = glowView ? glowView.dataset.glow : "blue";
  if (modalCleanup) closeModal();
}
let params = [];

/* ---------- interactive swipe-back (Instagram-style pop) ----------
   Drag right on a pushed page or the reel viewer: the top layer tracks the
   finger 1:1 — stop moving and it stops. The previous page waits underneath
   at a parallax offset, its dim lifting as you drag so it fades in. Release
   past the threshold (or a fast flick) springs the pop home; a short drag
   springs back. Transform + opacity only, no layout animation. */
function topUnderlay() { return underlays[underlays.length - 1] || null; }
function releaseUnderlay(u) {
  if (!u) return;
  u.querySelectorAll("video").forEach((v) => { v.pause(); if (v.getAttribute("src")) { v.removeAttribute("src"); v.load(); } });
  u.remove();
}
function discardUnderlay() { releaseUnderlay(underlays.pop()); }
function clearUnderlays() { while (underlays.length) releaseUnderlay(underlays.pop()); }
function resetSwipeLayers() {
  swipeEpoch++; swipeBusy = false;
  const screen = $("#screen");
  screen.style.transform = ""; screen.style.transition = ""; screen.style.zIndex = "";
  screen.classList.remove("swiping");
  const viewer = document.querySelector(".reel-viewer");
  if (viewer) { viewer.style.transform = ""; viewer.style.transition = ""; viewer.classList.remove("swiping"); }
  document.querySelectorAll(".device > .swipe-dim").forEach((d) => d.remove());
  const u = topUnderlay();
  if (u) { u.style.transform = ""; u.style.transition = ""; u.remove(); }
}
function swipeTarget() {
  if (!$("#modal-root").hidden) return null;                    // modal or sheet open
  if (document.querySelector(".game-player, .answer-sheet")) return null;
  const viewer = document.querySelector(".reel-viewer");
  if (viewer) return { mode: "viewer", layer: viewer };
  /* one snapshot per level below the top — a push still animating has not
     stored its snapshot yet, so the gesture waits until the trail is complete */
  if (navStack.length > 1 && underlays.length === navStack.length - 1 && !topUnderlay().isConnected) return { mode: "page", layer: $("#screen") };
  return null;
}
function applySwipe(s, p) {
  s.layer.style.transform = `translateX(${p * s.width}px)`;
  s.under.style.transform = `translateX(${-(1 - p) * 0.28 * s.width}px)`;
  s.dim.style.opacity = String((1 - p) * 0.22);
}
function engageSwipe(s) {
  s.engaged = true;
  s.width = $("#device").clientWidth || 1;
  const device = $("#device");
  if (s.mode === "page") {
    s.under = topUnderlay();
    device.insertBefore(s.under, device.firstChild);
    s.under.scrollTop = s.under._scroll || 0;
    const gs = s.under.querySelector(".reels");
    if (gs) gs.scrollTop = s.under._stripScroll || 0;
  } else {
    s.under = $("#screen"); // the live page under the viewer — no snapshot needed
  }
  s.dim = document.createElement("div");
  s.dim.className = "swipe-dim";
  device.appendChild(s.dim);
  s.layer.classList.add("swiping");
  applySwipe(s, 0);
}
function settleSwipe(s, complete) {
  const epoch = ++swipeEpoch;
  swipeBusy = true;
  const ease = "transform 300ms var(--ease-out), opacity 300ms var(--ease-out)";
  s.layer.style.transition = ease;
  s.under.style.transition = ease;
  s.dim.style.transition = "opacity 300ms var(--ease-out)";
  requestAnimationFrame(() => {
    if (epoch !== swipeEpoch) return;
    s.layer.style.transform = complete ? `translateX(${s.width}px)` : "translateX(0px)";
    s.under.style.transform = complete ? "translateX(0px)" : `translateX(${-0.28 * s.width}px)`;
    s.dim.style.opacity = complete ? "0" : "0.22";
  });
  setTimeout(() => {
    if (epoch !== swipeEpoch) return;
    if (complete && s.mode === "page") {
      /* the slide already happened — render() lands the previous page without
         re-animating and clears the layers once the new view has painted */
      popAnim = true;
      back();
      return;
    }
    swipeBusy = false;
    resetSwipeLayers();
    if (complete && s.mode === "viewer") closeViewer();
  }, 320);
}
function endSwipe(cancelled) {
  const s = swipe;
  if (!s) return;
  swipe = null;
  if (!s.engaged) return;
  const p = s.dx / s.width;
  let v = 0;
  const now = performance.now();
  const recent = s.samples.filter(([, t]) => now - t < 120);
  if (recent.length >= 2) {
    const [x1, t1] = recent[0];
    const [x2, t2] = recent[recent.length - 1];
    if (t2 > t1) v = (x2 - x1) / (t2 - t1);
  }
  settleSwipe(s, !cancelled && (p > 0.35 || (v > 0.45 && p > 0.06)));
}
{
  const device = $("#device");
  device.addEventListener("touchstart", (e) => {
    if (swipeBusy || swipe || e.touches.length !== 1) return;
    if (e.target.closest("input, textarea, select, button, a, [role=button]")) return;
    const target = swipeTarget();
    if (!target) return;
    const t = e.touches[0];
    if (t.clientX - device.getBoundingClientRect().left > 32) return;
    // Claim the edge so Safari cannot also perform a native history pop.
    if (e.cancelable) e.preventDefault();
    swipe = Object.assign(target, { x0: t.clientX, y0: t.clientY, engaged: false, dead: false, dx: 0, samples: [[t.clientX, performance.now()]] });
  }, { passive: false });
  device.addEventListener("touchmove", (e) => {
    const s = swipe;
    if (!s || s.dead) return;
    if (e.touches.length !== 1) { endSwipe(true); return; }
    const t = e.touches[0];
    const dx = t.clientX - s.x0, dy = t.clientY - s.y0;
    if (!s.engaged) {
      /* vertical intent wins: hand the gesture back to the scroll engine */
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { s.dead = true; return; }
      if (dx > 14 && dx > Math.abs(dy) * 1.4) engageSwipe(s);
      else return;
    }
    e.preventDefault();
    s.dx = Math.max(0, Math.min(dx, s.width));
    applySwipe(s, s.dx / s.width);
    s.samples.push([t.clientX, performance.now()]);
    if (s.samples.length > 8) s.samples.shift();
  }, { passive: false });
  device.addEventListener("touchend", () => endSwipe(false));
  device.addEventListener("touchcancel", () => endSwipe(true));
}

/* ---------- reels engine ------------------------------------ */
let reelObserver = null;
let gridObs = null;
/* First-frame posters captured from clips once they decode (same-origin), so
   revisits and prefetch-warmed neighbours show a real still instantly under
   the loading circle instead of a blank stage. */
const posterCache = new Map(); // video url -> dataURL
function teardownReels() {
  if (reelTeardown) { reelTeardown(); reelTeardown = null; }
  if (reelObserver) { reelObserver.disconnect(); reelObserver = null; }
  if (gridObs) { gridObs.disconnect(); gridObs = null; }
}

function feedItems() {
  return (state.feedTab === "discover" ? discoveries : studies);
}

function reelShell(item, i) {
  return `<article class="reel" data-genre="${esc(item.genre)}" data-id="${esc(item.id)}" data-i="${i}" aria-label="Reel ${i + 1}"><div class="reel-inner"></div></article>`;
}
function playReel(video) {
  video.play().catch((error) => {
    // Browsers may require a gesture before audible autoplay. Keep the
    // session preference and retry sound on the next interaction.
    if (error.name === "NotAllowedError" && state.sound && video.closest(".reel.live")) {
      video.muted = true;
      video.play().catch(() => {});
    }
  });
}
function mountReels(strip, items, startIdx, options = {}) {
  let liveIdx = -1, liveSince = 0, disposed = false, suspended = false;
  let loading = false, retryTimer = null;
  const status = strip.parentElement.querySelector(".feed-status");
  const showStatus = (message) => {
    if (!status) return;
    status.hidden = !message;
    status.querySelector("span").textContent = message;
  };
  const loadMore = async () => {
    if (!options.loadMore || loading || disposed || suspended) return;
    clearTimeout(retryTimer);
    loading = true;
    showStatus("Finding more posts…");
    try {
      const batch = await options.loadMore(items.map((it) => it.id));
      if (disposed || suspended) return;
      const ids = new Set(items.map((it) => it.id));
      const fresh = batch.filter((it) => !ids.has(it.id) && ids.add(it.id));
      // Keep 30 previous cards and a maximum of 90 metadata/DOM entries.
      const trim = items.length + fresh.length > 90 ? Math.max(0, liveIdx - 30) : 0;
      if (trim) {
        reportDwell(liveIdx);
        const offset = strip.scrollTop;
        for (let i = 0; i < trim; i++) { observer.unobserve(strip.firstElementChild); strip.firstElementChild.remove(); }
        items.splice(0, trim); liveIdx -= trim;
        strip.scrollTop = Math.max(0, offset - trim * strip.clientHeight);
      }
      const offset = items.length;
      items.push(...fresh);
      strip.insertAdjacentHTML("beforeend", fresh.map((it, i) => reelShell(it, offset + i)).join(""));
      urlIndex.clear();
      items.forEach((it, i) => { if (it.video) urlIndex.set(resolved(it), i); });
      [...strip.children].forEach((r, i) => {
        r.dataset.i = i; r.setAttribute("aria-label", `Reel ${i + 1}`); observer.observe(r);
      });
      if (fresh.length) {
        showStatus(""); pf.lastIdx = -1;
        if (!suspended) {
          const idx = Math.max(0, liveIdx);
          fillNeighborhood(idx);
          if (strip.children[idx]) setLive(strip.children[idx]);
        }
      } else {
        showStatus("You're up to date. Checking for fresh posts…");
      }
      if (strip.id === "reels") state.reelIndex = Math.max(0, liveIdx);
    } catch {
      if (!disposed) showStatus("Couldn't load more posts. Tap to retry.");
    } finally {
      loading = false;
      if (!disposed && !suspended && liveIdx >= items.length - 6) retryTimer = setTimeout(loadMore, 30000);
    }
  };
  if (status) status.addEventListener("click", loadMore);
  /* Instagram-style clip prefetch: previous 5 + next 5 clips are downloaded
     as real bytes into in-memory Blob URLs, and the <video> nodes play
     straight from memory. iOS WebKit's media loader does NOT reuse the HTTP
     cache a background fetch() fills (it issues its own Range requests), so
     cache-warming alone still re-downloaded every clip on swipe. Blobs bypass
     the network entirely: a warmed reel starts with zero spinner. ONE fetch
     at a time (nearest neighbours first, alternating ahead/behind) yields
     bandwidth to the live clip; a swipe RE-PRIORITISES the queue but never
     aborts the download already in flight, so normal-speed scrolling still
     fills the window (at 2 it queues 3…7, skipping what is already stored).
     Blobs outside the ±5 window are revoked to cap RAM. */
  const blobStore = new Map(); // resolved clip url -> { objUrl, bytes }
  const BLOB_MAX_BYTES = 64 * 1024 * 1024;
  const urlIndex = new Map(); // resolved clip url -> feed index
  items.forEach((it, i) => { if (it.video) urlIndex.set(new URL(it.video, location.href).href, i); });
  const resolved = (it) => new URL(it.video, location.href).href;
  const srcFor = (it) => { const b = blobStore.get(resolved(it)); return b ? b.objUrl : resolved(it); };
  const pf = { ctrl: null, queue: [], running: false, inflight: null, token: 0, lastIdx: -1 };
  const abortPrefetch = () => { pf.token++; if (pf.ctrl) { pf.ctrl.abort(); pf.ctrl = null; } pf.queue.length = 0; pf.running = false; pf.inflight = null; };
  const revokeBlob = (url) => {
    const b = blobStore.get(url); if (!b) return;
    /* a pool node may still point at this blob — fall back to the network url */
    for (const n of videoPool) { if (n.getAttribute("src") === b.objUrl) n.src = url; }
    URL.revokeObjectURL(b.objUrl);
    blobStore.delete(url);
  };
  const evictBlobs = (idx) => {
    const keep = new Set();
    for (let d = -5; d <= 5; d++) { const it = items[idx + d]; if (it && it.video) keep.add(resolved(it)); }
    const dist = (u) => { const i = urlIndex.get(u); return i == null ? 9999 : Math.abs(i - idx); };
    for (const u of [...blobStore.keys()].filter((u) => !keep.has(u)).sort((a, b) => dist(b) - dist(a))) revokeBlob(u);
    let total = 0; for (const b of blobStore.values()) total += b.bytes;
    while (total > BLOB_MAX_BYTES && blobStore.size) {
      const far = [...blobStore.keys()].sort((a, b) => dist(b) - dist(a))[0];
      total -= blobStore.get(far).bytes;
      revokeBlob(far);
    }
  };
  /* point any pool node bound to this clip at the in-memory copy */
  const applyBlob = (url) => {
    const b = blobStore.get(url); if (!b) return;
    for (const n of videoPool) {
      if (n.dataset.srcUrl !== url || n.getAttribute("src") === b.objUrl) continue;
      const isLive = !!(n.closest(".reel") && n.closest(".reel").classList.contains("live"));
      if (isLive && n.readyState >= 3) continue; // already playing fine — don't restart it
      const t = n.currentTime || 0;
      n.src = b.objUrl;
      if (t > 0.35) n.addEventListener("loadedmetadata", () => { try { n.currentTime = t; } catch {} }, { once: true });
      if (isLive) n.play().catch(() => {});
    }
  };
  const pumpPrefetch = () => {
    if (pf.running || !pf.queue.length) return;
    const url = pf.queue.shift();
    if (blobStore.has(url)) { pumpPrefetch(); return; }
    const ctrl = new AbortController();
    pf.ctrl = ctrl; pf.running = true; pf.inflight = url;
    fetch(url, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) return;
        if (Number(r.headers.get("content-length")) > BLOB_MAX_BYTES) { ctrl.abort(); return; }
        // Limit the in-flight download as well as retained blobs.
        const reader = r.body.getReader(), chunks = [];
        let bytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > BLOB_MAX_BYTES) { await reader.cancel(); return; }
          chunks.push(value);
        }
        const blob = new Blob(chunks, { type: r.headers.get("content-type") || "video/mp4" }); // clips are ~1–2MB — safe to hold whole
        if (ctrl.signal.aborted) return;
        blobStore.set(url, { objUrl: URL.createObjectURL(blob), bytes: blob.size });
        evictBlobs(Math.max(0, liveIdx));
        applyBlob(url);
      })
      .catch(() => {})
      .finally(() => { if (pf.ctrl === ctrl) { pf.ctrl = null; pf.running = false; pf.inflight = null; pumpPrefetch(); } });
  };
  const schedulePrefetch = (idx) => {
    if (idx === pf.lastIdx) return;
    pf.lastIdx = idx;
    const token = ++pf.token;
    const start = () => {
      if (token !== pf.token || disposed || suspended) return;
      evictBlobs(idx);
      const q = [];
      for (let d = 1; d <= 5; d++) {
        for (const j of [idx + d, idx - d]) {
          const it = items[j];
          if (!it || !it.video) continue;
          /* clips are stored relative ("videos/…") locally and absolute in the
             cloud — resolve both so the warmed URL matches the <video> request */
          const url = resolved(it);
          if (!/^https?:/.test(url) || blobStore.has(url) || url === pf.inflight || q.includes(url)) continue;
          q.push(url);
        }
      }
      pf.queue = q; // re-prioritise only — the in-flight download keeps running
      pumpPrefetch();
    };
    const live = strip.children[idx] && strip.children[idx].querySelector("video");
    if (!live || live.readyState >= 3) { start(); return; }
    const t = setTimeout(start, 1200);
    live.addEventListener("canplay", () => { clearTimeout(t); start(); }, { once: true });
  };
  /* Reusable video pool: a fixed set of <video> nodes whose src is swapped as
     the window moves. Creating/destroying a <video> per swipe exhausts iOS
     WebKit's media element pool — after a fast fling, new clips never decode a
     frame (blank stage). Reusing ≤4 nodes keeps playback alive at any scroll
     speed; a node keeps its buffer when detached, so returning is instant. */
  const videoPool = []; // persistent <video> nodes, reused by swapping src
  const POOL_MAX = 4;
  const capturePoster = (v) => {
    try {
      const url = v.dataset.srcUrl;
      if (!url || posterCache.has(url) || !v.videoWidth) return;
      const c = document.createElement("canvas");
      const w = 360, h = Math.max(1, Math.round(w * v.videoHeight / v.videoWidth));
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(v, 0, 0, w, h);
      posterCache.set(url, c.toDataURL("image/jpeg", 0.6));
      while (posterCache.size > 40) posterCache.delete(posterCache.keys().next().value);
    } catch {}
  };
  const wireVideo = (v) => {
    const stageOf = () => v.closest(".stage");
    v.addEventListener("waiting", () => { const s = stageOf(); if (s) s.classList.add("buffering"); });
    v.addEventListener("canplay", () => { const s = stageOf(); if (s) s.classList.remove("buffering"); });
    v.addEventListener("loadeddata", () => { v.dataset.errTries = "0"; capturePoster(v); const s = stageOf(); if (s) s.classList.add("has-frame"); });
    v.addEventListener("playing", () => { capturePoster(v); const s = stageOf(); if (s) { s.classList.remove("buffering"); s.classList.add("has-frame"); } });
    v.addEventListener("error", () => {
      const s = stageOf(); if (s) s.classList.remove("buffering");
      /* transient clip-host miss (cold cache): retry a few times with backoff
         so a reel never stays a dead stage — prefer the blob if it landed */
      const tries = +(v.dataset.errTries || 0);
      if (tries < 3 && v.dataset.srcUrl && !(v.getAttribute("src") || "").startsWith("blob:")) {
        v.dataset.errTries = String(tries + 1);
        setTimeout(() => {
          if (!videoPool.includes(v)) return;
          const b = blobStore.get(v.dataset.srcUrl);
          v.src = b ? b.objUrl : v.dataset.srcUrl;
          const reel = v.closest(".reel");
          if (reel && reel.classList.contains("live")) v.play().catch(() => {});
        }, 2500 * (tries + 1));
      }
    });
  };
  const acquireVideo = (item, protect) => {
    /* 1 */ let v = videoPool.find((n) => n.dataset.itemId === item.id);
    if (v) {
      /* upgrade to the in-memory copy if it arrived while this node was busy */
      const want = srcFor(item);
      if (v.getAttribute("src") !== want && v.readyState < 3) v.src = want;
      return v; // already bound — keeps its buffer for an instant return
    }
    /* 2 */ v = videoPool.find((n) => !protect.has(n.dataset.itemId)); // rebind a node whose item left the window
    if (!v && videoPool.length < POOL_MAX) {
      /* 3 */ v = document.createElement("video"); // grow only up to the cap
      v.className = "stage-video";
      v.muted = true; v.loop = true; v.playsInline = true;
      v.setAttribute("playsinline", ""); v.setAttribute("muted", "");
      v.preload = "auto";
      wireVideo(v);
      videoPool.push(v);
    }
    if (!v) v = videoPool[0];
    v.dataset.itemId = item.id;
    v.dataset.srcUrl = resolved(item);
    v.setAttribute("aria-label", `${item.chip || ""} video for ${item.title || ""}`);
    const want = srcFor(item);
    if (v.getAttribute("src") !== want) v.src = want;
    return v;
  };
  const reportDwell = (idx) => {
    if (idx < 0 || !items[idx] || !liveSince) return;
    const secs = (Date.now() - liveSince) / 1000;
    liveSince = 0;
    if (secs < 0.4) return;
    const it = items[idx];
    if (secs < 2) api("/api/events", { body: { item_id: it.id, kind: "skip", value: secs } }).catch(() => {});
    else api("/api/events", { body: { item_id: it.id, kind: "dwell", value: Math.min(secs, 120) } }).catch(() => {});
  };
  const applySound = () => {
    strip.querySelectorAll("video").forEach((v) => {
      v.muted = !state.sound || !v.closest(".reel").classList.contains("live");
    });
  };
  const setLive = (reelEl) => {
    const idx = [...strip.children].indexOf(reelEl);
    if (disposed || suspended || !reelEl) return;
    if (idx !== liveIdx) {
      reportDwell(liveIdx); liveIdx = idx; liveSince = Date.now();
      api("/api/events", { body: { item_id: items[idx].id, kind: "impression" } }).catch(() => {});
    }
    strip.querySelectorAll(".reel").forEach((r) => r.classList.toggle("live", r === reelEl));
    const device = $("#device");
    if (device) { const g = reelEl.dataset.genre; device.dataset.glow = g === "earn" ? "amber" : g === "attention" ? "lav" : "blue"; }
    strip.querySelectorAll("video").forEach((v) => {
      const mine = v.closest(".reel") === reelEl;
      if (mine) {
        /* if the in-memory copy landed while this reel was buffering, swap to
           it (zero network) and resume from the same position */
        const b = blobStore.get(v.dataset.srcUrl);
        if (b && v.getAttribute("src") !== b.objUrl && v.readyState < 3) {
          const t = v.currentTime || 0;
          v.src = b.objUrl;
          if (t > 0.35) v.addEventListener("loadedmetadata", () => { try { v.currentTime = t; } catch {} }, { once: true });
        }
        v.muted = !state.sound; playReel(v);
      }
      else { v.pause(); v.muted = true; }
    });
  };
  const fillNeighborhood = (idx) => {
    /* keep the current reel AND its neighbours mounted, so the next/previous
       reel is already attached and visible mid-swipe (no pop-in on release).
       Videos come from the reusable pool — only the LIVE reel plays; neighbours
       stay paused and are warmed by the abortable prefetch queue. */
    const protect = new Set();
    [...strip.children].forEach((r, i) => {
      if (Math.abs(i - idx) <= 1 && items[i] && items[i].video) protect.add(items[i].id);
    });
    [...strip.children].forEach((r, i) => {
      const inner = r.querySelector(".reel-inner");
      const inWindow = Math.abs(i - idx) <= 1;
      if (inWindow && !inner.children.length) {
        inner.innerHTML = reelInner(items[i], i);
        const item = items[i];
        const stage = inner.querySelector(".stage");
        if (item.video && stage) {
          const v = acquireVideo(item, protect);
          const slot = stage.querySelector(".stage-video-slot");
          if (slot) slot.appendChild(v);
          const poster = stage.querySelector(".stage-poster");
          const cached = posterCache.get(resolved(item));
          if (poster && cached) { poster.src = cached; stage.classList.add("has-poster"); }
          /* visibility of system status: a loading circle over the poster until
             frames flow — never a dead blank stage */
          if (v.readyState >= 3) stage.classList.add("has-frame");
          else stage.classList.add("buffering");
          if (i === idx && !matchMedia("(prefers-reduced-motion: reduce)").matches) v.play().catch(() => {});
        }
      } else if (!inWindow && inner.children.length) {
        const v = inner.querySelector("video");
        if (v) { v.pause(); v.remove(); } /* keep node + buffer in the pool */
        inner.innerHTML = "";
      }
      const v = inner.querySelector("video");
      /* blob srcs load from memory (no network) — let neighbours decode their
         first frame so the swipe lands on a real picture, never a spinner */
      if (v) v.preload = (i === idx || (v.getAttribute("src") || "").startsWith("blob:")) ? "auto" : "none";
    });
    schedulePrefetch(idx);
    if (idx >= items.length - 6) loadMore();
  };
  const observer = new IntersectionObserver((entries) => {
    if (disposed || suspended) return;
    for (const en of entries) {
      if (en.isIntersecting && en.intersectionRatio >= 0.55) {
        const idx = [...strip.children].indexOf(en.target);
        if (strip.id === "reels") state.reelIndex = idx;
        fillNeighborhood(idx);
        setLive(en.target);
      }
    }
  }, { root: strip, threshold: [0.55] });
  strip.querySelectorAll(".reel").forEach((r) => observer.observe(r));
  const start = startIdx == null ? state.reelIndex : startIdx;
  const idx = Math.min(start, strip.children.length - 1);
  const first = strip.children[idx];
  if (first) {
    fillNeighborhood(idx);
    setLive(first);
    /* scroll only the strip — scrollIntoView would also scroll the page and
       shift the whole device when returning to the reels tab */
    strip.scrollTop = strip.clientHeight * idx;
  }
  if (!first) loadMore();
  const teardown = () => {
    disposed = true; clearTimeout(retryTimer);
    if (status) status.removeEventListener("click", loadMore);
    reportDwell(liveIdx); observer.disconnect(); abortPrefetch();
    for (const v of videoPool) { try { v.pause(); v.removeAttribute("src"); v.load(); v.remove(); } catch {} }
    videoPool.length = 0;
    for (const b of blobStore.values()) URL.revokeObjectURL(b.objUrl);
    blobStore.clear();
  };
  /* keep-alive hooks: pause when the feed tab is hidden, resume the exact
     reel (and its dwell timer) when the tab is shown again — no remount.
     Detached DOM loses its scroll offset, so save and restore it explicitly. */
  let savedScroll = 0;
  teardown.suspend = () => {
    suspended = true; clearTimeout(retryTimer);
    reportDwell(liveIdx); liveSince = 0;
    abortPrefetch(); pf.lastIdx = -1;
    savedScroll = strip.scrollTop;
    strip.querySelectorAll("video").forEach((v) => v.pause());
  };
  teardown.resume = () => {
    suspended = false;
    strip.scrollTop = savedScroll;
    const idx = Math.min(Math.round(savedScroll / (strip.clientHeight || 1)), strip.children.length - 1);
    const reelEl = strip.children[idx];
    if (reelEl) { fillNeighborhood(idx); setLive(reelEl); }
    liveSince = Date.now();
    if (!reelEl) loadMore();
  };
  return teardown;
}
let reelTeardown = null;
function feedTabsHtml() {
  return `
    <div class="reel-tabs" role="tablist" aria-label="Feed">
      <button class="ftab" role="tab" data-tab="gold" aria-selected="${state.feedTab === "gold"}" aria-controls="reels">paid studies</button>
      <button class="ftab" role="tab" data-tab="discover" aria-selected="${state.feedTab === "discover"}" aria-controls="reels">discover</button>
    </div>`;
}
routes.feed = async (el) => {
  const items = feedItems();
  el.innerHTML = `
  <div class="feed-head">
    ${feedTabsHtml()}
    ${state.researcherMode ? `<button class="iconbtn create-btn" data-act="create-content" aria-label="Create a study or post">${icon("plus")}</button>` : ""}
    <button class="iconbtn sound-btn" data-act="toggle-sound" aria-pressed="${state.sound}" aria-label="${state.sound ? "Mute reel sound" : "Unmute reel sound"}">${icon(state.sound ? "speaker" : "speaker-off")}</button>
  </div>
  <div class="ptr-zone" id="ptr-zone">
    <div class="ptr-indicator" id="ptr-indicator" aria-hidden="true"><span class="ptr-ring"></span><span class="ptr-label">Pull for fresh picks</span></div>
    <div class="reels" id="reels" tabindex="-1" aria-label="Study reels, swipe vertically">
      ${items.map(reelShell).join("")}
    </div>
    <button class="feed-status" type="button" hidden aria-live="polite"><span></span></button>
  </div>`;
  const tab = state.feedTab;
  const strip = el.querySelector("#reels");
  reelTeardown = mountReels(strip, items, state.reelIndex, {
    loadMore: (ids) => api(`/api/feed?tab=${tab}&exclude=${encodeURIComponent(ids.join(","))}`),
  });
  /* Stable Instagram-style header: the wordmark bar is a fixed overlay in the feed
     so the reels never resize. The wordmark + tabs collapse once you leave the
     topmost reel and stay collapsed while you move between reels; they only slide
     back when you return to the very first reel of the tab. Transforms only. */
  const device = $("#device");
  device.classList.add("feed-mode");
  const sb = document.querySelector(".statusbar");
  const measure = () => {
    if (!sb) return;
    const h = sb.offsetHeight;
    const padTop = parseFloat(getComputedStyle(sb).paddingTop) || 0;
    device.style.setProperty("--sb-h", h + "px");
    device.style.setProperty("--collapse-h", Math.max(0, h - padTop) + "px");
  };
  measure();
  addEventListener("resize", measure);
  const onReelScroll = () => device.classList.toggle("feed-scrolled", strip.scrollTop > 8);
  strip.addEventListener("scroll", onReelScroll, { passive: true });
  onReelScroll();
  const baseTeardown = reelTeardown;
  reelTeardown = () => { strip.removeEventListener("scroll", onReelScroll); removeEventListener("resize", measure); device.classList.remove("feed-scrolled", "feed-mode"); baseTeardown(); };
  reelTeardown.suspend = () => { device.classList.remove("feed-scrolled", "feed-mode"); baseTeardown.suspend(); };
  reelTeardown.resume = () => { device.classList.add("feed-mode"); baseTeardown.resume(); onReelScroll(); };
  attachPullToRefresh(el.querySelector("#ptr-zone"), strip, async () => {
    const fresh = await api(`/api/feed?tab=${tab}&refresh=1`);
    if (!strip.isConnected || strip !== $("#reels") || state.feedTab !== tab) return;
    if (tab === "discover") discoveries = fresh; else studies = fresh;
    state.reelIndex = 0;
    render();
    toast("Fresh picks, matched to you.");
  });
};
routes.feed.tab = "feed";
state.feed = { applySound: null };

/* ---------- pull-to-refresh (Instagram-style: pull past the top, release) ---- */
function attachPullToRefresh(zone, scroller, onRefresh, pullTarget = scroller) {
  if (!zone || !scroller) return;
  const indicator = zone.querySelector("#ptr-indicator");
  const label = zone.querySelector(".ptr-label");
  const ring = zone.querySelector(".ptr-ring");
  let startY = null, startX = null, pulling = false, dist = 0, busy = false;
  const THRESHOLD = 72;
  const setPull = (d) => {
    dist = d;
    const p = Math.min(d / THRESHOLD, 1.35);
    pullTarget.style.transform = `translateY(${Math.min(d, 110)}px)`;
    indicator.style.opacity = String(Math.min(p, 1));
    ring.style.transform = `rotate(${p * 260}deg)`;
    label.textContent = p >= 1 ? "Release to refresh" : "Pull for fresh picks";
    zone.classList.toggle("ptr-armed", p >= 1);
  };
  const reset = () => {
    pullTarget.style.transition = "transform 260ms var(--ease-out)";
    pullTarget.style.transform = "";
    indicator.style.opacity = "0";
    zone.classList.remove("ptr-armed", "ptr-spinning");
    setTimeout(() => { pullTarget.style.transition = ""; }, 280);
  };
  zone.addEventListener("touchstart", (e) => {
    if (busy || scroller.scrollTop > 2) return;
    startY = e.touches[0].clientY; startX = e.touches[0].clientX; pulling = true;
    scroller.style.transition = "";
  }, { passive: true });
  zone.addEventListener("touchmove", (e) => {
    if (!pulling || startY == null) return;
    const dy = e.touches[0].clientY - startY;
    /* horizontal intent belongs to swipe-back, not pull-to-refresh */
    const dx = e.touches[0].clientX - startX;
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { pulling = false; reset(); return; }
    if (dy <= 0 || scroller.scrollTop > 2) { if (dy < -8) { pulling = false; reset(); } return; }
    if (scroller.scrollTop <= 0) {
      e.preventDefault();
      setPull(dy * 0.55);
    }
  }, { passive: false });
  const end = async () => {
    if (!pulling) return;
    pulling = false; startY = null;
    if (dist >= THRESHOLD && !busy) {
      busy = true;
      zone.classList.add("ptr-spinning");
      label.textContent = "Matching new picks…";
      pullTarget.style.transform = "translateY(56px)";
      indicator.style.opacity = "1";
      try { await onRefresh(); } catch (e) { toast(e.message); }
      busy = false;
      reset();
    } else reset();
    dist = 0;
  };
  zone.addEventListener("touchend", end);
  zone.addEventListener("touchcancel", () => { pulling = false; startY = null; dist = 0; reset(); });
  /* mouse fallback for desktop testing */
  let mDown = false;
  zone.addEventListener("mousedown", (e) => { if (!busy && scroller.scrollTop <= 2) { mDown = true; startY = e.clientY; } });
  zone.addEventListener("mousemove", (e) => { if (mDown && startY != null) { const dy = e.clientY - startY; if (dy > 4) setPull(dy * 0.55); } });
  zone.addEventListener("mouseup", () => { if (mDown) { mDown = false; end(); } });
  zone.addEventListener("mouseleave", () => { if (mDown) { mDown = false; pulling = false; dist = 0; reset(); } });
}

function stageMarkup(item) {
  /* Discover (news) reels: no paper authors / source overlaid on the media —
     the credit bar and source badge are omitted there. Paid-study reels keep
     their footage credit + topic chip. Byline/source stay in the body below. */
  const isStudy = item.kind === "study";
  const chip = isStudy ? `<span class="stage-chip"><i aria-hidden="true"></i>${esc(item.chip || "finding")}</span>` : "";
  const credit = isStudy && item.credit ? `<span class="stage-credit num">${esc(item.credit)}</span>` : "";
  if (item.video) {
    /* The <video> itself is injected from a reusable pool (see mountReels) —
       never recreated per mount, so fast scrolling cannot exhaust iOS's media
       element pool. A cached first-frame poster + a visible loading circle sit
       on top until frames flow. */
    return `<span class="stage-video-slot" data-video="${esc(item.video)}"></span>
    <img class="stage-poster" alt="" aria-hidden="true" decoding="async">
    <span class="stage-loading" aria-hidden="true"><i></i></span>
    ${chip}${credit}`;
  }
  if (item.image) {
    return `<img class="stage-image" src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy" decoding="async">
    ${chip}${credit}`;
  }
  return `<span class="stage-art" aria-hidden="true"></span>${chip}`;
}

function reelInner(item, i) {
  const isStudy = item.kind === "study";
  const r = (isStudy && researchers[item.researcher]) || { name: "Researcher", org: "", initials: "R", photo: null };
  const done = isStudy && state.answered[item.id];
  const liked = !!state.hearts[item.id];
  const boost = state.multiplier.active && state.multiplier.left > 0;
  const srcHref = /^https?:\/\//i.test(String(item.source_url || "")) ? item.source_url : null;
  const stageAct = !isStudy && item.paper ? ` role="button" tabindex="0" data-act="open-paper" data-id="${item.paper}" aria-label="Read the finding behind this reel"` : "";
  return `
    <div class="reel-glow" aria-hidden="true"></div>
    <div class="stage"${stageAct}>
      ${stageMarkup(item)}
    </div>
    <div class="reel-body with-rail">
      <div class="rail${isStudy ? " rail-top" : ""}">
        <button class="rail-btn" data-act="heart" data-id="${item.id}" aria-pressed="${liked}" aria-label="${isStudy ? "Like this study to see more like it" : `Like, ${item.rail.heart} likes`}"><span class="disc">${icon("heart")}</span>${item.rail ? esc(item.rail.heart) : ""}</button>
        ${item.rail ? `
        <button class="rail-btn" data-act="repost" data-id="${item.id}" aria-label="Repost, ${item.rail.repost} reposts"><span class="disc">${icon("bolt")}</span>${esc(item.rail.repost)}</button>
        <button class="rail-btn" data-act="comments" data-id="${item.id}" aria-label="Comments, ${item.rail.comment}"><span class="disc">${icon("comment")}</span><span data-count="${item.id}">${esc(item.rail.comment)}</span></button>` : ""}
      </div>
      ${isStudy ? `
        <div class="reel-who">
          <button class="avatar-btn" data-act="open-researcher" data-id="${item.researcher}" aria-label="Open ${esc(r.name)}'s profile">${photoAvatar(r)}</button>
          <span class="grow"><span class="nm">${esc(r.name)} ${item.verified ? icon("verified") : ""}</span><span class="or">${esc(String(r.org).replace("Researcher at ", ""))} · ${item.minutes} min</span></span>
        </div>
        <h2 class="reel-title reel-title-study">${esc(item.title)}</h2>
        <p class="reel-sub reel-sub-study">${esc(item.sub)}</p>
        ${item.source_url ? `<button class="reel-source-link" data-act="open-reader" data-id="study~${item.id}">Read more ${icon("chevron", "chev")}</button>` : ""}
        ${done ? `
        <div class="reel-receipt">
          <span class="row">${icon("check")} answered today · +${money(done.amount)}${done.boosted ? " at 2x" : ""}</span>
          <span>${icon("shield")} quality check: consistency, attention gates and interaction pattern reviewed before the researcher sees it</span>
        </div>` : ""}
        <div class="reel-actions">
          ${done ? `<button class="btn btn-wide" data-go="#/completed">${icon("check")} See your receipt</button>` : `
          <button class="btn btn-ink btn-wide" data-act="answer" data-id="${item.id}">Answer <span class="amt">+${money(item.reward)}${boost ? " x2" : ""}</span></button>`}
        </div>
      ` : `
        <span class="ai-chip">${icon("bolt")}<span class="ai-src">${esc(item.ai || "")}</span>${item.verified ? ` <span class="verified-tag">${icon("verified")} verified source</span>` : ""}</span>
        <h2 class="news-head">${esc(item.title)}</h2>
        <p class="reel-sub">${esc(item.sub || item.summary || "")}</p>
        ${item.author ? `<p class="reel-source muted">${esc(item.author)}${item.published_at ? ` · ${esc(String(item.published_at).slice(0, 10))}` : ""}</p>` : ""}
        <div class="reel-actions">
          ${(srcHref || item.has_blog) ? `<button class="btn btn-ink btn-wide" data-act="open-reader" data-id="post~${item.id}">Read more ${icon("chevron", "chev")}</button>` : ""}
          ${item.paper ? `<button class="btn ${srcHref ? "btn-wide" : "btn-ink btn-wide"}" data-act="open-paper" data-id="${item.paper}">Read the finding</button>` : ""}
        </div>
      `}
    </div>`;
}
state.feedTab = "gold";

/* ---------- rewards (server-authoritative) ---------- */
function applyRewardResult(d, label) {
  applyWallet(d);
  syncWallet();
  if (d.amount > 0) {
    toast(`${label}: +${money(d.amount / 100)}${d.boosted ? " (2x streak)" : ""}`, true);
    if (d.milestone) setTimeout(openMilestone, 700);
    else if (d.boosted && d.multiplier_left === 0) setTimeout(() => toast("Your 2x window is used up. The next streak opens a fresh one."), 900);
  }
}
function openMilestone() {
  openModal(`
    <div class="milestone-disc">${icon("bolt")}</div>
    <h2>Seven days running</h2>
    <p>Milestone reached. Your next <b>10 answers pay double</b>, on every study in the feed.</p>
    <button class="btn btn-ink btn-wide" data-close>Collect and keep going</button>`, { cls: "milestone" });
}
function syncWallet() {
  document.querySelectorAll("[data-wallet]").forEach((n) => { n.textContent = money(state.wallet); });
}

/* ---------- paradata telemetry (bot-detection signals) ----------
   Collects keystroke dynamics, paste/copy, focus/visibility, pointer physics
   and automation flags — the signals production fraud systems actually use.
   OS-level screen recorders are not detectable from a web page; we record
   consented session telemetry + capture/remote-control heuristics instead. */
const Telemetry = (() => {
  const now = () => performance.now();
  let env = null, sess = null, cur = null, questions = [];
  let lastKey = 0, keyDownAt = 0;
  const ptr = { strokes: [], cur: null, intervals: [], lastMove: 0 };
  let installed = false;

  function collectEnv() {
    if (env) return env;
    let cdp = false;
    try { const e = new Error(); Object.defineProperty(e, "stack", { get() { cdp = true; return ""; } }); console.debug(e); } catch {}
    let automationGlobals = false;
    try { automationGlobals = Object.keys(window).some((k) => /^cdc_/.test(k)) || !!window.__playwright || !!window.__selenium_unwrapped || !!window.domAutomation; } catch {}
    const ua = navigator.userAgent || "";
    const touch = navigator.maxTouchPoints > 0;
    env = {
      webdriver: !!navigator.webdriver,
      headless: /HeadlessChrome/i.test(ua),
      plugins0: (navigator.plugins ? navigator.plugins.length : 0) === 0 && !touch,
      cdp, automationGlobals,
      touchMismatch: touch && !("ontouchstart" in window),
      languages: (navigator.languages || []).join(","),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen: [screen.width, screen.height], dpr: window.devicePixelRatio || 1,
    };
    return env;
  }
  function install() {
    if (installed) return; installed = true;
    document.addEventListener("keydown", (e) => {
      if (!sess || !cur || !e.target.matches || !e.target.matches("[data-text]")) return;
      const t = now();
      cur.keys++;
      if (cur.first_input_ms == null) cur.first_input_ms = Math.round(t - cur.t0);
      if (lastKey) cur.flights.push(Math.round(t - lastKey));
      if (e.key === "Backspace" || e.key === "Delete") cur.backspaces++;
      keyDownAt = t; lastKey = t;
      if (!document.hasFocus()) sess.inputWhileBlurred = true;
    }, true);
    document.addEventListener("keyup", (e) => {
      if (!sess || !cur || !keyDownAt) return;
      if (e.target.matches && e.target.matches("[data-text]")) cur.dwells.push(Math.round(now() - keyDownAt));
      keyDownAt = 0;
    }, true);
    document.addEventListener("paste", (e) => {
      if (!sess || !cur) return;
      const cd = e.clipboardData || window.clipboardData;
      const txt = cd ? cd.getData("text") : "";
      cur.pastes++; cur.paste_words += txt.trim() ? txt.trim().split(/\s+/).length : 0;
    }, true);
    document.addEventListener("copy", () => { if (sess) { sess.copies++; if (cur) cur.copies++; } }, true);
    document.addEventListener("input", (e) => {
      if (!sess || !e.target.matches) return;
      if (e.target.matches("[data-hp]")) { sess.honeypot = true; return; }
      if (!cur || !e.target.matches("[data-text]")) return;
      const len = e.target.value.length;
      if (len > cur.chars + 1 && cur.keys === 0) cur.injected += len - cur.chars;
      cur.chars = len;
      if (cur.first_input_ms == null) cur.first_input_ms = Math.round(now() - cur.t0);
    }, true);
    document.addEventListener("visibilitychange", () => {
      if (!sess) return;
      sess.visSwitches++;
      if (document.visibilityState === "hidden") { sess.hiddenAt = Date.now(); if (cur) cur.focus_loss++; }
      else if (sess.hiddenAt) { sess.blurMs += Date.now() - sess.hiddenAt; sess.hiddenAt = null; }
    });
    window.addEventListener("blur", () => { if (sess && cur) cur.focus_loss++; });
    document.addEventListener("pointerdown", (e) => { ptr.cur = { len: 0, disp: 0, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY }; }, true);
    document.addEventListener("pointermove", (e) => {
      if (!sess) return;
      const t = now();
      if (ptr.lastMove) ptr.intervals.push(t - ptr.lastMove);
      ptr.lastMove = t;
      if (ptr.cur) {
        ptr.cur.len += Math.hypot(e.clientX - ptr.cur.x, e.clientY - ptr.cur.y);
        ptr.cur.x = e.clientX; ptr.cur.y = e.clientY;
        ptr.cur.disp = Math.hypot(e.clientX - ptr.cur.sx, e.clientY - ptr.cur.sy);
      }
    }, true);
    document.addEventListener("pointerup", () => {
      if (ptr.cur && ptr.cur.len > 20) ptr.strokes.push(ptr.cur.disp / ptr.cur.len);
      ptr.cur = null;
    }, true);
  }
  function start() {
    install(); collectEnv();
    sess = { t0: Date.now(), wallMs: 0, activeMs: 0, visSwitches: 0, copies: 0, blurMs: 0, hiddenAt: null, inputWhileBlurred: false, honeypot: false };
    questions = []; cur = null; lastKey = 0;
    ptr.strokes = []; ptr.intervals = []; ptr.lastMove = 0;
  }
  function questionStart() {
    if (!sess) start();
    cur = { t0: now(), t_ms: 0, first_input_ms: null, keys: 0, dwells: [], flights: [], pastes: 0, paste_words: 0, copies: 0, backspaces: 0, injected: 0, focus_loss: 0, chars: 0 };
  }
  function questionEnd() {
    if (!cur) return null;
    cur.t_ms = Math.round(now() - cur.t0);
    cur.dwells = cur.dwells.slice(0, 120); cur.flights = cur.flights.slice(0, 120);
    questions.push(cur); const out = cur; cur = null; lastKey = 0;
    return out;
  }
  function finish() {
    if (!sess) return { env: collectEnv(), session: {}, questions: [] };
    if (cur) questionEnd();
    sess.wallMs = Date.now() - sess.t0;
    sess.activeMs = Math.max(0, sess.wallMs - sess.blurMs);
    const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
    const cv = (a) => { const m = mean(a); if (!m || a.length < 2) return 0; return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) / m; };
    const straight = ptr.strokes.length ? mean(ptr.strokes) : 0.78;
    const regularity = ptr.intervals.length >= 8 ? Math.max(0, 1 - cv(ptr.intervals)) : 0.3;
    const out = { env, session: { ...sess, pointer: { samples: ptr.intervals.length, straightness: +straight.toFixed(3), regularity: +regularity.toFixed(3) } }, questions };
    sess = null; cur = null;
    return out;
  }
  return { start, questionStart, questionEnd, finish };
})();

/* ---------- answer sheet ---------- */
let sheet = null;
async function openAnswer(studyId) {
  let s = studies.find((x) => x.id === studyId);
  if (!s) {
    try { s = await api(`/api/studies/${studyId}`); studies.push(s); } catch { return; }
  }
  if (!s) return;
  Telemetry.start();
  sheet = { s, i: 0, qi: -1, answers: Array(s.questions.length).fill(null), timings: [], t0: Date.now() };
  mountSheet();
}
function mountSheet() {
  const host = document.querySelector(".reel-viewer .rv-frame") || $("#screen");
  const old = host.querySelector(".answer-sheet");
  if (old) old.remove();
  sheet.t0 = Date.now();
  if (sheet.qi !== sheet.i) { Telemetry.questionStart(); sheet.qi = sheet.i; }
  const { s, i, answers } = sheet;
  const q = s.questions[i];
  const last = i === s.questions.length - 1;
  const node = document.createElement("form");
  node.className = "answer-sheet";
  node.setAttribute("aria-label", `Answering ${s.title}`);
  node.innerHTML = `
    <span class="grabber" aria-hidden="true"></span>
    <span class="a-head"><b>${esc(s.title)}</b><span class="step num">${i + 1} / ${s.questions.length}</span></span>
    <span class="a-progress" aria-hidden="true"><i style="transform:scaleX(${(i + (answers[i] !== null ? 1 : 0)) / s.questions.length})"></i></span>
    <label class="a-q" ${q.type === "opts" ? `id="aq-${i}"` : `for="at-${i}"`}>${esc(q.q)}</label>
    ${q.type === "opts" ? `
      <span class="a-opts" role="group" aria-labelledby="aq-${i}">
        ${q.options.map((o, oi) => `
        <button type="button" class="opt" data-oi="${oi}" aria-pressed="${answers[i] === o}">${esc(o)}<span class="tick" aria-hidden="true">${icon("check")}</span></button>`).join("")}
      </span>` : `
      <input class="input" type="text" id="at-${i}" data-text placeholder="${esc(q.placeholder || "")}" autocomplete="off" value="${esc(answers[i] || "")}">`}
    <input class="hp-field" data-hp type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" value="">
    <span class="a-note">${icon("shield")}<span>One attention gate is mixed into every study. Passing keeps your record clean; the researcher never sees which one it was.</span></span>
    <span class="a-actions">
      <button type="button" class="btn a-close" data-sheet-close aria-label="Close answers">${icon("back")}</button>
      ${last ? `<button type="submit" class="btn btn-ink">Submit study · <span class="amt">+${money(s.reward)}${state.multiplier.active ? " x2" : ""}</span></button>` : `<button type="button" class="btn btn-ink" data-next>Next question</button>`}
    </span>`;
  host.appendChild(node);
  node.addEventListener("click", (e) => {
    const opt = e.target.closest(".opt");
    if (opt) {
      sheet.answers[sheet.i] = q.options[+opt.dataset.oi];
      node.querySelectorAll(".opt").forEach((o) => o.setAttribute("aria-pressed", String(o === opt)));
      node.querySelector(".a-progress i").style.transform = `scaleX(${(sheet.i + 1) / s.questions.length})`;
      autoNext();
      return;
    }
    if (e.target.closest("[data-sheet-close]")) { closeSheet(false); return; }
    if (e.target.closest("[data-next]")) { stepSheet(); return; }
  });
  node.addEventListener("input", (e) => {
    if (e.target.matches("[data-text]")) sheet.answers[sheet.i] = e.target.value;
  });
  node.addEventListener("submit", (e) => { e.preventDefault(); submitSheet(); });
  const firstInput = node.querySelector("[data-text]");
  if (firstInput) firstInput.focus();
}
let autoTimer = null;
function autoNext() {
  clearTimeout(autoTimer);
  if (sheet.i < sheet.s.questions.length - 1) autoTimer = setTimeout(() => stepSheet(), 320);
}
function stepSheet() {
  clearTimeout(autoTimer);
  if (sheet.answers[sheet.i] === null || sheet.answers[sheet.i] === "") {
    const field = document.querySelector(".answer-sheet");
    const err = field.querySelector(".field-err");
    if (!err) field.querySelector(".a-q").insertAdjacentHTML("afterend", `<span class="field-err">Answer this one first.</span>`);
    return;
  }
  sheet.timings[sheet.i] = Date.now() - sheet.t0;
  Telemetry.questionEnd();
  sheet.i = Math.min(sheet.i + 1, sheet.s.questions.length - 1);
  mountSheet();
}
async function submitSheet() {
  const missing = sheet.answers.findIndex((a) => a === null || a === "");
  if (missing !== -1) { sheet.i = missing; mountSheet(); toast("One question is still open."); return; }
  sheet.timings[sheet.i] = Date.now() - sheet.t0;
  Telemetry.questionEnd();
  const paradata = Telemetry.finish();
  const s = sheet.s;
  const btn = document.querySelector(".answer-sheet [type=submit]");
  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
  try {
    const d = await api(`/api/studies/${s.id}/respond`, { body: { answers: sheet.answers, timings: sheet.timings, paradata } });
    applyWallet(d);
    syncWallet();
    if (d.quality && d.quality.flagged) {
      closeSheet(false);
      render();
      openModal(`
        <div class="milestone-disc">${icon("shield")}</div>
        <h2>Held for review</h2>
        <p>This answer tripped the quality screen (${esc((d.quality.reasons || []).join(", ") || "pace")}). It is held for a human check before it counts or pays. Nothing is lost if it clears.</p>
        <button class="btn btn-ink btn-wide" data-close>Understood</button>`, { cls: "milestone" });
      return;
    }
    applyRewardResult(d, "Study sent");
    closeSheet(true);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "Submit study"; }
    toast(e.message);
  }
}
function closeSheet(advance) {
  clearTimeout(autoTimer);
  const node = document.querySelector(".answer-sheet");
  if (node) node.remove();
  if (sheet) Telemetry.finish();
  sheet = null;
  if (!advance) return;
  const items = feedItems();
  const cur = state.reelIndex;
  let target = -1;
  for (let i = cur + 1; i < items.length; i++) {
    const it = items[i];
    if (!(it.kind === "study" && state.answered[it.id])) { target = i; break; }
  }
  if (target === -1) target = Math.min(cur + 1, items.length - 1);
  state.reelIndex = target;
  render();
}

/* ---------- play: story games (the only kind) ---------- */
const GAME_KIND_LABEL = { story: "Story game" };
const GAME_KIND_ICON = { story: "comment" };
/* What each game measures, in the researcher's own words when the spec carries
   a study frame, otherwise the instrument's standing construct. */
const GAME_CONSTRUCT = {
  story: "Judgment as a story unfolds",
};
const GAME_WHY = {
  story: "Your answers at each question show how you weigh the situation. There is no winning branch — only your branch.",
};
const GAME_RULES = {
  story: [
    "Tap the ground and your character walks there — every platform and stair is reachable, no puzzles.",
    "The story moves in order: only the person with the floating mark can be talked to. Finish with them, then the next person lights up.",
    "Read their line and tap the arrow to continue. When they ask you something, pick an option or write your own words — some moments are timed.",
    "Talk to everyone in order to finish the story. Your choices are the research data — there is no winning branch, only yours.",
  ],
};
const GAME_MINUTES = { story: 4 };

/* The carousel keeps its settled pillar across background refreshes. */
let playSelIdx = 0, playGamesKey = "";
routes.play = async (el, prefetched) => {
  const cached = prefetched || apiCache.get("/api/games");
  const games = cached ? cached.games : [];
  const myRid = state.user ? "u-" + state.user.id : "";
  const visible = games.filter((g) => g.status === "published" || g.researcher_id === myRid);
  const myBuilds = visible.filter((g) => g.researcher_id === myRid && g.status !== "published");
  const published = visible.filter((g) => g.status === "published");
  const gamesKey = JSON.stringify(visible.map((g) => [g.id, g.status, g.played, g.reward_cents]));
  el.innerHTML = `
  <div class="view mv-select-view">
    <canvas id="mv-carousel" class="mv-select-canvas" aria-label="Game selection — rotate the pillars to choose a story"></canvas>
    <div class="mv-select-head">
      <span class="mv-select-kicker">Earnest research games</span>
      <h1 class="mv-select-title">Choose a story</h1>
    </div>
    <button class="mv-car-arrow left" id="mv-car-prev" aria-label="Previous game">‹</button>
    <button class="mv-car-arrow right" id="mv-car-next" aria-label="Next game">›</button>
    <div class="mv-select-bottom">
      <div class="mv-dots" id="mv-dots">${published.map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("")}</div>
      <div class="mv-game-card" id="mv-game-card"></div>
      ${state.researcherMode ? `<button class="mv-create-btn" data-go="#/create-custom">${icon("plus")} Create a story game</button>` : ""}
      ${myBuilds.length ? `<div class="mv-builds">${myBuilds.map((g) => g.status === "queued"
        ? `<button class="mv-build-chip" data-act="open-queued" data-id="${g.id}">${esc(g.title)} <span class="pill pill-lav">Building…</span></button>`
        : g.status === "failed"
        ? `<button class="mv-build-chip" data-go="#/game-template/story">${esc(g.title)} <span class="pill pill-flag">Retry</span></button>`
        : `<button class="mv-build-chip" data-act="open-draft" data-id="${g.id}">${esc(g.title)} <span class="pill">Draft</span></button>`).join("")}</div>` : ""}
    </div>
    ${!published.length && !myBuilds.length ? `<div class="card game-empty">${icon("gamepad")}<span>Researchers are building story games right now. ${state.researcherMode ? "Yours could be the first — create one above." : "Turn on researcher mode in your profile to create one."}</span></div>` : ""}
  </div>`;
  const card = el.querySelector("#mv-game-card");
  const dots = [...el.querySelectorAll("#mv-dots i")];
  const paintCard = (i) => {
    const g = published[i];
    playSelIdx = i;
    dots.forEach((d, di) => d.classList.toggle("on", di === i));
    if (!g) { card.innerHTML = `<p class="mv-game-desc">No stories yet — the pillars are waiting for their first statue.</p>`; return; }
    const r = researchers[g.researcher_id] || null;
    const study = (g.spec && g.spec.study) || {};
    const setting = g.spec && g.spec.world && g.spec.world.setting;
    const thumb = { school: "worlds/school.png", metro: "worlds/commute.jpg", office: "worlds/rooftop.jpg" }[setting] || g.logo;
    card.classList.remove("pop"); void card.offsetWidth; card.classList.add("pop");
    const mins = g.minutes || GAME_MINUTES[g.kind] || 4;
    const blurb = study.blurb || study.why || g.premise || g.headline || "";
    card.innerHTML = `
      <div class="mv-game-top">
        <img class="mv-game-thumb" src="${thumb}" alt="" decoding="async">
        <div class="mv-game-toptext">
          <span class="mv-game-kicker"><span class="mv-game-kicker-text">A research story${g.chip ? " · " + esc(g.chip) : ""}</span><span class="mv-game-mins num">${mins} min</span></span>
          <h2 class="mv-game-title">${esc(g.title)}</h2>
        </div>
      </div>
      <div class="mv-game-who-row">
        <button class="mv-game-who" data-act="open-researcher" data-id="${esc(g.researcher_id)}" style="background:none;border:none;padding:0;cursor:pointer;text-align:left">
          ${r ? photoAvatar(r, "avatar-sm") : `<span class="avatar avatar-sm" aria-hidden="true">E</span>`}
          <span class="grow"><b>${esc(r ? r.name : g.researcher_name || "EARNest research")}</b><small>${esc(r ? String(r.org || "").replace("Researcher at ", "") : "Researcher")}</small></span>
        </button>
        <button class="mv-game-detail-link" data-act="open-game" data-id="${esc(g.id)}">The research behind it${g.played ? " · played" : ""}</button>
      </div>
      <p class="mv-game-desc">${esc(blurb)}</p>
      <div class="mv-game-foot">
        <span class="pill pill-money num">+${money(g.reward_cents / 100)}</span>
        <button class="mv-play-btn" data-act="play-ai-game" data-id="${esc(g.id)}">${icon("play")} Play</button>
      </div>`;
  };
  if (published.length) {
    const carousel = window.MVWorld.mountCarousel(el.querySelector("#mv-carousel"), published, paintCard, playSelIdx);
    el.querySelector("#mv-car-prev").addEventListener("click", () => carousel.rotate(-1));
    el.querySelector("#mv-car-next").addEventListener("click", () => carousel.rotate(1));
  } else {
    paintCard(0);
    el.querySelector("#mv-carousel").style.display = "none";
    el.querySelector("#mv-car-prev").style.display = "none";
    el.querySelector("#mv-car-next").style.display = "none";
  }
  playGamesKey = gamesKey;
  if (!prefetched) {
    const seq = renderSeq;
    api("/api/games").then((fresh) => {
      apiCache.set("/api/games", fresh);
      if (seq !== renderSeq || $("#screen").dataset.view !== "play") return;
      const freshKey = JSON.stringify((fresh.games || []).filter((g) => g.status === "published" || g.researcher_id === myRid).map((g) => [g.id, g.status, g.played, g.reward_cents]));
      if (freshKey !== playGamesKey) routes.play(el, fresh);
    }).catch(() => {});
  }
};
routes.play.tab = "play";

/* ---------- game detail: the study's front-of-house, then the instrument ---------- */
function gameFacts(kind, spec) {
  const rows = [];
  const chars = (spec.characters || []).slice(0, 4);
  if (chars.length) rows.push(["Characters", chars.map((c) => c.name).join(", ")]);
  const scenes = spec.scenes || [];
  rows.push(["Scenes", String(scenes.length)]);
  const qs = scenes.filter((sc) => sc.input);
  if (qs.length) rows.push(["Questions", String(qs.length)]);
  if (qs.some((sc) => sc.input && sc.input.timeLimitMs)) rows.push(["Twists", "Timed moments"]);
  return rows;
}
routes["game/:id"] = async (el, id) => {
  let d;
  try { d = await api(`/api/games/${id}`); } catch (e) { if (!el.isConnected) return; toast(e.message); go("#/play"); return; }
  if (!el.isConnected) return;
  if (d.status === "draft" && d.spec) { setPendingGame({ kind: d.kind, spec: d.spec, id: d.id }); go("#/game-preview"); return; }
  if (d.status !== "published") { go(`#/game-queued/${id}`); return; }
  const spec = d.spec || {};
  const study = spec.study || {};
  let ctx = study.context || "";
  if (!ctx) { try { ctx = JSON.parse(d.prompt || "{}").research_context || ""; } catch {} }
  const r = researchers[d.researcher_id] || null;
  const facts = gameFacts(d.kind, spec);
  const rules = GAME_RULES[d.kind] || [];
  el.innerHTML = `
  <div class="view game-detail theme-dark" data-glow="blue">
    ${topbar("the game")}
    <div class="gd-stage">
      <img class="gd-video" src="${gameLogo(d)}" alt="${esc(d.title)} key art" decoding="async">
      <span class="stage-chip"><i aria-hidden="true"></i>${esc(d.chip || GAME_CONSTRUCT[d.kind] || "Research")}</span>
    </div>
    <div class="gd-head">
      <h1 class="gd-title">${esc(d.headline || d.title)}</h1>
      ${r ? `<button class="gd-who" data-act="open-researcher" data-id="${esc(d.researcher_id)}">${photoAvatar(r)}<span class="grow"><b>${esc(r.name)}</b><small>${esc(String(r.org || "").replace("Researcher at ", ""))}</small></span>${icon("chevron", "chev")}</button>` : ""}
      <div class="gd-meta">
        <span class="pill pill-money num">+${money(d.reward_cents / 100)}</span>
        <span class="pill num">${d.minutes || GAME_MINUTES[d.kind] || 3} min</span>
        <span class="pill num">${d.plays} played</span>
        ${d.played ? `<span class="pill">${icon("check")} Played</span>` : ""}
      </div>
    </div>
    <div class="sect-label">The research</div>
    <div class="gd-sec">
      <p class="gd-construct">${esc(study.construct || GAME_CONSTRUCT[d.kind] || "Behavioural research")}</p>
      ${ctx ? `<p>${esc(ctx)}</p>` : ""}
      <p class="muted">${esc(study.why || GAME_WHY[d.kind] || "Your play is the research data.")}</p>
    </div>
    <div class="sect-label">The story</div>
    <div class="gd-sec">
      <p>${esc(d.premise || spec.premise || "")}</p>
      ${facts.length ? `<dl class="gd-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
    </div>
    ${rules.length ? `
    <div class="sect-label">How to play</div>
    <ol class="gd-rules">${rules.map((h) => `<li>${esc(h)}</li>`).join("")}</ol>
    ` : ""}
    <div class="gd-actionbar">
      <button class="btn btn-ink btn-wide" data-act="play-ai-game" data-id="${esc(d.id)}">${icon("play")} ${d.played ? `Replay <span class="amt">no reward</span>` : `Play the story <span class="amt">+${money(d.reward_cents / 100)}</span>`}</button>
    </div>
  </div>`;
};
routes["game/:id"].tab = "play";

/* ---------- impact: real outcomes derived from the paid studies ---------- */
function impactCard(it) {
  const r = it.researcher;
  return `
  <button class="card impact-card" data-act="open-finding" data-id="${it.study}" aria-label="Read the finding: ${esc(it.headline)}">
    <span class="impact-art">
      <img src="${esc(it.poster)}" alt="" loading="lazy" decoding="async">
      <span class="grid-shade" aria-hidden="true"></span>
      <span class="grid-kind">${esc(it.chip || "Study")}</span>
      ${it.yours ? `<span class="impact-yours">${icon("check")} You contributed</span>` : ""}
    </span>
    <span class="impact-body">
      <span class="impact-date num">${esc(it.date)}</span>
      <span class="impact-headline">${esc(it.headline)}</span>
      <span class="impact-desc">${esc(it.description)}</span>
      <span class="impact-who">
        ${r ? photoAvatar(r, "avatar-sm") : `<span class="avatar avatar-sm" aria-hidden="true">E</span>`}
        <span class="grow">
          <span class="impact-name">${esc(r ? r.name : "EARNest research")}${r ? icon("verified") : ""}</span>
          <span class="impact-org">${esc(r ? r.org : "")}</span>
        </span>
        <span class="pill impact-answers num">${icon("comment")} ${it.answers} answers</span>
      </span>
      <span class="impact-study">${icon("reel")}<span class="grow">${esc(it.paperTitle || it.studyTitle)}</span></span>
      <span class="impact-foot">read the finding ${icon("chevron")}</span>
    </span>
  </button>`;
}
routes.impact = (el) => {
  el.innerHTML = `
  <div class="view" data-glow="lav">
    <h1 class="h-view">Your impact</h1>
    <div class="impact-list">
      ${impact.map((it) => impactCard(it)).join("")}
    </div>
  </div>`;
};
routes.impact.tab = "impact";

/* ---------- finding page: the researcher's finding, how the answers built
   it, and the chain from finding to impact ---------- */
routes["finding/:id"] = async (el, id) => {
  const seq = renderSeq;
  el.innerHTML = `<div class="view" data-glow="lav">${topbar("the finding")}<div class="empty">${icon("star")}<p>Loading the finding…</p></div></div>`;
  let d;
  try { d = await api(`/api/impact/${id}`); } catch (e) { if (seq === renderSeq) { toast(e.message); back(); } return; }
  if (seq !== renderSeq) return;
  const r = d.researcher;
  const maxDist = Math.max(1, ...d.questions.flatMap((qq) => (qq.dist || []).map((x) => x.n)));
  el.innerHTML = `
  <div class="view finding-view" data-glow="lav">
    ${topbar("the finding")}
    <div class="card finding-hero">
      <span class="impact-art finding-art">
        <img src="${esc(d.poster)}" alt="Frame from the study's wired video">
        <span class="grid-shade" aria-hidden="true"></span>
        <span class="grid-kind">${esc(d.study.chip || "Study")}</span>
      </span>
      <span class="finding-hero-body">
        <span class="impact-date num">${esc(d.date)}</span>
        <h1 class="finding-headline">${esc(d.headline)}</h1>
        <span class="impact-who">
          ${r ? photoAvatar(r) : `<span class="avatar" aria-hidden="true">E</span>`}
          <span class="grow">
            <span class="impact-name">${esc(r ? r.name : "EARNest research")}${r ? icon("verified") : ""}</span>
            <span class="impact-org">${esc(r ? r.org : "")}</span>
          </span>
          ${r ? `<button class="follow-chip" data-act="follow" data-id="${r.id}" aria-pressed="${!!state.follows[r.id]}">${state.follows[r.id] ? "Following" : "Follow"}</button>` : ""}
        </span>
        <span class="impact-study">${icon("reel")}<span class="grow">${esc(d.paper ? d.paper.title : d.study.title)}</span></span>
      </span>
    </div>

    <div class="sect-label">The finding</div>
    <div class="card reader-section finding-summary">
      <p class="finding-lead">${esc(d.story.findingPlain)}</p>
    </div>

    <div class="sect-label">How your answers built this finding</div>
    <p class="finding-intro">Each question had a job. Here's what it measured, what people actually said, and how it fed the finding.</p>
    ${d.questions.map((qq, i) => `
    <div class="card finding-q">
      <div class="finding-q-head"><span class="finding-q-n num">${i + 1}</span><b>${esc(qq.q)}</b></div>
      <p class="finding-measure">${esc(qq.measure)}</p>
      ${qq.dist && qq.dist.length ? `<div class="dist">${qq.dist.map((x) => `
        <div class="dist-row"><span class="dist-lbl">${esc(x.label)}</span><span class="dist-track"><i style="transform:scaleX(${(x.n / maxDist).toFixed(3)})"></i></span><span class="dist-n num">${x.n}</span></div>`).join("")}
      </div>` : ""}
      ${qq.quotes && qq.quotes.length ? `<div class="finding-quotes">${qq.quotes.map((x) => `
        <blockquote class="finding-quote">\u201c${esc(x.text)}\u201d<cite>${x.you ? "You" : esc(x.name)}</cite></blockquote>`).join("")}
      </div>` : ""}
      <p class="finding-link">${icon("bolt")}<span>${esc(qq.link)}</span></p>
    </div>`).join("")}

    <div class="sect-label">What the researchers did with it</div>
    <div class="card reader-section"><p>${esc(d.story.howUsed)}</p></div>

    <div class="sect-label">From finding to impact</div>
    <div class="chain">
      ${d.story.impactChain.map((s, i) => `
      <div class="chain-step">
        <span class="chain-n num">${i + 1}</span>
        <span class="chain-body"><b>${esc(s.title)}</b><p>${esc(s.text)}</p></span>
      </div>`).join("")}
    </div>

    ${d.paper ? `<button class="btn btn-ink btn-wide" style="margin-top:var(--space-md)" data-act="open-paper" data-id="${d.paper.id}">${icon("comment")} Read the paper</button>` : ""}
    <button class="btn btn-wide" style="margin-top:var(--space-sm)" data-act="open-study-reel" data-id="${d.study.id}">${icon("reel")} See the study in the feed</button>
  </div>`;
};
routes["finding/:id"].tab = "impact";

/* ---------- search (server-matched, personalized order, pull-to-refresh) ---- */
routes.search = async (el, prefetched) => {
  /* release any grid videos from the previous paint before replacing the DOM —
     detached media elements can keep downloading on iOS */
  el.querySelectorAll(".grid-card video").forEach((v) => { v.pause(); if (v.getAttribute("src")) { v.removeAttribute("src"); v.load(); } });
  const q = el.dataset.q || "";
  const ql = q.trim().toLowerCase();
  const searchPath = `/api/search?q=${encodeURIComponent(q)}`;
  const cached = prefetched || apiCache.get(searchPath);
  const d = cached || { researchers: [], papers: [], studies: [], discoveries: [] };
  if (gridObs) { gridObs.disconnect(); gridObs = null; }
  const people = d.researchers.slice(0, 3).map((r) => [r.id, r]);
  state.searchGrid = [
    ...d.studies.map((it) => ({ it, r: researchers[it.researcher] })),
    ...d.discoveries.map((it) => ({ it, r: it.researcher ? researchers[it.researcher] : null })),
  ];
  el.innerHTML = `
  <div class="ptr-zone" id="ptr-zone">
    <div class="ptr-indicator" id="ptr-indicator" aria-hidden="true"><span class="ptr-ring"></span><span class="ptr-label">Pull for fresh picks</span></div>
    <div class="view search-view" data-glow="mixed">
      <div class="topline"><span class="topline-title">search</span></div>
      <div class="searchwrap field">
        ${icon("search")}
        <label class="visually-hidden" for="search-in">Search profiles or research papers</label>
        <input class="input" id="search-in" type="search" placeholder="Search profiles or research papers" value="${esc(q)}" autocomplete="off">
      </div>
      ${ql && !people.length && !state.searchGrid.length ? `<div class="empty">${icon("search")}<p>Nothing matches that yet</p><span style="font-size:var(--text-sm)">Try a researcher name or a paper topic</span></div>` : ""}
      ${people.length ? `<div class="sect-label">People</div><div class="result-list">${people.map(([id, r]) => resultCard(id, r)).join("")}</div>` : ""}
      <div class="sect-label">Reels & findings</div>
      ${state.searchGrid.length ? `<div class="paper-grid">${state.searchGrid.map((g) => gridCard(g)).join("")}</div>` : `<div class="empty">${icon("reel")}<p>No reels match that yet</p></div>`}
      ${!ql ? `<p class="muted" style="font-size:var(--text-sm); margin-top:var(--space-md); line-height:1.55">Ordered by your match score. Pull down to refresh with new picks from the database. Tap a reel to open it full screen.</p>` : ""}
    </div>
  </div>`;
  const gridVideos = el.querySelectorAll(".grid-card video");
  if (gridVideos.length) {
    gridObs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const v = en.target;
        if (en.isIntersecting) {
          if (!v.getAttribute("src") && v.dataset.src) v.src = v.dataset.src;
          v.play().catch(() => {});
        } else if (v.getAttribute("src")) {
          /* off-screen: stop download + free the media engine, keep the src
             in data-src so scrolling back reloads it */
          v.pause(); v.removeAttribute("src"); v.load();
        }
      });
    }, { threshold: 0.4 });
    gridVideos.forEach((v) => gridObs.observe(v));
  }
  const input = el.querySelector("#search-in");
  let debounce;
  const searchSeq = renderSeq;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      /* If the user already switched tabs, this pending timer must NOT repaint
         search over the new screen — that made Play appear "not to switch"
         (hash stayed #/play while search content covered it). */
      if (searchSeq !== renderSeq || $("#screen").dataset.view !== "search") return;
      el.dataset.q = input.value;
      const pos = input.selectionStart;
      routes.search(el);
      const again = el.querySelector("#search-in");
      again.focus();
      try { again.setSelectionRange(pos, pos); } catch (err) { /* type=search */ }
    }, 220);
  });
  attachPullToRefresh(el.querySelector("#ptr-zone"), $("#screen"), async () => {
    const fresh = await api(`/api/search?q=${encodeURIComponent(el.dataset.q || "")}`);
    apiCache.set(`/api/search?q=${encodeURIComponent(el.dataset.q || "")}`, fresh);
    state.searchGrid = [
      ...fresh.studies.map((it) => ({ it, r: researchers[it.researcher] })),
      ...fresh.discoveries.map((it) => ({ it, r: it.researcher ? researchers[it.researcher] : null })),
    ];
    const grid = el.querySelector(".paper-grid");
    if (grid) grid.innerHTML = state.searchGrid.map((g) => gridCard(g)).join("");
    toast("Fresh picks, matched to you.");
  }, el.querySelector(".search-view"));
  if (!prefetched) {
    const seq = renderSeq;
    api(searchPath).then((fresh) => {
      apiCache.set(searchPath, fresh);
      if (seq !== renderSeq || $("#screen").dataset.view !== "search") return;
      const inp = el.querySelector("#search-in");
      if (inp && document.activeElement === inp) return; // mid-typing: the next keystroke repaints from cache
      if (JSON.stringify(fresh) !== JSON.stringify(cached || null)) routes.search(el, fresh);
    }).catch(() => {});
  }
};
routes.search.tab = "search";

function resultCard(id, r) {
  const following = !!state.follows[id];
  return `
  <div class="card result-card">
    ${photoAvatar(r)}
    <button class="result-main" data-act="open-researcher" data-id="${id}">
      <span class="result-name">${esc(r.name)}</span>
      <span class="result-sub">${esc(r.org)}</span>
    </button>
    <button class="follow-chip" data-act="follow" data-id="${id}" aria-pressed="${following}" aria-label="${following ? "Unfollow" : "Follow"} ${esc(r.name)}">${following ? "Following" : "Follow"}</button>
  </div>`;
}

/* ---------- researcher profile ---------- */
routes["researcher/:id"] = (el, id) => {
  const r = researchers[id];
  if (!r) { go("#/search"); return; }
  const following = !!state.follows[id];
  el.innerHTML = `
  <div class="view" data-glow="mixed">
    ${topbar("profile")}
    <div class="rp-head">
      ${photoAvatar(r, "avatar-lg")}
      <div class="grow">
        <div class="rp-name">${esc(r.name)}</div>
        <div class="rp-org">${icon("verified")} ${esc(r.org)}</div>
        <div class="rp-since num">${esc(r.since || "On EARNest since 2026")}</div>
      </div>
      <button class="follow-chip" data-act="follow" data-id="${id}" aria-pressed="${following}">${following ? "Following" : "Follow"}</button>
    </div>
    <div class="sect-label">Awards</div>
    <div class="card">${r.awards.length ? r.awards.map((a) => `
      <div class="award-row">${icon(a.icon)}<span class="award-txt">${esc(a.text)}</span></div>`).join("") : `<div class="award-row muted">none listed</div>`}</div>
    <div class="sect-label">Published papers</div>
    <div class="card" style="padding:var(--space-2xs) 0">${r.papers.map((p) => `
      <button class="paper-row" data-act="open-paper" data-id="${p.id}">
        <span class="paper-title">${esc(p.title)}</span><span class="paper-year num">${esc(p.year)}</span>${icon("chevron", "chev")}
      </button>`).join("")}</div>
    <div class="sect-label">Ask ${esc(r.name.split(" ")[0])}</div>
    <div class="card" style="padding:var(--space-md)">
      <div class="field"><label for="ask-in">An AI answer covers FAQs first; new questions reach the researcher</label>
      <input class="input" id="ask-in" type="text" placeholder="Type your question" autocomplete="off"></div>
      <button class="btn btn-wide btn-sm" style="margin-top:var(--space-sm)" data-act="ask" data-id="${id}">Send question</button>
    </div>
  </div>`;
};
routes["researcher/:id"].tab = "search";

function topbar(title) {
  return `<div class="topline"><button class="iconbtn" data-back aria-label="Back">${icon("back")}</button><span class="topline-title">${esc(title)}</span></div>`;
}

/* ---------- paper (free to read) ---------- */
routes["paper/:id"] = (el, id) => {
  const p = papers[id];
  if (!p) { go("#/impact"); return; }
  el.innerHTML = `
  <div class="view" data-glow="blue">
    ${topbar("paper")}
    <div class="card paper-hero">
      <h1 class="paper-title-lg">${esc(p.title)}</h1>
      <p class="paper-authors">${esc(p.authors)}</p>
      ${p.published_at ? `<p class="muted num" style="font-size:var(--text-xs)">${esc(String(p.published_at).slice(0, 10))}</p>` : ""}
    </div>
    <div class="sect-label">Abstract</div>
    <div class="card" style="padding:var(--space-md)">
      <p class="abstract-text">${esc(p.abstract)}</p>
    </div>
    ${p.url ? `<a class="btn btn-ink btn-wide" style="margin-top:var(--space-md)" href="${esc(p.url)}" target="_blank" rel="noopener">Read the full paper ${icon("chevron", "chev")}</a>` : ""}
    <p class="muted" style="font-size:var(--text-xs); margin-top:var(--space-sm)">Free to read on EARNest — the authors publish open access.</p>
  </div>`;
};
routes["paper/:id"].tab = "impact";

/* ---------- in-app source reader (stays inside the app) ---------- */
routes["reader/:id"] = async (el, ref) => {
  const seq = renderSeq;
  const sep = String(ref).indexOf("~");
  const kind = sep >= 0 ? String(ref).slice(0, sep) : "post";
  const id = sep >= 0 ? String(ref).slice(sep + 1) : String(ref);
  el.innerHTML = `<div class="view" data-glow="blue">${topbar("read the source")}<div class="empty">${icon("comment")}<p>Loading the source…</p></div></div>`;
  let doc;
  try { doc = await api(`/api/reader/${kind}/${id}`); } catch (e) { if (seq === renderSeq) { toast(e.message); back(); } return; }
  /* a swipe-back may have landed while the source was loading — never paint
     over the page the user returned to */
  if (seq !== renderSeq) return;
  /* Plain-English blog layout for revamped discovery posts */
  if (doc.blog && doc.blog.length) {
    el.innerHTML = `
    <div class="view reader-view" data-glow="blue">
      ${topbar("read the source")}
      <article class="blog">
        <header class="blog-head">
          <span class="pill pill-blue">${esc(doc.source || "Source")}</span>
          <h1 class="blog-title">${esc(doc.title)}</h1>
          ${doc.sub ? `<p class="blog-deck">${esc(doc.sub)}</p>` : ""}
          ${doc.authors && doc.authors.length ? `<p class="blog-byline">${esc(doc.authors.join(", "))}</p>` : ""}
          ${doc.date ? `<p class="blog-byline num">Published ${esc(String(doc.date).slice(0, 10))}</p>` : ""}
        </header>
        ${doc.blog.map((s) => `<section class="blog-sect"><h2>${esc(s.h)}</h2>${(s.p || []).map((p) => `<p>${esc(p)}</p>`).join("")}</section>`).join("")}
        ${doc.url ? `<a class="btn btn-wide blog-original" href="${esc(doc.url)}" target="_blank" rel="noopener">Open the original ${icon("chevron", "chev")}</a>` : ""}
      </article>
    </div>`;
    return;
  }
  el.innerHTML = `
  <div class="view reader-view" data-glow="blue">
    ${topbar("read the source")}
    <div class="card paper-hero">
      <span class="pill pill-blue">${esc(doc.source || "Source")}</span>
      <h1 class="paper-title-lg" style="margin-top:var(--space-xs)">${esc(doc.title)}</h1>
      ${doc.authors && doc.authors.length ? `<p class="paper-authors">${esc(doc.authors.join(", "))}</p>` : ""}
      ${doc.date ? `<p class="muted num" style="font-size:var(--text-xs)">${esc(String(doc.date).slice(0, 10))}</p>` : ""}
    </div>
    ${doc.abstract ? `<div class="sect-label">Abstract</div><div class="card" style="padding:var(--space-md)"><p class="abstract-text">${esc(doc.abstract)}</p></div>` : ""}
    ${(doc.sections || []).map((s) => `<div class="sect-label">${esc(s.h)}</div><div class="card reader-section">${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`).join("")}
    ${doc.full ? "" : `<p class="muted" style="font-size:var(--text-xs); margin-top:var(--space-sm)">Showing the abstract${doc.url ? " — the full text lives at the source below" : ""}.</p>`}
    ${doc.url ? `<a class="btn btn-wide" style="margin-top:var(--space-md)" href="${esc(doc.url)}" target="_blank" rel="noopener">Open the original ${icon("chevron", "chev")}</a>` : ""}
  </div>`;
};
routes["reader/:id"].tab = "feed";

/* ---------- profile hub ---------- */
routes.profile = (el) => {
  const boost = state.multiplier.active && state.multiplier.left > 0;
  el.innerHTML = `
  <div class="view" data-glow="amber">
    <div class="rp-head">
      ${photoAvatar(me, "avatar-lg")}
      <div class="grow">
        <div class="rp-name">${esc(me.name)}</div>
        <div class="rp-since num">Respondent since June 2026</div>
      </div>
      <button class="iconbtn" data-act="edit-me" aria-label="Edit your profile">${icon("pencil")}</button>
    </div>
    <div class="card wallet-card" data-go="#/wallet" role="button" tabindex="0" aria-label="Open your wallet">
      <span class="wallet-sum"><b data-wallet>${money(state.wallet)}</b><small>earned</small></span>
      <span class="wallet-side">
        <span class="pill pill-earn">${icon("flame")} <span class="num">${state.streakDay}</span>-day streak</span>
        ${boost
          ? `<span class="pill pill-blue">${icon("bolt")} 2x · <span class="num">${state.multiplier.left}</span> answers left</span>`
          : `<span class="pill">7 days opens a 2x window</span>`}
      </span>
    </div>
    <div class="sect-label">Money</div>
    <div class="menu">
      <button class="menu-row" data-go="#/wallet">${icon("chest")} Wallet & withdrawals ${icon("chevron", "chev")}</button>
      <button class="menu-row" data-go="#/payments">${icon("lock")} Payment methods ${icon("chevron", "chev")}</button>
    </div>
    <div class="sect-label">Respond</div>
    <div class="menu">
      <button class="menu-row" data-go="#/rprofile">${icon("person")} Respondent profile ${icon("chevron", "chev")}</button>
      <button class="menu-row" data-go="#/completed">${icon("check")} My completed surveys ${icon("chevron", "chev")}</button>
    </div>
    <div class="card" style="margin-top:var(--space-md); box-shadow:none">
      <div class="toggle-row">
        <span class="toggle-txt"><b>Researcher mode</b><small>Like creators switching to business accounts</small></span>
        <button class="toggle" role="switch" aria-checked="${state.researcherMode}" aria-label="Researcher mode" data-act="toggle-researcher"></button>
      </div>
      ${state.researcherMode ? `
      <div class="menu" style="border:0; border-top:var(--rule-hair) solid var(--color-rule); border-radius:0; box-shadow:none">
        <button class="menu-row" data-go="#/researcher/wang-ming">${icon("person")} Researcher profile ${icon("chevron", "chev")}</button>
        <button class="menu-row" data-go="#/dashboard">${icon("pulse")} Research dashboard ${icon("chevron", "chev")}</button>
      </div>` : ""}
    </div>
    <div class="sect-label">Checks passed</div>
    <div class="card quality">
      <span class="quality-row">${icon("check", "q-ok")} identity verified</span>
      <span class="quality-row">${icon("check", "q-ok")} anti-bot check cleared</span>
      <span class="quality-row">${icon("check", "q-ok")} behavioural consistency: clean record</span>
    </div>
    <button class="btn btn-wide signout-btn" data-act="sign-out">Sign out</button>
    <button class="btn btn-wide delete-btn" data-act="delete-account">Delete account</button>
  </div>`;
};
routes.profile.tab = "profile";

/* ---------- respondent profile ---------- */
routes.rprofile = (el) => {
  el.innerHTML = `
  <div class="view" data-glow="blue">
    ${topbar("respondent profile")}
    <div class="card" style="padding:var(--space-md); display:flex; flex-direction:column; gap:var(--space-md)">
      <div class="field"><label for="rp-name">Name</label><input class="input" id="rp-name" type="text" value="${esc(state.user.name)}"></div>
      <div class="field"><label for="rp-int">Interests, used to match studies</label><input class="input" id="rp-int" type="text" value="${esc(state.user.interests || "")}"></div>
      <div class="field"><label for="rp-win">When do you answer? commute, waiting rooms, queues</label><input class="input" id="rp-win" type="text" value="${esc(state.user.answer_windows || "")}"></div>
      <button class="btn btn-ink btn-wide" data-act="save-rprofile">Save</button>
    </div>
    <div class="sect-label">Matching</div>
    <div class="card" style="padding:var(--space-md)">
      <p class="muted" style="font-size:var(--text-sm); line-height:1.55; margin-bottom:var(--space-sm)">Your feed is ranked by a matching model: the topics you picked at signup seed it, and every like, completion and skip updates it in real time.</p>
      <button class="btn btn-wide btn-sm" data-go="#/onboarding">${icon("star")} ${state.preferences ? "Edit my topics" : "Pick my topics"}</button>
    </div>
  </div>`;
};
routes.rprofile.tab = "profile";

/* ---------- completed ---------- */
routes.completed = (el) => {
  el.innerHTML = `
  <div class="view" data-glow="amber">
    ${topbar("my completed surveys")}
    ${state.completed.length ? `<div class="menu">
      ${state.completed.map((c) => `
      <div class="menu-row menu-static">
        ${icon("check", "q-ok")}
        <span class="grow"><b style="font-weight:700; display:block; letter-spacing:var(--tracking-display)">${esc(c.title)}</b><span class="muted" style="font-size:var(--text-sm)">${esc(c.org)} · <span class="num">${esc(c.date)}</span></span></span>
        <span class="pill pill-money num">+${money(c.reward)}</span>
      </div>`).join("")}
    </div>` : `<div class="empty">${icon("reel")}<p>Nothing answered yet</p><span style="font-size:var(--text-sm)">Open the reels and send your first study</span></div>`}
    <p class="muted" style="font-size:var(--text-sm); margin-top:var(--space-md); line-height:1.55">Total earned: <b class="num" data-wallet>${money(state.wallet)}</b>. Withdraw to a card, bank or PayPal from your wallet; the platform's cut is taken once, at withdrawal.</p>
  </div>`;
};
routes.completed.tab = "profile";

/* ---------- researcher dashboard (API-backed) ---------- */
routes.dashboard = async (el) => {
  el.innerHTML = `<div class="view" data-glow="blue">${topbar("research dashboard")}<div class="empty">${icon("pulse")}<p>Loading dashboard…</p></div></div>`;
  let d;
  try { d = await api("/api/dashboard"); } catch (e) { toast(e.message); return; }
  const groups = {};
  for (const sv of d.surveys) (groups[sv.month] = groups[sv.month] || []).push(sv);
  el.innerHTML = `
  <div class="view" data-glow="blue">
    ${topbar("research dashboard")}
    <div class="stat-ring"><b>${d.published}</b></div>
    <div class="stat-cap">surveys published</div>
    <div class="sect-label">my surveys</div>
    ${Object.entries(groups).map(([month, items]) => `
      <div class="group-label">${esc(month)}</div>
      <div class="menu">${items.map((sv) => `
        <button class="menu-row" data-go="#/responses/${sv.id}">${icon("comment")} ${esc(sv.title)} ${icon("chevron", "chev")}</button>`).join("")}</div>
    `).join("")}
    ${d.games && d.games.length ? `
    <div class="sect-label">my games</div>
    <div class="menu">
      ${d.games.map((g) => `
      <button class="menu-row" data-go="#/game-plays/${g.id}">${icon("gamepad")} <span class="grow">${esc(g.title)}<span class="muted" style="font-size:var(--text-sm); display:block"><span class="num">${g.plays}</span> plays · +${money(g.reward_cents / 100)} each</span></span>${icon("chevron", "chev")}</button>`).join("")}
    </div>` : ""}
    <p class="muted" style="font-size:var(--text-sm); margin-top:var(--space-md); line-height:1.55">Every answer arriving here has passed the quality screen: consistency, attention gates and interaction pattern.</p>
  </div>`;
};
routes.dashboard.tab = "profile";

/* ---------- responses list ---------- */
routes["responses/:id"] = async (el, id) => {
  el.innerHTML = `<div class="view" data-glow="blue">${topbar("responses")}<div class="empty">${icon("comment")}<p>Loading responses…</p></div></div>`;
  let d;
  try { d = await api(`/api/responses/${id}`); } catch (e) { if (!el.isConnected) return; toast(e.message); go("#/dashboard"); return; }
  if (!el.isConnected) return;
  el.innerHTML = `
  <div class="view" data-glow="blue">
    ${topbar("responses")}
    <p class="muted" style="font-size:var(--text-sm); margin-bottom:var(--space-sm)">${esc(d.title)}</p>
    <button class="btn btn-wide" style="margin-bottom:var(--space-md)" data-go="#/aggregate/${id}">See aggregate data</button>
    <div class="row" style="gap:var(--space-xs); margin-bottom:var(--space-md); align-items:flex-start">
      <div class="searchwrap field grow" style="margin:0">
        ${icon("search")}
        <label class="visually-hidden" for="resp-q">Filter responses</label>
        <input class="input" id="resp-q" type="search" placeholder="filter responses" style="min-height:44px">
      </div>
      <button class="iconbtn" data-act="sort-resp" aria-label="Sort responses" style="margin-top:26px">${icon("sort")}</button>
      <button class="iconbtn" data-act="save-all" aria-label="Save all responses" style="margin-top:26px">${icon("bookmark")}</button>
    </div>
    ${d.responses.length ? `<div class="menu">
      ${d.responses.map((r) => `
      <button class="menu-row" data-go="#/response/${id}/${r.id}" style="font-weight:500">
        <span style="flex:none">${photoAvatar(r, "avatar-sm")}</span>
        <span class="grow"><b style="font-weight:700; display:block">${esc(r.name)}</b><span class="muted" style="font-size:var(--text-sm)"><span class="num">${esc(r.date)}</span></span></span>
        ${r.flagged ? `<span class="pill pill-flag">${r.bot_prob >= 0.8 ? "likely bot" : "flagged"}</span>` : `<span class="pill pill-blue">${icon("check")}</span>`}
        <span class="muted num" style="font-size:var(--text-xs); flex:none" title="Bot likelihood">${Math.round((r.bot_prob || 0) * 100)}%</span>
        ${icon("chevron", "chev")}
      </button>`).join("")}
    </div>` : `<div class="empty">${icon("comment")}<p>No responses yet for this survey</p></div>`}
    <p class="muted" style="font-size:var(--text-xs); margin-top:var(--space-sm)">Flagged responses are held for review before they count in aggregates.</p>
  </div>`;
  const q = el.querySelector("#resp-q");
  q.addEventListener("input", () => {
    const v = q.value.toLowerCase();
    el.querySelectorAll(".menu-row").forEach((row) => { row.hidden = v && !row.textContent.toLowerCase().includes(v); });
  });
};
routes["responses/:id"].tab = "profile";

/* ---------- single response (paradata beside each question) ---------- */
routes["response/:id"] = async (el, id, rid) => {
  el.innerHTML = `<div class="view" data-glow="blue">${topbar("response")}<div class="empty">${icon("pulse")}<p>Loading response…</p></div></div>`;
  let r;
  try { r = await api(`/api/response/${id}/${rid}`); } catch (e) { if (!el.isConnected) return; toast(e.message); go(`#/responses/${id}`); return; }
  if (!el.isConnected) return;
  const reasonText = { consistency: "conflict with an earlier submission", attention: "missed the embedded gate", automation: "automated-response profile", speed: "under the human pace median", bot: "bot-likelihood model fired", review: "held for human review", paste: "external paste pattern" };
  const reasonFor = (k) => (r.reasons || []).includes(k);
  const pq = r.per_question || [];
  const botPct = Math.round((r.bot_prob || 0) * 100);
  el.innerHTML = `
  <div class="view" data-glow="blue">
    ${topbar(`${r.name}, ${r.date}`)}
    <p class="muted" style="font-size:var(--text-sm); margin-bottom:var(--space-md)">${esc(r.title)}</p>
    <div class="card chart-card">
      <div class="chart-head"><b>Answer pace</b><span class="pill ${botPct >= 50 ? "pill-flag" : "pill-blue"} num">${botPct}% bot likelihood</span></div>
      ${paceChart(r.timings || [])}
    </div>
    <div class="sect-label">Answers & paradata</div>
    <div class="card" style="padding:0">
      ${r.answers.map((a, i) => {
        const p = pq[i] || {};
        const chips = [];
        if (p.time_s != null) chips.push(`${p.time_s}s`);
        if (p.first_input_s != null) chips.push(`first input ${p.first_input_s}s`);
        if (p.wpm) chips.push(`${p.wpm} wpm`);
        if (p.keys) chips.push(`${p.keys} keys`);
        if (p.backspaces) chips.push(`${p.backspaces} edits`);
        if (p.pastes) chips.push(`pasted ×${p.pastes}`);
        if (p.focus_loss) chips.push(`left tab ×${p.focus_loss}`);
        if (p.injected) chips.push(`injected text`);
        if (p.attention_correct === true) chips.push("gate passed");
        if (p.attention_correct === false) chips.push("gate failed");
        return `
      <div class="qa-block">
        <div class="qa-q num">${i + 1}. ${esc((r.questions && r.questions[i] && r.questions[i].q) || "answer")}</div>
        <div class="qa-a">${esc(a)}</div>
        ${chips.length ? `<div class="paradata-chips">${chips.map((c) => `<span class="pd-chip${/pasted|injected|failed|left tab/.test(c) ? " pd-warn" : ""}">${esc(c)}</span>`).join("")}</div>` : ""}
        <div class="qa-note"><b>analysis:</b> ${esc(r.notes[i] || (p.time_s != null ? `Completed in ${p.time_s}s${p.wpm ? `, typing at ${p.wpm} wpm` : ""}${p.pastes ? "; answer arrived by paste" : ""}.` : "No anomalies detected."))}</div>
      </div>`; }).join("")}
    </div>
    <div class="sect-label">Response quality · score <span class="num">${r.score}</span>/100</div>
    <div class="card quality">
      <span class="quality-row">${icon("check", reasonFor("consistency") ? "q-flag" : "q-ok")} answer consistency ${reasonFor("consistency") ? "· " + reasonText.consistency : "· clean"}</span>
      <span class="quality-row">${icon("shield", reasonFor("attention") ? "q-flag" : "q-ok")} attention checks ${reasonFor("attention") ? "· " + reasonText.attention : "· passed"}</span>
      <span class="quality-row">${icon("pulse", reasonFor("automation") || reasonFor("speed") ? "q-flag" : "q-ok")} interaction pattern ${reasonFor("automation") ? "· " + reasonText.automation : reasonFor("speed") ? "· " + reasonText.speed : "· human cadence"}</span>
      <span class="quality-row">${icon("search", reasonFor("paste") ? "q-flag" : "q-ok")} paste & injection ${reasonFor("paste") ? "· external-tool pattern" : "· typed in-app"}</span>
      ${r.flagged
        ? `<span class="pill pill-flag" style="align-self:flex-start">${icon("lock")} ${r.bot_prob >= 0.8 ? "likely bot · no pay, out of aggregates" : "flagged · held for manual review, out of aggregates"}</span>`
        : `<span class="pill pill-blue" style="align-self:flex-start">${icon("check")} cleared for the researcher</span>`}
    </div>
  </div>`;
};
routes["response/:id"].tab = "profile";

/* real data charts (no hardcoded polylines) */
function paceChart(timings) {
  const t = (timings || []).map(Number).filter((x) => x > 0);
  if (!t.length) return `<p class="muted" style="font-size:var(--text-sm)">No timing telemetry for this response.</p>`;
  const max = Math.max(...t, 1);
  const W = 306, H = 146, pad = 8;
  const bw = (W - pad * 2) / t.length;
  const bars = t.map((ms, i) => {
    const h = Math.max(4, (ms / max) * (H - 30));
    const x = pad + i * bw + bw * 0.18;
    const fast = ms < 900;
    return `<rect class="pace-bar${fast ? " pace-fast" : ""}" x="${x.toFixed(1)}" y="${(H - 10 - h).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>Q${i + 1}: ${(ms / 1000).toFixed(1)}s</title></rect>
    <text class="pace-lbl" x="${(x + bw * 0.32).toFixed(1)}" y="${H - 1}" text-anchor="middle">${i + 1}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Seconds spent per question">${bars}</svg>
  <p class="muted" style="font-size:var(--text-xs)">Seconds per question · red bars are under the 0.9s reading floor.</p>`;
}
function distBars(options, dist, total) {
  if (!options || !options.length) return "";
  const max = Math.max(...dist, 1);
  return `<div class="dist">${options.map((o, i) => `
    <div class="dist-row">
      <span class="dist-lbl">${esc(o)}</span>
      <span class="dist-track"><i style="transform:scaleX(${(dist[i] / max).toFixed(3)})"></i></span>
      <span class="dist-n num">${dist[i]}${total ? ` · ${Math.round(100 * dist[i] / total)}%` : ""}</span>
    </div>`).join("")}</div>`;
}

/* ---------- aggregate (computed from paradata, per-question analysis) ---------- */
routes["aggregate/:id"] = async (el, id) => {
  el.innerHTML = `<div class="view" data-glow="lav">${topbar("aggregate data")}<div class="empty">${icon("pulse")}<p>Loading aggregates…</p></div></div>`;
  let d;
  try { d = await api(`/api/aggregate/${id}`); } catch (e) { if (!el.isConnected) return; toast(e.message); go(`#/responses/${id}`); return; }
  if (!el.isConnected) return;
  const pace = d.pace || [];
  const medianTotal = pace.length ? pace.slice().sort((a, b) => a - b)[Math.floor(pace.length / 2)] : 0;
  el.innerHTML = `
  <div class="view" data-glow="lav">
    ${topbar("aggregate data")}
    <p class="muted" style="font-size:var(--text-sm); margin-bottom:var(--space-md)">${esc(d.title)} · <span class="num">${d.cleared}</span> cleared, <span class="num">${d.held}</span> held for review</p>
    <div class="stat-row">
      <div class="card stat-mini"><b class="num">${d.n}</b><span>responses</span></div>
      <div class="card stat-mini"><b class="num">${Math.round((d.mean_bot_prob || 0) * 100)}%</b><span>mean bot likelihood</span></div>
      <div class="card stat-mini"><b class="num">${d.bot_high || 0}</b><span>likely bots</span></div>
      <div class="card stat-mini"><b class="num">${medianTotal ? (medianTotal / 1000).toFixed(0) + "s" : "—"}</b><span>median completion</span></div>
    </div>
    <div class="sect-label">Question-level analysis</div>
    <div class="card" style="padding:0">
      ${(d.per_question || []).map((qq) => `
      <div class="qa-block">
        <div class="qa-q num">${qq.i + 1}. ${esc(qq.q)}</div>
        ${qq.type === "opts" ? distBars(qq.options, qq.dist, d.n) : ""}
        <div class="qa-note"><b>analysis:</b> ${qq.analysis.map(esc).join(" ")}</div>
      </div>`).join("") || `<div class="qa-block"><div class="qa-a muted">No responses yet.</div></div>`}
    </div>
    <p class="muted" style="font-size:var(--text-xs); margin-top:var(--space-sm); line-height:1.6">Analysis is computed from response paradata: per-gate timing, keystroke dynamics, paste and focus events, and the bot-likelihood model. Flagged responses are excluded from option distributions.</p>
  </div>`;
};
routes["aggregate/:id"].tab = "profile";

/* ---------- auth screens ---------- */
function oauthButtons() {
  const demo = !state.oauth.google.configured && !state.oauth.apple.configured;
  return `
    <button class="btn btn-wide oauth-btn" data-act="oauth" data-id="google"><svg class="brand-ic" aria-hidden="true"><use href="#i-google"/></svg>Continue with Google</button>
    <button class="btn btn-wide oauth-btn oauth-apple" data-act="oauth" data-id="apple"><svg class="brand-ic brand-ic-apple" aria-hidden="true"><use href="#i-apple"/></svg>Continue with Apple</button>
    ${demo ? `<p class="auth-note">Demo sign-in is active. <a href="#" data-act="setup-google">Connect real Google sign-in</a> or <a href="#" data-act="setup-apple">Apple</a> to use your own accounts — takes a few minutes in settings.</p>` : ""}`;
}
routes.welcome = (el) => {
  el.innerHTML = `
  <div class="view auth-view" data-glow="mixed">
    <div class="auth-hero">
      <span class="auth-logo" aria-hidden="true">earnest</span>
      <h1 class="auth-title">Get paid to be curious.</h1>
      <p class="auth-sub">Short studies from real researchers, in a feed built like your favourite app. Answer, earn, withdraw.</p>
    </div>
    <div class="auth-actions">
      ${oauthButtons()}
      <div class="auth-divider" role="separator"><span>or</span></div>
      <button class="btn btn-ink btn-wide" data-go="#/register">Sign up with email</button>
      <button class="btn btn-wide" data-go="#/login">I already have an account</button>
      <p class="auth-note">Every answer passes a quality screen before it reaches a researcher. Your streaks multiply rewards; your wallet is yours to withdraw.</p>
    </div>
  </div>`;
};
routes.login = (el) => {
  el.innerHTML = `
  <div class="view auth-view" data-glow="blue">
    ${topbar("sign in")}
    <h1 class="auth-title">Welcome back</h1>
    <form id="login-form" class="auth-form" novalidate>
      <div class="field"><label for="li-email">Email</label><input class="input" id="li-email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="li-pass">Password</label><input class="input" id="li-pass" type="password" autocomplete="current-password" required></div>
      <span class="field-err" id="login-err" hidden></span>
      <button class="btn btn-ink btn-wide" type="submit">Sign in</button>
    </form>
    <div class="auth-divider" role="separator"><span>or</span></div>
    ${oauthButtons()}
    <p class="auth-note">New here? <a href="#/register">Create an account</a>. Demo account: demo@earnest.app / demo1234.</p>
  </div>`;
  el.querySelector("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = el.querySelector("#login-err");
    err.hidden = true;
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Signing in…";
    try {
      const d = await api("/api/auth/login", { body: { email: $("#li-email").value, password: $("#li-pass").value } });
      await enterApp();
      toast(`Welcome back, ${d.user.name.split(" ")[0]}.`);
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false; btn.textContent = "Sign in";
    }
  });
};
routes.register = (el) => {
  el.innerHTML = `
  <div class="view auth-view" data-glow="amber">
    ${topbar("create account")}
    <h1 class="auth-title">Start earning</h1>
    <form id="reg-form" class="auth-form" novalidate>
      <div class="field"><label for="rg-name">Name</label><input class="input" id="rg-name" type="text" autocomplete="name" required></div>
      <div class="field"><label for="rg-email">Email</label><input class="input" id="rg-email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="rg-pass">Password, at least 8 characters</label><input class="input" id="rg-pass" type="password" autocomplete="new-password" minlength="8" required></div>
      <span class="field-err" id="reg-err" hidden></span>
      <button class="btn btn-ink btn-wide" type="submit">Create account</button>
    </form>
    <div class="auth-divider" role="separator"><span>or</span></div>
    ${oauthButtons()}
    <p class="auth-note">Already registered? <a href="#/login">Sign in</a>. Identity and anti-bot checks run quietly in the background.</p>
  </div>`;
  el.querySelector("#reg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = el.querySelector("#reg-err");
    err.hidden = true;
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Creating…";
    try {
      await api("/api/auth/register", { body: { name: $("#rg-name").value, email: $("#rg-email").value, password: $("#rg-pass").value } });
      await enterApp();
      toast("Account created. Your first study is waiting in the feed.", true);
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false; btn.textContent = "Create account";
    }
  });
};
async function enterApp() {
  applyBootstrap(await api("/api/bootstrap"));
  /* new users (and existing users without stored preferences) pick interests
     first — Instagram/X-style cold start for the matching model */
  location.hash = state.preferences ? "#/feed" : "#/onboarding";
  render();
}

/* ---------- onboarding: interest picks (cold start) ---------- */
let ob = null;
routes.onboarding = async (el) => {
  let cat;
  try { cat = await api("/api/onboarding/topics"); } catch { cat = { topics: [], goals: [], formats: [], windows: [] }; }
  const existing = state.preferences;
  ob = {
    step: 0,
    topics: new Set(existing ? existing.topics : []),
    fields: new Set(existing ? existing.fields : []),
    goals: new Set(existing ? existing.goals : []),
    formats: new Set(existing ? existing.formats : []),
    windows: new Set(existing && existing.windows ? existing.windows.split(",").filter(Boolean) : []),
    cat,
  };
  paintOnboarding(el);
};
routes.onboarding.tab = "feed";
function paintOnboarding(el) {
  const { step, cat } = ob;
  const steps = ["Topics", "Refine", "You"];
  const head = `
    <div class="ob-head">
      <span class="auth-logo" aria-hidden="true">earnest</span>
      <div class="ob-steps" aria-label="Step ${step + 1} of 3">${steps.map((s, i) => `<span class="ob-step${i === step ? " on" : i < step ? " done" : ""}">${i < step ? icon("check") : `<span class="num">${i + 1}</span>`} ${s}</span>`).join("")}</div>
    </div>`;
  let body = "";
  if (step === 0) {
    body = `
      <h1 class="ob-title">What are you curious about?</h1>
      <p class="ob-sub">Pick at least 3. Your feed is matched to these — and learns from what you actually watch, like and answer.</p>
      <div class="ob-grid" role="group" aria-label="Topics">
        ${cat.topics.map((t) => `<button class="ob-chip${ob.topics.has(t.id) ? " on" : ""}" data-ob-topic="${t.id}" aria-pressed="${ob.topics.has(t.id)}">${icon(t.icon)} ${esc(t.label)}</button>`).join("")}
      </div>`;
  } else if (step === 1) {
    const chosen = cat.topics.filter((t) => ob.topics.has(t.id));
    body = `
      <h1 class="ob-title">Go a level deeper</h1>
      <p class="ob-sub">Optional — pick the corners of your topics you care about most.</p>
      ${chosen.map((t) => `
        <div class="sect-label">${esc(t.label)}</div>
        <div class="ob-grid ob-grid-sub" role="group" aria-label="${esc(t.label)} subfields">
          ${t.fields.map((f) => `<button class="ob-chip ob-chip-sub${ob.fields.has(f) ? " on" : ""}" data-ob-field="${esc(f)}" aria-pressed="${ob.fields.has(f)}">${esc(f)}</button>`).join("")}
        </div>`).join("")}`;
  } else {
    body = `
      <h1 class="ob-title">How will you use EARNest?</h1>
      <p class="ob-sub">This tunes the mix of studies, games and findings you see.</p>
      <div class="sect-label">Here to…</div>
      <div class="ob-grid" role="group" aria-label="Goals">
        ${cat.goals.map((g) => `<button class="ob-chip${ob.goals.has(g.id) ? " on" : ""}" data-ob-goal="${g.id}" aria-pressed="${ob.goals.has(g.id)}">${esc(g.label)}</button>`).join("")}
      </div>
      <div class="sect-label">Prefer…</div>
      <div class="ob-grid" role="group" aria-label="Formats">
        ${cat.formats.map((f) => `<button class="ob-chip${ob.formats.has(f.id) ? " on" : ""}" data-ob-format="${f.id}" aria-pressed="${ob.formats.has(f.id)}">${esc(f.label)}</button>`).join("")}
      </div>
      <div class="sect-label">Answering during…</div>
      <div class="ob-grid" role="group" aria-label="Windows">
        ${cat.windows.map((w) => `<button class="ob-chip${ob.windows.has(w.id) ? " on" : ""}" data-ob-window="${w.id}" aria-pressed="${ob.windows.has(w.id)}">${esc(w.label)}</button>`).join("")}
      </div>`;
  }
  const canNext = step !== 0 || ob.topics.size >= 3;
  el.innerHTML = `
  <div class="view ob-view" data-glow="mixed">
    ${head}
    <div class="ob-body">${body}</div>
    <div class="ob-foot">
      ${step > 0 ? `<button class="btn" data-ob-back>${icon("back")} Back</button>` : `<span></span>`}
      <button class="btn btn-ink" data-ob-next ${canNext ? "" : "disabled"}>${step === 2 ? "Build my feed" : "Continue"} ${icon("chevron", "chev")}</button>
    </div>
    ${step === 0 ? `<p class="ob-count muted num" aria-live="polite">${ob.topics.size} selected${ob.topics.size < 3 ? ` · pick ${3 - ob.topics.size} more` : ""}</p>` : ""}
  </div>`;
}
async function obNext(el) {
  if (ob.step === 0 && ob.topics.size < 3) { toast("Pick at least 3 topics."); return; }
  if (ob.step < 2) { ob.step++; paintOnboarding(el); return; }
  const btn = el.querySelector("[data-ob-next]");
  btn.disabled = true; btn.textContent = "Matching…";
  try {
    const d = await api("/api/preferences", { method: "PUT", body: {
      topics: [...ob.topics], fields: [...ob.fields], goals: [...ob.goals], formats: [...ob.formats], windows: [...ob.windows].join(","),
    } });
    state.preferences = d.preferences;
    applyBootstrap(await api("/api/bootstrap"));
    toast("Your feed is matched. Pull down anytime for fresh picks.", true);
    location.hash = "#/feed";
    render();
  } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = "Build my feed"; }
}

/* ---------- wallet ---------- */
const ledgerIcon = { study: "check", game: "gamepad", paper: "lock", withdrawal: "chest", grant: "chest" };
routes.wallet = async (el) => {
  try { await refreshWallet(); } catch {}
  const boost = state.multiplier.active && state.multiplier.left > 0;
  const min = state.withdrawRules.min_cents / 100;
  const canWithdraw = state.wallet >= min;
  el.innerHTML = `
  <div class="view" data-glow="amber">
    ${topbar("wallet")}
    <div class="card wallet-card">
      <span class="wallet-sum"><b data-wallet>${money(state.wallet)}</b><small>available</small></span>
      <span class="wallet-side">
        <span class="pill pill-earn">${icon("flame")} <span class="num">${state.streakDay}</span>-day streak</span>
        ${boost ? `<span class="pill pill-blue">${icon("bolt")} 2x · <span class="num">${state.multiplier.left}</span> left</span>` : `<span class="pill">7 days opens a 2x window</span>`}
      </span>
    </div>
    <button class="btn btn-ink btn-wide" style="margin-top:var(--space-md)" data-go="#/withdraw" ${canWithdraw ? "" : "disabled"}>${icon("chest")} Withdraw</button>
    ${canWithdraw ? "" : `<p class="muted" style="font-size:var(--text-sm); margin-top:var(--space-xs)">Minimum withdrawal is ${money(min)}. Answer a study to top up.</p>`}
    <div class="sect-label">Recent activity</div>
    ${state.ledger.length ? `<div class="menu">
      ${state.ledger.map((t) => `
      <div class="menu-row menu-static">
        ${icon(ledgerIcon[t.kind] || "check", t.delta_cents >= 0 ? "q-ok" : "")}
        <span class="grow"><b style="font-weight:700; display:block; letter-spacing:var(--tracking-display)">${esc(t.note || t.kind)}</b><span class="muted" style="font-size:var(--text-sm)"><span class="num">${esc(fmtWhen(t.created_at))}</span></span></span>
        <span class="num ${t.delta_cents >= 0 ? "money-in" : "money-out"}">${t.delta_cents >= 0 ? "+" : "−"}${money(Math.abs(t.delta_cents) / 100)}</span>
      </div>`).join("")}
    </div>` : `<div class="empty">${icon("chest")}<p>No activity yet</p><span style="font-size:var(--text-sm)">Answer your first study to start the ledger</span></div>`}
    <button class="btn btn-wide" style="margin-top:var(--space-md)" data-go="#/payments">${icon("lock")} Payment methods</button>
  </div>`;
};
routes.wallet.tab = "profile";
function fmtWhen(sql) {
  const d = new Date(String(sql).replace(" ", "T") + "Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/* ---------- payment methods ---------- */
const BRAND_LABEL = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", diners: "Diners", jcb: "JCB", bank: "Bank account", paypal: "PayPal" };
function methodLabel(m) {
  if (m.kind === "bank") return `Bank ··${m.last4}`;
  if (m.kind === "paypal") return m.holder;
  return `${BRAND_LABEL[m.brand] || "Card"} ··${m.last4}`;
}
function methodSub(m) {
  if (m.kind === "card") return `expires ${String(m.exp_month).padStart(2, "0")}/${String(m.exp_year).slice(2)}`;
  if (m.kind === "bank") return m.holder;
  return "withdrawal destination";
}
routes.payments = (el) => {
  el.innerHTML = `
  <div class="view" data-glow="blue">
    ${topbar("payment methods")}
    ${state.methods.length ? `<div class="menu">
      ${state.methods.map((m) => `
      <button class="menu-row" data-act="method-options" data-id="${m.id}">
        <svg class="brand-ic brand-ic-pay" aria-hidden="true"><use href="#i-brand-${m.kind === "card" ? m.brand : m.kind}"/></svg>
        <span class="grow"><b style="font-weight:700; display:block; letter-spacing:var(--tracking-display)">${esc(methodLabel(m))}</b><span class="muted" style="font-size:var(--text-sm)">${esc(methodSub(m))}</span></span>
        ${m.is_default ? `<span class="pill pill-blue">default</span>` : ""}
        ${icon("chevron", "chev")}
      </button>`).join("")}
    </div>` : `<div class="empty">${icon("lock")}<p>No payment methods yet</p><span style="font-size:var(--text-sm)">Add a card, bank account or PayPal to withdraw your earnings</span></div>`}
    <div class="sect-label">Add a destination</div>
    <div class="auth-form">
      <button class="btn btn-ink btn-wide" data-go="#/card-new/card">${icon("plus")} Add credit or debit card</button>
      <button class="btn btn-wide" data-go="#/card-new/bank">${icon("plus")} Add bank account</button>
      <button class="btn btn-wide" data-go="#/card-new/paypal">${icon("plus")} Add PayPal</button>
    </div>
    <p class="muted" style="font-size:var(--text-xs); margin-top:var(--space-md); line-height:1.6">Card numbers are checked against the network's rules, then tokenised: EARNest stores only the brand, last four digits and expiry. Full numbers never touch the database.</p>
  </div>`;
};
routes.payments.tab = "profile";

/* ---------- add method ---------- */
routes["card-new/:id"] = (el, kind = "card") => {
  if (!["card", "bank", "paypal"].includes(kind)) kind = "card";
  const titles = { card: "add card", bank: "add bank account", paypal: "add PayPal" };
  const forms = {
    card: `
      <div class="brand-row" aria-hidden="true">
        ${["visa", "mastercard", "amex", "discover"].map((b) => `<svg class="brand-ic brand-ic-lg" data-brand="${b}"><use href="#i-brand-${b}"/></svg>`).join("")}
      </div>
      <div class="field"><label for="cc-num">Card number</label><input class="input num" id="cc-num" inputmode="numeric" autocomplete="cc-number" placeholder="1234 5678 9012 3456" maxlength="23"></div>
      <div class="field"><label for="cc-name">Name on card</label><input class="input" id="cc-name" autocomplete="cc-name" placeholder="As printed on the card"></div>
      <div class="row" style="gap:var(--space-sm)">
        <div class="field grow"><label for="cc-mm">Expiry month</label><input class="input num" id="cc-mm" inputmode="numeric" autocomplete="cc-exp-month" placeholder="MM" maxlength="2"></div>
        <div class="field grow"><label for="cc-yy">Expiry year</label><input class="input num" id="cc-yy" inputmode="numeric" autocomplete="cc-exp-year" placeholder="YY or YYYY" maxlength="4"></div>
        <div class="field grow"><label for="cc-cvc">CVC</label><input class="input num" id="cc-cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="3 digits" maxlength="4"></div>
      </div>
      <div class="field"><label for="cc-zip">Billing postcode</label><input class="input" id="cc-zip" autocomplete="postal-code" placeholder="Optional"></div>`,
    bank: `
      <div class="field"><label for="bk-name">Account holder</label><input class="input" id="bk-name" placeholder="Name on the account"></div>
      <div class="field"><label for="bk-routing">Routing number</label><input class="input num" id="bk-routing" inputmode="numeric" placeholder="9 digits" maxlength="9"></div>
      <div class="field"><label for="bk-account">Account number</label><input class="input num" id="bk-account" inputmode="numeric" placeholder="6 to 17 digits" maxlength="17"></div>`,
    paypal: `
      <div class="field"><label for="pp-email">PayPal email</label><input class="input" id="pp-email" type="email" placeholder="The email on your PayPal account"></div>`,
  };
  el.innerHTML = `
  <div class="view" data-glow="blue">
    ${topbar(titles[kind])}
    <form id="pm-form" class="auth-form" novalidate>
      ${forms[kind]}
      <span class="field-err" id="pm-err" hidden></span>
      <button class="btn btn-ink btn-wide" type="submit">${kind === "card" ? "Add card" : kind === "bank" ? "Add account" : "Link PayPal"}</button>
      <p class="muted" style="font-size:var(--text-xs); line-height:1.6">${kind === "card" ? "Visa, Mastercard, Amex and Discover are supported. The number is validated, tokenised and discarded." : "Used only as a withdrawal destination."}</p>
    </form>
  </div>`;
  if (kind === "card") {
    const num = el.querySelector("#cc-num");
    num.addEventListener("input", () => {
      const digits = num.value.replace(/\D/g, "").slice(0, 19);
      const brand = detectBrandClient(digits);
      num.value = brand === "amex"
        ? digits.replace(/(\d{4})(\d{0,6})(\d{0,5}).*/, (m, a, b, c) => [a, b, c].filter(Boolean).join(" "))
        : digits.replace(/(\d{4})(?=\d)/g, "$1 ");
      el.querySelectorAll(".brand-row [data-brand]").forEach((b) => b.classList.toggle("brand-on", b.dataset.brand === brand));
      const cvc = el.querySelector("#cc-cvc");
      cvc.placeholder = brand === "amex" ? "4 digits" : "3 digits";
      cvc.maxLength = brand === "amex" ? 4 : 3;
    });
    for (const sel of ["#cc-mm", "#cc-yy", "#cc-cvc"]) {
      el.querySelector(sel).addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, ""); });
    }
  }
  el.querySelector("#pm-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = el.querySelector("#pm-err");
    err.hidden = true;
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    let body;
    if (kind === "card") {
      body = { kind, number: el.querySelector("#cc-num").value, holder: el.querySelector("#cc-name").value, expMonth: el.querySelector("#cc-mm").value, expYear: el.querySelector("#cc-yy").value, cvc: el.querySelector("#cc-cvc").value, zip: el.querySelector("#cc-zip").value };
    } else if (kind === "bank") {
      body = { kind, holder: el.querySelector("#bk-name").value, routing: el.querySelector("#bk-routing").value, account: el.querySelector("#bk-account").value };
    } else {
      body = { kind, email: el.querySelector("#pp-email").value };
    }
    try {
      const d = await api("/api/payment-methods", { body });
      state.methods = d.methods;
      toast(kind === "card" ? "Card added. It is tokenised and ready for withdrawals." : "Destination added.");
      go("#/payments");
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false;
    }
  });
};
routes["card-new/:id"].tab = "profile";
function detectBrandClient(num) {
  if (/^4/.test(num)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(num)) return "mastercard";
  if (/^3[47]/.test(num)) return "amex";
  if (/^(6011|65|64[4-9])/.test(num)) return "discover";
  return null;
}

/* ---------- withdraw ---------- */
function feeFor(cents) { return Math.max(state.withdrawRules.min_fee_cents, Math.round(cents * state.withdrawRules.fee_rate)); }
routes.withdraw = async (el) => {
  try { await refreshWallet(); } catch {}
  const min = state.withdrawRules.min_cents / 100;
  if (!state.methods.length) {
    el.innerHTML = `
    <div class="view" data-glow="amber">
      ${topbar("withdraw")}
      <div class="empty">${icon("lock")}<p>Add a destination first</p><span style="font-size:var(--text-sm)">Withdrawals go to a card, bank account or PayPal you add.</span></div>
      <button class="btn btn-ink btn-wide" data-go="#/payments">Add a payment method</button>
    </div>`;
    return;
  }
  const def = state.methods.find((m) => m.is_default) || state.methods[0];
  el.innerHTML = `
  <div class="view" data-glow="amber">
    ${topbar("withdraw")}
    <p class="muted" style="font-size:var(--text-sm)">Available: <b class="num money-in" data-wallet>${money(state.wallet)}</b> · minimum ${money(min)}</p>
    <form id="wd-form" class="auth-form" novalidate>
      <div class="field"><label for="wd-amount">Amount</label><input class="input num" id="wd-amount" inputmode="decimal" placeholder="0.00" value="${state.wallet >= min ? state.wallet.toFixed(2) : ""}"></div>
      <div class="chip-row" role="group" aria-label="Quick amounts">
        ${[10, 25, 50].map((v) => `<button type="button" class="chip" data-act="wd-chip" data-v="${v}" ${state.wallet < v ? "disabled" : ""}>$${v}</button>`).join("")}
        <button type="button" class="chip" data-act="wd-chip" data-v="all">All</button>
      </div>
      <div class="field"><label for="wd-method">Destination</label>
        <select class="input" id="wd-method">
          ${state.methods.map((m) => `<option value="${m.id}" ${m.id === def.id ? "selected" : ""}>${esc(methodLabel(m))}${m.is_default ? " · default" : ""}</option>`).join("")}
        </select>
      </div>
      <div class="card wd-quote">
        <div class="row-between"><span>Withdrawal</span><b class="num" id="wd-gross">${money(0)}</b></div>
        <div class="row-between muted"><span>Platform fee (${Math.round(state.withdrawRules.fee_rate * 100)}%, min ${money(state.withdrawRules.min_fee_cents / 100)})</span><b class="num" id="wd-fee">−${money(0)}</b></div>
        <div class="row-between wd-net"><span>You receive</span><b class="num money-in" id="wd-net">${money(0)}</b></div>
      </div>
      <span class="field-err" id="wd-err" hidden></span>
      <button class="btn btn-ink btn-wide" type="submit">Confirm withdrawal</button>
      <p class="muted" style="font-size:var(--text-xs); line-height:1.6">The platform's cut is taken once, here. Card withdrawals usually settle in 1 to 3 business days; this demo settles in seconds.</p>
    </form>
    ${state.withdrawals.length ? `
    <div class="sect-label">Withdrawal history</div>
    <div class="menu">
      ${state.withdrawals.map((w) => `
      <div class="menu-row menu-static">
        ${icon("chest")}
        <span class="grow"><b style="font-weight:700; display:block">${esc(methodLabel(w))}</b><span class="muted" style="font-size:var(--text-sm)"><span class="num">${esc(fmtWhen(w.created_at))}</span> · fee ${money(w.fee_cents / 100)}</span></span>
        <span class="pill ${w.status === "paid" ? "pill-money" : "pill-blue"} num">${w.status === "paid" ? "paid" : "processing"} · ${money(w.net_cents / 100)}</span>
      </div>`).join("")}
    </div>` : ""}
  </div>`;
  const amount = el.querySelector("#wd-amount");
  const update = () => {
    const cents = Math.round(parseFloat(amount.value || "0") * 100) || 0;
    const fee = cents > 0 ? feeFor(cents) : 0;
    el.querySelector("#wd-gross").textContent = money(cents / 100);
    el.querySelector("#wd-fee").textContent = "−" + money(fee / 100);
    el.querySelector("#wd-net").textContent = money(Math.max(0, cents - fee) / 100);
  };
  amount.addEventListener("input", update);
  update();
  el.querySelector("#wd-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = el.querySelector("#wd-err");
    err.hidden = true;
    const cents = Math.round(parseFloat(amount.value || "0") * 100) || 0;
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      const d = await api("/api/withdrawals", { body: { amount_cents: cents, method_id: Number(el.querySelector("#wd-method").value) } });
      applyWallet(d);
      const m = state.methods.find((x) => x.id === Number(el.querySelector("#wd-method").value));
      await refreshWallet();
      render();
      openModal(`
        <div class="milestone-disc">${icon("chest")}</div>
        <h2>On its way</h2>
        <p><b>${money(d.net_cents / 100)}</b> is heading to ${esc(m ? methodLabel(m) : "your destination")} after a ${money(d.fee_cents / 100)} fee. Status starts as processing and flips to paid when it settles.</p>
        <button class="btn btn-ink btn-wide" data-close>Done</button>`, { cls: "milestone" });
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false; btn.textContent = "Confirm withdrawal";
    }
  });
};
routes.withdraw.tab = "profile";

/* ---------- story game player ---------- */
let gameSession = null;
async function openAiGame(id, previewSpec) {
  let d;
  if (previewSpec) {
    d = { id, spec: previewSpec, reward_cents: 0, preview: true };
  } else {
    try { d = await api(`/api/games/${id}`); } catch (e) { toast(e.message); return; }
    Telemetry.start();
  }
  gameSession = { d, i: 0, responses: [], timings: [], t0: Date.now(), score: 0, replay: !!d.played };
  gameSession.finishLabel = d.preview ? "Finish playtest" : gameSession.replay ? "Finish replay · no reward" : `Finish · earn ${money(d.reward_cents / 100)}`;
  const device = $("#device");
  const ov = document.createElement("div");
  ov.className = "game-player theme-dark";
  ov.innerHTML = `
    <div class="gp-head">
      <button class="iconbtn" data-act="gp-close" aria-label="Leave game">${icon("back")}</button>
      <b class="gp-title">${esc(d.spec.title)}${d.preview ? " · playtest" : ""}</b>
      <button class="iconbtn" data-act="gp-audio" aria-label="Toggle game sound">${icon(StoryPlayer.isMuted() ? "speaker-off" : "speaker")}</button>
      <span class="num gp-step" id="gp-step"></span>
    </div>
    <div class="gp-body" id="gp-body"></div>`;
  device.appendChild(ov);
  gameSession.t0 = Date.now();
  StoryPlayer.open(gameSession, ov.querySelector("#gp-body"), {
    record: recordGame,
    questionStart: () => Telemetry.questionStart(),
    progress: (done, total) => gpProgress(`${done} / ${total}`),
    finish: () => finishGame(),
  });
}
function closeGame() {
  if (window.StoryPlayer) StoryPlayer.close();
  gameSession = null;
  const ov = document.querySelector(".game-player");
  if (ov) ov.remove();
}
function gpProgress(label) {
  const el = document.querySelector("#gp-step");
  if (el) el.textContent = label;
}
function recordGame(r) {
  /* per-beat durations (same semantics as survey timings) + keystroke/paste
     paradata on every question beat, so game answers get the full analysis */
  if (r && r.question != null) {
    const pd = Telemetry.questionEnd();
    if (pd) r.pd = pd;
  }
  gameSession.responses.push(r);
  gameSession.timings.push(Number(r && r.ms) || (Date.now() - gameSession.t0));
}
async function finishGame() {
  const { d, responses, timings, score } = gameSession;
  if (d.preview) {
    closeGame();
    toast("Playtest complete — nothing was recorded. Publish when you're happy.", true);
    return;
  }
  const paradata = Telemetry.finish();
  const btn = document.querySelector("[data-act=gp-finish]");
  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
  try {
    const res = await api(`/api/games/${d.id}/complete`, { body: { responses, timings, score, paradata } });
    closeGame();
    if (res.replay) {
      toast("Replay complete — replays don't pay, but your answers still reach the researcher.", true);
    } else if (res.flagged) {
      openModal(`
        <div class="milestone-disc">${icon("shield")}</div>
        <h2>Held for review</h2>
        <p>This playthrough was faster than a human pace, so it is held for review before it pays. Nothing is lost if it clears.</p>
        <button class="btn btn-ink btn-wide" data-close>Understood</button>`, { cls: "milestone" });
    } else {
      applyRewardResult(res, "Game complete");
    }
    navDirection = "tab";
    render();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "Finish"; }
    toast(e.message);
  }
}

/* ---------- game creation (researcher) ---------- */
let pendingGame = (() => { try { return JSON.parse(sessionStorage.getItem("earnest.pendingGame")) || null; } catch (e) { return null; } })();
function setPendingGame(v) {
  pendingGame = v;
  try { v ? sessionStorage.setItem("earnest.pendingGame", JSON.stringify(v)) : sessionStorage.removeItem("earnest.pendingGame"); } catch (e) { /* private mode */ }
}
/* Every story game carries its own AI-drawn logo and key art; the generic
   story badge is only the fallback for games whose artist step hasn't run. */
const gameLogo = (g) => (g && (g.logo || g.poster || (g.spec && (g.spec.logo || g.spec.poster)))) || "/game-logos/story.jpg";
/* Fields: ["§", "Section title"] renders a group header; otherwise
   [name, label, type, placeholder, help]. Types: text, number, textarea,
   select:value=label|…, chips:id=label|… (multi-select). Every answer is
   sent to the generator — it understands natural language, so free-text
   fields are first-class, chips just make common choices quicker. */
const GAME_TEMPLATES = {
  story: {
    label: "Story game", icon: "comment",
    goal: "Walk respondents through your scenario as a living Monument-Valley-style world and collect the decisions each character asks for.",
    desc: "An isometric diorama of modern-day Earth in Monument Valley's pastel style. Your respondents tap the ground to walk, tap characters to talk, and answer your study's questions inside the conversation — multiple choice, free text, and timed moments. You describe the setting, the story, the characters, what they say and what they ask, all in plain language; the builder writes the script and the engine builds the world.",
    fields: [
      ["research_context", "What are you studying, and why?", "textarea", "e.g. How new students respond to peer pressure to smoke when they want to belong…", "Shown to players as the study behind the game, and used to frame the results."],
      ["§", "The world"],
      ["setting", "Where does it take place?", "textarea", "e.g. A school courtyard behind the gym at lunch break. Or: a metro station platform late at night; an office plaza after work; an apartment courtyard…", "Any everyday place — the builder maps it to the matching world. Mention the time of day and mood if you like."],
      ["§", "The story"],
      ["premise", "What happens? The scenario the player lives through.", "textarea", "e.g. You are a new student. A group of classmates invites you behind the gym and pressures you to smoke to prove you fit in…", "Keep it a sensible, plausible daily-life situation that serves the research."],
      ["tone", "Tone", "text", "warm and realistic, tense, light…"],
      ["§", "Characters"],
      ["characters", "Who are they?", "textarea", "Dani — popular classmate, charming but pushy\nSam — another new student, quietly refuses", "One per line: name — role — personality. 1 to 3 people."],
      ["character_looks", "What should they look like?", "textarea", "e.g. Dani in a teal hoodie and cap; Sam in a mustard beanie and round glasses…", "Clothes, colours, hair — the engine draws them as pastel robed figures."],
      ["character_lines", "What should each character say?", "textarea", "e.g. Dani opens with 'Everyone's here, don't be weird about it'; Sam admits they said no last week…", "Exact lines or paraphrases — the builder works them into the script."],
      ["character_questions", "What does each character ask the player?", "textarea", "Dani asks whether you'd take the cigarette to fit in. Sam asks what you'd actually say to get out of it…", "The genuine opinions and decisions your study needs. Include at least one free-text question and one timed moment."],
      ["§", "Anything else"],
      ["extra_notes", "Any other instructions?", "textarea", "e.g. Make the last question a free-text reflection; keep each line under three sentences…"],
      ["title", "Game title (optional)", "text", "The New Kid"],
    ],
  },
};
function gtField(f) {
  if (f[0] === "§") return `<div class="sect-label gt-sec">${esc(f[1])}</div>`;
  const [name, label, type, ph, help] = f;
  const helpHtml = help ? `<p class="gt-help">${esc(help)}</p>` : "";
  let control, labelHtml;
  if (type.startsWith("chips:")) {
    labelHtml = `<span class="gt-label" id="gt-lbl-${name}">${esc(label)}</span>`;
    control = `<input type="hidden" id="gt-${name}" value="">
      <div class="chip-row gt-chips" data-for="gt-${name}" role="group" aria-labelledby="gt-lbl-${name}">
        ${type.slice(6).split("|").map((o) => { const eq = o.indexOf("="); const v = eq >= 0 ? o.slice(0, eq) : o; const l = eq >= 0 ? o.slice(eq + 1) : o; return `<button type="button" class="chip" data-val="${esc(v)}" aria-pressed="false">${esc(l)}</button>`; }).join("")}
      </div>`;
  } else {
    labelHtml = `<label for="gt-${name}">${esc(label)}</label>`;
    if (type === "textarea") control = `<textarea class="input" id="gt-${name}" placeholder="${esc(ph || "")}"></textarea>`;
    else if (type.startsWith("select:")) control = `<select class="input" id="gt-${name}">${type.slice(7).split("|").map((o) => { const eq = o.indexOf("="); const v = eq >= 0 ? o.slice(0, eq) : o; const l = eq >= 0 ? o.slice(eq + 1) : o; return `<option value="${esc(v)}">${esc(l)}</option>`; }).join("")}</select>`;
    else control = `<input class="input${type === "number" ? " num" : ""}" id="gt-${name}" ${type === "number" ? 'inputmode="numeric"' : ""} placeholder="${esc(ph || "")}">`;
  }
  return `<div class="field">${labelHtml}${control}${helpHtml}</div>`;
}
routes["create-game"] = (el) => {
  /* one format now: story games — go straight to the brief */
  go("#/create-custom");
};
routes["create-game"].tab = "play";
routes["create-custom"] = (el) => {
  el.innerHTML = `
  <div class="view theme-dark" data-glow="lav">
    ${topbar("create a story game")}
    <p class="create-sub">Describe your study in plain language: the setting, the story, the characters, what each of them says and what they ask. The builder generates a Monument-Valley-style world where players walk, talk and answer.</p>
    <form id="cc-form" class="auth-form" novalidate>
      <div class="card tpl-hero">
        <img class="tpl-logo" src="/game-logos/story.jpg" alt="">
        <div class="grow tpl-meta">
          <h1 class="tpl-name" style="font-size:var(--text-lg)">Story game</h1>
          <span class="game-kicker">Isometric world · tap to walk · talk to answer</span>
        </div>
      </div>
      <div class="field"><label for="cc-goal">Research goal</label><textarea class="input" id="cc-goal" placeholder="What are you studying, and what do you want to learn from players?"></textarea></div>
      <div class="field"><label for="cc-brief">Describe your game</label><textarea class="input cc-brief" id="cc-brief" placeholder="Anything you like, in your own words: the setting (a school, a metro station, an office, a house…), the story that happens there, the characters and what they look like, what each character says, the questions they ask the player, timed moments, the tone, how it ends…"></textarea></div>
      <span class="field-err" id="cc-err" hidden></span>
      <button class="btn btn-ink btn-wide" type="submit">${icon("bolt")} Generate game</button>
      <p class="muted" style="font-size:var(--text-xs); line-height:1.6">Usually ready in a few minutes — the world, the script and the questions. You review before publishing.</p>
    </form>
  </div>`;
  el.querySelector("#cc-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = el.querySelector("#cc-err"); err.hidden = true;
    const brief = el.querySelector("#cc-brief").value.trim();
    if (!brief) { err.textContent = "Describe your story first — a sentence or two is enough."; err.hidden = false; return; }
    const answers = { research_context: el.querySelector("#cc-goal").value, custom_brief: brief };
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    btn.innerHTML = `<span class="gen-dots">Generating your game</span>`;
    try {
      const d = await api("/api/games/generate", { body: { kind: "story", answers } });
      if (d.queued) { go(`#/game-queued/${d.id}`); return; }
      setPendingGame({ kind: "story", spec: d.spec, id: d.id });
      go("#/game-preview");
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false;
      btn.innerHTML = `${icon("bolt")} Generate game`;
    }
  });
};
routes["create-custom"].tab = "play";
routes["game-template/:id"] = (el, kind) => {
  const t = GAME_TEMPLATES[kind];
  if (!t) { go("#/create-custom"); return; }
  el.innerHTML = `
  <div class="view theme-dark" data-glow="lav">
    ${topbar(t.label.toLowerCase())}
    <div class="card tpl-hero">
      <img class="tpl-logo" src="/game-logos/story.jpg" alt="">
      <div class="grow tpl-meta">
        <h1 class="tpl-name">${esc(t.label)}</h1>
        <span class="game-kicker">AI-built · Monument Valley world</span>
      </div>
    </div>
    <div class="sect-label">Research goal</div>
    <p class="tpl-goal">${esc(t.goal)}</p>
    <div class="sect-label">Game description</div>
    <p class="tpl-desc">${esc(t.desc)}</p>
    <div class="sect-label">Configure your game</div>
    <form id="gt-form" class="auth-form" novalidate>
      ${t.fields.map(gtField).join("")}
      <span class="field-err" id="gt-err" hidden></span>
      <button class="btn btn-ink btn-wide" type="submit">${icon("bolt")} Generate game</button>
      <p class="muted" style="font-size:var(--text-xs); line-height:1.6">Usually ready in a few minutes — script, characters and logo. You review before publishing.</p>
    </form>
  </div>`;
  el.querySelector("#gt-form").addEventListener("click", (e) => {
    const c = e.target.closest(".gt-chips .chip"); if (!c) return;
    c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true"));
    const wrap = c.closest(".gt-chips");
    el.querySelector("#" + wrap.dataset.for).value = [...wrap.querySelectorAll('.chip[aria-pressed="true"]')].map((x) => x.dataset.val).join(",");
  });
  el.querySelector("#gt-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = el.querySelector("#gt-err"); err.hidden = true;
    const answers = {};
    t.fields.forEach(([name]) => { if (name === "§") return; answers[name] = (el.querySelector(`#gt-${name}`) || {}).value || ""; });
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    btn.innerHTML = `<span class="gen-dots">Generating your game</span>`;
    try {
      const d = await api("/api/games/generate", { body: { kind: "story", answers } });
      if (d.queued) { go(`#/game-queued/${d.id}`); return; }
      setPendingGame({ kind: "story", spec: d.spec, id: d.id });
      go("#/game-preview");
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false;
      btn.innerHTML = `${icon("bolt")} Generate game`;
    }
  });
};
routes["game-template/:id"].tab = "play";
routes["game-queued/:id"] = async (el, id) => {
  el.innerHTML = `<div class="view theme-dark" data-glow="lav">${topbar("building your game")}<div class="empty">${icon("bolt")}<p>Checking build status…</p></div></div>`;
  let stopped = false;
  el._stopPoll = () => { stopped = true; };
  const paint = (d) => {
    if (d.status === "draft" || d.status === "published") {
      setPendingGame({ kind: d.kind, spec: d.spec, id: d.id });
      go("#/game-preview");
      return true;
    }
    if (d.status === "failed") {
      el.innerHTML = `
      <div class="view theme-dark" data-glow="lav">
        ${topbar("build failed")}
        <div class="card" style="padding:var(--space-md)">
          <span class="pill pill-flag">${icon("shield")} Build failed</span>
          <p style="font-size:var(--text-sm); line-height:1.6; margin-top:var(--space-sm)">${esc(d.error || "The builder could not produce a valid game.")}</p>
        </div>
        <button class="btn btn-ink btn-wide" style="margin-top:var(--space-md)" data-go="#/game-template/${d.kind}">${icon("plus")} Edit template & try again</button>
      </div>`;
      return true;
    }
    el.innerHTML = `
    <div class="view theme-dark" data-glow="lav">
      ${topbar("building your game")}
      <div class="card paper-hero">
        <span class="pill pill-lav">${icon("bolt")} Building</span>
        <h1 class="paper-title-lg" style="margin-top:var(--space-xs)">${esc(d.title || "Building your game…")}</h1>
        <p class="paper-authors">${esc(d.premise || "")}</p>
      </div>
      <div class="card" style="padding:var(--space-md); margin-top:var(--space-md)">
        <p style="font-size:var(--text-sm); line-height:1.65"><span class="gen-dots">Writing your game — characters, scenes and questions</span></p>
        <p class="muted" style="font-size:var(--text-xs); line-height:1.6; margin-top:var(--space-xs)">Usually ready in a few minutes. This page updates automatically, and you review the game before it goes live.</p>
      </div>
      <button class="btn btn-wide" style="margin-top:var(--space-md)" data-go="#/play">Back to games — it will appear in your library</button>
    </div>`;
    return false;
  };
  const poll = async () => {
    if (stopped || location.hash !== `#/game-queued/${id}`) return;
    try {
      const d = await api(`/api/games/${id}`);
      if (stopped || location.hash !== `#/game-queued/${id}`) return;
      if (paint(d)) return;
    } catch (e) { /* transient — keep polling */ }
    setTimeout(poll, 5000);
  };
  poll();
};
routes["game-queued/:id"].tab = "play";
routes["game-preview"] = (el) => {
  if (!pendingGame) { go("#/create-custom"); return; }
  const { kind, spec } = pendingGame;
  const scenes = spec.scenes || [];
  const questions = scenes.filter((sc) => sc.input);
  const preview = `
    <div class="sect-label">Characters (${(spec.characters || []).length})</div>
    <div class="card" style="padding:var(--space-sm) var(--space-md)">${(spec.characters || []).map((c) => `
      <div class="award-row" style="padding:var(--space-xs) 0">${icon("person")}<span class="award-txt" style="font-size:var(--text-sm)">${esc(c.name)} — ${esc(c.role || "")}${(c.expressions || []).length ? ` · expressions: ${c.expressions.map(esc).join(", ")}` : ""}</span></div>`).join("")}
    </div>
    <div class="sect-label">Scenes (${scenes.length}) · ${questions.length} questions${questions.some((sc) => sc.input.timeLimitMs) ? " · timed twists" : ""}</div>
    <div class="card" style="padding:0">${scenes.map((sc, i) => {
      const ch = (spec.characters || []).find((c) => c.id === sc.character) || {};
      return `<div class="qa-block"><div class="qa-q">${i + 1}. ${esc(ch.name || "")}${sc.expression ? ` · ${esc(sc.expression)}` : ""}${sc.move ? ` · ${esc(sc.move)}` : ""}</div><div class="qa-a">${esc(sc.text)}</div>${sc.input ? `<div class="qa-note"><b>asks (${esc(sc.input.type)}${sc.input.timeLimitMs ? `, ${Math.round(sc.input.timeLimitMs / 1000)}s` : ""}):</b> ${esc(sc.input.question)}${sc.input.type === "choice" ? ` — ${(sc.input.options || []).map(esc).join(" · ")}` : ""}</div>` : ""}</div>`;
    }).join("")}</div>`;
  el.innerHTML = `
  <div class="view theme-dark" data-glow="lav">
    ${topbar("review your game")}
    <div class="card paper-hero">
      <div class="row" style="align-items:flex-start">
        <img class="tpl-logo" src="${gameLogo(spec)}" alt="">
        <div class="grow tpl-meta">
          <span class="pill pill-lav">${GAME_KIND_LABEL[kind] || "Story game"}</span>
          <h1 class="tpl-name" style="margin-top:var(--space-2xs)">${esc(spec.title)}</h1>
        </div>
      </div>
      <p class="paper-authors">${esc(spec.premise || "")}</p>
      ${spec.world ? `<p class="muted" style="font-size:var(--text-xs); margin-top:var(--space-2xs); text-transform:capitalize">${esc(spec.world.setting)} · ${esc(spec.world.time || "day")}${spec.world.mood ? " · " + esc(spec.world.mood) : ""}</p>` : ""}
    </div>
    ${preview}
    <button class="btn btn-ink btn-wide" type="button" id="g-playtest" style="margin-top:var(--space-md)">${icon("play")} Playtest — try it before publishing</button>
    <p class="muted" style="font-size:var(--text-xs); line-height:1.6; margin-top:var(--space-2xs)">Runs the real world on your device — walk around, talk to everyone, answer the questions. Nothing is recorded and no reward is paid.</p>
    <form id="gpublish" class="auth-form" style="margin-top:var(--space-md)">
      <div class="field"><label for="gp-reward">Reward per completed play ($)</label><input class="input num" id="gp-reward" inputmode="decimal" value="0.40"></div>
      <span class="field-err" id="gp-err" hidden></span>
      <button class="btn btn-ink btn-wide" type="submit">Publish game</button>
      <button class="btn btn-wide" type="button" data-go="#/game-template/story">Edit brief & regenerate</button>
    </form>
  </div>`;
  el.querySelector("#g-playtest").addEventListener("click", () => openAiGame(pendingGame.id, spec));
  el.querySelector("#gpublish").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = el.querySelector("#gp-err"); err.hidden = true;
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Publishing…";
    try {
      await api("/api/games", { body: { id: pendingGame.id, spec, reward: el.querySelector("#gp-reward").value } });
      setPendingGame(null);
      toast("Game published. Players can play it now.", true);
      go("#/play");
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false; btn.textContent = "Publish game";
    }
  });
};
routes["game-preview"].tab = "play";
routes["game-plays/:id"] = async (el, id) => {
  el.innerHTML = `<div class="view" data-glow="blue">${topbar("game responses")}<div class="empty">${icon("pulse")}<p>Loading…</p></div></div>`;
  let d;
  try { d = await api(`/api/games/${id}/plays`); } catch (e) { if (!el.isConnected) return; toast(e.message); go("#/dashboard"); return; }
  if (!el.isConnected) return;
  el.innerHTML = `
  <div class="view" data-glow="blue">
    ${topbar("game responses")}
    <p class="muted" style="font-size:var(--text-sm); margin-bottom:var(--space-sm)">${esc(d.title)} · <span class="num">${d.plays.length}</span> completed plays</p>
    <button class="btn btn-wide" style="margin-bottom:var(--space-md)" data-go="#/game-aggregate/${id}">See aggregate data</button>
    <div class="row" style="gap:var(--space-xs); margin-bottom:var(--space-md); align-items:flex-start">
      <div class="searchwrap field grow" style="margin:0">
        ${icon("search")}
        <label class="visually-hidden" for="gp-q">Filter responses</label>
        <input class="input" id="gp-q" type="search" placeholder="filter responses" style="min-height:44px">
      </div>
      <button class="iconbtn" data-act="sort-resp" aria-label="Sort responses" style="margin-top:26px">${icon("sort")}</button>
      <button class="iconbtn" data-act="save-all" aria-label="Save all responses" style="margin-top:26px">${icon("bookmark")}</button>
    </div>
    ${d.plays.length ? `<div class="menu">
      ${d.plays.map((p) => `
      <button class="menu-row" data-go="#/game-play/${id}/${p.id}" style="font-weight:500">
        <span style="flex:none">${photoAvatar(p, "avatar-sm")}</span>
        <span class="grow"><b style="font-weight:700; display:block">${esc(p.name)}</b><span class="muted" style="font-size:var(--text-sm)"><span class="num">${esc(p.date)}</span>${p.score != null ? ` · score ${p.score}` : ""}</span></span>
        ${p.flagged ? `<span class="pill pill-flag">${p.bot_prob >= 0.8 ? "likely bot" : "flagged"}</span>` : `<span class="pill pill-blue">${icon("check")}</span>`}
        <span class="muted num" style="font-size:var(--text-xs); flex:none" title="Bot likelihood">${Math.round((p.bot_prob || 0) * 100)}%</span>
        ${icon("chevron", "chev")}
      </button>`).join("")}
    </div>` : `<div class="empty">${icon("comment")}<p>No plays yet</p><span style="font-size:var(--text-sm)">Share your game in the feed to collect responses</span></div>`}
    <p class="muted" style="font-size:var(--text-xs); margin-top:var(--space-sm)">Flagged plays are held for review before they count in aggregates.</p>
  </div>`;
  const q = el.querySelector("#gp-q");
  q.addEventListener("input", () => {
    const v = q.value.toLowerCase();
    el.querySelectorAll(".menu-row").forEach((row) => { row.hidden = v && !row.textContent.toLowerCase().includes(v); });
  });
};
routes["game-plays/:id"].tab = "profile";

/* ---------- single game play (paradata beside each decision, survey-grade) ---------- */
routes["game-play/:id"] = async (el, id, pid) => {
  el.innerHTML = `<div class="view" data-glow="blue">${topbar("response")}<div class="empty">${icon("pulse")}<p>Loading response…</p></div></div>`;
  let r;
  try { r = await api(`/api/games/${id}/plays/${pid}`); } catch (e) { if (!el.isConnected) return; toast(e.message); go(`#/game-plays/${id}`); return; }
  if (!el.isConnected) return;
  const reasonText = { consistency: "conflict with an earlier submission", attention: "missed a decision beat or the pace gate", automation: "automated-response profile", speed: "under the human pace median", bot: "bot-likelihood model fired", review: "held for human review", paste: "external paste pattern" };
  const reasonFor = (k) => (r.reasons || []).includes(k);
  const pq = r.per_question || [];
  const botPct = Math.round((r.bot_prob || 0) * 100);
  el.innerHTML = `
  <div class="view" data-glow="blue">
    ${topbar(`${r.name}, ${r.date}`)}
    <p class="muted" style="font-size:var(--text-sm); margin-bottom:var(--space-md)">${esc(r.title)}${r.game_score != null ? ` · game score <span class="num">${r.game_score}</span>` : ""}${r.replay ? " · replay" : ""}</p>
    <div class="card chart-card">
      <div class="chart-head"><b>Decision pace</b><span class="pill ${botPct >= 50 ? "pill-flag" : "pill-blue"} num">${botPct}% bot likelihood</span></div>
      ${paceChart(r.timings || [])}
    </div>
    <div class="sect-label">Answers & paradata</div>
    <div class="card" style="padding:0">
      ${r.answers.map((a, i) => {
        const p = pq[i] || {};
        const chips = [];
        if (p.time_s != null) chips.push(`${p.time_s}s`);
        if (p.first_input_s != null) chips.push(`first input ${p.first_input_s}s`);
        if (p.wpm) chips.push(`${p.wpm} wpm`);
        if (p.keys) chips.push(`${p.keys} keys`);
        if (p.backspaces) chips.push(`${p.backspaces} edits`);
        if (p.pastes) chips.push(`pasted ×${p.pastes}`);
        if (p.focus_loss) chips.push(`left tab ×${p.focus_loss}`);
        if (p.injected) chips.push(`injected text`);
        if (p.timed_out) chips.push(`timed out`);
        const note = p.timed_out ? "No decision before the timer expired — the pass itself is recorded as data."
          : p.time_s != null ? `Decided in ${p.time_s}s${p.wpm ? `, typing at ${p.wpm} wpm` : ""}${p.pastes ? "; answer arrived by paste" : ""}.`
          : "No anomalies detected.";
        return `
      <div class="qa-block">
        <div class="qa-q num">${i + 1}. ${esc((r.questions && r.questions[i] && r.questions[i].q) || "decision")}</div>
        <div class="qa-a">${esc(a)}</div>
        ${chips.length ? `<div class="paradata-chips">${chips.map((c) => `<span class="pd-chip${/pasted|injected|left tab|timed out/.test(c) ? " pd-warn" : ""}">${esc(c)}</span>`).join("")}</div>` : ""}
        <div class="qa-note"><b>analysis:</b> ${esc(note)}</div>
      </div>`; }).join("")}
    </div>
    <div class="sect-label">Response quality · score <span class="num">${r.score}</span>/100</div>
    <div class="card quality">
      <span class="quality-row">${icon("check", reasonFor("consistency") ? "q-flag" : "q-ok")} answer consistency ${reasonFor("consistency") ? "· " + reasonText.consistency : "· clean"}</span>
      <span class="quality-row">${icon("shield", reasonFor("attention") ? "q-flag" : "q-ok")} decision completeness ${reasonFor("attention") ? "· " + reasonText.attention : "· every beat answered"}</span>
      <span class="quality-row">${icon("pulse", reasonFor("automation") || reasonFor("speed") ? "q-flag" : "q-ok")} interaction pattern ${reasonFor("automation") ? "· " + reasonText.automation : reasonFor("speed") ? "· " + reasonText.speed : "· human cadence"}</span>
      <span class="quality-row">${icon("search", reasonFor("paste") ? "q-flag" : "q-ok")} paste & injection ${reasonFor("paste") ? "· external-tool pattern" : "· typed in-app"}</span>
      ${r.flagged
        ? `<span class="pill pill-flag" style="align-self:flex-start">${icon("lock")} ${r.bot_prob >= 0.8 ? "likely bot · no pay, out of aggregates" : "flagged · held for manual review, out of aggregates"}</span>`
        : `<span class="pill pill-blue" style="align-self:flex-start">${icon("check")} cleared for the researcher</span>`}
    </div>
    ${(r.model_notes || []).length ? `
    <div class="sect-label">Model notes</div>
    <div class="card quality">
      ${r.model_notes.map((n) => `<span class="quality-row">${icon("pulse", "q-ok")} ${esc(n)}</span>`).join("")}
    </div>` : ""}
    ${r.dialogue_beats ? `<p class="muted" style="font-size:var(--text-xs); margin-top:var(--space-sm)"><span class="num">${r.dialogue_beats}</span> dialogue beats walked through before, between and after these decisions.</p>` : ""}
  </div>`;
};
routes["game-play/:id"].tab = "profile";

/* ---------- game aggregate (computed from paradata, per-decision analysis) ---------- */
routes["game-aggregate/:id"] = async (el, id) => {
  el.innerHTML = `<div class="view" data-glow="lav">${topbar("aggregate data")}<div class="empty">${icon("pulse")}<p>Loading aggregates…</p></div></div>`;
  let d;
  try { d = await api(`/api/games/${id}/aggregate`); } catch (e) { if (!el.isConnected) return; toast(e.message); go(`#/game-plays/${id}`); return; }
  if (!el.isConnected) return;
  const pace = d.pace || [];
  const medianTotal = pace.length ? pace.slice().sort((a, b) => a - b)[Math.floor(pace.length / 2)] : 0;
  el.innerHTML = `
  <div class="view" data-glow="lav">
    ${topbar("aggregate data")}
    <p class="muted" style="font-size:var(--text-sm); margin-bottom:var(--space-md)">${esc(d.title)} · <span class="num">${d.cleared}</span> cleared, <span class="num">${d.held}</span> held for review</p>
    <div class="stat-row">
      <div class="card stat-mini"><b class="num">${d.n}</b><span>plays</span></div>
      <div class="card stat-mini"><b class="num">${Math.round((d.mean_bot_prob || 0) * 100)}%</b><span>mean bot likelihood</span></div>
      <div class="card stat-mini"><b class="num">${d.bot_high || 0}</b><span>likely bots</span></div>
      <div class="card stat-mini"><b class="num">${medianTotal ? (medianTotal / 1000).toFixed(0) + "s" : "—"}</b><span>median decision time</span></div>
    </div>
    <div class="sect-label">Decision-level analysis</div>
    <div class="card" style="padding:0">
      ${(d.per_question || []).map((qq) => `
      <div class="qa-block">
        <div class="qa-q num">${qq.i + 1}. ${esc(qq.q)}</div>
        ${qq.type === "opts" ? distBars(qq.options, qq.dist, d.n) : ""}
        <div class="qa-note"><b>analysis:</b> ${qq.analysis.map(esc).join(" ")}</div>
      </div>`).join("") || `<div class="qa-block"><div class="qa-a muted">No plays yet.</div></div>`}
    </div>
    <p class="muted" style="font-size:var(--text-xs); margin-top:var(--space-sm); line-height:1.6">Analysis is computed from play paradata: per-decision timing, keystroke dynamics, paste and focus events, time-outs, and the bot-likelihood model. Flagged plays are excluded from choice distributions.</p>
  </div>`;
};
routes["game-aggregate/:id"].tab = "profile";

/* ---------- researcher creation ---------- */
async function uploadMedia(file) {
  const res = await fetch("/api/upload", { method: "POST", headers: { "Content-Type": file.type || "video/mp4" }, body: file, credentials: "same-origin" });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Upload failed.");
  return d.path;
}
function openCreatePicker() {
  openModal(`
    <h2>create</h2>
    <p class="muted" style="font-size:var(--text-sm)">Publish to the feed as a researcher. Media uploads stay on this server.</p>
    <button class="btn btn-ink btn-wide" data-go="#/create-study">${icon("reel")} New paid study</button>
    <button class="btn btn-wide" data-go="#/create-post">${icon("bolt")} New discover post</button>
    <button class="btn btn-wide" data-close>Cancel</button>`);
}
function questionRow(q = { type: "text", q: "", options: "" }) {
  return `
  <div class="q-row card">
    <div class="row" style="gap:var(--space-xs)">
      <select class="input q-type" style="min-height:44px; flex:none; width:110px">
        <option value="text" ${q.type === "text" ? "selected" : ""}>Open text</option>
        <option value="opts" ${q.type === "opts" ? "selected" : ""}>Choices</option>
      </select>
      <input class="input q-text" placeholder="Question" value="${esc(q.q)}" style="min-height:44px">
      <button type="button" class="iconbtn q-del" aria-label="Remove question" style="width:44px;height:44px">${icon("back")}</button>
    </div>
    <input class="input q-opts" placeholder="Options, comma separated" value="${esc(q.options || "")}" style="min-height:44px; margin-top:var(--space-xs); ${q.type === "opts" ? "" : "display:none"}">
  </div>`;
}
routes["create-study"] = (el) => {
  el.innerHTML = `
  <div class="view" data-glow="blue">
    ${topbar("new paid study")}
    <form id="cs-form" class="auth-form" novalidate>
      <div class="field"><label for="cs-title">Study title (the reel headline)</label><input class="input" id="cs-title" placeholder="e.g. How do you actually save electricity?"></div>
      <div class="field"><label for="cs-sub">One-line description</label><input class="input" id="cs-sub" placeholder="What the respondent gets into"></div>
      <div class="row" style="gap:var(--space-sm)">
        <div class="field grow"><label for="cs-chip">Topic chip</label><input class="input" id="cs-chip" placeholder="Energy"></div>
        <div class="field grow"><label for="cs-genre">Light genre</label>
          <select class="input" id="cs-genre"><option value="study">Blue · study</option><option value="attention">Lavender · attention</option><option value="earn">Amber · earn</option></select>
        </div>
      </div>
      <div class="row" style="gap:var(--space-sm)">
        <div class="field grow"><label for="cs-reward">Reward per answer ($)</label><input class="input num" id="cs-reward" inputmode="decimal" placeholder="0.50"></div>
        <div class="field grow"><label for="cs-min">Minutes</label><input class="input num" id="cs-min" inputmode="numeric" placeholder="3"></div>
      </div>
      <div class="field"><label for="cs-video">Intro video (mp4/webm/mov)</label><input class="input" id="cs-video" type="file" accept="video/mp4,video/webm,video/quicktime" style="padding-top:14px"></div>
      <div class="sect-label" style="margin-top:var(--space-sm)">Questions <button type="button" class="btn btn-sm" id="cs-addq">${icon("plus")} Add question</button></div>
      <div id="cs-questions" style="display:flex; flex-direction:column; gap:var(--space-sm)">${questionRow()}</div>
      <span class="field-err" id="cs-err" hidden></span>
      <button class="btn btn-ink btn-wide" type="submit">Publish study</button>
    </form>
  </div>`;
  const qWrap = el.querySelector("#cs-questions");
  el.querySelector("#cs-addq").addEventListener("click", () => qWrap.insertAdjacentHTML("beforeend", questionRow()));
  qWrap.addEventListener("click", (e) => { if (e.target.closest(".q-del")) e.target.closest(".q-row").remove(); });
  qWrap.addEventListener("change", (e) => {
    if (e.target.matches(".q-type")) e.target.closest(".q-row").querySelector(".q-opts").style.display = e.target.value === "opts" ? "" : "none";
  });
  el.querySelector("#cs-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = el.querySelector("#cs-err"); err.hidden = true;
    const btn = e.target.querySelector("[type=submit]");
    const questions = [...qWrap.querySelectorAll(".q-row")].map((row) => ({
      type: row.querySelector(".q-type").value,
      q: row.querySelector(".q-text").value,
      options: row.querySelector(".q-opts").value.split(",").map((o) => o.trim()).filter(Boolean),
    }));
    const file = el.querySelector("#cs-video").files[0];
    if (!file) { err.textContent = "Upload the intro video first."; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = "Uploading video…";
    try {
      const video = await uploadMedia(file);
      btn.textContent = "Publishing…";
      const d = await api("/api/studies", { body: {
        title: el.querySelector("#cs-title").value, sub: el.querySelector("#cs-sub").value,
        chip: el.querySelector("#cs-chip").value, genre: el.querySelector("#cs-genre").value,
        reward: el.querySelector("#cs-reward").value, minutes: el.querySelector("#cs-min").value,
        video, questions,
      } });
      studies = d.studies;
      toast("Study published. It is live in the paid studies feed.", true);
      state.feedTab = "gold"; state.reelIndex = 0;
      go("#/feed");
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false; btn.textContent = "Publish study";
    }
  });
};
routes["create-study"].tab = "feed";
routes["create-post"] = (el) => {
  el.innerHTML = `
  <div class="view" data-glow="lav">
    ${topbar("new discover post")}
    <form id="cp-form" class="auth-form" novalidate>
      <div class="field"><label for="cp-title">Post title</label><input class="input" id="cp-title" placeholder="e.g. What our reef survey found"></div>
      <div class="field"><label for="cp-sub">One-line description</label><input class="input" id="cp-sub" placeholder="The finding in a sentence"></div>
      <div class="row" style="gap:var(--space-sm)">
        <div class="field grow"><label for="cp-chip">Chip</label><input class="input" id="cp-chip" placeholder="Finding"></div>
        <div class="field grow"><label for="cp-genre">Light genre</label>
          <select class="input" id="cp-genre"><option value="study">Blue · study</option><option value="attention">Lavender · attention</option><option value="earn">Amber · earn</option></select>
        </div>
      </div>
      <div class="field"><label for="cp-video">Video (mp4/webm/mov)</label><input class="input" id="cp-video" type="file" accept="video/mp4,video/webm,video/quicktime" style="padding-top:14px"></div>
      <span class="field-err" id="cp-err" hidden></span>
      <button class="btn btn-ink btn-wide" type="submit">Publish post</button>
    </form>
  </div>`;
  el.querySelector("#cp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = el.querySelector("#cp-err"); err.hidden = true;
    const btn = e.target.querySelector("[type=submit]");
    const file = el.querySelector("#cp-video").files[0];
    if (!file) { err.textContent = "Upload the video first."; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = "Uploading video…";
    try {
      const video = await uploadMedia(file);
      btn.textContent = "Publishing…";
      const d = await api("/api/discoveries", { body: {
        title: el.querySelector("#cp-title").value, sub: el.querySelector("#cp-sub").value,
        chip: el.querySelector("#cp-chip").value, genre: el.querySelector("#cp-genre").value, video,
      } });
      discoveries = d.discoveries;
      toast("Post published to discover.", true);
      state.feedTab = "discover"; state.reelIndex = 0;
      go("#/feed");
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false; btn.textContent = "Publish post";
    }
  });
};
routes["create-post"].tab = "feed";

/* ---------- search grid + full-screen reel viewer ---------- */
function gridItems(ql = "") {
  const all = [
    ...studies.map((it) => ({ it, r: researchers[it.researcher] })),
    ...discoveries.map((it) => ({ it, r: it.researcher ? researchers[it.researcher] : null })),
  ];
  if (!ql) return all;
  return all.filter(({ it, r }) => it.title.toLowerCase().includes(ql) || (it.chip || "").toLowerCase().includes(ql) || (r && r.name.toLowerCase().includes(ql)));
}
function gridCard({ it, r }) {
  /* preload="none" + data-src: iOS Safari hangs when dozens of video elements
     load at once (the old preload="metadata" grid froze the whole app after a
     search visit). Cards stay inert until scrolled into view; gridObs loads
     only the visible few and unloads them again when they leave. */
  const media = it.video
    ? `<video data-src="${it.video}" muted loop playsinline preload="none" tabindex="-1"></video>`
    : it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy" decoding="async">` : `<span class="grid-fallback" aria-hidden="true"></span>`;
  return `
  <button class="grid-card" data-act="open-reel" data-id="${it.id}" aria-label="Open ${esc(it.title)} full screen">
    ${media}
    <span class="grid-shade" aria-hidden="true"></span>
    <span class="grid-kind">${esc(it.chip || "reel")}${it.verified ? ` ${icon("verified")}` : ""}</span>
    <span class="grid-meta">
      <span class="grid-who">${r ? photoAvatar(r, "avatar-sm") : it.author_photo ? `<img class="avatar-img avatar-sm" src="${esc(it.author_photo)}" alt="" loading="lazy" decoding="async">` : `<span class="avatar avatar-sm" aria-hidden="true">E</span>`}<span>${esc(r ? r.name : (it.author || "EARNest research"))}</span></span>
      <span class="grid-title">${esc(it.title)}</span>
    </span>
  </button>`;
}
let viewerTeardown = null;
function closeViewer() {
  const ov = document.querySelector(".reel-viewer");
  if (!ov) return;
  if (viewerTeardown) { viewerTeardown(); viewerTeardown = null; }
  ov.querySelectorAll("video").forEach((v) => { v.pause(); if (v.getAttribute("src")) { v.removeAttribute("src"); v.load(); } });
  ov.remove();
}
function openReelViewer(items, startIdx, sourceEl) {
  closeViewer();
  const device = $("#device");
  const ov = document.createElement("div");
  ov.className = "reel-viewer";
  ov.innerHTML = `
    <div class="rv-frame">
      <div class="reels" id="rv-reels" tabindex="-1" aria-label="Reel viewer, swipe vertically">
        ${items.map(({ it }, i) => `
        <article class="reel" data-genre="${it.genre}" data-id="${it.id}" data-i="${i}" aria-label="Reel ${i + 1} of ${items.length}">
          <div class="reel-inner"></div>
        </article>`).join("")}
      </div>
      <button class="iconbtn rv-close" data-act="rv-close" aria-label="Close viewer">${icon("back")}</button>
    </div>`;
  device.appendChild(ov);
  const frame = ov.querySelector(".rv-frame");
  viewerTeardown = mountReels(ov.querySelector("#rv-reels"), items.map((g) => g.it), startIdx);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (sourceEl && !reduce) {
    const dr = device.getBoundingClientRect();
    const sr = sourceEl.getBoundingClientRect();
    frame.style.transformOrigin = "top left";
    frame.style.transform = `translate(${sr.left - dr.left}px, ${sr.top - dr.top}px) scale(${sr.width / dr.width}, ${sr.height / dr.height})`;
    frame.style.borderRadius = "var(--radius-card)";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      frame.style.transition = "transform 320ms var(--ease-out), border-radius 320ms var(--ease-out)";
      frame.style.transform = "none";
      frame.style.borderRadius = "0";
      setTimeout(() => { frame.style.transition = ""; }, 360);
    }));
  }
  const onKey = (e) => { if (e.key === "Escape") { closeViewer(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
}

/* ---------- connection wizards ---------- */
function redirectUri(provider) { return `${location.origin}/api/auth/oauth/${provider}/callback`; }
async function saveConfig(patch, after) {
  try {
    const d = await api("/api/config", { method: "PUT", body: patch });
    state.config = d;
    state.oauth = { google: { configured: d.google_configured }, apple: { configured: d.apple_configured } };
    toast("Saved.");
    closeModal();
    if (after) after();
  } catch (e) { toast(e.message); }
}
function setupGoogle() {
  const c = state.config || {};
  openModal(`
    <h2>Connect Google sign-in</h2>
    <p class="muted" style="font-size:var(--text-sm); line-height:1.6">Real Google login needs a free OAuth client from your own Google Cloud console. Once connected, “Continue with Google” redirects to Google, shows the consent screen, and Google emails you the access notice.</p>
    <ol class="setup-steps">
      <li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">console.cloud.google.com/apis/credentials</a>. Create an OAuth consent screen (External) and add yourself as a test user.</li>
      <li>Create credentials → OAuth client ID → Web application.</li>
      <li>Add this authorized redirect URI: <code class="setup-uri">${esc(redirectUri("google"))}</code></li>
      <li>Paste the client ID and secret below.</li>
    </ol>
    <div class="field"><label for="gg-id">Client ID</label><input class="input" id="gg-id" value="${esc(c.google_client_id && c.google_client_id.value || "")}" placeholder="…apps.googleusercontent.com"></div>
    <div class="field"><label for="gg-secret">Client secret ${c.google_client_secret && c.google_client_secret.set ? "(saved — leave blank to keep)" : ""}</label><input class="input" id="gg-secret" type="password" placeholder="GOCSPX-…">${c.google_client_secret_hint ? `<span class="auth-note" style="display:block;margin-top:var(--space-2xs)">Stored: <span class="num">${esc(c.google_client_secret_hint)}</span> — use the copy icon in Google (not select-and-copy) so no line break sneaks in.</span>` : ""}</div>
    <div class="modal-actions">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-ink" data-act="save-google">Connect</button>
    </div>`);
}
function setupApple() {
  const c = state.config || {};
  openModal(`
    <h2>Connect Apple sign-in</h2>
    <p class="muted" style="font-size:var(--text-sm); line-height:1.6">Apple requires a paid Apple Developer account. Create a Services ID with Sign in with Apple, and a Sign in with Apple key (.p8). Return URL: <code class="setup-uri">${esc(redirectUri("apple"))}</code></p>
    <div class="field"><label for="ap-client">Services ID (client ID)</label><input class="input" id="ap-client" value="${esc(c.apple_client_id && c.apple_client_id.value || "")}" placeholder="com.example.earnest"></div>
    <div class="field"><label for="ap-team">Team ID</label><input class="input" id="ap-team" value="${esc(c.apple_team_id && c.apple_team_id.value || "")}" placeholder="10 characters"></div>
    <div class="field"><label for="ap-key">Key ID</label><input class="input" id="ap-key" value="${esc(c.apple_key_id && c.apple_key_id.value || "")}" placeholder="10 characters"></div>
    <div class="field"><label for="ap-p8">Private key (.p8 contents) ${c.apple_private_key && c.apple_private_key.set ? "(saved — leave blank to keep)" : ""}</label><textarea class="input" id="ap-p8" placeholder="-----BEGIN PRIVATE KEY-----"></textarea></div>
    <div class="modal-actions">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-ink" data-act="save-apple">Connect</button>
    </div>`);
}
function setupEmail() {
  const c = state.config || {};
  openModal(`
    <h2>Email delivery</h2>
    <p class="muted" style="font-size:var(--text-sm); line-height:1.6">Registration success emails are sent for real when a provider is connected. Until then they land in the dev outbox below. Easiest: a free Resend account and API key; or any SMTP server (Gmail app password, Mailgun, your own).</p>
    <div class="field"><label for="em-resend">Resend API key ${c.resend_api_key && c.resend_api_key.set ? "(saved)" : ""}</label><input class="input" id="em-resend" type="password" placeholder="re_…"></div>
    <div class="sect-label" style="margin-top:var(--space-xs)">or SMTP</div>
    <div class="row" style="gap:var(--space-sm)">
      <div class="field grow"><label for="em-host">Host</label><input class="input" id="em-host" value="${esc(c.smtp_host && c.smtp_host.value || "")}" placeholder="smtp.gmail.com"></div>
      <div class="field grow"><label for="em-port">Port</label><input class="input num" id="em-port" value="${esc(c.smtp_port && c.smtp_port.value || "")}" placeholder="587"></div>
    </div>
    <div class="row" style="gap:var(--space-sm)">
      <div class="field grow"><label for="em-user">User</label><input class="input" id="em-user" value="${esc(c.smtp_user && c.smtp_user.value || "")}"></div>
      <div class="field grow"><label for="em-pass">Password ${c.smtp_pass && c.smtp_pass.set ? "(saved)" : ""}</label><input class="input" id="em-pass" type="password"></div>
    </div>
    <div class="field"><label for="em-from">From address</label><input class="input" id="em-from" value="${esc(c.smtp_from && c.smtp_from.value || "")}" placeholder="EARNest <you@yourdomain.com>"></div>
    <div class="modal-actions">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-ink" data-act="save-email">Save</button>
    </div>
    <button class="btn btn-wide" style="margin-top:var(--space-xs)" data-act="test-email">Send a test email to ${esc(state.user ? state.user.email : "me")}</button>`);
}
function setupLlm() {
  const c = state.config || {};
  const keySaved = c.llm_api_key && c.llm_api_key.set;
  const provider = c.gen_provider === "api" ? "api" : "qwenwork";
  const root = openModal(`
    <h2>AI game generation</h2>
    <div class="field">
      <label>Generation runs on</label>
      <label style="display:flex; gap:8px; align-items:flex-start; font-size:var(--text-sm); line-height:1.5; padding:6px 0; cursor:pointer"><input type="radio" name="gen-provider" value="qwenwork" ${provider === "qwenwork" ? "checked" : ""} style="margin-top:3px"><span><b>My QwenWork credits</b> — the local “Earnest game builder” agent writes each story game: the world, the script and the questions. No API key, no OpenRouter, no Alibaba. Budget-capped: 10 builds/day, checks every 10 min (8am–midnight).</span></label>
      <label style="display:flex; gap:8px; align-items:flex-start; font-size:var(--text-sm); line-height:1.5; padding:6px 0; cursor:pointer"><input type="radio" name="gen-provider" value="api" ${provider === "api" ? "checked" : ""} style="margin-top:3px"><span><b>API key</b> — an OpenAI-compatible provider (OpenRouter, Alibaba DashScope…). Instant generation; the key stays on your server, never in the browser.</span></label>
    </div>
    <div id="llm-api-fields" ${provider === "api" ? "" : "hidden"}>
      <div class="field"><label for="llm-key">API key ${keySaved ? "(saved)" : ""}</label><input class="input" id="llm-key" type="password" placeholder="sk-or-…" autocomplete="off">
        <small class="muted" style="font-size:var(--text-xs); line-height:1.5; display:block; margin-top:4px">${keySaved ? "Leave blank to keep the saved key. Pasting a key replaces it outright." : "Paste the key for the provider below."} If you change the Base URL to a different provider, paste that provider's key too — the old key is never reused silently.</small></div>
      <div class="field"><label for="llm-url">Base URL</label><input class="input" id="llm-url" value="${esc(c.llm_base_url && c.llm_base_url.value || "")}" placeholder="https://openrouter.ai/api/v1"></div>
      <div class="field"><label for="llm-model">Model</label><input class="input" id="llm-model" value="${esc(c.llm_model && c.llm_model.value || "")}" placeholder="qwen/qwen3.7-flash"></div>
      <div class="field"><label for="llm-fallback">Fallback model (used on rate limits / no credit)</label><input class="input" id="llm-fallback" value="${esc(c.llm_fallback_model && c.llm_fallback_model.value || "")}" placeholder="openrouter/free"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-ink" data-act="save-llm">Save</button>
    </div>
    <button class="btn btn-wide" style="margin-top:var(--space-xs)" data-act="test-llm" id="llm-test-btn" ${provider === "api" ? "" : "hidden"}>Test the connection</button>`);
  root.querySelectorAll("[name=gen-provider]").forEach((r) => r.addEventListener("change", () => {
    const api = root.querySelector("[name=gen-provider]:checked").value === "api";
    root.querySelector("#llm-api-fields").hidden = !api;
    root.querySelector("#llm-test-btn").hidden = !api;
  }));
}
async function showOutbox() {
  let d;
  try { d = await api("/api/dev/outbox"); } catch (e) { toast(e.message); return; }
  openModal(`
    <h2>Dev email outbox</h2>
    <p class="muted" style="font-size:var(--text-sm)">No email provider connected yet, so registration emails are stored here. Connect Resend or SMTP in settings to deliver them for real.</p>
    ${d.messages.length ? `<div class="menu" style="box-shadow:none">
      ${d.messages.map((msg) => `<button class="menu-row" data-act="read-outbox" data-id="${esc(msg.file)}">${icon("comment")}<span class="grow" style="font-weight:500; font-size:var(--text-sm)">${esc(msg.file)}</span>${icon("chevron", "chev")}</button>`).join("")}
    </div>` : `<div class="empty">${icon("comment")}<p>No emails yet</p><span style="font-size:var(--text-sm)">Register an account to generate one</span></div>`}
    <button class="btn btn-wide" data-close>Close</button>`);
}

/* ---------- comments (Instagram-style sheet) ---------- */
function commentRow(c) {
  return `
  <div class="cm-row" data-cid="${c.id}">
    ${photoAvatar(c, "avatar-sm")}
    <div class="cm-main">
      <span class="cm-meta"><b>${esc(c.name)}</b><span class="num">${esc(c.date)}</span>${c.mine ? `<button class="cm-del" data-act="cm-del" data-id="${c.id}" aria-label="Delete your comment">delete</button>` : ""}</span>
      <p class="cm-text">${esc(c.text)}</p>
    </div>
    <button class="cm-like" data-act="cm-like" data-id="${c.id}" aria-pressed="${c.liked}" aria-label="Like comment">
      ${icon("heart")}<span class="num">${c.likes || ""}</span>
    </button>
  </div>`;
}
async function openComments(itemId) {
  const root = openModal(`
    <div class="cm-head"><b>Comments</b><span class="num muted" id="cm-count"></span></div>
    <div class="cm-list" id="cm-list"><div class="empty">${icon("comment")}<p>Loading comments…</p></div></div>
    <form class="cm-input" id="cm-form">
      ${photoAvatar(me, "avatar-sm")}
      <label class="visually-hidden" for="cm-text">Add a comment</label>
      <input class="input" id="cm-text" placeholder="Add a comment…" maxlength="500" autocomplete="off">
      <button class="cm-post" type="submit">Post</button>
    </form>`, { sheet: true, cls: "comments-sheet" });
  let data;
  try { data = await api(`/api/comments/${itemId}`); } catch (e) { toast(e.message); closeModal(); return; }
  const list = root.querySelector("#cm-list");
  const paint = () => {
    root.querySelector("#cm-count").textContent = `${data.comments.length}`;
    list.innerHTML = data.comments.length
      ? data.comments.map(commentRow).join("")
      : `<div class="empty">${icon("comment")}<p>No comments yet</p><span style="font-size:var(--text-sm)">Start the conversation</span></div>`;
  };
  paint();
  root.querySelector("#cm-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const inp = root.querySelector("#cm-text");
    const text = inp.value.trim();
    if (!text) return;
    try {
      await api(`/api/comments/${itemId}`, { body: { text } });
      inp.value = "";
      data = await api(`/api/comments/${itemId}`);
      paint();
      list.scrollTop = 0;
      document.querySelectorAll(`[data-count="${itemId}"]`).forEach((n) => { n.textContent = String(Number(n.textContent.replace(/[^\d]/g, "")) + 1); });
    } catch (ex) { toast(ex.message); }
  });
  list.addEventListener("click", async (e) => {
    const like = e.target.closest("[data-act=cm-like]");
    const del = e.target.closest("[data-act=cm-del]");
    try {
      if (like) {
        const d = await api(`/api/comments/${like.dataset.id}/like`, { method: "POST" });
        like.setAttribute("aria-pressed", String(d.liked));
        like.querySelector(".num").textContent = d.likes || "";
        const c = data.comments.find((x) => x.id === Number(like.dataset.id));
        if (c) { c.liked = d.liked; c.likes = d.likes; }
      } else if (del) {
        await api(`/api/comments/${del.dataset.id}`, { method: "DELETE" });
        data = await api(`/api/comments/${itemId}`);
        paint();
      }
    } catch (ex) { toast(ex.message); }
  });
}

/* ---------- global interaction wiring ---------- */
document.addEventListener("click", (e) => {
  // onboarding picks
  const obChip = e.target.closest("[data-ob-topic],[data-ob-field],[data-ob-goal],[data-ob-format],[data-ob-window]");
  if (obChip && ob) {
    const sets = { obTopic: "topics", obField: "fields", obGoal: "goals", obFormat: "formats", obWindow: "windows" };
    for (const [attr, key] of Object.entries(sets)) {
      const v = obChip.dataset[attr];
      if (v != null) { ob[key].has(v) ? ob[key].delete(v) : ob[key].add(v); break; }
    }
    paintOnboarding($("#screen"));
    return;
  }
  if (e.target.closest("[data-ob-back]") && ob) { ob.step = Math.max(0, ob.step - 1); paintOnboarding($("#screen")); return; }
  if (e.target.closest("[data-ob-next]") && ob) { obNext($("#screen")); return; }

  // feed tab switch
  const tabBtn = e.target.closest(".reel-tabs [data-tab]");
  if (tabBtn) {
    const want = tabBtn.dataset.tab;
    if (want !== state.feedTab) {
      state.feedPositions[state.feedTab] = state.reelIndex;
      state.feedTab = want;
      state.reelIndex = state.feedPositions[want] || 0;
      render();
    }
    return;
  }

  const navEl = e.target.closest("[data-go]");
  if (navEl && !e.target.closest("[data-act]")) { go(navEl.dataset.go); return; }

  if (e.target.closest("[data-back]")) { back(); return; }
  if (e.target.closest("[data-close]")) { closeModal(); return; }
  if (e.target.closest("[data-sheet-close]")) { closeSheet(false); return; }

  const act = e.target.closest("[data-act]");
  if (!act) return;
  const id = act.dataset.id;
  switch (act.dataset.act) {
    case "oauth": {
      (async () => {
        try {
          const r = await api(`/api/auth/oauth/${id}/start`);
          if (r.redirect) { location.href = r.redirect; return; }
          if (r.demo) {
            await api(`/api/auth/oauth/${id}/demo`, { method: "POST" });
            await enterApp();
            toast(`Signed in with a demo ${id === "google" ? "Google" : "Apple"} account.`);
          }
        } catch (ex) { toast(ex.message); }
      })();
      break;
    }
    case "method-options": {
      const m = state.methods.find((x) => x.id === Number(id));
      if (!m) break;
      openModal(`
        <h2>${esc(methodLabel(m))}</h2>
        <p class="muted" style="font-size:var(--text-sm)">${esc(methodSub(m))}${m.is_default ? " · default destination" : ""}</p>
        ${m.is_default ? "" : `<button class="btn btn-wide" data-act="method-default" data-id="${m.id}">Make default</button>`}
        <button class="btn btn-wide" data-act="method-remove" data-id="${m.id}">Remove</button>
        <button class="btn btn-wide" data-close>Close</button>`);
      break;
    }
    case "method-default":
      api(`/api/payment-methods/${id}/default`, { method: "POST" }).then((d) => {
        state.methods = d.methods; closeModal(); render(); toast("Default destination updated.");
      }).catch((e) => toast(e.message));
      break;
    case "method-remove":
      api(`/api/payment-methods/${id}`, { method: "DELETE" }).then((d) => {
        state.methods = d.methods; closeModal(); render(); toast("Payment method removed.");
      }).catch((e) => toast(e.message));
      break;
    case "wd-chip": {
      const input = document.querySelector("#wd-amount");
      if (!input) break;
      input.value = act.dataset.v === "all" ? state.wallet.toFixed(2) : Number(act.dataset.v).toFixed(2);
      input.dispatchEvent(new Event("input"));
      break;
    }
    case "answer": openAnswer(id); break;
    case "repost": {
      api(`/api/reposts/${id}`, { method: "POST" }).then((d) => {
        state.reposts[id] = d.active;
        toast(d.active ? "Reposted to your followers. They will see it in discover." : "Repost removed.");
      }).catch((e) => toast(e.message));
      break;
    }
    case "toggle-sound": {
      state.sound = !state.sound;
      const btn = document.querySelector(".sound-btn");
      if (btn) {
        btn.setAttribute("aria-pressed", String(state.sound));
        btn.setAttribute("aria-label", state.sound ? "Mute reel sound" : "Unmute reel sound");
        btn.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-${state.sound ? "speaker" : "speaker-off"}"/></svg>`;
      }
      const live = document.querySelector(".reel.live video");
      if (live) { live.muted = !state.sound; playReel(live); }
      toast(state.sound ? "Sound on for the reel you are watching." : "Sound muted.");
      break;
    }
    case "heart": {
      const next = !state.hearts[id];
      state.hearts[id] = next;
      document.querySelectorAll(`[data-act="heart"][data-id="${id}"]`).forEach((b) => b.setAttribute("aria-pressed", String(next)));
      api(`/api/hearts/${id}`, { method: "POST" }).then((d) => {
        state.hearts[id] = d.active;
        document.querySelectorAll(`[data-act="heart"][data-id="${id}"]`).forEach((b) => b.setAttribute("aria-pressed", String(d.active)));
        if (d.active && id.startsWith("s-")) toast("Liked. The feed will surface more studies like this one.");
      }).catch((e) => toast(e.message));
      break;
    }
    case "comments": openComments(id); break;
    case "follow": {
      api(`/api/follows/${id}`, { method: "POST" }).then((d) => {
        state.follows[id] = d.active;
        document.querySelectorAll(`[data-act="follow"][data-id="${id}"]`).forEach((b) => {
          b.setAttribute("aria-pressed", String(d.active));
          b.textContent = d.active ? "Following" : "Follow";
        });
        toast(d.active ? `Following ${researchers[id].name}. Updates join your discover feed.` : `Unfollowed ${researchers[id].name}.`);
      }).catch((e) => toast(e.message));
      break;
    }
    case "open-reel": {
      const items = (state.searchGrid && state.searchGrid.length ? state.searchGrid : gridItems((($("#search-in") || {}).value || "").trim().toLowerCase()));
      const idx = items.findIndex((g) => g.it.id === id);
      if (idx >= 0) openReelViewer(items, idx, act.closest(".grid-card"));
      break;
    }
    case "rv-close": closeViewer(); break;
    case "create-content": openCreatePicker(); break;
    case "setup-google": setupGoogle(); break;
    case "setup-apple": setupApple(); break;
    case "setup-email": setupEmail(); break;
    case "setup-llm": setupLlm(); break;
    case "show-outbox": showOutbox(); break;
    case "read-outbox":
      api(`/api/dev/outbox/${id}`).then((d) => {
        openModal(`<h2>Email</h2><pre class="outbox-raw">${esc(d.raw)}</pre><button class="btn btn-wide" data-close>Close</button>`);
      }).catch((e) => toast(e.message));
      break;
    case "save-google": {
      const patch = { google_client_id: ($("#gg-id") || {}).value || "" };
      const sec = ($("#gg-secret") || {}).value;
      if (sec) patch.google_client_secret = sec;
      saveConfig(patch, () => render());
      break;
    }
    case "save-apple": {
      const patch = { apple_client_id: ($("#ap-client") || {}).value || "", apple_team_id: ($("#ap-team") || {}).value || "", apple_key_id: ($("#ap-key") || {}).value || "" };
      const p8 = ($("#ap-p8") || {}).value;
      if (p8) patch.apple_private_key = p8;
      saveConfig(patch, () => render());
      break;
    }
    case "save-email": {
      const patch = { smtp_host: ($("#em-host") || {}).value || "", smtp_port: ($("#em-port") || {}).value || "", smtp_user: ($("#em-user") || {}).value || "", smtp_from: ($("#em-from") || {}).value || "" };
      const rk = ($("#em-resend") || {}).value; if (rk) patch.resend_api_key = rk;
      const sp = ($("#em-pass") || {}).value; if (sp) patch.smtp_pass = sp;
      saveConfig(patch, () => render());
      break;
    }
    case "save-llm": {
      const sel = document.querySelector("[name=gen-provider]:checked");
      const patch = { gen_provider: sel ? sel.value : "qwenwork" };
      if (patch.gen_provider === "api") {
        patch.llm_base_url = ($("#llm-url") || {}).value || "";
        patch.llm_model = ($("#llm-model") || {}).value || "";
        patch.llm_fallback_model = ($("#llm-fallback") || {}).value || "";
        const k = ($("#llm-key") || {}).value; if (k) patch.llm_api_key = k;
      }
      saveConfig(patch, () => render());
      break;
    }
    case "test-email":
      api("/api/config/test-email", { method: "POST" }).then((d) => toast(d.delivered === "outbox" ? "Test email saved to the dev outbox." : `Test email sent via ${d.delivered}.`)).catch((e) => toast(e.message));
      break;
    case "test-llm":
      api("/api/llm/test", { method: "POST" }).then((d) => toast(`Qwen connected: ${d.model} replied "${d.sample}"`)).catch((e) => toast(e.message));
      break;
    case "open-researcher": closeViewer(); go(`#/researcher/${id}`); break;
    case "open-paper": closeViewer(); go(`#/paper/${id}`); break;
    case "open-finding": closeViewer(); go(`#/finding/${id}`); break;
    case "open-study-reel": {
      (async () => {
        let it = studies.find((x) => x.id === id);
        if (!it) { try { it = await api(`/api/studies/${id}`); } catch (e) { /* fall through */ } }
        if (it) openReelViewer([{ it, r: researchers[it.researcher] }], 0);
        else go("#/feed");
      })();
      break;
    }
    case "open-reader": closeViewer(); go(`#/reader/${id}`); break;
    case "ask": {
      const inp = document.querySelector("#ask-in");
      const q = (inp && inp.value.trim()) || "";
      if (!q) { if (inp) inp.focus(); toast("Type your question first."); return; }
      toast("Sent. The AI answers FAQs instantly; anything new reaches the researcher by tonight.");
      if (inp) inp.value = "";
      break;
    }
    case "play-ai-game": openAiGame(id); break;
    case "open-game": go(`#/game/${id}`); break;
    case "open-queued": go(`#/game-queued/${id}`); break;
    case "open-draft": {
      (async () => {
        try {
          const d = await api(`/api/games/${id}`);
          setPendingGame({ kind: d.kind, spec: d.spec, id: d.id });
          go("#/game-preview");
        } catch (ex) { toast(ex.message); }
      })();
      break;
    }
    case "gp-close": closeGame(); navDirection = "tab"; render(); break;
    case "gp-audio": {
      const muted = StoryPlayer.toggleAudio();
      act.innerHTML = icon(muted ? "speaker-off" : "speaker");
      act.setAttribute("aria-label", muted ? "Unmute game sound" : "Mute game sound");
      break;
    }
    case "gp-finish": finishGame(); break;
    case "node-done": toast("Already cleared. The next node unlocks tomorrow."); break;
    case "node-lock": toast("Locked until your streak day advances."); break;
    case "node-chest":
      if (state.streakDay >= 7) openMilestone();
      else openModal(`
        <div class="milestone-disc">${icon("chest")}</div>
        <h2>Day-seven chest</h2>
        <p>Answer a study every day for seven days and this chest opens a <b>2x reward window</b> on your next 10 answers. You are on day <b>${state.streakDay}</b>.</p>
        <button class="btn btn-ink btn-wide" data-close>Back to the path</button>`, { cls: "milestone" });
      break;
    case "settings": openSettings(); break;
    case "edit-me": openEditMe(); break;
    case "toggle-researcher":
      api("/api/researcher-mode", { body: { on: !state.researcherMode } }).then((d) => {
        state.researcherMode = d.researcher_mode;
        render();
        toast(d.researcher_mode ? "Researcher mode on: dashboard and public profile unlocked." : "Researcher mode off. Your public resume stays hidden.");
      }).catch((e) => toast(e.message));
      break;
    case "save-rprofile": {
      const name = ($("#rp-name") || {}).value || me.name;
      const interests = ($("#rp-int") || {}).value || "";
      const windows = ($("#rp-win") || {}).value || "";
      api("/api/profile", { method: "PUT", body: { name, interests, answer_windows: windows } }).then((d) => {
        state.user = d.user; me.name = d.user.name;
        toast("Respondent profile saved. Matching will use the new interests.");
      }).catch((e) => toast(e.message));
      break;
    }
    case "save-all": toast("All responses saved to your downloads."); break;
    case "sort-resp": toast("Sorted newest first."); break;
    case "chart-set": toast("Chart settings are fixed in this prototype: pace per question, cleared responses only."); break;
    case "boost": toast("Boost requested. The study moves up in discovery while the budget lasts."); break;
    case "save-me": {
      const name = ($("#em-name") || {}).value || me.name;
      api("/api/profile", { method: "PUT", body: { name, interests: state.user.interests, answer_windows: state.user.answer_windows } }).then((d) => {
        state.user = d.user; me.name = d.user.name; me.initials = d.user.initials || me.initials;
        closeModal(); render(); toast("Profile saved.");
      }).catch((e) => toast(e.message));
      break;
    }
    case "set-autoplay": case "set-reminders": {
      const key = act.dataset.act === "set-autoplay" ? "autoplay" : "streak_reminders";
      const next = !state.settings[key];
      state.settings[key] = next ? 1 : 0;
      act.setAttribute("aria-checked", String(next));
      api("/api/settings", { method: "PUT", body: state.settings }).catch((e) => toast(e.message));
      break;
    }
    case "sign-out":
      api("/api/auth/logout", { method: "POST" }).then(() => {
        state.user = null; closeModal(); location.hash = "#/welcome"; render();
      }).catch((e) => toast(e.message));
      break;
    case "delete-account": openDeleteAccount(); break;
    case "confirm-delete-account": {
      const input = $("#del-confirm");
      if (!input || input.value.trim().toUpperCase() !== "DELETE") { toast("Type DELETE to confirm."); break; }
      const btn = act;
      btn.disabled = true; btn.textContent = "Deleting…";
      api("/api/auth/account", { method: "DELETE" }).then(() => {
        state.user = null; closeModal(); location.hash = "#/welcome"; render();
        toast("Your account and all its data were deleted.");
      }).catch((e) => { btn.disabled = false; btn.textContent = "Delete forever"; toast(e.message); });
      break;
    }
    case "show-credits": openCredits(); break;
    default: break;
  }
});

function openEditMe() {
  openModal(`
    <h2>edit profile</h2>
    <div class="field"><label for="em-name">Name</label><input class="input" id="em-name" type="text" value="${esc(me.name)}" autocomplete="name"></div>
    <div class="modal-actions">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-ink" data-act="save-me">Save</button>
    </div>`);
}
function openDeleteAccount() {
  const root = openModal(`
    <h2>Delete your account?</h2>
    <p class="muted" style="font-size:var(--text-sm); line-height:1.6">This permanently deletes your profile, answers, wallet balance (<b class="num">${money(state.wallet)}</b>), payment methods, comments and any studies or games you published. It cannot be undone.</p>
    <div class="field"><label for="del-confirm">Type DELETE to confirm</label><input class="input" id="del-confirm" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="DELETE"></div>
    <div class="modal-actions">
      <button class="btn" data-close>Keep my account</button>
      <button class="btn btn-danger" data-act="confirm-delete-account" disabled>Delete forever</button>
    </div>`);
  const input = root.querySelector("#del-confirm");
  const btn = root.querySelector("[data-act=confirm-delete-account]");
  input.addEventListener("input", () => { btn.disabled = input.value.trim().toUpperCase() !== "DELETE"; });
}
function openSettings() {
  openModal(`
    <h2>settings</h2>
    <div class="card toggle-row" style="box-shadow:none">
      <span class="toggle-txt"><b>Autoplay media</b><small>reels play as they arrive</small></span>
      <button class="toggle" role="switch" aria-checked="${!!state.settings.autoplay}" aria-label="Autoplay media" data-act="set-autoplay"></button>
    </div>
    <div class="card toggle-row" style="box-shadow:none; margin-top:var(--space-xs)">
      <span class="toggle-txt"><b>Streak reminders</b><small>one nudge before your streak expires</small></span>
      <button class="toggle" role="switch" aria-checked="${!!state.settings.streak_reminders}" aria-label="Streak reminders" data-act="set-reminders"></button>
    </div>
    <p class="muted" style="font-size:var(--text-sm)">Anti-bot and identity checks run quietly in the background. The platform takes its cut once, at withdrawal.</p>
    <div class="sect-label" style="margin-top:var(--space-sm)">Connections</div>
    <button class="btn btn-wide" data-act="setup-google">${icon("verified")} Google sign-in · ${state.oauth.google.configured ? "connected" : "not connected"}</button>
    <button class="btn btn-wide" data-act="setup-apple">${icon("verified")} Apple sign-in · ${state.oauth.apple.configured ? "connected" : "not connected"}</button>
    <button class="btn btn-wide" data-act="setup-email">${icon("chest")} Email delivery · ${state.config && state.config.email_configured ? "connected" : "dev outbox"}</button>
    <button class="btn btn-wide" data-act="setup-llm">${icon("bolt")} AI game generation · ${state.config && state.config.gen_provider === "api" ? (state.config.llm_configured ? "API key connected" : "API key missing") : "QwenWork credits"}</button>
    ${state.config && !state.config.email_configured ? `<button class="btn btn-wide" data-act="show-outbox">${icon("comment")} Dev email outbox</button>` : ""}
    <button class="btn btn-wide" data-act="show-credits">Photo and video credits</button>
    <button class="btn btn-wide" data-act="sign-out">Sign out</button>
    <button class="btn btn-wide" data-close>Close</button>`, { sheet: true });
}
function openCredits() {
  openModal(`
    <h2>credits</h2>
    <p class="muted" style="font-size:var(--text-sm)">Every photograph and clip in this prototype is openly licensed. Portraits: Leroy Chiao, Kalpana Chawla and Leland Melvin official NASA portraits (public domain, images.nasa.gov); Young-Kee Kim (CC BY-SA 4.0, Rpostelfermilab); Bonnie Fleming (CC BY-SA 4.0, Neutrinos on the Prairie); Siarhei Besarab (CC BY-SA 4.0); Ilan Ramon (public domain, NASA), all via Wikimedia Commons.</p>
    <ul class="credits-list muted">
      <li>Earth at night: lights of human activity · NASA GSFC · public domain</li>
      <li>Seeing our home in a whole new light: space station benefits · NASA · public domain</li>
      <li>Operation IceBridge: across the Ross · NASA GSFC · public domain</li>
      <li>Nancy Grace Roman Space Telescope mission trailer · NASA · public domain</li>
      <li>Astronauts share a tour of Boeing's Starliner spacecraft · NASA JSC · public domain</li>
      <li>Astronaut Kate Rubins advances DNA sequencing in space · NASA JSC · public domain</li>
      <li>Reciprocity in coral reef fishes · PLOS ONE supplementary · CC BY 4.0</li>
      <li>KSC-11-S-00026, Space Shuttle processing · NASA KSC · public domain</li>
      <li>U.S. Spacewalk 74 animation · NASA JSC · public domain</li>
      <li>Artemis I launch rollout · NASA KSC · public domain</li>
    </ul>
    <button class="btn btn-wide" data-close>Close</button>`);
}

/* The shell is viewport-locked; never let the browser restore a document
   scroll offset on reload — that would lift the whole app off the bottom edge. */
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
addEventListener("load", () => scrollTo(0, 0));

addEventListener("popstate", () => {
  const trail = history.state?.earnest?.trail;
  navDirection = trail && trail.length < navStack.length ? "back" : "none";
  // Hash history emits hashchange next, which performs the single render.
});
addEventListener("hashchange", render);
for (const event of ["touchend", "click"]) document.addEventListener(event, () => {
  if (!state.sound) return;
  document.querySelectorAll(".reel.live video").forEach((video) => { video.muted = false; playReel(video); });
}, { passive: true, capture: true });
addEventListener("DOMContentLoaded", async () => {
  /* night-theme tokens live in [data-mode="dark"]; keep the attribute in sync
     with the .theme-dark class across every render path (push, tab, async) */
  const syncDark = () => document.querySelectorAll(".theme-dark:not([data-mode])").forEach((el) => el.setAttribute("data-mode", "dark"));
  new MutationObserver(syncDark).observe($("#device"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  syncDark();
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    switchTab(`#/${b.dataset.nav}`);
  }));
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[role=button][data-go]")) {
      e.preventDefault(); go(e.target.dataset.go);
    }
  });
  try {
    const { user } = await api("/api/auth/me");
    if (user) applyBootstrap(await api("/api/bootstrap"));
  } catch { /* offline or server starting: stay on welcome */ }
  if (!location.hash) location.hash = state.user ? "#/feed" : "#/welcome";
  render();
});
