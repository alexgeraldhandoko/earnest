/* EARNest Founder Cockpit · prototype logic (client-side, demo data only) */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ic = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const num = n => Number(n).toLocaleString("en-US");
const money = n => "$" + Number(n).toFixed(2);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ago = s => {
  const t = Date.parse(s); if (!t) return "";
  const d = Date.now() - t;
  if (d < 60000) return "now";
  if (d < 3600000) return Math.floor(d / 60000) + "m";
  if (d < 86400000) return Math.floor(d / 3600000) + "h";
  return Math.floor(d / 86400000) + "d";
};

const state = {
  view: "overview",
  approvalFilter: "all",
  catalogTab: "studies",
  moneyTab: "withdrawals",
  peopleTab: "users",
  growthTab: "overview",
};

/* ── small builders ─────────────────────────────────── */
function spark(vals, stroke = "var(--color-accent)") {
  const w = 64, h = 24, max = Math.max(...vals), min = Math.min(...vals);
  const pts = vals.map((v, i) =>
    `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`
  ).join(" ");
  return `<svg class="kpi-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function kpi(label, value, delta, tone, sparkVals, sparkColor) {
  const d = delta ? `<div class="kpi-delta ${delta.dir}">${delta.dir === "up" ? "▲" : delta.dir === "down" ? "▼" : "•"} ${delta.text}</div>` : "";
  const s = sparkVals ? spark(sparkVals, sparkColor) : "";
  return `<div class="card kpi k-${tone}">${s}<div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${d}</div>`;
}
const head = (eyebrow, title, sub, actions = "") =>
  `<div class="view-head"><div><div class="eyebrow">${eyebrow}</div><h1 class="view-title">${title}</h1><p class="view-sub">${sub}</p></div>${actions ? `<div class="hstack">${actions}</div>` : ""}</div>`;
const card = (title, icon, body, note = "", cls = "") =>
  `<section class="card ${cls}"><div class="card-head"><h2 class="card-title">${ic(icon)}${title}</h2>${note ? `<span class="card-note">${note}</span>` : ""}</div>${body}</section>`;
function meter(label, pct, tone = "", display) {
  return `<div class="meter-row"><div class="meter-label"><span>${label}</span><b>${display ?? pct + "%"}</b></div><div class="meter ${tone}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div></div>`;
}
const dotFor = s => ({ running: "run", idle: "ok", failed: "err", paused: "idle", queued: "warn" }[s] || "idle");
const statusWord = s => ({ running: "running", idle: "idle", failed: "failed", paused: "paused" }[s] || s);
function toast(msg, bad = false) {
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.innerHTML = ic(bad ? "x" : "check") + `<span>${msg}</span>`;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 280); }, 2600);
}
const demoBtn = (label, icon = "zap", cls = "") =>
  `<button class="btn ${cls}" data-action="demo" data-label="${label}">${ic(icon)}${label}</button>`;
