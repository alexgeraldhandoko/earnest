/* EARNest · story-game generation. OpenAI-compatible chat completions client:
   defaults to OpenRouter (cheapest Qwen tier, free-model fallback), works with
   Alibaba DashScope or any compatible endpoint via config only.
   There is ONE game kind: the story game — a Monument-Valley-style isometric
   world set in modern-day Earth. The player taps the ground to walk, taps
   characters to talk, and answers the researcher's questions in conversation.
   Games are generated fresh from the researcher's natural-language brief; the
   spec carries the world (setting + time of day), the cast and the script. The
   engine renders everything procedurally — no image assets are required. */
"use strict";
const config = require("./config");

const DEFAULT_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "qwen/qwen3.7-flash";
const DEFAULT_FALLBACK = "openrouter/free";

function llmCfg() {
  return {
    key: config.get("llm_api_key"),
    base: (config.get("llm_base_url") || DEFAULT_BASE).replace(/\/+$/, ""),
    model: config.get("llm_model") || DEFAULT_MODEL,
    fallback: config.get("llm_fallback_model") || DEFAULT_FALLBACK,
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* one HTTP attempt; errors carry retryable / useFallback flags for the loop below */
async function request(base, key, model, messages, json, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.8, ...(json ? { response_format: { type: "json_object" } } : {}) }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw Object.assign(new Error(e.name === "AbortError" ? "The AI provider took too long to reply. Try again." : "Could not reach the AI endpoint: " + e.message), { retryable: true });
  }
  clearTimeout(timer);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    const detail = t.slice(0, 180);
    if (res.status === 401 || res.status === 403)
      throw Object.assign(new Error(`The AI provider rejected the API key (${res.status}). Check the key in Settings → AI game generation. ${detail}`), {});
    if (res.status === 402)
      throw Object.assign(new Error(`The AI provider account has no credit left (402). Top up or configure a fallback model. ${detail}`), { useFallback: true });
    if (res.status === 404)
      throw Object.assign(new Error(`Model not found at the provider (404): ${model}. Check the model id in Settings. ${detail}`), { useFallback: true });
    if (res.status === 429)
      throw Object.assign(new Error(`The AI provider is rate-limiting requests (429). ${detail}`), { retryable: true, useFallback: true });
    if (res.status >= 500)
      throw Object.assign(new Error(`The AI provider had a server error (${res.status}). ${detail}`), { retryable: true });
    throw Object.assign(new Error(`AI provider error ${res.status}: ${detail}`), {});
  }
  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw Object.assign(new Error("The AI provider returned an empty reply."), { retryable: true });
  return { content, model: data.model || model };
}

async function chat(messages, { json = true, timeoutMs = 120000 } = {}) {
  const { key, base, model, fallback } = llmCfg();
  if (!key) throw Object.assign(new Error("Connect an AI provider in Settings → AI game generation to generate games."), { status: 400 });
  const models = [model];
  if (fallback && fallback !== model) models.push(fallback);
  let lastErr = null;
  for (const m of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await request(base, key, m, messages, json, timeoutMs);
      } catch (e) {
        lastErr = e;
        if (e.retryable && attempt < 2) { await sleep(1000 * Math.pow(3, attempt)); continue; }
        if (e.useFallback) break; // move on to the fallback model
        throw e;                 // fatal (bad key, bad request…) — surface immediately
      }
    }
  }
  throw lastErr;
}
function extractJson(text) {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  if (start > 0) t = t.slice(start);
  return JSON.parse(t);
}

