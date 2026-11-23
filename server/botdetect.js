/* EARNest · bot & authenticity detection — layered model after Prolific,
   CloudResearch Sentry, Qualtrics Fraud Detection and the keystroke-telemetry
   literature ("A Penny for Your Prompts", arXiv:2607.00403):
     Layer 0  hard rules (near-zero false positives)
     Layer 1  logistic risk model over paradata + answer features
     Layer 2  anomaly detector vs a human reference baseline
     Layer 3  account-level EWMA quality score
   Signals: in-app activity paradata (keystroke dynamics, pointer physics,
   focus/visibility, paste/copy), automation & capture environment checks,
   and answer-text analysis. OS-level screen recorders are not detectable from
   a web sandbox — we record consented session telemetry + capture/remote-control
   heuristics instead, which is what production systems actually do. */
"use strict";
const { q } = require("./db");
const E = require("./embed");

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const cv = (a) => { const m = mean(a); return m > 0 ? sd(a) / m : 0; };
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* Human reference baselines (keystroke/mouse dynamics literature): used by the
   anomaly layer as robust z-scores. */
const HUMAN = {
  perQuestionMs: { mu: 14000, sigma: 9000 },
  flightCV: { mu: 0.85, sigma: 0.35 },
  straightness: { mu: 0.78, sigma: 0.12 },
  pasteRate: { mu: 0.04, sigma: 0.08 },
};

