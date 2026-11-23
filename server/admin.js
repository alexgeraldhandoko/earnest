/* EARNest · Founder Cockpit API — real data for the admin dashboard.
   Mounted at /api/admin/* in index.js. Admin-gated (users.role='admin'),
   CORS-enabled for the cockpit page, every mutation audit-logged.
   Read model: one GET /bootstrap payload shaped for the cockpit views.
   Instagram inbox: durable threads, founder reply via Outstand, per-thread
   bot takeover, AI draft replies on QwenWork credits. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { q, tx, DATA_DIR } = require("./db");
const auth = require("./auth");
const config = require("./config");
const persist = require("./persist");
const inbox = require("./inbox");
const qw = require("./qwenwork");
const { TOPICS } = require("./topics");

const COCKPIT_ORIGINS = new Set([
  "https://zfu5jcjg.qwenwork.page",
  "https://jjj6ztb4.qwenwork.page",
]);
function cors(req, res) {
  const o = String(req.headers.origin || "");
  if (COCKPIT_ORIGINS.has(o) || /^http:\/\/localhost:\d+$/.test(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Vary", "Origin");
}
function json(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }
function audit(actor, action, target) { try { q.run("INSERT INTO audit_log (actor,action,target) VALUES (?,?,?)", actor, action, target || null); } catch (_) {} }
function pollToken() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "igwebhook-config.json"), "utf8")).poll_token || kvGet("ig_poll_token"); } catch (_) { return kvGet("ig_poll_token"); } }
function kvGet(k) { const r = q.get("SELECT value FROM config WHERE key=?", k); return r && r.value ? r.value : ""; }
function kvSet(k, v) {
  if (v == null || v === "") q.run("DELETE FROM config WHERE key=?", k);
  else q.run("INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, String(v));
}
function adminUser(req, cookieUser) {
  let u = cookieUser;
  const h = String(req.headers.authorization || "");
  if (h.startsWith("Bearer ")) u = auth.sessionUser(h.slice(7).trim());
  return u && u.role === "admin" ? u : null;
}
/* SQLite datetime('now') is UTC without a marker — normalise before parsing */
function parseTs(s) { if (!s) return 0; const t = String(s); return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(t) ? t.replace(" ", "T") + "Z" : t) || 0; }
function rel(s) {
  const t = parseTs(s); if (!t) return "—";
  const d = Date.now() - t;
  if (d < 60000) return "just now";
  if (d < 3600000) return Math.floor(d / 60000) + "m ago";
  if (d < 86400000) return Math.floor(d / 3600000) + "h ago";
  return Math.floor(d / 86400000) + "d ago";
}
const one = (sql, ...p) => { const r = q.get(sql, ...p); return r ? Object.values(r)[0] : 0; };

