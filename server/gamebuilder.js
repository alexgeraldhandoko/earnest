/* EARNest · cloud game builder — QwenWork OpenAPI worker.
   Builds queued story games entirely on the hosted Page, on the founder's
   QwenWork credits: picks up agentqueue jobs, runs one OpenAPI agent session
   per job with the SAME prompt the local worker uses, validates the spec and
   completes the job. No Mac, no cron, no third-party key.

   Active only when the QwenWork OAuth connection is authorized on THIS page
   (qwenwork.enabled()). While active, /api/agent-queue reports
   cloud_builder:true so the Mac cron worker stands down for this server. */
"use strict";
const { q } = require("./db");
require("./config"); // ensures the config table exists
const qw = require("./qwenwork");
const llm = require("./llm");
const agentqueue = require("./agentqueue");

const POLL_MS = Number(process.env.GB_POLL_MS || 2000);
const TURN_DEADLINE_MS = Number(process.env.GB_TURN_DEADLINE_MS || 300000);
const TICK_MS = Number(process.env.GB_TICK_MS || 30000);

function kvGet(k) { const r = q.get("SELECT value FROM config WHERE key=?", k); return r && r.value ? r.value : ""; }
function kvSet(k, v) {
  if (v == null || v === "") q.run("DELETE FROM config WHERE key=?", k);
  else q.run("INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, String(v));
}
function kvJSON(k, fallback) { try { const v = kvGet(k); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } }

function ready() { return qw.enabled(); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(["completed", "failed", "interrupted", "cancelled", "ended", "error"]);
const ACTIVE = new Set(["pending", "queued", "running", "starting", "in_progress", "action_required"]);

/* game builds are long agent turns — own wait loop with a generous deadline */
async function waitTurn(sid, tid) {
  const start = Date.now();
  let cancelSent = false;
  while (Date.now() - start < TURN_DEADLINE_MS) {
    const r = await qw.api("GET", `/sessions/${sid}/turns/${tid}`);
    if (r.status === 200) {
      const t = r.json || {};
      const st = String(t.status || "");
      if (st === "action_required" && !cancelSent) {
        cancelSent = true; // the builder prompt forbids questions — unblock
        await qw.api("POST", `/sessions/${sid}/cancel`, {});
      } else if (t.ended_at || (st && !ACTIVE.has(st)) || TERMINAL.has(st)) {
        return t;
      }
    }
    await sleep(POLL_MS);
  }
  return null;
}

async function turnText(sid, tid) {
  const turn = await waitTurn(sid, tid);
  if (!turn) return { error: "The builder session timed out." };
  const st = String(turn.status || "");
  if (st === "failed" || st === "interrupted" || st === "cancelled") return { error: "The builder session ended before finishing (" + st + ")." };
  let out = turn.final_message || "";
  if (!out) out = await qw.eventsText(sid);
  if (!out) return { error: "The builder session returned no output." };
  return { text: String(out) };
}

function parseSpec(text) {
  let spec;
  try { spec = llm.extractJson(text); } catch (_) { return { error: "The builder reply was not parseable JSON." }; }
  if (!spec || typeof spec !== "object") return { error: "The builder reply was not a game object." };
  spec.kind = "story";
  const err = llm.validateSpec(spec);
  if (err) return { error: err };
  return { spec };
}

async function build(job) {
  const t0 = Date.now();
  const mode = await qw.getMode().catch(() => "");
  const text = job.system + "\n\n" + job.prompt +
    "\n\nRespond with ONLY the JSON object — no markdown fences, no commentary. Never use tools, never write files, never ask questions, never request permissions.";
  const r = await qw.api("POST", "/sessions", {
    name: "Earnest game build " + job.id,
    initial_prompt: { text },
    locale: "en", timezone: "Asia/Singapore", ttl_seconds: 3600,
    ...(mode ? { mode } : {}),
  }, { timeout: 60000 });
  if (!(r.status >= 200 && r.status < 300) || !r.json.session_id) {
    return agentqueue.fail(job.id, "Could not start a builder session (HTTP " + r.status + ").");
  }
  const sid = r.json.session_id;
  try {
    let tid = r.json.first_turn_id || null;
    if (!tid) {
      const d = await qw.api("GET", `/sessions/${sid}`);
      tid = d.json && d.json.current_turn && d.json.current_turn.turn_id;
    }
    if (!tid) return agentqueue.fail(job.id, "The builder session produced no turn.");
    let out = await turnText(sid, tid);
    let parsed = out.text ? parseSpec(out.text) : { error: out.error };
    /* one correction turn in the same session, mirroring llm.generateGame */
    if (parsed.error) {
      const c = await qw.api("POST", `/sessions/${sid}/prompt`, {
        text: "Your previous reply was invalid: " + parsed.error + ". Output corrected JSON only, same schema. No commentary, no tools, no questions.",
      }, { timeout: 60000 });
      if ((c.status === 202 || c.status === 200) && c.json.turn_id) {
        out = await turnText(sid, c.json.turn_id);
        if (out.text) parsed = parseSpec(out.text);
        else parsed = { error: out.error };
      }
    }
    if (parsed.error) return agentqueue.fail(job.id, parsed.error);
    const done = agentqueue.complete(job.id, parsed.spec);
    if (done.error) return done;
    /* mirror the finished spec to the Page DB immediately — a suspended cold
       start must not lose the build */
    await require("./persist").flush().catch(() => {});
    kvSet("gb_last_build", JSON.stringify({ at: new Date().toISOString(), id: job.id, ms: Date.now() - t0 }));
    kvSet("gb_last_error", "");
    return done;
  } finally {
    await qw.api("DELETE", `/sessions/${sid}`, null, { timeout: 15000 }).catch(() => {});
  }
}

let running = false;
async function tick() {
  if (running || !ready()) return;
  running = true;
  try {
    for (const job of agentqueue.pending()) {
      try { await build(job); }
      catch (e) {
        try { agentqueue.fail(job.id, String(e.message || e).slice(0, 300)); } catch (_) {}
        kvSet("gb_last_error", JSON.stringify({ at: new Date().toISOString(), id: job.id, error: String(e.message || e) }));
      }
    }
  } finally { running = false; }
}

function kick() { if (ready()) setImmediate(() => tick().catch(() => {})); }

let started = false;
function start() {
  if (started) return;
  started = true;
  setInterval(() => tick().catch(() => {}), TICK_MS).unref();
  setTimeout(() => tick().catch(() => {}), 5000).unref();
  console.log("game builder: " + (ready() ? "cloud worker active (QwenWork OpenAPI)" : "waiting for QwenWork authorization"));
}

function status() {
  return { ready: ready(), running, last_build: kvJSON("gb_last_build", null), last_error: kvJSON("gb_last_error", null) };
}

module.exports = { ready, kick, start, tick, status };