const LLM_MARKERS = /\b(as an ai|certainly!|delve|moreover|it'?s important to note|in conclusion|rich tapestry|ever-evolving)\b/i;
const GIBBERISH_ROWS = /(asdf|qwer|zxcv|hjkl|jkl;|wasd){2,}/i;

function gibberish(text) {
  const t = String(text || "").toLowerCase().trim();
  if (t.length < 4) return false;
  if (GIBBERISH_ROWS.test(t)) return true;
  const letters = t.replace(/[^a-z]/g, "");
  if (!letters) return false;
  const vowels = (letters.match(/[aeiou]/g) || []).length / letters.length;
  if (vowels < 0.18 || vowels > 0.85) return true;
  if (/(.)\1{4,}/.test(t)) return true;
  const words = t.split(/\s+/);
  if (words.length >= 3 && new Set(words).size === 1) return true;
  return false;
}
function jaccard(a, b) {
  const A = new Set(E.tokens(a)), B = new Set(E.tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/* ---- feature extraction ---------------------------------------------- */
function extract(answers, timings, paradata, questions, ctx) {
  const pd = paradata && typeof paradata === "object" ? paradata : {};
  const env = pd.env || {};
  const sess = pd.session || {};
  const qs = Array.isArray(pd.questions) ? pd.questions : [];
  const t = Array.isArray(timings) ? timings.map(Number) : [];
  const n = questions.length || answers.length;
  const openIdx = questions.map((qq, i) => qq.type === "text" ? i : -1).filter((i) => i >= 0);
  const f = {};
  const notes = [];
  const perQuestion = [];

  const totalMs = t.reduce((a, b) => a + b, 0);
  const perQ = n ? totalMs / n : 0;

  /* Layer 0 hard rules */
  const hard = [];
  if (sess.honeypot) hard.push("honeypot");
  if (env.automationGlobals) hard.push("automation");
  const injectedNoKeys = qs.some((qq) => (qq.injected || 0) > 0 && (qq.keys || 0) === 0);
  if (injectedNoKeys) hard.push("injection");
  if (totalMs > 0 && totalMs < n * 2000) hard.push("impossible-pace");
  if (env.untrusted) hard.push("synthetic-events");

  /* timing */
  f.telemetry_missing = qs.length === 0 && t.length === 0 ? 1 : 0;
  f.speed_z = perQ > 0 ? Math.max(0, (HUMAN.perQuestionMs.mu - perQ) / HUMAN.perQuestionMs.sigma) : 0;
  f.time_z_lt3 = perQ > 0 && perQ < HUMAN.perQuestionMs.mu - 3 * HUMAN.perQuestionMs.sigma ? 1 : 0;
  f.cadence_cv = t.length >= 2 ? cv(t) : 1;
  f.regular_cadence = t.length >= 2 && cv(t) < 0.1 && mean(t) < 2500 ? 1 : 0;

  /* keystroke dynamics */
  const allFlights = qs.flatMap((qq) => Array.isArray(qq.flights) ? qq.flights : []);
  const allDwells = qs.flatMap((qq) => Array.isArray(qq.dwells) ? qq.dwells : []);
  f.flight_cv = allFlights.length >= 8 ? cv(allFlights) : HUMAN.flightCV.mu;
  f.low_flight_entropy = allFlights.length >= 8 && cv(allFlights) < 0.18 ? 1 : 0;
  f.dwell_cv = allDwells.length >= 8 ? cv(allDwells) : 0.5;

  /* paste / copy — the strongest LLM-use signal in the literature */
  const pasteWords = qs.reduce((s, qq) => s + (qq.paste_words || 0), 0);
  const pastedOpen = openIdx.filter((i) => qs[i] && (qs[i].pastes || 0) > 0 && (qs[i].paste_words || 0) >= 10).length;
  f.paste_all_open = openIdx.length > 0 && pastedOpen === openIdx.length ? 1 : 0;
  f.paste_most_open = openIdx.length > 0 && pastedOpen / openIdx.length >= 0.66 ? 1 : 0;
  f.copy_then_paste = (sess.copies || 0) > 0 && pasteWords >= 10 ? 1 : 0;
  f.paste_rate = n ? pastedOpen / Math.max(1, openIdx.length) : 0;
  f.llm_artifacts = answers.some((a) => LLM_MARKERS.test(String(a))) ? 1 : 0;

  /* attention & answer quality */
  let attentionFails = 0, gibberishCount = 0, longNoEdit = 0;
  answers.forEach((a, i) => {
    const qq = questions[i];
    const v = String(a == null ? "" : a);
    if (qq && qq.meta && qq.meta.attention && qq.type === "opts") {
      let opts = [];
      try { opts = JSON.parse(qq.options || "[]"); } catch {}
      if (opts.indexOf(v) !== qq.meta.correct) attentionFails++;
    }
    if (qq && qq.type === "text") {
      if (gibberish(v)) gibberishCount++;
      const pq = qs[i] || {};
      if (v.trim().split(/\s+/).length >= 12 && (pq.backspaces || 0) === 0 && (pq.pastes || 0) > 0) longNoEdit++;
    }
  });
  f.attention_fail = attentionFails > 0 ? 1 : 0;
  f.gibberish = gibberishCount > 0 ? 1 : 0;
  f.long_no_edit = longNoEdit > 0 ? 1 : 0;

  /* cross-user answer similarity (answer farms / shared LLM scripts) */
  let maxSim = 0, dupOther = 0;
  let cohorts = [];
  if (ctx && ctx.studyId) {
    cohorts = q.all("SELECT answers FROM responses WHERE study_id=? AND user_id<>? ORDER BY id DESC LIMIT 60", ctx.studyId, ctx.userId || 0)
      .map((o) => { try { return JSON.parse(o.answers); } catch { return null; } }).filter(Array.isArray);
  } else if (ctx && ctx.gameId) {
    cohorts = q.all("SELECT responses FROM game_plays WHERE game_id=? AND user_id<>? ORDER BY id DESC LIMIT 60", ctx.gameId, ctx.userId || 0)
      .map((o) => { try { return JSON.parse(o.responses).filter((r) => r && r.question != null).map((r) => String(r.answer == null ? "" : r.answer)); } catch { return null; } }).filter(Array.isArray);
  }
  for (const oa of cohorts) {
    answers.forEach((a, i) => {
      if (questions[i] && questions[i].type === "text" && String(a).trim().length > 15 && oa[i]) {
        maxSim = Math.max(maxSim, jaccard(a, oa[i]));
      }
    });
    if (JSON.stringify(oa) === JSON.stringify(answers)) dupOther++;
  }
  f.cohort_sim = maxSim > 0.8 ? 1 : 0;
  f.max_cohort_sim = maxSim;
  f.duplicate_other_users = dupOther >= 2 ? 1 : 0;
  if (dupOther >= 3) hard.push("duplicate-farm");

  /* environment / automation */
  f.webdriver = env.webdriver || env.headless ? 1 : 0;
  f.cdp = env.cdp ? 1 : 0;
  f.cdp_no_input = env.cdp && allFlights.length === 0 && (sess.pointer ? sess.pointer.samples : 0) < 5 ? 1 : 0;
  f.touch_mismatch = env.touchMismatch ? 1 : 0;
  f.plugins0 = env.plugins0 ? 1 : 0;

  /* focus / visibility / remote-control heuristics */
  f.tab_switches = sess.visSwitches || 0;
  f.tab_switch_rate = openIdx.length ? Math.min(1, (sess.visSwitches || 0) / openIdx.length) : 0;
  f.active_ratio = sess.wallMs > 0 ? Math.min(1, (sess.activeMs || 0) / sess.wallMs) : 1;
  f.input_while_blurred = sess.inputWhileBlurred ? 1 : 0;
  f.capture = env.capture ? 1 : 0; // consented page capture / display-media session active

  /* pointer physics */
  const ptr = sess.pointer || {};
  f.straightness = ptr.samples >= 10 ? ptr.straightness : HUMAN.straightness.mu;
  f.pointer_straight = ptr.samples >= 10 && ptr.straightness > 0.98 ? 1 : 0;
  f.pointer_regular = ptr.samples >= 10 && ptr.regularity > 0.9 ? 1 : 0;

  /* per-question paradata summary (shown beside each question for researchers) */
  questions.forEach((qq, i) => {
    const pq = qs[i] || {};
    const ms = Number(t[i]) || pq.t_ms || 0;
    const typingMs = (Array.isArray(pq.flights) ? pq.flights.reduce((a, b) => a + b, 0) : 0) + (Array.isArray(pq.dwells) ? pq.dwells.reduce((a, b) => a + b, 0) : 0);
    const chars = pq.chars || String(answers[i] || "").length;
    const wpm = typingMs > 1500 && chars > 0 ? Math.round((chars / 5) / (typingMs / 60000)) : null;
    perQuestion.push({
      i, q: qq.q, type: qq.type,
      time_s: +(ms / 1000).toFixed(1),
      first_input_s: pq.first_input_ms != null ? +(pq.first_input_ms / 1000).toFixed(1) : null,
      keys: pq.keys || 0, wpm,
      pastes: pq.pastes || 0, paste_words: pq.paste_words || 0, copies: pq.copies || 0,
      backspaces: pq.backspaces || 0, focus_loss: pq.focus_loss || 0,
      injected: pq.injected || 0,
      attention_correct: qq.meta && qq.meta.attention && qq.type === "opts"
        ? (() => { try { return JSON.parse(qq.options || "[]").indexOf(String(answers[i])) === qq.meta.correct; } catch { return null; } })()
        : null,
    });
  });

  return { f, hard, notes, perQuestion, totalMs, perQ };
}

/* ---- Layer 1 logistic model (priors grounded in the cited effect sizes) -- */
const WEIGHTS = [
  ["injection", 4.0], ["cdp_no_input", 3.5], ["paste_all_open", 3.0], ["paste_most_open", 1.6],
  ["copy_then_paste", 2.5], ["webdriver", 2.5], ["telemetry_missing", 2.0],
  ["time_z_lt3", 1.5], ["regular_cadence", 1.5], ["low_flight_entropy", 1.0],
  ["pointer_straight", 1.0], ["pointer_regular", 0.8], ["cohort_sim", 1.5], ["duplicate_other_users", 2.0],
  ["tab_switch_rate", 0.7], ["attention_fail", 1.5], ["gibberish", 1.5], ["long_no_edit", 0.7],
  ["llm_artifacts", 0.5], ["touch_mismatch", 0.7], ["plugins0", 0.4],
  ["input_while_blurred", 2.5], ["cdp", 0.8],
];
const INTERCEPT = -3.2;

function evaluate(answers, timings, paradata, questions, ctx = {}) {
  const { f, hard, perQuestion, totalMs, perQ } = extract(answers, timings, paradata, questions, ctx);
  let logit = INTERCEPT;
  const fired = [];
  for (const [name, w] of WEIGHTS) {
    const v = Number(f[name]) || 0;
    if (v > 0) { logit += w * Math.min(v, 1); if (v >= 1 || name === "tab_switch_rate") fired.push(name); }
  }
  if (f.active_ratio < 0.3 && totalMs > 8000) { logit += 0.7; fired.push("idle-gaps"); }

  /* Layer 2 anomaly: robust z vs human baseline, top-2 mean */
  const z = [
    Math.abs((perQ || HUMAN.perQuestionMs.mu) - HUMAN.perQuestionMs.mu) / HUMAN.perQuestionMs.sigma,
    Math.abs(f.flight_cv - HUMAN.flightCV.mu) / HUMAN.flightCV.sigma,
    Math.abs(f.straightness - HUMAN.straightness.mu) / HUMAN.straightness.sigma,
    Math.abs(f.paste_rate - HUMAN.pasteRate.mu) / HUMAN.pasteRate.sigma,
  ].sort((a, b) => b - a);
  const anomaly = Math.min(1, (z[0] + z[1]) / 2 / 3);
  if (anomaly > 0.83) logit += 0.6;

  /* Layer 3 account EWMA */
  let ewma = 0;
  if (ctx.userId) {
    const u = q.get("SELECT bot_ewma FROM users WHERE id=?", ctx.userId);
    ewma = u && u.bot_ewma != null ? u.bot_ewma : 0;
    if (ewma > 0.6) logit += 0.8;
  }

  let prob = sigmoid(logit);
  if (hard.length) prob = Math.max(prob, 0.92);
  prob = Math.min(0.99, Math.max(0.01, prob));

  const reasons = [];
  if (hard.length) reasons.push("bot");
  if (prob >= 0.8) reasons.push("bot");
  else if (prob >= 0.5) reasons.push("review");
  if (f.time_z_lt3 || (totalMs > 0 && perQ < 900)) reasons.push("speed");
  if (f.regular_cadence || f.low_flight_entropy || hard.includes("injection")) reasons.push("automation");
  if (f.attention_fail || f.gibberish) reasons.push("attention");
  if (f.cohort_sim || f.duplicate_other_users) reasons.push("consistency");
  if (f.paste_all_open || f.copy_then_paste) reasons.push("paste");

  const notes = [];
  notes.push(`Bot likelihood ${(prob * 100).toFixed(0)}% (logistic risk model + anomaly layer).`);
  if (hard.length) notes.push("Hard rule fired: " + hard.join(", ") + ".");
  if (f.paste_all_open) notes.push("Every open-ended answer arrived by paste (≥10 words) — the strongest external-tool signal.");
  else if (f.paste_most_open) notes.push("Most open-ended answers were pasted; review for external tool use.");
  if (f.copy_then_paste) notes.push("Question text was copied and external text pasted back — LLM round-trip pattern.");
  if (hard.includes("injection")) notes.push("Text appeared with zero keyboard events — agent/CDP injection signature.");
  if (f.regular_cadence) notes.push("Machine-regular answer cadence (CV < 0.1).");
  if (f.low_flight_entropy) notes.push("Keystroke flight times lack human variability.");
  if (f.pointer_straight) notes.push("Pointer paths are near-perfectly straight — synthetic movement.");
  if (f.attention_fail) notes.push("Comprehension gate failed (answer not from this study's abstract).");
  if (f.gibberish) notes.push("Keyboard-mash / gibberish text detected.");
  if (f.cohort_sim) notes.push(`Answer overlaps another respondent's (Jaccard ${f.max_cohort_sim.toFixed(2)}).`);
  if (f.tab_switch_rate >= 1) notes.push("Tab switches ≥ open-ended count — supporting signal only.");
  if (f.input_while_blurred) notes.push("Input events arrived while the window was unfocused — remote-control heuristic.");
  if (f.capture) notes.push("A page-initiated screen capture session was active during answering.");
  if (anomaly > 0.83) notes.push("Behavioral vector is anomalous against the human baseline.");
  if (!notes.length) notes.push("No anomalies.");

  const score = Math.round(100 * (1 - prob));
  const flagged = prob >= 0.5 || hard.length > 0;

  /* update account-level EWMA */
  if (ctx.userId) {
    const next = 0.7 * ewma + 0.3 * prob;
    q.run("UPDATE users SET bot_ewma=? WHERE id=?", next, ctx.userId);
  }
  return { score, flagged, reasons: [...new Set(reasons)], notes, bot_prob: +prob.toFixed(3), hard, features: f, per_question: perQuestion, anomaly: +anomaly.toFixed(2) };
}

/* ---- researcher-facing per-question analysis (aggregate view) ---------- */
function aggregateAnalysis(studyId) {
  const questions = q.all("SELECT * FROM questions WHERE study_id=? ORDER BY ord", studyId);
  const rows = q.all("SELECT answers, timings, paradata, flagged, bot_prob, quality_score FROM responses WHERE study_id=?", studyId);
  const parsed = rows.map((r) => {
    let answers = [], timings = [], pd = {};
    try { answers = JSON.parse(r.answers); } catch {}
    try { timings = JSON.parse(r.timings || "[]"); } catch {}
    try { pd = JSON.parse(r.paradata || "{}"); } catch {}
    return { answers, timings, qs: Array.isArray(pd.questions) ? pd.questions : [], flagged: r.flagged, bot_prob: r.bot_prob || 0 };
  });
  const n = parsed.length;
  const clean = parsed.filter((p) => !p.flagged); // distributions exclude held responses
  const perQuestion = questions.map((qq, i) => {
    let opts = [];
    try { opts = JSON.parse(qq.options || "[]"); } catch {}
    const times = clean.map((p) => Number(p.timings[i]) || (p.qs[i] && p.qs[i].t_ms) || 0).filter((x) => x > 0);
    const med = median(times);
    const firsts = clean.map((p) => p.qs[i] && p.qs[i].first_input_ms).filter((x) => x != null);
    const hesitant = firsts.filter((x) => x > 4000).length;
    const wpms = clean.map((p) => {
      const pq = p.qs[i];
      if (!pq) return null;
      const typingMs = (pq.flights || []).reduce((a, b) => a + b, 0) + (pq.dwells || []).reduce((a, b) => a + b, 0);
      const chars = pq.chars || String(p.answers[i] || "").length;
      return typingMs > 1500 && chars > 0 ? (chars / 5) / (typingMs / 60000) : null;
    }).filter((x) => x != null);
    const pasted = clean.filter((p) => p.qs[i] && (p.qs[i].pastes || 0) > 0).length;
    const focusLost = clean.filter((p) => p.qs[i] && (p.qs[i].focus_loss || 0) > 0).length;
    const dist = opts.map((o) => clean.filter((p) => String(p.answers[i]) === o).length);
    let correctRate = null;
    if (qq.meta && qq.meta.attention && opts.length) {
      const ok = clean.filter((p) => opts.indexOf(String(p.answers[i])) === qq.meta.correct).length;
      correctRate = clean.length ? ok / clean.length : null;
    }
    const lens = clean.map((p) => String(p.answers[i] || "").trim().split(/\s+/).filter(Boolean).length);
    const analysis = [];
    if (times.length) {
      analysis.push(`This question took a median of ${(med / 1000).toFixed(1)} s to complete (n=${times.length}).`);
      if (med > 20000) analysis.push("Long dwell suggests deliberation or difficulty — consider simplifying the wording.");
      else if (med < 3000) analysis.push("Very fast completions; check that respondents are reading the gate.");
    } else analysis.push("No timing telemetry yet for this question.");
    if (firsts.length && hesitant / firsts.length >= 0.3) analysis.push(`Many users hesitated here: ${Math.round(100 * hesitant / firsts.length)}% took over 4 s before their first input.`);
    if (wpms.length >= 2) {
      const w = Math.round(median(wpms));
      analysis.push(`Typing speed ${w >= 70 ? "rose to" : "averaged"} ${w} wpm here, indicating ${w >= 70 ? "high familiarity with the topic" : "measured, deliberate answering"}.`);
    }
    if (clean.length && pasted / clean.length >= 0.2) analysis.push(`${Math.round(100 * pasted / clean.length)}% of answers arrived by paste — review for external tool use.`);
    if (clean.length && focusLost / clean.length >= 0.3) analysis.push(`${Math.round(100 * focusLost / clean.length)}% of respondents left the tab on this question.`);
    if (correctRate != null) analysis.push(`Comprehension gate: ${Math.round(correctRate * 100)}% picked the finding from this study.`);
    if (qq.type === "text" && lens.length) analysis.push(`Open answers average ${Math.round(mean(lens))} words.`);
    return { i, q: qq.q, type: qq.type, options: opts, dist, median_s: +(med / 1000).toFixed(1), n: times.length, analysis };
  });
  const flagged = parsed.filter((p) => p.flagged).length;
  const meanBot = n ? mean(parsed.map((p) => p.bot_prob)) : 0;
  return {
    n, cleared: n - flagged, held: flagged,
    mean_bot_prob: +meanBot.toFixed(3),
    bot_high: parsed.filter((p) => p.bot_prob >= 0.8).length,
    per_question: perQuestion,
    pace: parsed.map((p) => p.timings.reduce((a, b) => a + (Number(b) || 0), 0)).filter((x) => x > 0),
  };
}

/* ---- game plays: same analysis depth as survey responses ----------------
   Story games record one event per beat; question beats (r.question != null)
   are the research answers. inputScenes = spec scenes with .input, in order. */
function gameQuestionBeats(responses) {
  return (Array.isArray(responses) ? responses : []).filter((r) => r && typeof r === "object" && r.question != null);
}
function gameQuestionsFromScenes(inputScenes) {
  return inputScenes.map((sc) => ({
    q: sc.input.question || "", type: sc.input.type === "choice" ? "opts" : "text",
    options: JSON.stringify(sc.input.options || []), meta: {},
  }));
}
/* per-question paradata summary for a single play (read-time, no side effects) */
function gamePerQuestion(beats, pd, questions) {
  const qs = Array.isArray(pd && pd.questions) ? pd.questions : [];
  return beats.map((r, i) => {
    const pq = qs[i] || r.pd || {};
    const ms = Number(r.ms) || pq.t_ms || 0;
    const typingMs = (Array.isArray(pq.flights) ? pq.flights.reduce((a, b) => a + b, 0) : 0) + (Array.isArray(pq.dwells) ? pq.dwells.reduce((a, b) => a + b, 0) : 0);
    const chars = pq.chars || String(r.answer == null ? "" : r.answer).length;
    const wpm = typingMs > 1500 && chars > 0 ? Math.round((chars / 5) / (typingMs / 60000)) : null;
    return {
      i, q: (questions[i] && questions[i].q) || r.question, type: (questions[i] && questions[i].type) || "text",
      time_s: +(ms / 1000).toFixed(1),
      first_input_s: pq.first_input_ms != null ? +(pq.first_input_ms / 1000).toFixed(1) : null,
      keys: pq.keys || 0, wpm,
      pastes: pq.pastes || 0, paste_words: pq.paste_words || 0, copies: pq.copies || 0,
      backspaces: pq.backspaces || 0, focus_loss: pq.focus_loss || 0, injected: pq.injected || 0,
      attention_correct: null, timed_out: !!r.timed_out,
    };
  });
}
/* researcher-facing aggregate over game_plays (mirrors aggregateAnalysis) */
function aggregateGameAnalysis(gameId, inputScenes) {
  const questions = gameQuestionsFromScenes(inputScenes);
  const rows = q.all("SELECT responses, timings, paradata, flagged, bot_prob, quality_score FROM game_plays WHERE game_id=?", gameId);
  const parsed = rows.map((r) => {
    let responses = [], pd = {};
    try { responses = JSON.parse(r.responses); } catch {}
    try { pd = JSON.parse(r.paradata || "{}"); } catch {}
    const beats = gameQuestionBeats(responses);
    return { beats, answers: beats.map((b) => String(b.answer == null ? "" : b.answer)), qs: Array.isArray(pd.questions) ? pd.questions : [], flagged: r.flagged, bot_prob: r.bot_prob || 0 };
  });
  const n = parsed.length;
  const clean = parsed.filter((p) => !p.flagged); // distributions exclude held plays
  const beatFor = (p, sc, i) => p.beats.find((b) => b.scene === sc.id) || p.beats[i];
  const perQuestion = inputScenes.map((sc, i) => {
    const opts = sc.input.type === "choice" ? (sc.input.options || []) : [];
    const times = clean.map((p) => { const b = beatFor(p, sc, i); return b ? Number(b.ms) || 0 : 0; }).filter((x) => x > 0);
    const med = median(times);
    const firsts = clean.map((p) => p.qs[i] && p.qs[i].first_input_ms).filter((x) => x != null);
    const hesitant = firsts.filter((x) => x > 4000).length;
    const wpms = clean.map((p) => {
      const pq = p.qs[i];
      if (!pq) return null;
      const typingMs = (pq.flights || []).reduce((a, b) => a + b, 0) + (pq.dwells || []).reduce((a, b) => a + b, 0);
      const chars = pq.chars || String(p.answers[i] || "").length;
      return typingMs > 1500 && chars > 0 ? (chars / 5) / (typingMs / 60000) : null;
    }).filter((x) => x != null);
    const pasted = clean.filter((p) => p.qs[i] && (p.qs[i].pastes || 0) > 0).length;
    const focusLost = clean.filter((p) => p.qs[i] && (p.qs[i].focus_loss || 0) > 0).length;
    const dist = opts.map((o) => clean.filter((p) => { const b = beatFor(p, sc, i); return b && String(b.answer) === o; }).length);
    const timedOut = clean.filter((p) => { const b = beatFor(p, sc, i); return b && b.timed_out; }).length;
    const lens = clean.map((p) => String(p.answers[i] || "").trim().split(/\s+/).filter(Boolean).length);
    const analysis = [];
    if (times.length) {
      analysis.push(`This decision took a median of ${(med / 1000).toFixed(1)} s (n=${times.length}).`);
      if (med > 20000) analysis.push("Long dwell suggests real deliberation — the scenario is landing as intended.");
      else if (med < 3000) analysis.push("Very fast decisions; check that players are reading the scene before choosing.");
    } else analysis.push("No timing telemetry yet for this decision.");
    if (firsts.length && hesitant / firsts.length >= 0.3) analysis.push(`Many players hesitated here: ${Math.round(100 * hesitant / firsts.length)}% took over 4 s before their first input.`);
    if (wpms.length >= 2) {
      const w = Math.round(median(wpms));
      analysis.push(`Typing speed ${w >= 70 ? "rose to" : "averaged"} ${w} wpm here, indicating ${w >= 70 ? "high familiarity with the topic" : "measured, deliberate answering"}.`);
    }
    if (clean.length && pasted / clean.length >= 0.2) analysis.push(`${Math.round(100 * pasted / clean.length)}% of answers arrived by paste — review for external tool use.`);
    if (clean.length && focusLost / clean.length >= 0.3) analysis.push(`${Math.round(100 * focusLost / clean.length)}% of players left the tab on this decision.`);
    if (clean.length && timedOut / clean.length >= 0.15) analysis.push(`${Math.round(100 * timedOut / clean.length)}% let the moment pass without deciding — the time pressure itself is a signal.`);
    if (sc.input.type !== "choice" && lens.length) analysis.push(`Open answers average ${Math.round(mean(lens))} words.`);
    return { i, q: sc.input.question || "", type: sc.input.type === "choice" ? "opts" : "text", options: opts, dist, median_s: +(med / 1000).toFixed(1), n: times.length, analysis };
  });
  const flagged = parsed.filter((p) => p.flagged).length;
  const meanBot = n ? mean(parsed.map((p) => p.bot_prob)) : 0;
  return {
    n, cleared: n - flagged, held: flagged,
    mean_bot_prob: +meanBot.toFixed(3),
    bot_high: parsed.filter((p) => p.bot_prob >= 0.8).length,
    per_question: perQuestion,
    pace: parsed.map((p) => p.beats.reduce((a, b) => a + (Number(b.ms) || 0), 0)).filter((x) => x > 0),
  };
}

module.exports = { evaluate, aggregateAnalysis, aggregateGameAnalysis, gameQuestionBeats, gameQuestionsFromScenes, gamePerQuestion, gibberish, jaccard };