/* ---------------- read model ---------------- */
function coverageGrid() {
  return TOPICS.map((t) => ({
    name: t.label,
    cells: t.fields.map((f) => one("SELECT COUNT(*) FROM studies WHERE active=1 AND chip=?", f)),
  }));
}
function sparks() {
  const days = [...Array(12)].map((_, i) => {
    const off = 11 - i;
    const d = one(`SELECT COUNT(DISTINCT user_id) FROM feed_events WHERE date(created_at)=date('now','-${off} days')`);
    const r = one(`SELECT COUNT(*) FROM responses WHERE date(created_at)=date('now','-${off} days')`) +
              one(`SELECT COUNT(*) FROM game_plays WHERE date(created_at)=date('now','-${off} days')`);
    const rev = one(`SELECT COALESCE(SUM(fee_cents),0)/100.0 FROM withdrawals WHERE date(created_at)=date('now','-${off} days')`);
    const earn = one(`SELECT COALESCE(SUM(delta_cents),0)/100.0 FROM wallet_ledger WHERE delta_cents>0 AND date(created_at)=date('now','-${off} days')`);
    return { d, r, rev, earn };
  });
  return { dau: days.map((x) => x.d), responses: days.map((x) => x.r), revenue: days.map((x) => x.rev), liability: days.map((x) => x.earn) };
}
function kpis(grid) {
  const totalCells = grid.reduce((n, t) => n + t.cells.length, 0);
  const empty = grid.reduce((n, t) => n + t.cells.filter((c) => c === 0).length, 0);
  const respTotal = one("SELECT COUNT(*) FROM responses") + one("SELECT COUNT(*) FROM game_plays");
  const flagged = one("SELECT COUNT(*) FROM responses WHERE flagged!=0") + one("SELECT COUNT(*) FROM game_plays WHERE flagged!=0");
  return {
    dau: one("SELECT COUNT(DISTINCT user_id) FROM feed_events WHERE date(created_at)=date('now')"),
    wau: one("SELECT COUNT(*) FROM users WHERE last_active_date>=date('now','-6 days')"),
    responses: one("SELECT COUNT(*) FROM responses WHERE date(created_at)=date('now')") + one("SELECT COUNT(*) FROM game_plays WHERE date(created_at)=date('now')"),
    liability: one("SELECT COALESCE(SUM(wallet_cents),0)/100.0 FROM users WHERE wallet_cents>0"),
    revenue: one("SELECT COALESCE(SUM(fee_cents),0)/100.0 FROM withdrawals WHERE strftime('%Y-%m',created_at)=strftime('%Y-%m','now')"),
    flagRate: respTotal ? Math.round((flagged / respTotal) * 1000) / 10 : 0,
    discoverSize: one("SELECT COUNT(*) FROM discoveries WHERE active=1"),
    discoverIngest: one("SELECT COUNT(*) FROM discovery_posts WHERE date(synced_at)=date('now')"),
    studies: one("SELECT COUNT(*) FROM studies WHERE active=1"),
    coverageBalance: totalCells ? Math.round(((totalCells - empty) / totalCells) * 100) : 0,
    emptyCells: empty,
    sparks: sparks(),
  };
}
function agents() {
  const pipe = require("./pipeline").status();
  const gb = require("./gamebuilder").status();
  const aq = require("./agentqueue");
  const used = aq.DAILY_CAP - aq.remainingToday();
  const qwConvs = (() => { try { return Object.keys(JSON.parse(kvGet("qw_convs") || "{}")).length; } catch (_) { return 0; } })();
  const lastReply = (() => { try { return JSON.parse(kvGet("qw_last_reply") || "null"); } catch (_) { return null; } })();
  const list = [
    { id: "a-discover", name: "Discovery Pipeline", icon: "globe", role: "arXiv / HN / NASA → Discover findings", schedule: "Hourly", status: pipe.running ? "running" : pipe.paused ? "paused" : "idle", last: rel(pipe.last_run), next: pipe.next_run ? rel(pipe.next_run).replace(" ago", "") : "—", jobs: pipe.last_added, credits: 0, budget: 1, success: pipe.errors.length ? Math.max(0, 100 - pipe.errors.length * 5) : 100 },
    { id: "a-game", name: "Game Builder", icon: "bot", role: "Writes game specs on QwenWork credits", schedule: "Every 10m", status: gb.running ? "running" : gb.ready ? "idle" : "paused", last: gb.last_build ? rel(gb.last_build.at) : "—", next: "10m", jobs: used, credits: used, budget: aq.DAILY_CAP, success: gb.last_error ? 90 : 100 },
    { id: "a-dm", name: "DM Responder", icon: "chat", role: "Answers Instagram DMs in the cloud · cockpit takeover", schedule: "Always on", status: qw.enabled() ? "running" : "paused", last: lastReply ? rel(lastReply.at) : "—", next: "live", jobs: qwConvs, credits: 0, budget: 1, success: kvGet("qw_last_error") ? 90 : 100 },
    { id: "a-sourcer", name: "Study Sourcer", icon: "flask", role: "Scrape → verify → transform paid studies, gap-first", schedule: "QwenWork skill", status: "idle", last: "—", next: "on demand", jobs: 0, credits: 0, budget: 1, success: 100, external: true },
    { id: "a-deck", name: "Deck Writer", icon: "doc", role: "Refreshes investor deck from metrics snapshots", schedule: "QwenWork cron", status: "idle", last: "—", next: "—", jobs: 0, credits: 0, budget: 1, success: 100, external: true },
    { id: "a-growth", name: "Growth & CRM", icon: "mega", role: "Hashmeta content, visibility checks, lead nurture", schedule: "QwenWork cron", status: "idle", last: "—", next: "—", jobs: 0, credits: 0, budget: 1, success: 100, external: true },
    { id: "a-ops", name: "Ops Reporter", icon: "chart", role: "Morning agenda, KPI snapshot, alert digest", schedule: "QwenWork cron", status: "idle", last: "—", next: "—", jobs: 0, credits: 0, budget: 1, success: 100, external: true },
    { id: "a-leadscout", name: "Lead Scout", icon: "radar", role: "Scores social chats for researchers likely to convert", schedule: "QwenWork cron", status: "idle", last: "—", next: "—", jobs: 0, credits: 0, budget: 1, success: 100, external: true },
    { id: "a-invscout", name: "Investor Scout", icon: "target", role: "Scores chats & posts for investors most likely to fund", schedule: "QwenWork cron", status: "idle", last: "—", next: "—", jobs: 0, credits: 0, budget: 1, success: 100, external: true },
  ];
  return list;
}
function alerts(k) {
  const out = [];
  const flagged = one("SELECT COUNT(*) FROM responses WHERE flagged=1") + one("SELECT COUNT(*) FROM game_plays WHERE flagged=1");
  if (flagged) out.push({ level: "warn", text: `${flagged} flagged response${flagged > 1 ? "s" : ""} held unpaid`, sub: "Review in Response Quality and Trust — clear & pay or reject.", view: "quality" });
  const stuck = q.all("SELECT id, amount_cents FROM withdrawals WHERE status='processing' AND created_at < datetime('now','-1 hour')");
  for (const w of stuck) out.push({ level: "warn", text: "Withdrawal stuck in processing", sub: `w-${w.id} · $${(w.amount_cents / 100).toFixed(2)} · over 1h.`, view: "money" });
  if (k.emptyCells) out.push({ level: "warn", text: `Coverage gaps: ${k.emptyCells} empty cells`, sub: "Source gap topics first in Research Ops.", view: "research" });
  const qe = kvGet("qw_last_error");
  if (qe) out.push({ level: "err", text: "DM responder error", sub: String(qe).slice(0, 140), view: "inbox" });
  const ge = kvGet("gb_last_error");
  if (ge) out.push({ level: "err", text: "Game Builder error", sub: String(ge).slice(0, 140), view: "catalog" });
  const pipe = require("./pipeline").status();
  if (pipe.errors.length) out.push({ level: "warn", text: "Discover pipeline errors", sub: String(pipe.errors[pipe.errors.length - 1]).slice(0, 140), view: "research" });
  const needsHuman = one("SELECT COUNT(*) FROM social_conversations WHERE needs_human=1");
  if (needsHuman) out.push({ level: "warn", text: `${needsHuman} DM thread${needsHuman > 1 ? "s" : ""} need a human`, sub: "Bot is paused on these threads — reply from the Social Inbox.", view: "inbox" });
  return out;
}
function activity() {
  const items = [];
  for (const r of q.all(`SELECT r.id, r.created_at, r.quality_score, r.flagged, u.name AS user, s.title FROM responses r JOIN users u ON u.id=r.user_id JOIN studies s ON s.id=r.study_id ORDER BY r.id DESC LIMIT 6`))
    items.push({ ts: parseTs(r.created_at), tone: r.flagged ? "error" : "blue", icon: r.flagged ? "shield" : "flask", text: r.flagged ? `Response <b>r-${r.id}</b> flagged · score ${r.quality_score} · held unpaid` : `<b>${r.user}</b> answered <b>${r.title}</b> · score ${r.quality_score}` });
  for (const w of q.all(`SELECT w.id, w.amount_cents, w.status, w.created_at, u.name FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 4`))
    items.push({ ts: parseTs(w.created_at), tone: "money", icon: "coin", text: `Withdrawal <b>w-${w.id}</b> ${w.status} · <b>$${(w.amount_cents / 100).toFixed(2)}</b> · ${w.name}` });
  for (const g of q.all("SELECT id, title, status, created_at FROM games ORDER BY created_at DESC LIMIT 4"))
    items.push({ ts: parseTs(g.created_at), tone: "lav", icon: "bot", text: `<b>Game Builder</b> · <b>${g.title}</b> → ${g.status}` });
  for (const m of q.all(`SELECT m.created_at, m.text, c.display_name, c.handle FROM social_messages m JOIN social_conversations c ON c.id=m.conversation_id WHERE m.direction='in' ORDER BY m.id DESC LIMIT 4`))
    items.push({ ts: parseTs(m.created_at), tone: "earn", icon: "chat", text: `<b>${m.display_name || m.handle || "Instagram user"}</b> DM'd: “${String(m.text).slice(0, 70)}”` });
  for (const a of q.all("SELECT actor, action, target, created_at FROM audit_log ORDER BY id DESC LIMIT 4"))
    items.push({ ts: parseTs(a.created_at), tone: "blue", icon: "check", text: `<b>${a.actor}</b> ${a.action} · ${a.target || ""}` });
  return items.sort((a, b) => b.ts - a.ts).slice(0, 12).map((x) => ({ tone: x.tone, icon: x.icon, text: x.text, time: rel(new Date(x.ts).toISOString()) }));
}
function approvals() {
  const out = [];
  for (const g of q.all("SELECT id, title, kind, reward_cents, status FROM games WHERE status='draft' ORDER BY created_at DESC LIMIT 10")) {
    out.push({
      id: "game:" + g.id, flow: "studies", risk: "low", agent: "Game Builder", status: "pending",
      title: `Publish game · “${g.title}”`,
      payload: `Kind: ${g.kind} · Reward $${((g.reward_cents || 0) / 100).toFixed(2)} · spec built on QwenWork credits. Publishing makes it live in the play tab.`,
      evidence: [{ ok: true, text: "Spec parsed & stored by the builder" }, { ok: true, text: "Daily build budget respected" }],
    });
  }
  for (const w of q.all(`SELECT w.id, w.amount_cents, w.fee_cents, w.user_id, u.name, u.wallet_cents, u.bot_ewma,
      (SELECT COALESCE(AVG(quality_score),100) FROM responses r WHERE r.user_id=w.user_id) AS q,
      (SELECT COUNT(*) FROM responses r WHERE r.user_id=w.user_id AND r.flagged!=0) AS flags
      FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.status='processing' AND w.amount_cents>2000 ORDER BY w.id DESC LIMIT 10`)) {
    out.push({
      id: "wd:" + w.id, flow: "payouts", risk: w.amount_cents > 5000 ? "high" : "medium", agent: "Ops Reporter", status: "pending",
      title: `Withdrawal over threshold · $${(w.amount_cents / 100).toFixed(2)}`,
      payload: `${w.name} · fee $${(w.fee_cents / 100).toFixed(2)} (2%). Wallet already debited; approving settles processing → paid.`,
      evidence: [
        { ok: w.q >= 60, text: `Avg quality ${Math.round(w.q)} across their responses` },
        { ok: w.flags === 0, text: w.flags ? `${w.flags} flagged responses on record` : "Zero flags" },
        { ok: (w.bot_ewma || 0) < 0.6, text: `Bot score ${(w.bot_ewma || 0).toFixed(2)}` },
      ],
    });
  }
  return out;
}
function flaggedQueue() {
  const out = [];
  const mk = (r, kind, studyTitle) => {
    let reasons = []; try { reasons = JSON.parse(r.flag_reasons || "[]"); } catch (_) {}
    const hist = one("SELECT COUNT(*) FROM responses WHERE user_id=?", r.user_id);
    const prior = one("SELECT COUNT(*) FROM responses WHERE user_id=? AND flagged!=0 AND id!=?", r.user_id, r.id);
    const u = q.get("SELECT name FROM users WHERE id=?", r.user_id);
    return {
      id: (kind === "play" ? "gp-" : "r-") + r.id, kind, study: studyTitle, user: u ? u.name : "user " + r.user_id,
      score: r.quality_score,
      timing: reasons.includes("timing") ? Math.min(r.quality_score, 35) : Math.max(r.quality_score, 80),
      attention: reasons.includes("attention") ? Math.min(r.quality_score, 30) : 100,
      consistency: reasons.includes("consistency") ? Math.min(r.quality_score, 45) : Math.max(r.quality_score, 75),
      age: rel(r.created_at), history: `${prior ? prior + " prior flag" + (prior > 1 ? "s" : "") : "Clean"} · ${hist} responses`,
    };
  };
  for (const r of q.all(`SELECT r.*, s.title FROM responses r JOIN studies s ON s.id=r.study_id WHERE r.flagged=1 ORDER BY r.id DESC LIMIT 30`)) out.push(mk(r, "response", r.title));
  for (const r of q.all(`SELECT gp.id, gp.user_id, gp.quality_score, gp.created_at, g.title FROM game_plays gp JOIN games g ON g.id=gp.game_id WHERE gp.flagged=1 ORDER BY gp.id DESC LIMIT 10`)) out.push(mk(r, "play", r.title));
  return out;
}
function qualityDist() {
  const buckets = Array(10).fill(0);
  for (const t of ["responses", "game_plays"]) {
    for (const r of q.all(`SELECT quality_score FROM ${t}`)) {
      const b = Math.max(0, Math.min(9, Math.floor((r.quality_score || 0) / 10)));
      buckets[b]++;
    }
  }
  return buckets;
}
function botCases() {
  return q.all("SELECT id, name, bot_ewma, wallet_cents FROM users WHERE bot_ewma>0.5 ORDER BY bot_ewma DESC LIMIT 6").map((u) => ({
    id: "case-u" + u.id, title: `${u.name} · bot score ${(u.bot_ewma || 0).toFixed(2)}`,
    detail: `Wallet $${(u.wallet_cents / 100).toFixed(2)} · ${one("SELECT COUNT(*) FROM responses WHERE user_id=?", u.id)} responses · timing/device signals accumulated`,
    risk: u.bot_ewma > 0.8 ? "high" : "medium",
  }));
}
function money() {
  const withdrawals = q.all(`SELECT w.*, u.name, p.kind, p.last4, p.brand FROM withdrawals w JOIN users u ON u.id=w.user_id LEFT JOIN payment_methods p ON p.id=w.method_id ORDER BY w.id DESC LIMIT 50`).map((w) => ({
    id: "w-" + w.id, user: w.name, amount: w.amount_cents / 100, fee: w.fee_cents / 100,
    dest: (w.kind || "?") + (w.last4 ? " •••• " + w.last4 : ""), status: w.status, age: rel(w.created_at),
  }));
  const ledger = q.all(`SELECT l.*, u.name FROM wallet_ledger l JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 50`).map((l) => ({
    id: "l-" + l.id, user: l.name, type: l.kind, amount: l.delta_cents / 100, note: l.note || "", time: rel(l.created_at),
  }));
  const paid = q.get("SELECT COALESCE(AVG(reward_cents),0)/100.0 AS avg, COUNT(*) AS n FROM responses WHERE flagged=0 AND reward_cents>0");
  const fees = q.get("SELECT COALESCE(SUM(fee_cents),0) AS f, COALESCE(SUM(amount_cents),0) AS a FROM withdrawals");
  return {
    withdrawals, ledger, invoices: [],
    economics: {
      costPerResponse: Math.round((paid.avg || 0) * 100) / 100,
      avgReward: Math.round((paid.avg || 0) * 100) / 100,
      takeRate: fees.a ? Math.round((fees.f / fees.a) * 1000) / 10 : 0,
      marginPerStudy: null,
    },
  };
}
function people() {
  const users = q.all(`SELECT u.*, (SELECT COUNT(*) FROM responses r WHERE r.user_id=u.id) AS resp,
      (SELECT COALESCE(AVG(quality_score),100) FROM responses r WHERE r.user_id=u.id) AS q,
      (SELECT COUNT(*) FROM responses r WHERE r.user_id=u.id AND r.flagged!=0) AS flags
      FROM users u ORDER BY u.id DESC LIMIT 200`).map((u) => ({
    id: u.id, name: u.name, email: u.email, wallet: u.wallet_cents / 100, streak: u.streak_day || 0,
    responses: u.resp, quality: Math.round(u.q), flags: u.flags,
    status: u.suspended ? "suspended" : (u.bot_ewma || 0) > 0.6 ? "watch" : "active", av: (u.id % 5) + 1,
  }));
  const researcherQueue = q.all(`SELECT r.*, (SELECT COUNT(*) FROM studies s WHERE s.researcher_id=r.id) AS studies FROM researchers r ORDER BY r.name LIMIT 60`).map((r) => ({
    name: r.name, org: r.org, studies: r.studies, verified: r.studies > 0,
  }));
  return { users, researcherQueue };
}
function catalog() {
  const studies = q.all(`SELECT s.*, (SELECT COUNT(*) FROM responses r WHERE r.study_id=s.id) AS resp,
      (SELECT COALESCE(AVG(quality_score),100) FROM responses r WHERE r.study_id=s.id) AS q
      FROM studies s ORDER BY s.active DESC, s.id DESC LIMIT 250`).map((s) => ({
    id: s.id, title: s.title, chip: s.chip || "", reward: s.reward_cents, min: s.minutes || 0,
    resp: s.resp, quality: Math.round(s.q), active: !!s.active,
  }));
  const aq = require("./agentqueue");
  const items = q.all("SELECT id, title, kind, status, reward_cents FROM games WHERE status IN ('queued','building','draft') ORDER BY created_at DESC LIMIT 30").map((g) => ({
    id: g.id, title: g.title, kind: g.kind, status: g.status, reward: g.reward_cents || 0,
  }));
  return {
    studies,
    gameQueue: { budget: { used: aq.DAILY_CAP - aq.remainingToday(), cap: aq.DAILY_CAP }, items, published: one("SELECT COUNT(*) FROM games WHERE status='published'") },
  };
}
function deployInfo() {
  let dbSize = "—";
  try { dbSize = (fs.statSync(path.join(DATA_DIR, "earnest.db")).size / 1048576).toFixed(1) + " MB"; } catch (_) {}
  const pipe = require("./pipeline").status();
  return {
    cloud: { page: "ptc2aptn.qwenwork.page", status: "live", sync: persist.ENABLED ? "ok" : "local-only", version: "live", lastPublish: "—", region: "ap-southeast-1", cdn: "on" },
    health: { apiLatency: null, bridge: persist.ENABLED ? "online" : "local", dbSize, wal: "clean", errors24h: pipe.errors.length + (kvGet("qw_last_error") ? 1 : 0) },
    uptimeMin: Math.round(process.uptime() / 60),
  };
}
function connections() {
  const cs = config.publicState();
  return [
    { name: "Google sign-in", status: cs.google_configured ? "connected" : "demo", detail: cs.google_configured ? "OAuth client · real redirect" : "Demo button · client not set" },
    { name: "Apple sign-in", status: cs.apple_configured ? "connected" : "demo", detail: cs.apple_configured ? "Services ID configured" : "Demo button · Services ID not set" },
    { name: "Email · Resend/SMTP", status: cs.email_configured ? "connected" : "demo", detail: cs.email_configured ? "Delivery configured" : "Dev outbox only" },
    { name: "Payment processor", status: "simulated", detail: "Simulated settlement · wire Stripe/Adyen in payments.js" },
    { name: "QwenWork OpenAPI", status: qw.enabled() ? "connected" : "demo", detail: qw.enabled() ? "Cloud responder + game builder on founder credits" : "Awaiting token handoff" },
    { name: "Outstand (Instagram)", status: qw.outstandKey() ? "connected" : "demo", detail: qw.outstandKey() ? "@earnestapp.official · webhook bridge" : "API key missing" },
    { name: "Page database", status: persist.ENABLED ? "connected" : "demo", detail: persist.ENABLED ? "Supabase mirror · survives redeploys" : "Local SQLite only" },
    { name: "Hashmeta (CMS · SEO · CRM)", status: kvGet("hashmeta_snapshot") ? "connected" : "demo", detail: kvGet("hashmeta_snapshot") ? "earnest.geo.hashmeta.tech · synced " + rel(kvGet("hashmeta_synced_at")) : "Awaiting first agent sync" },
  ];
}
/* Growth read model — real Hashmeta metrics pushed by the growth agent via
   /api/admin/hashmeta-sync (poll_token). Null until the first sync lands. */
