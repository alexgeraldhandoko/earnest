/* EARNest · QwenWork credit bridge (Earnest side).
   Lets game generation / webscrape run on the organiser's QwenWork credits
   instead of a paid API key. Earnest drops a chat-completions request into a
   local file queue; a QwenWork cron agent (which IS a QwenWork session running
   on organiser credits) picks it up, writes the reply with its own model, and
   drops the result back. Earnest polls for the result. No external API key,
   no published secrets — everything stays inside the project folder. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(require("./db").DATA_DIR, "bridge");
const DIRS = ["pending", "done", "failed", "processed"];
function ensureDirs() { for (const d of DIRS) fs.mkdirSync(path.join(ROOT, d), { recursive: true }); }
const file = (dir, id) => path.join(ROOT, dir, id + ".json");
function writeJson(dir, id, obj) {
  ensureDirs();
  const tmp = file(dir, id) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file(dir, id));
}
function readJson(dir, id) {
  try { return JSON.parse(fs.readFileSync(file(dir, id), "utf8")); } catch { return null; }
}

/* Submit a chat-completions request; returns a job id. */
function submit(messages, { json = true } = {}) {
  const id = "j-" + crypto.randomBytes(6).toString("hex");
  writeJson("pending", id, { id, messages, json, created_at: new Date().toISOString() });
  return id;
}

/* Poll until the agent writes a result (or fails / times out). */
async function poll(id, timeoutMs = 200000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const done = readJson("done", id);
    if (done && typeof done.content === "string" && done.content.length)
      return { content: done.content, model: done.model || "qwenwork-agent" };
    const failed = readJson("failed", id);
    if (failed) throw new Error("QwenWork agent could not complete the request: " + (failed.error || "unknown error"));
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("The QwenWork agent did not respond in time. Make sure the game-worker scheduled task is enabled and this computer is online, then try again.");
}

/* One bridge "chat completion": submit + poll. Mirrors llm.chat()'s return shape. */
async function chat(messages, opts = {}) {
  const id = submit(messages, opts);
  return poll(id, opts.timeoutMs || 200000);
}

module.exports = { submit, poll, chat, ROOT };