const scoreBadge = s => {
  const tier = s >= 80 ? "hi" : s >= 65 ? "mid" : "lo";
  return `<span class="score-badge ${tier}" title="Likelihood score"><b>${s}</b>/100</span>`;
};
const platformTag = (name, icon) => `<span class="platform">${ic(icon)}${name}</span>`;
const tile = (k, v, d) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${d ? `<div class="d ${d.dir}">${d.text}</div>` : ""}</div>`;

/* ── views ──────────────────────────────────────────── */
const VIEWS = {};

VIEWS.overview = () => {
  const k = DEMO.kpis;
  const kpis = `<div class="grid g4">
    ${kpi("Daily active users", num(k.dau), { dir: "flat", text: "today · real events" }, "blue", k.sparks.dau)}
    ${kpi("Responses today", num(k.responses), { dir: "flat", text: "studies + games" }, "blue", k.sparks.responses)}
    ${kpi("Payout liability", money(k.liability), { dir: "flat", text: "wallet balances" }, "earn", k.sparks.liability, "var(--color-earn-deep)")}
    ${kpi("Revenue · MTD", money(k.revenue), { dir: "flat", text: "withdrawal fees" }, "money", k.sparks.revenue, "var(--color-money-deep)")}
    ${kpi("Quality flag rate", k.flagRate + "%", { dir: "flat", text: "of all responses" }, "error")}
    ${kpi("Discover catalog", num(k.discoverSize), { dir: "up", text: "+" + k.discoverIngest + " today · no cap" }, "lav")}
    ${kpi("Active studies", num(k.studies), { dir: "flat", text: "in the feed" }, "blue")}
    ${kpi("Coverage balance", k.coverageBalance + "%", { dir: "flat", text: (k.emptyCells ?? 0) + " empty cells" }, "earn")}
  </div>`;

  const strip = DEMO.agents.map(a => `
    <button class="agent-pill" data-view="agents">
      <span class="agent-pill-top"><span class="dot ${dotFor(a.status)}"></span>${a.name}${a.external ? ' <span class="chip" style="padding:0 5px;font-size:.55rem">ext</span>' : ""}</span>
      <span class="agent-pill-meta">${statusWord(a.status)} · ${a.jobs} jobs${a.external ? " · QwenWork" : ""}</span>
    </button>`).join("");

  const feed = DEMO.activity.map(f => `
    <div class="feed-item"><span class="feed-ic ${f.tone}">${ic(f.icon)}</span>
      <div class="feed-body"><div class="feed-text">${f.text}</div><div class="feed-time">${f.time}</div></div>
    </div>`).join("");

  const alerts = DEMO.alerts.map(a => `
    <div class="alert-item ${a.level === "warn" ? "warn" : ""}">${ic("alert")}
      <div><div class="alert-text">${a.text}</div><div class="alert-sub">${a.sub}</div>
      <button class="link-btn mt" data-view="${a.view}">Open ${ic("arrow")}</button></div>
    </div>`).join("");

  const agenda = DEMO.agenda.map((t, i) => `
    <div class="feed-item"><span class="feed-ic blue mono" style="font-weight:600;font-size:.8125rem">${i + 1}</span>
      <div class="feed-body"><div class="feed-text">${t}</div></div></div>`).join("");

  return head("Founder overview", `Good morning, ${DEMO.founder}`,
    "One founder. An AI workforce. Every flow audited. Here's the company at a glance.",
    `<span class="chip mono">${new Date().toDateString()}</span><button class="btn primary" data-action="refresh-live">${ic("chart")}Refresh now</button>`)
    + card("Company Metrics", "chart", kpis, DEMO.live ? "live · from the Earnest backend" : "demo data")
    + card("AI workforce", "bot", `<div class="agent-strip">${strip}</div>`, "live status · click to manage")
    + `<div class="grid g-2-1">
        ${card("Activity stream", "clock", `<div class="feed">${feed}</div>`, "agents + approvals + money")}
        <div class="grid" style="align-content:start">
          ${card("Alerts", "bell", alerts, DEMO.alerts.length + " open")}
          ${card("Today's agenda", "check", `<div class="feed">${agenda}</div>`, "auto-generated by Ops Reporter")}
        </div>
      </div>`;
};

VIEWS.approvals = () => {
  const flows = ["all", "studies", "payouts", "deck", "takedown"];
  const flowLabel = { all: "All", studies: "Studies", payouts: "Payouts", deck: "Deck Updates", takedown: "Takedown Requests" };
  const filters = flows.map(f =>
    `<button class="filter-chip ${state.approvalFilter === f ? "active" : ""}" data-action="filter-approval" data-flow="${f}">${flowLabel[f]}</button>`).join("");
  const list = DEMO.approvals
    .filter(a => state.approvalFilter === "all" || a.flow === state.approvalFilter)
    .map(a => {
      const ev = a.evidence.map(e =>
        `<div class="evidence-line ${e.ok ? "" : "bad"}">${ic(e.ok ? "check" : "x")}<span>${e.text}</span></div>`).join("");
      const riskChip = { low: "money", medium: "earn", high: "error" }[a.risk];
      const actions = a.status === "pending"
        ? `<button class="btn good sm" data-action="approve" data-id="${a.id}">${ic("check")}Approve</button>
           <button class="btn bad sm" data-action="reject" data-id="${a.id}">${ic("x")}Reject</button>
           <button class="btn ghost sm" data-action="demo" data-label="Edit proposal">${ic("doc")}Edit</button>`
        : `<span class="decided-stamp ${a.status === "approved" ? "ok" : "no"}">${a.status === "approved" ? "✓ APPROVED" : "✕ REJECTED"} · just now</span>`;
      return `<section class="card approval risk-${a.risk} ${a.status !== "pending" ? "decided" : ""}">
        <div class="approval-top"><span class="chip ${riskChip}">${a.risk} risk</span><span class="chip blue">${flowLabel[a.flow] || a.flow}</span><span class="approval-title">${a.title}</span></div>
        <div class="approval-payload">${a.payload}</div>
        <div class="approval-evidence">${ev}</div>
        <div class="approval-actions">${actions}<span class="approval-agent">${ic("bot")}${a.agent}</span></div>
      </section>`;
    }).join("");
  const pending = DEMO.approvals.filter(a => a.status === "pending").length;
  const body = list || `<div class="empty">${ic("inbox")}<b>Inbox zero</b><span>No proposals in this filter.</span></div>`;
  return head("Human-on-the-loop", "Agent Approvals",
    "Every agent proposal that touches money or public content lands here. Evidence attached — decide in seconds.",
    `<span class="chip blue">${pending} pending</span><button class="btn primary" data-action="batch">${ic("check")}Approve all low-risk</button>`)
    + `<div class="filters">${filters}</div>` + body;
};

VIEWS.research = () => {
  const totals = DEMO.topics.map(t => t.cells.reduce((a, b) => a + b, 0));
  const sorted = [...totals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const zeroCells = DEMO.topics.reduce((n, t) => n + t.cells.filter(c => c === 0).length, 0);
  const gapTopics = DEMO.topics.filter(t => t.cells.some(c => c === 0)).map(t => t.name);

  const hmHead = `<div class="hm-head"><span></span>${[1, 2, 3, 4, 5].map(i => `<span>Field ${i}</span>`).join("")}</div>`;
  const rows = DEMO.topics.map((t, ti) => {
    const over = totals[ti] >= 2 * median;
    const cells = t.cells.map((c, ci) => {
      const cls = c === 0 ? "c0" : c >= 5 ? "c5" : "c" + c;
      return `<div class="hm-cell ${cls} ${over && c >= 5 ? "over" : ""}" title="${t.name} · field ${ci + 1}: ${c} studies">${c}</div>`;
    }).join("");
    return `<div class="hm-row"><div class="hm-topic"><span>${t.name}</span>${over ? '&nbsp;<span class="chip earn" style="padding:1px 7px;font-size:.58rem">over</span>' : ""}</div>${cells}</div>`;
  }).join("");
  const legend = `<div class="hm-legend">
    <span><span class="swatch" style="background:var(--color-error-soft);border:1px dashed var(--color-error)"></span>empty cell</span>
    <span><span class="swatch" style="background:oklch(90% 0.05 248)"></span>1–2</span>
    <span><span class="swatch" style="background:oklch(72% 0.11 248)"></span>3–4</span>
    <span><span class="swatch" style="background:oklch(58% 0.14 248)"></span>5+</span>
    <span><span class="swatch" style="background:var(--color-earn-soft);border:1px solid var(--color-earn-deep)"></span>over-concentrated topic</span>
  </div>`;
  const coverage = card("Coverage grid · 22 topics × 5 fields", "flask",
    `<div class="heatmap">${hmHead}${rows}</div>${legend}`,
    `${zeroCells} empty cells · balance audit, not a volume cap`);

  const cols = [["scrape", "Scrape"], ["verify", "Verify"], ["transform", "Transform"], ["apply", "Apply"], ["sync", "Sync"]];
  const kanban = cols.map(([key, label]) => {
    const items = DEMO.sourcing[key].map(it => {
      const gates = it.gates.length ? `<div class="gates">${it.gates.map(([g, ok]) => `<span class="gate ${ok ? "" : "fail"}">${g}</span>`).join("")}</div>` : "";
      const act = key === "transform" ? `<button class="btn good sm" data-action="demo" data-label="Approve study">${ic("check")}Approve</button>` : "";
      return `<div class="kb-card"><div class="kb-card-title">${it.title}</div><div class="kb-card-meta">${it.meta}</div>${gates}${act}</div>`;
    }).join("") || `<div class="kb-card-meta" style="padding:6px 4px">—</div>`;
    return `<div class="kb-col"><div class="kb-head">${label}<b>${DEMO.sourcing[key].length}</b></div>${items}</div>`;
  }).join("");
  const board = card("Sourcing pipeline · gap-first", "layers", `<div class="kanban">${kanban}</div>`,
    "scrape → verify → transform run in the QwenWork skill chat · sync shows recent catalog additions");

  const p = DEMO.pipeline;
  const pipeStats = `<div class="stat-list">
    <div class="stat-row"><span class="k">Last run</span><span class="v">${p.lastRun}</span></div>
    <div class="stat-row"><span class="k">Added last run</span><span class="v">${p.added} findings</span></div>
    <div class="stat-row"><span class="k">Ingest today</span><span class="v">${p.ingestToday}</span></div>
    <div class="stat-row"><span class="k">Errors</span><span class="v">${p.errors}</span></div>
    <div class="stat-row"><span class="k">Source cursor</span><span class="v">${p.cursor}</span></div>
  </div>
  <div class="hstack mt">${p.sources.map(s => `<span class="chip">${s}</span>`).join("")}</div>
  <p class="small muted mt">Extractive summaries · no facts invented. No content ceiling — the catalog grows with demand.</p>`;
  const pipeBtn = `<button class="btn ${p.paused ? "good" : ""}" data-action="toggle-pipeline">${ic(p.paused ? "play" : "pause")}${p.paused ? "Resume pipeline" : "Pause pipeline"}</button>`;
  const pipeline = card("Discover pipeline", "globe", pipeStats, p.paused ? "paused" : "running hourly", "");

  const lint = [["Goal-style titles (no “Let's”, no “?”)", 1], ["Pitch 195–247 chars", 1], ["≥ 3 tailored questions", 1], ["Chip = exact subtopic label", 1], ["Real citation resolves", 1]]
    .map(([t, ok]) => `<div class="evidence-line ${ok ? "" : "bad"}">${ic(ok ? "check" : "x")}<span>${t}</span></div>`).join("");
  const lintCard = card("Copy style lint", "shield", `<div class="approval-evidence">${lint}</div><p class="small muted mt">Failures block approval into the catalog.</p>`, "all passing");

  return head("Research operations", "Research Ops",
    "Source real participant studies gap-first, verify hard gates, and steer the Discover pipeline.",
    `<span class="chip error">${zeroCells} empty cells</span>${pipeBtn}`)
    + coverage
    + board
    + `<div class="grid g2">${pipeline}${lintCard}</div>`
    + (gapTopics.length ? `<div class="card"><div class="card-head"><h2 class="card-title">${ic("alert")}Gap topics — source these first</h2></div><div class="hstack">${gapTopics.map(t => `<button class="chip blue" data-action="demo" data-label="Source ${t}" style="cursor:pointer">${t} ${ic("arrow")}</button>`).join("")}</div></div>` : "");
};

VIEWS.catalog = () => {
  const tabs = `<div class="filters">
    <button class="filter-chip ${state.catalogTab === "studies" ? "active" : ""}" data-action="catalog-tab" data-tab="studies">Surveys</button>
    <button class="filter-chip ${state.catalogTab === "games" ? "active" : ""}" data-action="catalog-tab" data-tab="games">Games &amp; generation</button>
  </div>`;
  if (state.catalogTab === "studies") {
    const rows = DEMO.studies.map(s => `<tr>
      <td><div class="tbl-title">${s.title}</div><div class="tbl-sub mono">${s.id}</div></td>
      <td><span class="chip">${s.chip}</span></td>
      <td class="num">${money(s.reward / 100)}</td>
      <td class="num">${s.min}m</td>
      <td class="num">${num(s.resp)}</td>
      <td><span class="chip ${s.quality >= 90 ? "money" : "earn"}">${s.quality}</span></td>
      <td><span class="chip ${s.active ? "money" : ""}">${s.active ? "active" : "inactive"}</span></td>
      <td><div class="row-actions"><button class="btn sm" data-action="toggle-study" data-id="${s.id}">${s.active ? "Deactivate" : "Activate"}</button><button class="btn sm ghost" data-action="demo" data-label="Edit ${s.id}">${ic("doc")}</button></div></td>
    </tr>`).join("");
    const table = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Study</th><th>Chip</th><th>Reward</th><th>Min</th><th>Responses</th><th>Quality</th><th>State</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    return head("Catalog", "Paid Surveys", "Manage the paid-survey catalog and the AI game generation queue.",
      demoBtn("New study", "flask", "primary")) + tabs
      + card("Paid surveys", "layers", table, DEMO.studies.length + " shown · deactivation never deletes");
  }
  const gq = DEMO.gameQueue;
  const budget = meter("Daily build budget", gq.budget.cap ? gq.budget.used / gq.budget.cap * 100 : 0, "lav", `${gq.budget.used} / ${gq.budget.cap}`);
  const statusChip = s => ({ draft: "earn", building: "blue", queued: "", published: "money" }[s] || "");
  const rows = gq.items.map(g => `<tr>
    <td><div class="tbl-title">${g.title}</div><div class="tbl-sub mono">${g.id} · ${g.kind}</div></td>
    <td><span class="chip ${statusChip(g.status)}">${g.status}</span></td>
    <td class="num">${g.reward ? money(g.reward / 100) : "—"}</td>
    <td><div class="row-actions">${g.status === "draft" ? `<button class="btn good sm" data-action="publish-game" data-id="${g.id}">${ic("check")}Publish</button>` : ""}<button class="btn sm ghost" data-action="demo" data-label="Review ${g.id}">${ic("eye")}</button></div></td>
  </tr>`).join("");
  const table = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Game</th><th>Status</th><th>Reward</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  return head("Catalog", "Paid Surveys", "Manage the paid-survey catalog and the AI game generation queue.",
    demoBtn("Create game with AI", "bot", "primary")) + tabs
    + `<div class="grid g-1-2">
        ${card("Generation budget", "zap", budget + `<div class="stat-list mt"><div class="stat-row"><span class="k">Published games</span><span class="v">${gq.published}</span></div><div class="stat-row"><span class="k">Provider</span><span class="v">QwenWork credits</span></div></div><p class="small muted mt">Configurable budget — raise it as the plan grows.</p>`, `${gq.budget.used} / ${gq.budget.cap} today`)}
        ${card("Generation queue", "bot", table, "queued → building → draft → published")}
      </div>`;
};

VIEWS.quality = () => {
  const kpis = `<div class="grid g4">
    ${kpi("Flag rate", DEMO.kpis.flagRate + "%", { dir: "flat", text: "of all responses" }, "error")}
    ${kpi("Review backlog", DEMO.flagged.length, { dir: "flat", text: "held unpaid" }, "earn")}
    ${kpi("Responses scored", num(DEMO.qualityDist.reduce((a, b) => a + b, 0)), { dir: "flat", text: "studies + games" }, "money")}
    ${kpi("Bot cases", DEMO.botCases.length, { dir: "flat", text: "high bot scores" }, "lav")}
  </div>`;
  const cards = DEMO.flagged.map(f => {
    const cls = f.score < 50 ? "bad" : f.score < 60 ? "mid" : "good";
    const bars = `<div class="q-bars">
      ${meter("Timing", f.timing, f.timing < 50 ? "error" : "money")}
      ${meter("Attention", f.attention, f.attention < 50 ? "error" : "money")}
      ${meter("Consistency", f.consistency, f.consistency < 50 ? "error" : "money")}
    </div>`;
    return `<section class="card">
      <div class="split"><div class="hstack"><span class="q-score ${cls}">${f.score}</span><div><div class="tbl-title">${f.study}</div><div class="tbl-sub mono">${f.id} · ${f.user} · ${f.age} ago</div></div></div>
      <span class="chip error">held unpaid</span></div>
      <div class="grid g2 mt" style="align-items:center">${bars}<div class="stat-list"><div class="stat-row"><span class="k">History</span><span class="v">${f.history}</span></div><div class="stat-row"><span class="k">Threshold</span><span class="v">score &lt; 60</span></div></div></div>
      <div class="approval-actions mt"><button class="btn good sm" data-action="clear-response" data-id="${f.id}">${ic("check")}Clear &amp; pay</button><button class="btn bad sm" data-action="reject-response" data-id="${f.id}">${ic("x")}Reject · no pay</button><button class="btn ghost sm" data-action="demo" data-label="Ban ${f.user}">${ic("shield")}Ban respondent</button></div>
    </section>`;
  }).join("") || `<div class="empty">${ic("shield")}<b>Queue clear</b><span>No flagged responses awaiting review.</span></div>`;

  const max = Math.max(...DEMO.qualityDist);
  const bars = DEMO.qualityDist.map((v, i) => `<div class="bar ${i < 6 ? "hot" : ""}" style="height:${v / max * 100}%"><span>${v}</span></div>`).join("");
  const xs = DEMO.qualityDist.map((_, i) => `<span>${i * 10}</span>`).join("");
  const dist = card("Score distribution", "chart", `<div class="bars">${bars}</div><div class="bars-x">${xs}</div>`, "0–100 · red &lt; 60 flagged");

  const bots = DEMO.botCases.map(b => `<div class="alert-item ${b.risk === "medium" ? "warn" : ""}">${ic("alert")}<div><div class="alert-text">${b.title}</div><div class="alert-sub">${b.detail}</div><button class="btn bad sm mt" data-action="demo" data-label="Open ${b.id}">${ic("shield")}Open case</button></div></div>`).join("");
  const botCard = card("Bot & fraud detection", "shield", bots, "device · timing · graph signals");

  return head("Response trust", "Response Quality and Trust",
    "Every response is scored 0–100 from timing, attention gates and consistency. Below 60 it's flagged and held unpaid — clear &amp; pay or reject it here. This is Earnest's promise of quality data to researchers.",
    demoBtn("Quality methodology", "doc")) + kpis
    + `<div class="grid g-2-1"><div class="grid" style="align-content:start">${cards}</div><div class="grid" style="align-content:start">${dist}${botCard}</div></div>`;
};

VIEWS.money = () => {
  const e = DEMO.economics;
  const kpis = `<div class="grid g4">
    ${kpi("Payout liability", money(DEMO.kpis.liability), { dir: "flat", text: "wallet balances" }, "earn")}
    ${kpi("Revenue · MTD", money(DEMO.kpis.revenue), { dir: "flat", text: "withdrawal fees" }, "money")}
    ${kpi("Take rate", e.takeRate + "%", { dir: "flat", text: "fees / withdrawals" }, "blue")}
    ${kpi("Cost / quality response", money(e.costPerResponse), { dir: "flat", text: "avg reward paid" }, "lav")}
  </div>`;
  const tabs = `<div class="filters">
    ${["withdrawals", "ledger", "invoices"].map(t => `<button class="filter-chip ${state.moneyTab === t ? "active" : ""}" data-action="money-tab" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}
  </div>`;
  let body;
  if (state.moneyTab === "withdrawals") {
    const chip = s => ({ processing: "earn", paid: "money", awaiting: "blue" }[s] || "");
    const rows = DEMO.withdrawals.map(w => `<tr>
      <td class="mono">${w.id}</td><td class="tbl-title">${w.user}</td>
      <td class="num">${money(w.amount)}</td><td class="num muted">${money(w.fee)}</td>
      <td class="tbl-sub">${w.dest}</td><td><span class="chip ${chip(w.status)}">${w.status}</span></td>
      <td class="tbl-sub">${w.age}</td>
      <td><div class="row-actions">${w.status !== "paid" ? `<button class="btn good sm" data-action="settle" data-id="${w.id}">${ic("check")}Settle</button>` : ""}</div></td>
    </tr>`).join("");
    body = card("Withdrawals", "coin", `<div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>User</th><th>Amount</th><th>Fee</th><th>Destination</th><th>Status</th><th>Age</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`, "fee 2% · min $0.25 · threshold approvals in inbox");
  } else if (state.moneyTab === "ledger") {
    const rows = DEMO.ledger.map(l => `<tr>
      <td class="mono">${l.id}</td><td class="tbl-title">${l.user}</td><td><span class="chip">${l.type}</span></td>
      <td class="num" style="color:${l.amount < 0 ? "var(--color-error)" : "var(--color-money-deep)"}">${l.amount < 0 ? "−" : "+"}${money(Math.abs(l.amount))}</td>
      <td class="tbl-sub">${l.note}</td><td class="tbl-sub">${l.time}</td>
    </tr>`).join("");
    body = card("Wallet ledger", "doc", `<div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>User</th><th>Type</th><th>Amount</th><th>Note</th><th>When</th></tr></thead><tbody>${rows}</tbody></table></div>`, "server-authoritative · every credit audited");
  } else {
    const rows = DEMO.invoices.map(v => `<tr>
      <td class="mono">${v.id}</td><td><div class="tbl-title">${v.researcher}</div><div class="tbl-sub">${v.study}</div></td>
      <td class="num">${num(v.responses)}</td><td class="num">${money(v.amount)}</td>
      <td><span class="chip ${v.status === "paid" ? "money" : "earn"}">${v.status}</span></td>
      <td><div class="row-actions"><button class="btn sm ghost" data-action="demo" data-label="Open ${v.id}">${ic("doc")}</button></div></td>
    </tr>`).join("");
    body = card("Researcher billing", "coin", rows ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Invoice</th><th>Researcher</th><th>Responses</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${ic("coin")}<b>Billing not live yet</b><span>Researcher invoicing activates with the real payment processor. Withdrawal fees are the current revenue.</span></div>`, "researchers pay for quality responses");
  }
  const econ = card("Unit economics", "chart", `<div class="stat-list">
    <div class="stat-row"><span class="k">Cost / quality response</span><span class="v">${money(e.costPerResponse)}</span></div>
    <div class="stat-row"><span class="k">Avg reward</span><span class="v">${money(e.avgReward)}</span></div>
    <div class="stat-row"><span class="k">Margin / study</span><span class="v">${e.marginPerStudy == null ? "— · billing pending" : money(e.marginPerStudy)}</span></div>
    <div class="stat-row"><span class="k">Take rate</span><span class="v">${e.takeRate}%</span></div>
  </div><div class="hstack mt"><span class="chip money">${ic("check")}Live ledger</span><span class="chip">Processor: simulated</span></div>`, "the numbers investors ask for");
  return head("Finance ops", "Finance", "Payouts, ledger, researcher billing and unit economics — server-authoritative, fully audited.",
    demoBtn("Export CSV", "doc")) + kpis + tabs + `<div class="grid g-2-1">${body}${econ}</div>`;
};

VIEWS.people = () => {
  const tabs = `<div class="filters">
    <button class="filter-chip ${state.peopleTab === "users" ? "active" : ""}" data-action="people-tab" data-tab="users">Participants</button>
    <button class="filter-chip ${state.peopleTab === "researchers" ? "active" : ""}" data-action="people-tab" data-tab="researchers">Researchers</button>
  </div>`;
  if (state.peopleTab === "users") {
    const rows = DEMO.users.map(u => `<tr>
      <td><div class="hstack"><span class="avatar av-${u.av}">${u.name[0]}</span><div><div class="tbl-title">${u.name}</div><div class="tbl-sub">${u.email}</div></div></div></td>
      <td class="num">${money(u.wallet)}</td><td class="num">${u.streak}🔥</td><td class="num">${u.responses}</td>
      <td><span class="chip ${u.quality >= 80 ? "money" : "error"}">${u.quality}</span></td>
      <td class="num">${u.flags}</td>
      <td><span class="chip ${u.status === "active" ? "money" : "earn"}">${u.status}</span></td>
      <td><div class="row-actions"><button class="btn sm ghost" data-action="demo" data-label="View ${u.name}">${ic("eye")}</button><button class="btn sm" data-action="suspend" data-name="${u.name}">${u.status === "suspended" ? "Unsuspend" : "Suspend"}</button></div></td>
    </tr>`).join("");
    const table = card("Participant directory", "users", `<div class="table-wrap"><table class="tbl"><thead><tr><th>User</th><th>Wallet</th><th>Streak</th><th>Responses</th><th>Quality</th><th>Flags</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`, "wallet edits always via ledger + approval");
    const cohorts = card("Cohorts & retention", "chart", `<div class="stat-list">
      <div class="stat-row"><span class="k">7-day retention</span><span class="v">61%</span></div>
      <div class="stat-row"><span class="k">Streak ≥ 7 days</span><span class="v">18%</span></div>
      <div class="stat-row"><span class="k">Churn signal · 7d idle</span><span class="v">214 users</span></div>
      <div class="stat-row"><span class="k">2x windows open</span><span class="v">312</span></div>
    </div>`, "demo aggregates");
    return head("Directory", "Users", "Administer participants and researchers. They use the main app — this is your management view.",
      demoBtn("Support tools", "shield")) + tabs + `<div class="grid g-2-1">${table}${cohorts}</div>`;
  }
  const cards = DEMO.researcherQueue.map(r => `<section class="card">
    <div class="split"><div><div class="tbl-title">${r.name}</div><div class="tbl-sub">${r.org}</div></div>
    <span class="chip ${r.verified ? "money" : "earn"}">${r.verified ? "verified" : "pending"}</span></div>
    <div class="stat-list mt"><div class="stat-row"><span class="k">Studies</span><span class="v">${r.studies}</span></div></div>
    <div class="approval-actions mt">${r.verified ? `<button class="btn sm ghost" data-action="demo" data-label="View ${r.name}">${ic("eye")}View dashboard</button>` : `<button class="btn good sm" data-action="verify" data-name="${r.name}">${ic("check")}Verify researcher</button>`}</div>
  </section>`).join("");
  return head("Directory", "Users", "Administer participants and researchers. They use the main app — this is your management view.",
    demoBtn("Invite researcher", "users", "primary")) + tabs
    + `<div class="grid g3">${cards}</div>`
    + card("Note", "shield", `<p class="small muted">Researchers keep their own in-app dashboard (responses, aggregates, games). The cockpit only verifies, bills and supports them — read-only impersonation for support. No researcher account can reach <span class="code-inline">/admin</span>.</p>`);
};

VIEWS.community = () => {
  const cs = DEMO.communityStats || { commentsToday: 0, commentsTotal: 0 };
  const rows = DEMO.reports.map(r => `<tr>
    <td class="mono">${r.id}</td><td class="tbl-title">${r.target}</td><td>${r.reason}</td>
    <td class="num">${r.reports}</td><td class="tbl-sub">${r.proposed}</td>
    <td><span class="chip ${r.status === "open" ? "earn" : "money"}">${r.status}</span></td>
    <td><div class="row-actions">${r.status === "open" ? `<button class="btn good sm" data-action="resolve-report" data-id="${r.id}">${ic("check")}Apply</button><button class="btn bad sm" data-action="demo" data-label="Dismiss ${r.id}">${ic("x")}</button>` : ""}</div></td>
  </tr>`).join("");
  const table = card("Report queue", "chat", rows ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Target</th><th>Reason</th><th>Reports</th><th>Proposed action</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${ic("check")}<b>No reports</b><span>In-app reporting is not live yet — nothing to moderate here.</span></div>`, "takedowns are always-ask → inbox");
  const stats = card("Community health", "chart", `<div class="stat-list">
    <div class="stat-row"><span class="k">Comments today</span><span class="v">${num(cs.commentsToday)}</span></div>
    <div class="stat-row"><span class="k">Comments total</span><span class="v">${num(cs.commentsTotal)}</span></div>
  </div><div class="hstack mt"><span class="chip money">Live counts</span></div>`);
  return head("Community", "Community", "Moderate comments, reposts and reports. Agent proposes, founder decides.",
    demoBtn("Moderation policy", "doc")) + `<div class="grid g-2-1">${table}${stats}</div>`;
};

VIEWS.inbox = () => {
  const S = LIVE.inboxState;
  const sum = S.summary || DEMO.inbox || { conversations: 0, unread: 0, bot_enabled: false };
  const botChip = sum.bot_enabled
    ? `<span class="chip money"><span class="dot ok"></span>AI responder on</span>`
    : `<span class="chip earn"><span class="dot idle"></span>AI responder off</span>`;
  const actions = `${botChip}<button class="btn" data-action="inbox-sync">${ic("clock")}Sync history</button>`;

  const list = S.conversations.map(c => {
    const name = esc(c.display_name || c.handle || c.id);
    const active = S.sel === c.id;
    return `<button class="dm-item ${active ? "active" : ""}" data-action="inbox-open" data-id="${esc(c.id)}">
      <span class="avatar av-${(Math.abs([...c.id].reduce((a, ch) => a + ch.charCodeAt(0), 0)) % 5) + 1}">${esc((c.display_name || c.handle || "?")[0].toUpperCase())}</span>
      <span class="dm-item-body">
        <span class="dm-item-top"><b>${name}</b><span class="dm-time">${ago(c.last_message_at)}</span></span>
        <span class="dm-snippet">${c.last_actor && c.last_actor !== "customer" ? (c.last_actor === "ai" ? "AI: " : "You: ") : ""}${esc(c.last_text || "")}</span>
      </span>
      <span class="dm-badges">${c.bot_paused ? `<span class="chip earn" title="Bot paused — you own this thread">you</span>` : ""}${c.unread ? `<b class="count warn">${c.unread}</b>` : ""}</span>
    </button>`;
  }).join("") || `<div class="empty">${ic("instagram")}<b>No conversations yet</b><span>DMs to @earnestapp.official appear here. Use Sync history to pull existing threads.</span></div>`;

  let threadPane;
  if (!S.thread) {
    threadPane = `<div class="empty" style="min-height:320px">${ic("chat")}<b>Pick a conversation</b><span>Full history, AI replies labelled, and a reply box. Replying pauses the bot on that thread.</span></div>`;
  } else {
    const c = S.thread.conversation;
    const name = esc(c.display_name || c.handle || c.id);
    const msgs = S.thread.messages.map(m => {
      const out = m.direction === "out";
      const who = out ? (m.actor === "admin" ? "You" : "AI") : name;
      return `<div class="dm-msg ${out ? "out" : "in"} ${m.actor === "ai" ? "ai" : ""}">
        <div class="dm-bubble">${esc(m.text)}</div>
        <div class="dm-meta">${who} · ${ago(m.created_at)}</div>
      </div>`;
    }).join("");
    const toggle = c.bot_paused
      ? `<button class="btn good sm" data-action="inbox-bot" data-id="${esc(c.id)}" data-paused="0">${ic("play")}Resume bot</button>`
      : `<button class="btn sm" data-action="inbox-bot" data-id="${esc(c.id)}" data-paused="1">${ic("pause")}Take over</button>`;
    threadPane = `
      <div class="dm-thread-head">
        <div><div class="tbl-title">${name}</div><div class="tbl-sub mono">${esc(c.platform || "instagram")} · ${esc(c.id)}</div></div>
        <div class="hstack">${c.bot_paused ? `<span class="chip earn">bot paused</span>` : `<span class="chip money">bot active</span>`}${toggle}</div>
      </div>
      <div class="dm-thread" id="dmThread">${msgs || `<div class="empty">No messages yet.</div>`}</div>
      <div class="dm-composer">
        <textarea id="replyBox" rows="2" placeholder="Reply as @earnestapp.official… (sending pauses the bot on this thread)"></textarea>
        <div class="hstack">
          <button class="btn primary" data-action="inbox-send" data-id="${esc(c.id)}">${ic("arrow")}Send</button>
          <button class="btn ghost" data-action="inbox-draft" data-id="${esc(c.id)}" ${S.draftBusy ? "disabled" : ""}>${ic("bot")}${S.draftBusy ? "Drafting…" : "AI draft"}</button>
        </div>
      </div>`;
  }

  return head("Social Inbox", "Social Inbox",
    "Every Instagram DM in one place — the AI answers routine messages 24/7, and you can take over any thread and reply yourself. More channels plug into this same inbox.",
    actions)
    + `<div class="grid dm-grid">
        ${card(`Conversations · ${sum.conversations || 0}`, "instagram", `<div class="dm-list">${list}</div>`, `${sum.unread || 0} unread · ${sum.needs_human || 0} need you`)}
        ${card("Thread", "chat", threadPane, "replies send via Outstand · within Meta's 24h window")}
      </div>`;
};

VIEWS.growth = () => {
  const g = DEMO.growth;
  const tabsDef = [["overview", "Overview"], ["cms", "CMS & SEO"], ["crm", "CRM & Leads"], ["listening", "Social Listening"], ["campaigns", "Campaigns"]];
  const tabs = `<div class="filters">${tabsDef.map(([t, l]) => `<button class="filter-chip ${state.growthTab === t ? "active" : ""}" data-action="growth-tab" data-tab="${t}">${l}</button>`).join("")}</div>`;
  const header = (sub, action) => head("Growth", "Growth", sub, `${g.live ? `<span class="chip money">Hashmeta live · synced ${g.lastSync || "—"}</span>` : `<span class="chip earn">demo data · integration pending</span>`}${action || ""}`) + tabs;
  const c = g.hashmeta.crm;
  const funnel = `<div class="leads">
    <div class="lead-stage"><b>${c.capture}</b><span>Capture</span></div>
    <div class="lead-stage"><b>${c.nurture}</b><span>Nurture</span></div>
    <div class="lead-stage"><b>${c.convert}</b><span>Convert</span></div>
    <div class="lead-stage"><b>${c.won}</b><span>Won</span></div>
  </div>`;

  if (state.growthTab === "overview") {
    const k = g.kpis;
    const dl = (dir, text) => g.live ? undefined : { dir, text };
    const tiles = `<div class="tiles">
      ${tile("Sessions · 30d", num(k.sessions), dl("up", "+12%"))}
      ${tile("Users · 30d", num(k.users), dl("up", "+9%"))}
      ${tile("Pageviews", num(k.pageviews), dl("up", "+14%"))}
      ${tile("Bounce rate", k.bounce + "%", dl("down", "−2.1 pts"))}
      ${tile("Avg. duration", k.avgDuration, dl("up", "+11s"))}
      ${tile("Leads", k.leads, dl("up", "+8 this wk"))}
      ${tile("Hot leads", k.hotLeads, dl("up", "ready to pursue"))}
      ${tile("Lead → signup", k.conversion + "%", dl("up", "+0.6 pts"))}
      ${tile("Pipeline value", money(k.pipelineValue), dl("up", "open deals"))}
      ${tile("AI citations", k.citations, dl("up", "ChatGPT · Gemini"))}
      ${tile("Keywords in top 10", k.keywordsTop10, dl("up", "+2"))}
    </div>`;
    const hot = g.listening.leads.filter(l => l.status === "hot").slice(0, 3).map((l, i) => `
      <div class="feed-item"><span class="avatar av-${i + 1}">${l.name[0]}</span>
        <div class="feed-body"><div class="feed-text"><b>${l.name}</b> · ${l.org}</div><div class="feed-time">${l.platform} · ${l.next}</div></div>
        ${scoreBadge(l.score)}</div>`).join("");
    const hotCard = card("Hot researcher leads", "radar", `<div class="feed">${hot}</div><button class="link-btn mt" data-action="growth-tab" data-tab="listening">Open Social Listening ${ic("arrow")}</button>`, "scored by Lead Scout");
    const platRows = g.listening.platforms.map(p => `<tr><td>${platformTag(p.name, p.icon)}</td><td class="num">${num(p.mentions)}</td><td class="num">${p.leads}</td><td class="num">${p.hot}</td></tr>`).join("");
    const platCard = card("Listening by platform", "globe", `<div class="table-wrap"><table class="tbl"><thead><tr><th>Platform</th><th>Mentions</th><th>Leads</th><th>Hot</th></tr></thead><tbody>${platRows}</tbody></table></div>`, "chats monitored across channels");
    return header("The growth arm of the one-person company — Hashmeta CMS, SEO, CRM and AI lead scouting across every channel.",
      g.live ? `<a class="btn primary" href="https://earnest.geo.hashmeta.tech" target="_blank" rel="noopener">${ic("link")}Open Hashmeta</a>` : demoBtn("Open Hashmeta", "link", "primary"))
      + card("Growth metrics", "trend", tiles, "Hashmeta analytics · last 30 days")
      + `<div class="grid g-2-1">${card("Lead funnel", "users", funnel + `<div class="hstack mt"><span class="chip money">Pipeline ${money(c.value)}</span><span class="chip blue">${g.kpis.conversion}% lead → signup</span></div>`, "capture → nurture → convert → won")}${hotCard}</div>`
      + platCard
      + `<p class="small muted">Study videos are submitted by researchers in-app — the cockpit does not generate them. Growth here is landing content, visibility, leads and campaigns.</p>`;
  }

  if (state.growthTab === "cms") {
    const cms = g.hashmeta.cms, seo = g.hashmeta.seo;
    const cmsTiles = `<div class="tiles">
      ${tile("Pages", cms.pages)}${tile("Blog posts", cms.posts)}${tile("Media assets", cms.media)}
      ${tile("Collections", cms.collections)}${tile("Forms", cms.forms)}${tile("Content queue", cms.queue + " drafts")}
    </div>`;
    const pageRows = cms.topPages.map(p => `<tr><td><div class="tbl-title">${p.title}</div><div class="tbl-sub mono">${p.path}</div></td><td class="num">${num(p.views)}</td><td class="num">${p.conv}%</td></tr>`).join("");
    const cmsCard = card("AI CMS", "globe", cmsTiles + `<div class="table-wrap mt"><table class="tbl"><thead><tr><th>Top page</th><th>Views</th><th>Conv.</th></tr></thead><tbody>${pageRows}</tbody></table></div><div class="hstack mt"><span class="chip money">Status: ${cms.status}</span><span class="chip">Last publish ${cms.lastPublish}</span><span class="chip lav">Blog: ${cms.blog.scheduled} scheduled · ${cms.blog.reviews} in review</span></div>${demoBtn("Review content queue", "doc", "sm mt")}`, "Hashmeta builds & manages the site");
    const seoTiles = `<div class="tiles">
      ${tile("Clicks · 30d", num(seo.clicks), g.live ? undefined : { dir: "up", text: "+18%" })}
      ${tile("Impressions", num(seo.impressions), g.live ? undefined : { dir: "up", text: "+22%" })}
      ${tile("CTR", seo.ctr + "%", g.live ? undefined : { dir: "up", text: "+0.4 pts" })}
      ${tile("Avg. position", seo.position, g.live ? undefined : { dir: "down", text: "−1.2" })}
      ${tile("Indexed pages", seo.indexed)}${tile("Backlinks", seo.backlinks)}
    </div>`;
    const qRows = seo.topQueries.map(q => `<tr><td class="tbl-title">${q.q}</td><td class="num">${num(q.clicks)}</td><td class="num">#${q.pos}</td></tr>`).join("");
    const ai = seo.aiVisibility;
    const seoCard = card("SEO & AI visibility", "search", seoTiles + `<div class="table-wrap mt"><table class="tbl"><thead><tr><th>Top query</th><th>Clicks</th><th>Position</th></tr></thead><tbody>${qRows}</tbody></table></div><div class="hstack mt"><span class="chip ${ai.chatgpt ? "money" : ""}">ChatGPT ${ai.chatgpt ? "cited" : "—"}</span><span class="chip ${ai.gemini ? "money" : ""}">Gemini ${ai.gemini ? "cited" : "—"}</span><span class="chip ${ai.perplexity ? "money" : ""}">Perplexity ${ai.perplexity ? "cited" : "not yet"}</span><span class="chip blue">${ai.citations} AI citations</span>${seo.disconnected ? `<span class="chip earn">GA4 &amp; Search Console not connected</span>` : ""}</div>`, "Search Console + AI-answer monitoring");
    return header("Hashmeta AI CMS and visibility — get found on Google and in AI answers, then turn that into customers.",
      demoBtn("New page / post", "doc", "primary"))
      + `<div class="grid g2">${cmsCard}${seoCard}</div>`;
  }

  if (state.growthTab === "crm") {
    const srcRows = c.sources.map(s => `<tr><td class="tbl-title">${s.name}</td><td class="num">${s.leads}</td><td class="num">${s.won}</td><td class="num">${Math.round(s.won / s.leads * 100)}%</td></tr>`).join("");
    const seqRows = c.sequences.map(s => `<tr><td class="tbl-title">${s.name}</td><td class="num">${s.enrolled}</td><td class="num">${s.open}%</td><td class="num">${s.reply}%</td></tr>`).join("");
    const subRows = c.submissions.map(s => `<tr><td class="mono">${s.id}</td><td class="tbl-title">${s.name}</td><td class="tbl-sub">${s.form}</td><td class="tbl-sub">${s.when}</td><td><span class="chip ${s.status === "new" ? "earn" : "blue"}">${s.status}</span></td></tr>`).join("");
    const leadRows = g.leads.map(l => `<tr><td><div class="tbl-title">${l.name}</div><div class="tbl-sub">${l.org}</div></td><td><span class="chip blue">${l.stage}</span></td><td class="tbl-sub">${l.source}</td><td class="tbl-sub">${l.next}</td></tr>`).join("");
    const rates = `<div class="grid g3 mt">
      ${tile("Capture → nurture", c.rates.captureToNurture + "%")}${tile("Nurture → convert", c.rates.nurtureToConvert + "%")}${tile("Convert → won", c.rates.convertToWon + "%")}
    </div>`;
    const funnelCard = card("Pipeline", "users", funnel + rates + `<div class="hstack mt"><span class="chip money">Open value ${money(c.value)}</span></div>`, "Hashmeta AI CRM");
    const sourcesCard = card("Lead sources", "trend", `<div class="table-wrap"><table class="tbl"><thead><tr><th>Source</th><th>Leads</th><th>Won</th><th>Win rate</th></tr></thead><tbody>${srcRows}</tbody></table></div>`);
    const seqCard = card("Nurture sequences", "mail", `<div class="table-wrap"><table class="tbl"><thead><tr><th>Sequence</th><th>Enrolled</th><th>Open</th><th>Reply</th></tr></thead><tbody>${seqRows}</tbody></table></div>`, "agent-drafted · approval-gated");
    const subCard = card("Recent form submissions", "doc", `<div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Name</th><th>Form</th><th>When</th><th>Status</th></tr></thead><tbody>${subRows}</tbody></table></div>`);
    const leadsCard = card("Active leads", "target", `<div class="table-wrap"><table class="tbl"><thead><tr><th>Lead</th><th>Stage</th><th>Source</th><th>Next action</th></tr></thead><tbody>${leadRows}</tbody></table></div>`);
    return header("Capture, nurture and convert the leads that follow — researchers wanting quality responses.",
      demoBtn("Add lead", "users", "primary"))
      + `<div class="grid g-2-1">${funnelCard}${sourcesCard}</div>`
      + `<div class="grid g2">${seqCard}${subCard}</div>` + leadsCard;
  }

  if (state.growthTab === "listening") {
    const ls = g.listening;
    const summary = `<div class="tiles">
      ${tile("Chats scanned", num(ls.scanned), { dir: "up", text: "last 24h" })}
      ${tile("Leads identified", ls.leadsIdentified)}${tile("Hot leads", ls.hot, { dir: "up", text: "pursue now" })}
      ${tile("Agent", ls.agent)}
    </div>`;
    const platRows = ls.platforms.map(p => `<tr><td>${platformTag(p.name, p.icon)}</td><td class="num">${num(p.mentions)}</td><td class="num">${p.leads}</td><td class="num">${p.hot}</td></tr>`).join("");
    const platCard = card("Channels monitored", "globe", `<div class="table-wrap"><table class="tbl"><thead><tr><th>Platform</th><th>Mentions</th><th>Leads</th><th>Hot</th></tr></thead><tbody>${platRows}</tbody></table></div>`, "LinkedIn · Instagram · Facebook · X · email · Reddit");
    const cards = ls.leads.map((l, i) => `
      <section class="card">
        <div class="suggest-head"><span class="avatar av-${(i % 5) + 1}">${l.name[0]}</span>
          <div class="suggest-id"><div class="suggest-name">${l.name}</div>
            <div class="suggest-meta">${platformTag(l.platform, l.icon)}<span class="mono">${l.handle}</span> · ${l.role} · ${l.org}</div></div>
          <span class="suggest-score">${scoreBadge(l.score)}</span></div>
        <div class="signal"><b>Signal:</b> ${l.signal}</div>
        <div class="stat-list mt"><div class="stat-row"><span class="k">Why this lead</span><span class="v" style="font-family:var(--font-body);font-weight:600">${l.reason}</span></div><div class="stat-row"><span class="k">Suggested next</span><span class="v" style="font-family:var(--font-body);font-weight:600">${l.next}</span></div></div>
        <div class="approval-actions mt"><button class="btn good sm" data-action="pursue-lead" data-id="${l.id}">${ic("check")}Pursue</button><button class="btn sm ghost" data-action="demo" data-label="Draft outreach · ${l.name}">${ic("mail")}Draft outreach</button><button class="btn bad sm" data-action="dismiss-lead" data-id="${l.id}">${ic("x")}Dismiss</button><span class="chip ${l.status === "hot" ? "error" : l.status === "warm" ? "earn" : ""}" style="margin-left:auto">${l.status}</span></div>
      </section>`).join("");
    return header("Lead Scout monitors chats across LinkedIn, Instagram, Facebook, X and email, then scores who is most likely to convert as a researcher.",
      demoBtn("Configure listening", "radar", "primary"))
      + card("Listening summary", "radar", summary, "runs every 30m on QwenWork credits")
      + platCard
      + `<div class="grid g2">${cards}</div>`;
  }

  const rows = g.campaigns.map(c => `<tr><td class="tbl-title">${c.name}</td><td class="tbl-sub">${c.channel}</td><td class="num">${num(c.signups)}</td><td class="num">${num(c.firstAnswers)}</td><td class="num">${money(c.cost)}</td><td class="num">${money(c.cost / c.signups)}</td></tr>`).join("");
  const table = card("Campaigns", "mega", `<div class="table-wrap"><table class="tbl"><thead><tr><th>Campaign</th><th>Channel</th><th>Signups</th><th>First answers</th><th>Spend</th><th>CAC</th></tr></thead><tbody>${rows}</tbody></table></div>`, "UTM attribution back to Earnest");
  return header("Campaign performance and promo scheduling with liability preview.",
    demoBtn("New campaign", "mega", "primary")) + table;
};

VIEWS.deploy = () => {
  const d = DEMO.deploy;
  const k = d.kpis;
  const kpis = card("Deployment metrics", "gauge", `<div class="tiles">
    ${tile("Uptime · 30d", k.uptime + "%", { dir: "up", text: "SLA 99.9%" })}
    ${tile("Latency p50", k.p50 + " ms", { dir: "down", text: "−8 ms" })}
    ${tile("Latency p95", k.p95 + " ms", { dir: "down", text: "−21 ms" })}
    ${tile("Error rate", k.errorRate + "%", { dir: "down", text: "−0.05 pts" })}
    ${tile("Requests / min", num(k.requestsMin), { dir: "up", text: "+12%" })}
    ${tile("Bandwidth · 24h", k.bandwidth, { dir: "flat", text: "steady" })}
    ${tile("CDN cache hit", k.cacheHit + "%", { dir: "up", text: "+3 pts" })}
    ${tile("SSL expires", k.sslDays + " days", { dir: "flat", text: "auto-renew" })}
  </div>`, "live · cloud Page gateway");

  const env = `<div class="grid g3">
    ${card("Local", "server", `<div class="stat-list"><div class="stat-row"><span class="k">Version</span><span class="v">${d.local.version}</span></div><div class="stat-row"><span class="k">Status</span><span class="v" style="color:var(--color-money-deep)">${d.local.status}</span></div><div class="stat-row"><span class="k">Uptime</span><span class="v">${d.local.uptime}</span></div></div><div class="mt">${meter("CPU", d.local.cpu, "lav", d.local.cpu + "%")}${meter("Memory", d.local.mem / 10, "lav", d.local.mem + " MB")}</div>`, "this machine")}
    ${card("Cloud Page", "globe", `<div class="stat-list"><div class="stat-row"><span class="k">Version</span><span class="v">${d.cloud.version}</span></div><div class="stat-row"><span class="k">Page</span><span class="v">${d.cloud.page}</span></div><div class="stat-row"><span class="k">Region</span><span class="v">${d.cloud.region}</span></div><div class="stat-row"><span class="k">Boot sync</span><span class="v" style="color:var(--color-money-deep)">${d.cloud.sync}</span></div><div class="stat-row"><span class="k">CDN</span><span class="v">${d.cloud.cdn}</span></div></div>`, "studysync snapshot applied")}
    ${card("Preview", "eye", `<div class="stat-list"><div class="stat-row"><span class="k">Version</span><span class="v">${d.preview.version}</span></div><div class="stat-row"><span class="k">Status</span><span class="v">${d.preview.status}</span></div><div class="stat-row"><span class="k">URL</span><span class="v">${d.preview.url}</span></div><div class="stat-row"><span class="k">Sync</span><span class="v">${d.preview.sync}</span></div></div>${demoBtn("Promote to cloud", "rocket", "sm mt")}`, "staging build")}
  </div>`;

  const steps = d.steps.map((s, i) => {
    const node = `<div class="step ${s.state}"><span class="step-node">${ic(s.state === "done" ? "check" : s.state === "active" ? "clock" : "arrow")}${s.label}</span></div>`;
    return node + (i < d.steps.length - 1 ? `<span class="step-arrow">${ic("arrow")}</span>` : "");
  }).join("");
  const release = card("Release pipeline", "layers", `<div class="steps">${steps}</div>
    <div class="hstack mt"><span class="chip money">+${d.diff.added} surveys</span><span class="chip earn">−${d.diff.deactivated} deactivated</span><span class="chip blue">${d.diff.copy} copy edits</span></div>
    <div class="approval-actions mt">${demoBtn("Republish via owner task", "rocket", "primary")}${demoBtn("Rollback", "clock")}</div>
    <p class="small muted mt">Routes to the Page-binding owner task. Never creates a new Page or re-provisions the DB.</p>`, "one button · full trail");

  const codes = d.statusCodes.map(s => meter(s.code, s.pct, s.tone, s.pct + "%")).join("");
  const h = d.health;
  const traffic = card("Traffic & health", "trend", `<div class="grid g2"><div class="stat-list">${codes}</div><div class="stat-list">
    <div class="stat-row"><span class="k">API latency</span><span class="v">${h.apiLatency} ms</span></div>
    <div class="stat-row"><span class="k">Bridge</span><span class="v" style="color:var(--color-money-deep)">${h.bridge}</span></div>
    <div class="stat-row"><span class="k">DB size</span><span class="v">${h.dbSize}</span></div>
    <div class="stat-row"><span class="k">WAL</span><span class="v">${h.wal}</span></div>
    <div class="stat-row"><span class="k">Errors · 24h</span><span class="v">${h.errors24h}</span></div>
  </div></div>`, "status codes · resources");

  const log = d.changelog.map(c => `<div class="feed-item"><span class="feed-ic blue mono" style="font-size:.8125rem;font-weight:600">${c.v}</span><div class="feed-body"><div class="feed-text">${c.note}</div><div class="feed-time">${c.when}</div></div></div>`).join("");
  const changelog = card("Changelog", "doc", `<div class="feed">${log}</div>`, "auto-drafted · founder approves");

  const depRows = d.deployments.map(x => `<tr><td class="mono">${x.id}</td><td class="tbl-title">${x.version}</td><td><span class="chip">${x.env}</span></td><td class="tbl-sub">${x.when}</td><td class="num">${x.dur}</td><td class="tbl-sub">${x.by}</td><td><span class="chip ${x.status === "success" ? "money" : "earn"}">${x.status}</span></td></tr>`).join("");
  const history = card("Deployment history", "clock", `<div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Version</th><th>Env</th><th>When</th><th>Duration</th><th>By</th><th>Status</th></tr></thead><tbody>${depRows}</tbody></table></div>`, "every release audited · rollback ready");

  return head("Release ops", "Deploy", "Environments, traffic, health and a full deployment history — one-click release with diff preview and rollback.",
    `<span class="chip blue">cloud + health: live</span><span class="chip earn">traffic metrics: demo</span>${demoBtn("Probe live API", "search")}`) + kpis + env + release
    + `<div class="grid g-2-1">${traffic}${changelog}</div>` + history;
};

VIEWS.investors = () => {
  const inv = DEMO.investors;
  const s = inv.snapshot;
  const ls = inv.listening;
  const listenSummary = `<div class="tiles">
    ${tile("Chats & posts scanned", num(ls.scanned), { dir: "up", text: "last 24h" })}
    ${tile("Investors identified", ls.identified)}${tile("Hot prospects", ls.hot, { dir: "up", text: "reach out now" })}
    ${tile("Agent", ls.agent)}
  </div>`;
  const suggestCards = inv.suggested.map(v => `
    <section class="card">
      <div class="suggest-head"><span class="avatar av-${v.av}">${v.name[0]}</span>
        <div class="suggest-id"><div class="suggest-name">${v.name}</div>
          <div class="suggest-meta">${platformTag(v.platform, v.icon)}<span>${v.contact}</span> · ${v.focus}</div></div>
        <span class="suggest-score">${scoreBadge(v.score)}</span></div>
      <div class="signal"><b>Signal:</b> ${v.signal}</div>
      <div class="stat-list mt"><div class="stat-row"><span class="k">Why likely to invest</span><span class="v" style="font-family:var(--font-body);font-weight:600">${v.reason}</span></div><div class="stat-row"><span class="k">Suggested next</span><span class="v" style="font-family:var(--font-body);font-weight:600">${v.next}</span></div></div>
      <div class="approval-actions mt"><button class="btn good sm" data-action="reach-investor" data-id="${v.id}">${ic("mail")}Reach out</button><button class="btn sm ghost" data-action="demo" data-label="Draft intro · ${v.name}">${ic("doc")}Draft intro</button><button class="btn bad sm" data-action="dismiss-investor" data-id="${v.id}">${ic("x")}Dismiss</button><span class="chip ${v.status === "hot" ? "error" : v.status === "warm" ? "earn" : ""}" style="margin-left:auto">${v.status}</span></div>
    </section>`).join("");
  const suggested = card("Suggested investors", "target", `<div class="grid g2">${suggestCards}</div>`, "Investor Scout scores chats across LinkedIn · Instagram · Facebook · X · email");

  const snap = card("Metrics snapshot · " + s.period, "chart", `<div class="grid g3">
    ${kpi("DAU", num(s.dau), null, "blue")}${kpi("Responses", num(s.responses), null, "blue")}${kpi("Revenue", money(s.revenue), null, "money")}
    ${kpi("Liability", money(s.liability), null, "earn")}${kpi("Quality", s.quality + "%", null, "money")}${kpi("Coverage", s.coverage + "%", null, "lav")}
  </div>`, "frozen · single source of truth");
  const deck = card("Deck builder", "doc", `<div class="hstack">${inv.deck.slides.map(x => `<span class="chip blue">${x}</span>`).join("")}</div>
    <p class="small muted mt">${inv.deck.updated} changed from the latest snapshot. Review slide-by-slide diff, then approve &amp; export.</p>
    <div class="approval-actions mt"><button class="btn good sm" data-action="demo" data-label="Approve deck">${ic("check")}Approve refresh</button>${demoBtn("Export PPTX", "doc", "sm")}${demoBtn("View diff", "eye", "sm ghost")}</div>`, inv.deck.status);
  const contacts = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Investor</th><th>Contact</th><th>Last touch</th><th>Next</th></tr></thead><tbody>
    ${inv.contacts.map(c => `<tr><td class="tbl-title">${c.name}</td><td>${c.contact}</td><td class="tbl-sub">${c.last}</td><td class="tbl-sub">${c.next}</td></tr>`).join("")}
  </tbody></table></div>`;
  const crm = card("Investor CRM", "users", contacts, "update emails are approval-gated");
  const room = card("Data room", "layers", `<div class="hstack">${inv.dataRoom.map(x => `<span class="chip">${ic("doc")}${x}</span>`).join("")}</div><div class="approval-actions mt">${demoBtn("Export pack", "doc", "primary sm")}</div><p class="small muted mt">Aggregate only · no PII · access logged.</p>`);
  return head("Investor relations", "Investors", "Scout likely investors from social chats, then run frozen metrics, an agent-refreshed deck and a gated data room.",
    `<span class="chip earn">demo data · integration pending</span>${demoBtn("New snapshot", "chart")}`)
    + card("Investor listening", "radar", listenSummary, "runs hourly on QwenWork credits")
    + suggested
    + snap + `<div class="grid g2">${deck}${crm}</div>` + room;
};

VIEWS.agents = () => {
  const cards = DEMO.agents.map(a => {
    const paused = a.status === "paused";
    const budgetLabel = a.id === "a-game" ? "Daily builds" : a.external ? "Runs in QwenWork" : "Credit budget";
    const budget = a.external ? `<p class="small muted mt">Scheduled QwenWork task — status and budgets live in QwenWork, not this server.</p>` : meter(budgetLabel, a.budget ? a.credits / a.budget * 100 : 0, a.budget && a.credits / a.budget > 0.8 ? "error" : "lav", `${a.credits} / ${a.budget}`);
    return `<section class="card">
      <div class="split"><div class="hstack"><span class="feed-ic lav">${ic(a.icon)}</span><div><div class="tbl-title">${a.name}</div><div class="tbl-sub mono">${a.schedule}</div></div></div>
      <span class="chip ${a.status === "failed" ? "error" : a.status === "running" ? "blue" : paused ? "" : "money"}"><span class="dot ${dotFor(a.status)}"></span>${statusWord(a.status)}</span></div>
      <p class="small muted mt">${a.role}</p>
      <div class="stat-list mt"><div class="stat-row"><span class="k">Last / next</span><span class="v">${a.last} / ${a.next}</span></div><div class="stat-row"><span class="k">Jobs today</span><span class="v">${a.jobs}</span></div><div class="stat-row"><span class="k">Success rate</span><span class="v">${a.success}%</span></div></div>
      <div class="mt">${budget}</div>
      <div class="approval-actions mt"><button class="btn sm" data-action="toggle-agent" data-id="${a.id}">${ic(paused ? "play" : "pause")}${paused ? "Resume" : "Pause"}</button><button class="btn sm ghost" data-action="demo" data-label="Run logs · ${a.name}">${ic("clock")}Logs</button>${a.status === "failed" ? `<button class="btn good sm" data-action="demo" data-label="Retry ${a.name}">${ic("play")}Retry</button>` : ""}</div>
    </section>`;
  }).join("");
  const runRows = DEMO.runs.map(r => `<tr><td class="tbl-title">${r.agent}</td><td class="tbl-sub">${r.started}</td><td class="num">${r.dur}</td><td class="num">${r.jobs}</td><td class="num">${r.credits}</td><td><span class="chip ${r.status === "ok" ? "money" : "error"}">${r.status}</span></td></tr>`).join("");
  const runs = card("Run logs", "clock", `<div class="table-wrap"><table class="tbl"><thead><tr><th>Agent</th><th>Started</th><th>Duration</th><th>Jobs</th><th>Credits</th><th>Status</th></tr></thead><tbody>${runRows}</tbody></table></div>`, "every run attributed in the audit log");
  const b = DEMO.bridge;
  const bridge = card("Credit bridge health", "link", `<div class="stat-list">
    <div class="stat-row"><span class="k">Worker</span><span class="v" style="color:var(--color-money-deep)">${b.worker}</span></div>
    <div class="stat-row"><span class="k">Pending / done / failed</span><span class="v">${b.pending} / ${b.done} / ${b.failed}</span></div>
    <div class="stat-row"><span class="k">Processed total</span><span class="v">${b.processed}</span></div>
    <div class="stat-row"><span class="k">Timeout rate</span><span class="v">${b.timeoutRate}%</span></div>
  </div><p class="small muted mt">Loopback file queue · runs on QwenWork credits · no external API key.</p>`);
  const budget = card("Global budget", "zap", meter("Game builds today", DEMO.credits.cap ? DEMO.credits.used / DEMO.credits.cap * 100 : 0, "lav", `${num(DEMO.credits.used)} / ${num(DEMO.credits.cap)}`) + `<div class="approval-actions mt">${demoBtn("Adjust budgets", "gear", "sm")}${demoBtn("Kill switch", "x", "bad sm")}</div>`, "game builds on QwenWork credits · per-day cap");
  return head("The AI workforce", "Agents", "Your org chart of one. Schedules, run logs, credit budgets, pause/resume — QwenWork is the execution plane.",
    demoBtn("New agent", "bot", "primary")) + `<div class="grid g3">${cards}</div>`
    + `<div class="grid g-2-1">${runs}<div class="grid" style="align-content:start">${bridge}${budget}</div></div>`;
};

VIEWS.settings = () => {
  const connRows = DEMO.connections.map(c => {
    const chip = { connected: "money", demo: "earn", simulated: "earn" }[c.status] || "";
    return `<tr><td class="tbl-title">${c.name}</td><td class="tbl-sub">${c.detail}</td><td><span class="chip ${chip}">${c.status}</span></td><td><div class="row-actions"><button class="btn sm ghost" data-action="demo" data-label="Configure ${c.name}">${ic("gear")}</button></div></td></tr>`;
  }).join("");
  const conn = card("Connections", "link", `<div class="table-wrap"><table class="tbl"><thead><tr><th>Service</th><th>Detail</th><th>Status</th><th></th></tr></thead><tbody>${connRows}</tbody></table></div>`, "secrets masked · never returned by API");
  const polRows = DEMO.policies.map(p => `<tr><td class="tbl-title">${p.k}</td><td class="num">${p.v}</td><td><div class="row-actions"><button class="btn sm ghost" data-action="demo" data-label="Edit policy">${ic("gear")}</button></div></td></tr>`).join("");
  const pol = card("Policy table", "shield", `<div class="table-wrap"><table class="tbl"><thead><tr><th>Rule</th><th>Value</th><th></th></tr></thead><tbody>${polRows}</tbody></table></div>`, "thresholds · caps · content rules");
  const auditRows = DEMO.audit.map(a => `<tr><td><span class="chip ${a.actor === "Founder" ? "blue" : "lav"}">${a.actor}</span></td><td class="tbl-title">${a.action}</td><td class="tbl-sub mono">${a.target}</td><td class="tbl-sub">${a.when}</td></tr>`).join("");
  const audit = card("Audit log", "doc", `<div class="table-wrap"><table class="tbl"><thead><tr><th>Actor</th><th>Action</th><th>Target</th><th>When</th></tr></thead><tbody>${auditRows}</tbody></table></div>`, "immutable · every admin + agent action");
  const backup = card("Data & backups", "layers", `<div class="stat-list"><div class="stat-row"><span class="k">Last backup</span><span class="v">today · 06:00</span></div><div class="stat-row"><span class="k">Cards stored</span><span class="v">tokenised only</span></div><div class="stat-row"><span class="k">Deletion queue</span><span class="v">0 pending</span></div></div><div class="approval-actions mt">${demoBtn("Backup now", "layers", "sm")}</div><p class="small muted mt">Backup-first before any bulk change. PII minimised · full card numbers never touch the DB.</p>`);
  return head("System", "Settings & governance", "Connections, policies, the immutable audit trail, and data safeguards.",
    demoBtn("Export audit", "doc")) + `<div class="grid g2">${conn}${pol}</div>` + `<div class="grid g-2-1">${audit}${backup}</div>`;
};

/* ── render & counts ────────────────────────────────── */
function updateCounts() {
  const pending = DEMO.approvals.filter(a => a.status === "pending").length;
  $("#inboxCount").textContent = pending;
  $("#navInboxCount").textContent = pending || "";
  $("#alertCount").textContent = DEMO.alerts.length;
  $("#navFlagCount").textContent = DEMO.flagged.length || "";
  $("#creditsToday").textContent = num(DEMO.credits.used);
  const cap = $("#creditsCap"); if (cap) cap.textContent = "/ " + DEMO.credits.cap + " builds";
  const dm = $("#navDmCount"); if (dm) dm.textContent = (DEMO.inbox && DEMO.inbox.unread) || "";
}
function render() {
  $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === state.view));
  $("#workspace").innerHTML = `<div class="view">${VIEWS[state.view]()}</div>`;
  updateCounts();
  $("#sidenav").classList.remove("open");
  if (state.view === "inbox") {
    const t = $("#dmThread"); if (t) t.scrollTop = t.scrollHeight;
  } else {
    window.scrollTo({ top: 0 });
  }
}

/* ── interactions ───────────────────────────────────── */
document.addEventListener("click", e => {
  const viewBtn = e.target.closest("[data-view]");
  const actBtn = e.target.closest("[data-action]");

  if (actBtn) {
    const action = actBtn.dataset.action;
    const id = actBtn.dataset.id;
    const find = (arr) => arr.find(x => x.id === id);

    if (action === "demo") { toast(`${actBtn.dataset.label} — not wired yet (demo).`); return; }
    if (action === "refresh-live") { LIVE.refresh().then(() => toast("Refreshed from the live backend")).catch(e => toast(e.message, true)); return; }

    if (action === "approve" || action === "reject") {
      LIVE.act("/api/admin/decide", { id, decision: action === "approve" ? "approve" : "reject" }, action === "approve" ? "Approved · written to audit log" : "Rejected · written to audit log");
      return;
    }
    if (action === "batch") {
      const low = DEMO.approvals.filter(a => a.status === "pending" && a.risk === "low");
      if (!low.length) { toast("No low-risk proposals pending"); return; }
      (async () => { for (const a of low) await LIVE.post("/api/admin/decide", { id: a.id, decision: "approve" }); toast(`${low.length} low-risk proposals approved`); await LIVE.refresh(); })().catch(e => toast(e.message, true));
      return;
    }
    if (action === "filter-approval") { state.approvalFilter = actBtn.dataset.flow; render(); return; }
    if (action === "catalog-tab") { state.catalogTab = actBtn.dataset.tab; render(); return; }
    if (action === "money-tab") { state.moneyTab = actBtn.dataset.tab; render(); return; }
    if (action === "people-tab") { state.peopleTab = actBtn.dataset.tab; render(); return; }
    if (action === "growth-tab") { state.growthTab = actBtn.dataset.tab; render(); return; }

    if (action === "toggle-pipeline") { LIVE.act("/api/admin/pipeline-toggle", {}, "Discover pipeline toggled"); return; }
    if (action === "toggle-agent") {
      const a = DEMO.agents.find(x => x.id === id);
      if (a && a.id === "a-discover") { LIVE.act("/api/admin/pipeline-toggle", {}, "Discovery pipeline toggled"); return; }
      toast(a && a.external ? `${a.name} runs as a QwenWork scheduled task — manage it in QwenWork.` : `${a ? a.name : "Agent"} pause/resume is not wired yet.`);
      return;
    }
    if (action === "toggle-study") { LIVE.act("/api/admin/study-toggle", { id }, `${id} toggled (never deleted)`); return; }
    if (action === "publish-game") { LIVE.act("/api/admin/game-publish", { id }, "Game published to the play tab"); return; }
    if (action === "clear-response" || action === "reject-response") {
      const f = DEMO.flagged.find(x => x.id === id);
      LIVE.act("/api/admin/quality", { id, kind: f ? f.kind : "response", decision: action === "clear-response" ? "clear" : "reject" }, action === "clear-response" ? `${id} cleared · paid` : `${id} rejected · no pay`);
      return;
    }
    if (action === "settle") { LIVE.act("/api/admin/settle", { id }, `${id} settled`); return; }
    if (action === "suspend") {
      const u = DEMO.users.find(x => x.name === actBtn.dataset.name);
      if (!u || !u.id) { toast("User not found", true); return; }
      LIVE.act("/api/admin/suspend", { id: u.id }, `${u.name} ${u.status === "suspended" ? "unsuspended" : "suspended"}`);
      return;
    }
    if (action === "verify") { toast("Researcher verification is not wired yet (demo)."); return; }
    if (action === "resolve-report") { toast("Report actions are not wired yet (demo)."); return; }
    if (action === "pursue-lead" || action === "dismiss-lead" || action === "reach-investor" || action === "dismiss-investor") { toast("Growth & Investors are demo modules — integration pending."); return; }

    /* ---- social inbox ---- */
    if (action === "inbox-open") { LIVE.openThread(id).catch(e => toast(e.message, true)); return; }
    if (action === "inbox-sync") { LIVE.syncInbox(); return; }
    if (action === "inbox-bot") { LIVE.botToggle(id, actBtn.dataset.paused === "1").catch(e => toast(e.message, true)); return; }
    if (action === "inbox-draft") { LIVE.draft(id); return; }
    if (action === "inbox-send") {
      const box = $("#replyBox");
      const text = box ? box.value.trim() : "";
      if (!text) { toast("Write a reply first", true); return; }
      actBtn.disabled = true;
      LIVE.reply(id, text).catch(e => { toast(e.message, true); actBtn.disabled = false; });
      return;
    }
    return;
  }

  if (viewBtn) {
    state.view = viewBtn.dataset.view;
    render();
    if (state.view === "inbox") LIVE.loadInbox().catch(e => toast(e.message, true));
    return;
  }
  if (e.target.closest("#navToggle")) { $("#sidenav").classList.toggle("open"); return; }
  if (e.target.closest("#alertsBtn")) { state.view = "overview"; render(); return; }
});

render();
LIVE.init();