function growth() {
  const raw = kvGet("hashmeta_snapshot");
  if (!raw) return null;
  try { const g = JSON.parse(raw); g.live = true; g.lastSync = rel(kvGet("hashmeta_synced_at")); return g; } catch (_) { return null; }
}
function bootstrap(admin) {
  const grid = coverageGrid();
  const k = kpis(grid);
  const m = money();
  const p = people();
  const c = catalog();
  const pipe = require("./pipeline").status();
  const flagged = flaggedQueue();
  const ap = approvals();
  const al = alerts(k);
  const aq = require("./agentqueue");
  const recentStudies = q.all("SELECT id, title, chip, created_at FROM studies ORDER BY created_at DESC, id DESC LIMIT 6").map((s) => ({ title: s.title, meta: s.id + (s.chip ? " · " + s.chip : ""), gates: [["Sync", 1]] }));
  return {
    live: true,
    founder: String(admin.name || "Founder").split(" ")[0],
    serverTime: new Date().toISOString(),
    credits: { used: aq.DAILY_CAP - aq.remainingToday(), cap: aq.DAILY_CAP },
    kpis: k,
    agents: agents(),
    alerts: al,
    agenda: [
      ap.length ? `${ap.length} proposal${ap.length > 1 ? "s" : ""} awaiting approval` : "Approval inbox is clear",
      flagged.length ? `${flagged.length} flagged response${flagged.length > 1 ? "s" : ""} to review` : "Quality queue is clear",
      k.emptyCells ? `Source ${k.emptyCells} empty coverage cells gap-first` : "Coverage grid has no empty cells",
      inbox.summary().unread ? `${inbox.summary().unread} unread Instagram DM${inbox.summary().unread > 1 ? "s" : ""} in the Social Inbox` : "Social Inbox has no unread DMs",
    ],
    activity: activity(),
    approvals: ap,
    topics: grid,
    sourcing: { scrape: [], verify: [], transform: [], apply: [], sync: recentStudies },
    pipeline: { paused: pipe.paused, lastRun: rel(pipe.last_run), added: pipe.last_added, errors: pipe.errors.length, cursor: pipe.running ? "running now" : "hourly", sources: pipe.sources, ingestToday: k.discoverIngest },
    studies: c.studies,
    gameQueue: c.gameQueue,
    flagged,
    qualityDist: qualityDist(),
    botCases: botCases(),
    withdrawals: m.withdrawals,
    ledger: m.ledger,
    invoices: m.invoices,
    economics: m.economics,
    users: p.users,
    researcherQueue: p.researcherQueue,
    reports: [],
    communityStats: { commentsToday: one("SELECT COUNT(*) FROM comments WHERE date(created_at)=date('now')"), commentsTotal: one("SELECT COUNT(*) FROM comments") },
    deploy: deployInfo(),
    connections: connections(),
    policies: [
      { k: "Quality flag threshold", v: "score < 60" },
      { k: "Always-ask payout threshold", v: "$20.00" },
      { k: "Withdrawal fee", v: "2% · min $0.25" },
      { k: "Game build budget", v: aq.DAILY_CAP + " / day" },
      { k: "Reward bounds (catalog)", v: `$${(one("SELECT COALESCE(MIN(reward_cents),0) FROM studies WHERE active=1") / 100).toFixed(2)} – $${(one("SELECT COALESCE(MAX(reward_cents),0) FROM studies WHERE active=1") / 100).toFixed(2)}` },
      { k: "Takedown / public content", v: "always ask" },
    ],
    audit: q.all("SELECT actor, action, target, created_at FROM audit_log ORDER BY id DESC LIMIT 50").map((a) => ({ actor: a.actor, action: a.action, target: a.target || "", when: rel(a.created_at) })),
    inbox: inbox.summary(),
    growth: growth(),
    demoModules: growth() ? ["investors"] : ["growth", "investors"],
  };
}