/* ---------- schema: the story game (the only kind) ---------- */
const SETTINGS = ["school", "metro", "office", "courtyard", "rooftop", "street", "house", "park"];
const SCHEMAS = {
  story: `{
  "kind": "story",
  "title": "short evocative game name, max 60 chars",
  "headline": "one persuasive sentence, max 90 chars, that makes people want to play — a question or bold claim about the research, like a study reel headline; never the game's name",
  "premise": "1-2 sentence setup shown to the player",
  "study": { "construct": "what this measures, a few words", "context": "the research behind the game, 1-2 sentences", "why": "how the player's answers help, 1 sentence" },
  "world": {
    "setting": "school|metro|office|courtyard|rooftop|street|house|park — pick the ONE that best matches the researcher's setting (school covers any school/college/university; metro covers train/bus stations; office covers any workplace; courtyard covers apartment compounds and community gardens; house covers homes/indoor domestic scenes; street covers markets and neighbourhood streets; park covers outdoor public space)",
    "time": "day|dusk|night",
    "mood": "2-3 words describing the atmosphere, e.g. warm golden, quiet blue, tense amber"
  },
  "characters": [{
    "id": "c1", "name": "character name", "role": "who they are", "personality": "2-4 words",
    "look": "one sentence: clothes + colours + hair, e.g. teal hoodie, black jeans, short curly hair",
    "colors": { "robe": "#7fd4c1", "accent": "#f2a08c" },
    "expressions": ["neutral", "happy", "thinking", "surprised", "worried"],
    "tap": { "lines": ["2-3 short in-character reactions when the player taps them after their story is done, max 80 chars each"] }
  }],
  "scenes": [{
    "id": "s1", "character": "c1",
    "text": "what the character says, max 160 chars",
    "expression": "neutral",
    "input": null
  }],
  "closing": "final message after every conversation is done, 1-2 sentences, in the world's voice"
}
Rules:
- The game is a Monument-Valley-style isometric diorama set in modern-day Earth: pastel impossible-geometry architecture, a small robed player who walks where the player taps, and characters who wander the world. The player taps a character to open a conversation; that character's scenes play in order as one continuous dialogue. Write dialogue that sounds like a real person with the stated personality — vivid, grounded, a little playful — never survey text. Max 160 chars per line.
- The scenario must be a sensible, plausible slice of daily life that a real researcher could study (e.g. peer pressure to smoke as a new student at school, bystander intervention on a metro platform, after-hours work pressure in an office). Characters act like real people in that situation, not quiz hosts.
- 1 to 3 characters. EVERY character must carry at least 2 scenes. Spread the scenes so each conversation has a beginning, a middle and an end; the most important character gets the most scenes.
- 10 to 16 scenes total. 4 to 6 scenes carry an "input"; the rest are pure dialogue (input: null) that advances the story.
- "input" is either {"type":"choice","question","options":[2-4 strings]} or {"type":"text","question","placeholder"}. Add twists: at least ONE timed choice ("timeLimitMs": 8000-20000 on the input) and at least ONE free-text answer. Timed questions should feel like pressure inside the story, not a quiz.
- Questions must collect the genuine opinions/decisions the researcher asked for — never trivia, never right/wrong answers.
- "expression" must be one of that character's "expressions"; switch expressions as the mood of the conversation changes.
- "colors" are pastel hex values for the character's robe and accent (hat/trim). Keep them soft and Monument-Valley-like; each character visually distinct.
- Every character gets a "tap" reaction set for after their conversation is finished.
- The story always completes — there is no winning branch, only the player's branch.`,
};

