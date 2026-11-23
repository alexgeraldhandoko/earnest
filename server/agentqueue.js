/* EARNest · QwenWork-credit generation queue.
   Game generation runs on the founder's QwenWork plan credits: the app enqueues
   a job here, and the local "Earnest game builder" scheduled agent picks it up,
   writes the spec itself (no external AI API, no OpenRouter, no DashScope) and
   posts it back. Endpoints are loopback-only — the worker runs on this machine.
   Budget guards: DAILY_CAP generations/day, worker processes ≤3 jobs per run,
   and idle runs cost a single HTTP check. */
"use strict";
const crypto = require("node:crypto");
const { q } = require("./db");
const llm = require("./llm");
const storage = require("./storage");

const DAILY_CAP = 10;

function usedToday() {
  const row = q.get("SELECT COUNT(*) n FROM games WHERE provider='qwenwork' AND status IN ('draft','published') AND date(created_at)=date('now')");
  return row ? row.n : 0;
}
function remainingToday() { return Math.max(0, DAILY_CAP - usedToday()); }

function enqueue({ kind, answers, researcherId }) {
  if (!llm.SCHEMAS[kind]) throw Object.assign(new Error("Unknown game template."), { status: 400 });
  if (remainingToday() <= 0) throw Object.assign(new Error(`Daily build limit reached (${DAILY_CAP}/day on QwenWork credits). Try again tomorrow.`), { status: 429 });
  const id = "g-" + crypto.randomBytes(4).toString("hex");
  const hint = String(answers.premise || answers.setting || answers.research_context || answers.research_material || "New game").slice(0, 120);
  storage.save({
    id, researcher_id: researcherId, kind, title: "Building your game…",
    premise: hint, reward_cents: 0, prompt: JSON.stringify(answers || {}),
    provider: "qwenwork", model: "QwenWork agent", status: "queued", spec: null,
  });
  return id;
}

/* jobs carry the full prompt + schema so the worker needs nothing but HTTP */
function pending() {
  const rows = q.all("SELECT id,kind,prompt FROM games WHERE status='queued' ORDER BY rowid ASC LIMIT 3");
  return rows.map((r) => {
    let answers = {};
    try { answers = JSON.parse(r.prompt || "{}"); } catch {}
    const p = llm.buildPrompt(r.kind, answers);
    return { id: r.id, kind: r.kind, system: p.system, prompt: p.user, schema: p.schema };
  });
}

function complete(id, spec) {
  const meta = storage.loadMeta(id);
  if (!meta) return { error: "Unknown job." };
  if (meta.status !== "queued") return { error: `Job is not queued (status: ${meta.status}).` };
  if (spec && typeof spec === "object") spec.kind = meta.kind;
  const err = llm.validateSpec(spec);
  if (err) return { error: err };
  const art = require("./gameart").ensureArt(id, spec);
  storage.save({
    ...meta, kind: spec.kind, title: String(spec.title).slice(0, 80),
    premise: String(spec.premise || "").slice(0, 300),
    provider: "qwenwork", model: "QwenWork agent", status: "draft", error: null, spec,
    ...require("./gamemedia").assign(spec.kind, (() => { try { return JSON.parse(meta.prompt || "{}").research_context; } catch { return ""; } })()),
    headline: require("./gamemedia").headlineFor({ kind: spec.kind, spec }),
    logo: art.logo, poster: art.poster,
  });
  return { ok: true, id };
}

function fail(id, message) {
  const meta = storage.loadMeta(id);
  if (!meta) return { error: "Unknown job." };
  if (meta.status !== "queued") return { error: `Job is not queued (status: ${meta.status}).` };
  storage.save({ ...meta, status: "failed", error: String(message || "The builder could not produce a valid game.").slice(0, 300), spec: null });
  return { ok: true, id };
}

/* retry a failed build (e.g. after a server-side fix) without a new submission */
function requeue(id) {
  const meta = storage.loadMeta(id);
  if (!meta) return { error: "Unknown job." };
  if (meta.status !== "failed") return { error: `Only failed jobs can be requeued (status: ${meta.status}).` };
  if (remainingToday() <= 0) return { error: `Daily build limit reached (${DAILY_CAP}/day on QwenWork credits). Try again tomorrow.` };
  storage.save({ ...meta, status: "queued", error: null, spec: null });
  return { ok: true, id };
}

module.exports = { enqueue, pending, complete, fail, requeue, remainingToday, DAILY_CAP };