/* ---------------- mutations ---------------- */
function settleWithdrawal(id, actor) {
  const w = q.get("SELECT * FROM withdrawals WHERE id=?", id);
  if (!w) return { error: "Withdrawal not found." };
  if (w.status === "paid") return { ok: true, already: true };
  q.run("UPDATE withdrawals SET status='paid', completed_at=datetime('now') WHERE id=?", id);
  audit(actor, "settled withdrawal", "w-" + id + " · $" + (w.amount_cents / 100).toFixed(2));
  return { ok: true };
}
function rejectWithdrawal(id, actor) {
  const w = q.get("SELECT * FROM withdrawals WHERE id=?", id);
  if (!w || w.status === "paid") return { error: "Cannot reject this withdrawal." };
  tx(() => {
    q.run("UPDATE withdrawals SET status='failed', completed_at=datetime('now') WHERE id=?", id);
    q.run("UPDATE users SET wallet_cents = wallet_cents + ? WHERE id=?", w.amount_cents, w.user_id);
    q.run("INSERT INTO wallet_ledger (user_id,delta_cents,kind,note) VALUES (?,?,?,?)", w.user_id, w.amount_cents, "refund", "Withdrawal w-" + id + " rejected · refunded");
  });
  audit(actor, "rejected withdrawal (refunded)", "w-" + id);
  return { ok: true };
}
function decideQuality(id, kind, decision, actor) {
  const table = kind === "play" ? "game_plays" : "responses";
  const numId = Number(String(id).replace(/^(r-|gp-)/, ""));
  const r = q.get(`SELECT * FROM ${table} WHERE id=?`, numId);
  if (!r || r.flagged !== 1) return { error: "Not in the flagged queue." };
  if (decision === "clear") {
    tx(() => {
      q.run(`UPDATE ${table} SET flagged=0 WHERE id=?`, numId);
      if (r.reward_cents > 0) {
        q.run("UPDATE users SET wallet_cents = wallet_cents + ? WHERE id=?", r.reward_cents, r.user_id);
        q.run("INSERT INTO wallet_ledger (user_id,delta_cents,kind,note) VALUES (?,?,?,?)", r.user_id, r.reward_cents, "answer", `Cleared ${kind === "play" ? "gp-" : "r-"}${numId} · paid`);
      }
    });
    audit(actor, "cleared & paid", (kind === "play" ? "gp-" : "r-") + numId);
  } else {
    q.run(`UPDATE ${table} SET flagged=2, reward_cents=0 WHERE id=?`, numId);
    audit(actor, "rejected (no pay)", (kind === "play" ? "gp-" : "r-") + numId);
  }
  return { ok: true };
}