function validateSpec(spec) {
  if (!spec || typeof spec !== "object") return "The AI reply was not a game object.";
  if (spec.kind !== "story") return "Unknown game kind — Earnest games are story games.";
  if (!spec.title || String(spec.title).length < 4) return "Game needs a title.";
  if (!spec.world || !SETTINGS.includes(spec.world.setting)) return `Game needs a world.setting — one of: ${SETTINGS.join(", ")}.`;
  if (spec.world.time && !["day", "dusk", "night"].includes(spec.world.time)) return "world.time must be day, dusk or night.";
  if (!Array.isArray(spec.characters) || !spec.characters.length || spec.characters.length > 3) return "Story needs 1 to 3 characters.";
  const ids = new Set();
  for (const c of spec.characters) {
    if (!c.id || !c.name) return "Every character needs an id and a name.";
    if (ids.has(c.id)) return `Duplicate character id ${c.id}.`;
    ids.add(c.id);
    if (!Array.isArray(c.expressions) || c.expressions.length < 2) return `Character ${c.name} needs at least 2 expressions.`;
    if (c.tap && (!Array.isArray(c.tap.lines) || !c.tap.lines.length)) return `Character ${c.name}'s tap reactions need lines.`;
  }
  if (!Array.isArray(spec.scenes) || spec.scenes.length < 8 || spec.scenes.length > 24) return "Story needs 8 to 24 scenes.";
  const perChar = new Map();
  let inputs = 0, timed = 0, text = 0;
  for (const sc of spec.scenes) {
    if (!ids.has(sc.character)) return `Scene references unknown character ${sc.character}.`;
    perChar.set(sc.character, (perChar.get(sc.character) || 0) + 1);
    if (!sc.text || String(sc.text).length > 220) return "Every scene needs a short line of dialogue (max ~160 chars).";
    if (sc.input) {
      inputs += 1;
      const inp = sc.input;
      if (!inp.question) return "Every question needs question text.";
      if (inp.type === "choice") {
        if (!Array.isArray(inp.options) || inp.options.length < 2 || inp.options.length > 4) return "Choice questions need 2 to 4 options.";
      } else if (inp.type === "text") { text += 1; }
      else return "Question type must be choice or text.";
      if (inp.timeLimitMs != null) {
        const t = Number(inp.timeLimitMs);
        if (!Number.isFinite(t) || t < 5000 || t > 30000) return "timeLimitMs must be between 5000 and 30000.";
        timed += 1;
      }
    }
  }
  for (const c of spec.characters) if ((perChar.get(c.id) || 0) < 2) return `Character ${c.name} needs at least 2 scenes of dialogue.`;
  if (inputs < 3) return "Story needs at least 3 questions.";
  if (!text) return "Story needs at least one free-text question.";
  if (!timed) return "Story needs at least one timed question.";
  return null;
}

const SYSTEM = `You are the game designer for EARNest, a gamified research platform. Earnest has ONE game format: the story game — a Monument-Valley-style isometric diorama set in modern-day Earth (school, metro station, office, courtyard, rooftop, street, house or park). A small robed player walks wherever the respondent taps; pastel-robed characters wander the world; tapping a character opens a conversation where the researcher's questions are asked in-story. Researchers describe, in natural language, the study, the setting, the story, the characters, what each character says and what they ask. You output ONLY valid JSON matching the requested schema exactly. Scenarios must be sensible, plausible daily-life situations that genuinely serve the research — like real life, never absurd. Questions must gather genuine opinions, decisions or knowledge, never pointless filler. The engine draws the world procedurally from world.setting + world.time, so do NOT invent image assets, backgrounds or sprite files. Write in a natural, engaging voice. No markdown, no commentary, just the JSON object.`;

/* Shared prompt builder — used by the direct API path AND handed to the
   QwenWork-credit agent worker so both produce identical game specs. */
function buildPrompt(kind, answers) {
  if (kind !== "story") throw Object.assign(new Error("Earnest games are story games — unknown template."), { status: 400 });
  const brief = Object.entries(answers || {}).filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `- ${k}: ${String(v).slice(0, 4000)}`).join("\n");
  if (!brief) throw Object.assign(new Error("Describe your story game first."), { status: 400 });
  return { system: SYSTEM, user: `Game kind: story\n\nResearcher's brief:\n${brief}\n\nOutput JSON schema:\n${SCHEMAS.story}`, schema: SCHEMAS.story };
}

async function generateGame(kind, answers) {
  const { system, user: userMsg } = buildPrompt(kind, answers);
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = [
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ];
    if (lastErr) messages.push({ role: "user", content: `Your previous reply was invalid: ${lastErr}. Output corrected JSON only, same schema.` });
    const { content } = await chat(messages);
    let spec;
    try { spec = extractJson(content); } catch (e) { lastErr = "not parseable JSON"; continue; }
    spec.kind = "story";
    const err = validateSpec(spec);
    if (!err) return spec;
    lastErr = err;
  }
  throw new Error("Qwen could not produce a valid story game after two tries (" + lastErr + "). Adjust the brief and try again.");
}
async function testConnection() {
  const { content, model } = await chat([{ role: "user", content: "Reply with exactly: OK" }], { json: false, timeoutMs: 30000 });
  return { model, sample: content.trim().slice(0, 40) };
}
module.exports = { generateGame, validateSpec, testConnection, llmCfg, chat, extractJson, buildPrompt, SCHEMAS, SYSTEM, SETTINGS };