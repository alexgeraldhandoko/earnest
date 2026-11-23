#!/usr/bin/env node
/* EARNest · QwenWork credit bridge — worker helper for the cron agent.
   The agent does the creative work (writing the game JSON with its own model,
   on organiser credits); this script only does deterministic file bookkeeping.

   Usage:
     node server/bridge-worker.js list                 # print pending jobs (JSON array)
     node server/bridge-worker.js peek <id>            # print one pending job
     node server/bridge-worker.js ack <id>             # archive a job after writing done/<id>.json
     node server/bridge-worker.js fail <id> <message>  # mark a job failed and archive it

   Result contract: the agent writes data/bridge/done/<id>.json containing
   {"content": "<the full assistant reply, e.g. the game JSON string>", "model": "<model id>"}.
*/
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..", "data", "bridge");
const p = (dir, id) => path.join(ROOT, dir, id + ".json");
function ensure() { for (const d of ["pending", "done", "failed", "processed"]) fs.mkdirSync(path.join(ROOT, d), { recursive: true }); }
function read(dir, id) { return JSON.parse(fs.readFileSync(p(dir, id), "utf8")); }
function archive(id) {
  ensure();
  const src = p("pending", id);
  if (fs.existsSync(src)) fs.renameSync(src, p("processed", id));
}
const [cmd, id, ...rest] = process.argv.slice(2);
ensure();
if (cmd === "list") {
  const ids = fs.readdirSync(path.join(ROOT, "pending")).filter((f) => f.endsWith(".json")).sort();
  const jobs = ids.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "pending", f), "utf8")); } catch { return null; } }).filter(Boolean);
  console.log(JSON.stringify(jobs, null, 2));
} else if (cmd === "peek") {
  if (!id) { console.error("usage: peek <id>"); process.exit(1); }
  console.log(JSON.stringify(read("pending", id), null, 2));
} else if (cmd === "ack") {
  if (!id) { console.error("usage: ack <id>"); process.exit(1); }
  if (!fs.existsSync(p("done", id))) { console.error("No done/" + id + ".json yet — write the result file first."); process.exit(1); }
  archive(id);
  console.log("acked " + id);
} else if (cmd === "fail") {
  if (!id) { console.error("usage: fail <id> <message>"); process.exit(1); }
  fs.writeFileSync(p("failed", id), JSON.stringify({ id, error: rest.join(" ") || "agent could not complete the job", failed_at: new Date().toISOString() }));
  archive(id);
  console.log("failed " + id);
} else {
  console.error("unknown command: " + cmd);
  process.exit(1);
}