/* ---------------- router ---------------- */
async function handle(req, res, url, body, cookieUser) {
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const p = url.pathname;
  const B = body || {};

  if (p === "/api/admin/login" && req.method === "POST") {
    const r = auth.login({ email: B.email, password: B.password });
    if (r.error) return json(res, 401, { error: r.error });
    const u = q.get("SELECT role, name FROM users WHERE id=?", r.user.id);
    if (!u || u.role !== "admin") return json(res, 403, { error: "This account is not a cockpit admin. Ask the founder to grant access." });
    return json(res, 200, { token: r.token, name: u.name });
  }
  if (p === "/api/admin/grant" && req.method === "POST") {
    const pt = pollToken();
    if (!pt || B.token !== pt) return json(res, 403, { error: "bad token" });
    const email = String(B.email || "").trim().toLowerCase();
    const r = q.run("UPDATE users SET role='admin' WHERE email=?", email);
    audit("system", "granted cockpit admin", email);
    return json(res, 200, { ok: true, found: r.changes > 0 });
  }
  /* Growth agent pushes real Hashmeta metrics here (poll_token-gated, like grant). */
  if (p === "/api/admin/hashmeta-sync" && req.method === "POST") {
    const pt = pollToken();
    if (!pt || B.token !== pt) return json(res, 403, { error: "bad token" });
    if (!B.snapshot || typeof B.snapshot !== "object") return json(res, 400, { error: "snapshot object required" });
    kvSet("hashmeta_snapshot", JSON.stringify(B.snapshot));
    kvSet("hashmeta_synced_at", new Date().toISOString());
    audit("growth-agent", "synced Hashmeta metrics", B.site || "");
    return json(res, 200, { ok: true });
  }

  const admin = adminUser(req, cookieUser);
  if (!admin) return json(res, 401, { error: "Admin sign-in required." });
  const actor = admin.name || "Founder";

  try {
    if (p === "/api/admin/bootstrap" && req.method === "GET") {
      inbox.syncIfStale();
      return json(res, 200, bootstrap(admin));
    }
    if (p === "/api/admin/decide" && req.method === "POST") {
      const [kind, id] = String(B.id || "").split(":");
      if (kind === "game") {
        const g = q.get("SELECT * FROM games WHERE id=?", id);
        if (!g) return json(res, 404, { error: "Game not found." });
        if (B.decision === "approve") { q.run("UPDATE games SET status='published' WHERE id=?", id); audit(actor, "published game", id); }
        else { q.run("UPDATE games SET status='rejected' WHERE id=?", id); audit(actor, "rejected game", id); }
        return json(res, 200, { ok: true });
      }
      if (kind === "wd") {
        const r = B.decision === "approve" ? settleWithdrawal(Number(id), actor) : rejectWithdrawal(Number(id), actor);
        return json(res, r.error ? 400 : 200, r);
      }
      return json(res, 400, { error: "Unknown proposal type." });
    }
    if (p === "/api/admin/quality" && req.method === "POST") {
      const r = decideQuality(B.id, B.kind, B.decision, actor);
      return json(res, r.error ? 400 : 200, r);
    }
    if (p === "/api/admin/settle" && req.method === "POST") {
      const r = settleWithdrawal(Number(String(B.id).replace("w-", "")), actor);
      return json(res, r.error ? 400 : 200, r);
    }
    if (p === "/api/admin/study-toggle" && req.method === "POST") {
      const s = q.get("SELECT id, active FROM studies WHERE id=?", B.id);
      if (!s) return json(res, 404, { error: "Study not found." });
      q.run("UPDATE studies SET active=? WHERE id=?", s.active ? 0 : 1, B.id);
      audit(actor, s.active ? "deactivated study" : "activated study", B.id);
      return json(res, 200, { ok: true, active: !s.active });
    }
    if (p === "/api/admin/game-publish" && req.method === "POST") {
      q.run("UPDATE games SET status='published' WHERE id=?", B.id);
      audit(actor, "published game", B.id);
      return json(res, 200, { ok: true });
    }
    if (p === "/api/admin/pipeline-toggle" && req.method === "POST") {
      const paused = require("./pipeline").status().paused;
      kvSet("pipeline_paused", paused ? "" : "1");
      audit(actor, paused ? "resumed Discover pipeline" : "paused Discover pipeline", "");
      return json(res, 200, { ok: true, paused: !paused });
    }
    if (p === "/api/admin/suspend" && req.method === "POST") {
      const u = q.get("SELECT id, suspended, name FROM users WHERE id=?", Number(B.id));
      if (!u) return json(res, 404, { error: "User not found." });
      if (u.id === admin.id) return json(res, 400, { error: "You cannot suspend your own admin account." });
      q.run("UPDATE users SET suspended=? WHERE id=?", u.suspended ? 0 : 1, u.id);
      audit(actor, u.suspended ? "unsuspended user" : "suspended user", u.name);
      return json(res, 200, { ok: true, suspended: !u.suspended });
    }

    /* ---- social inbox ---- */
    if (p === "/api/admin/inbox" && req.method === "GET") {
      inbox.syncIfStale();
      return json(res, 200, { conversations: inbox.list(), summary: inbox.summary(), last_reply: kvGet("qw_last_reply") ? JSON.parse(kvGet("qw_last_reply")) : null, last_error: kvGet("qw_last_error") ? JSON.parse(kvGet("qw_last_error")) : null, bridge: qw.enabled() && kvGet("ig_bridge_disabled") !== "1" });
    }
    if (p === "/api/admin/inbox-thread" && req.method === "GET") {
      const t = inbox.thread(url.searchParams.get("id"));
      if (!t) return json(res, 404, { error: "Conversation not found." });
      return json(res, 200, t);
    }
    if (p === "/api/admin/inbox-reply" && req.method === "POST") {
      const id = String(B.id || ""), text = String(B.text || "").trim();
      if (!id || !text) return json(res, 400, { error: "Conversation and text required." });
      const sent = await qw.sendOutstand(id, text.slice(0, 1000));
      if (!sent.ok) return json(res, 502, { error: "Outstand send failed (HTTP " + sent.status + "). The customer must have messaged within 24h." });
      inbox.recordOut(id, text, "admin", sent.id);
      inbox.setPaused(id, 1); /* founder replied → bot stays silent until resumed */
      audit(actor, "replied to DM", id);
      return json(res, 200, { ok: true, message_id: sent.id, bot_paused: true });
    }
    if (p === "/api/admin/inbox-bot" && req.method === "POST") {
      inbox.setPaused(String(B.id || ""), !!B.paused);
      audit(actor, B.paused ? "took over DM thread" : "resumed bot on DM thread", String(B.id || ""));
      return json(res, 200, { ok: true });
    }
    if (p === "/api/admin/inbox-draft" && req.method === "POST") {
      const id = String(B.id || "");
      const last = q.get("SELECT text FROM social_messages WHERE conversation_id=? AND direction='in' ORDER BY id DESC LIMIT 1", id);
      if (!last) return json(res, 400, { error: "No customer message to draft from." });
      if (!qw.enabled()) return json(res, 409, { error: "QwenWork responder not authorized yet." });
      const draft = await qw.answer(id, last.text);
      if (!draft) return json(res, 502, { error: "The AI could not produce a draft. Try again." });
      return json(res, 200, { draft });
    }
    if (p === "/api/admin/inbox-sync" && req.method === "POST") {
      const r = await inbox.syncFromOutstand();
      return json(res, r.ok ? 200 : 502, r);
    }
    return json(res, 404, { error: "not found" });
  } catch (e) {
    console.error("admin:", e);
    return json(res, 500, { error: String(e.message || e) });
  }
}

module.exports = { handle };