/* EARNest Founder Cockpit · live data layer.
   Talks to the real Earnest backend (/api/admin/* on Render), keeps the
   DEMO object as the view-model (Object.assign from the bootstrap payload),
   and wires every cockpit action to a real, audit-logged endpoint.
   Growth & Investors remain demo until their integrations land. */
"use strict";

const LIVE = (() => {
  const API = localStorage.getItem("earnest_api_base") ||
    (location.hostname.endsWith(".onrender.com") ? location.origin : "https://earnest-g2kz.onrender.com");
  const TOKEN_KEY = "earnest_admin_token";
  let token = localStorage.getItem(TOKEN_KEY) || "";
  let busy = false;

  async function call(path, opts = {}) {
    const r = await fetch(API + path, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== "/api/admin/login") { showLogin(); throw new Error("Sign-in required."); }
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }
  const post = (path, body) => call(path, { method: "POST", body });

  function showLogin() {
    const o = document.getElementById("loginOverlay");
    if (o) o.hidden = false;
  }
  function hideLogin() {
    const o = document.getElementById("loginOverlay");
    if (o) o.hidden = true;
  }

  function paintChrome() {
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set("creditsToday", Number(DEMO.credits.used).toLocaleString("en-US"));
    set("creditsCap", "/ " + DEMO.credits.cap + " builds");
    set("founderBadge", (DEMO.founder || "F")[0].toUpperCase());
    const chip = document.getElementById("liveChip");
    if (chip) chip.innerHTML = DEMO.live ? '<span class="dot ok"></span><span>live</span>' : '<span class="dot idle"></span><span>demo</span>';
    const nav = document.getElementById("navStatus");
    if (nav) nav.innerHTML = DEMO.live ? '<span class="dot ok"></span>Live · Render' : '<span class="dot idle"></span>Demo data';
    const dm = document.getElementById("navDmCount");
    if (dm) dm.textContent = (DEMO.inbox && DEMO.inbox.unread) || "";
  }

  async function refresh() {
    const payload = await call("/api/admin/bootstrap");
    if (payload.deploy) Object.assign(DEMO.deploy, payload.deploy);
    if (payload.growth) {
      /* real Hashmeta metrics override KPIs/CMS/SEO/CRM; Social Listening &
         Campaigns stay demo until those integrations land. */
      const g = payload.growth;
      DEMO.growth = Object.assign({}, DEMO.growth, g, {
        hashmeta: Object.assign({}, DEMO.growth.hashmeta, g.hashmeta || {}),
      });
      delete payload.growth;
    }
    Object.assign(DEMO, payload);
    paintChrome();
    if (typeof render === "function") render();
  }

  async function login(email, password) {
    const j = await post("/api/admin/login", { email, password });
    token = j.token;
    localStorage.setItem(TOKEN_KEY, token);
    hideLogin();
    await refresh();
  }
  function logout() {
    token = "";
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
  }

  /* run an action, then re-pull real state */
  async function act(path, body, okMsg) {
    if (busy) return;
    busy = true;
    try {
      await post(path, body);
      if (okMsg && typeof toast === "function") toast(okMsg);
      await refresh();
    } catch (e) {
      if (typeof toast === "function") toast(e.message, true);
    } finally { busy = false; }
  }

  /* ---- inbox ---- */
  const inboxState = { conversations: [], summary: null, sel: null, thread: null, draftBusy: false };
  async function loadInbox() {
    const j = await call("/api/admin/inbox");
    inboxState.conversations = j.conversations || [];
    inboxState.summary = j.summary;
    inboxState.bridge = j.bridge;
    inboxState.last_error = j.last_error;
    DEMO.inbox = j.summary;
    paintChrome();
    if (inboxState.sel) await openThread(inboxState.sel, true);
    if (typeof render === "function" && state.view === "inbox") render();
  }
  async function openThread(id, silent) {
    const j = await call("/api/admin/inbox-thread?id=" + encodeURIComponent(id));
    inboxState.sel = id;
    inboxState.thread = j;
    if (!silent && typeof render === "function") render();
  }
  async function reply(id, text) {
    const j = await post("/api/admin/inbox-reply", { id, text });
    if (typeof toast === "function") toast("Reply sent · bot paused on this thread");
    await openThread(id, true);
    await loadInbox();
    return j;
  }
  async function botToggle(id, paused) {
    await post("/api/admin/inbox-bot", { id, paused });
    if (typeof toast === "function") toast(paused ? "You took over — bot is silent on this thread" : "Bot resumed on this thread");
    await openThread(id, true);
    await loadInbox();
  }
  async function draft(id) {
    inboxState.draftBusy = true;
    if (typeof render === "function") render();
    try {
      const j = await post("/api/admin/inbox-draft", { id });
      const box = document.getElementById("replyBox");
      if (box) { box.value = j.draft; box.focus(); }
      if (typeof toast === "function") toast("AI draft ready — edit, then send");
    } catch (e) {
      if (typeof toast === "function") toast(e.message, true);
    } finally {
      inboxState.draftBusy = false;
      if (typeof render === "function" && state.view === "inbox") render();
    }
  }
  async function syncInbox() {
    try {
      const j = await post("/api/admin/inbox-sync", {});
      if (typeof toast === "function") toast(`Synced · ${j.conversations} threads, ${j.new_messages} new messages`);
      await loadInbox();
    } catch (e) { if (typeof toast === "function") toast(e.message, true); }
  }

  function init() {
    const form = document.getElementById("loginForm");
    if (form) form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("loginBtn");
      const err = document.getElementById("loginErr");
      btn.disabled = true; err.textContent = "";
      try {
        await login(document.getElementById("loginEmail").value, document.getElementById("loginPass").value);
      } catch (ex) { err.textContent = ex.message; }
      finally { btn.disabled = false; }
    });
    if (!token) { showLogin(); return; }
    refresh().catch(() => showLogin());
    /* keep the cockpit fresh */
    setInterval(() => { if (token && !document.hidden) refresh().catch(() => {}); }, 60000);
    setInterval(() => { if (token && !document.hidden && typeof state !== "undefined" && state.view === "inbox") loadInbox().catch(() => {}); }, 15000);
  }

  return { init, refresh, act, login, logout, loadInbox, openThread, reply, botToggle, draft, syncInbox, inboxState, call, post };
})();