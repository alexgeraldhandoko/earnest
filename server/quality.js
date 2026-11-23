/* EARNest · response-quality screen — now backed by the layered bot-detection
   model (paradata + answer analysis + anomaly + account history). Flagged
   responses are held for review, unpaid, and excluded from aggregates. */
"use strict";
const { q } = require("./db");
const botdetect = require("./botdetect");

function screen(studyId, userId, answers, timings, paradata) {
  const questions = q.all("SELECT * FROM questions WHERE study_id=? ORDER BY ord", studyId).map((qq) => {
    let meta = null;
    try { meta = qq.meta ? JSON.parse(qq.meta) : null; } catch {}
    return { ...qq, meta };
  });
  const r = botdetect.evaluate(answers, timings, paradata, questions, { studyId, userId });

  /* legacy consistency note: identical long text re-submitted by the same user */
  const prior = q.all("SELECT answers FROM responses WHERE user_id=? AND study_id=? AND flagged=0 ORDER BY id DESC LIMIT 3", userId, studyId);
  for (const p of prior) {
    let old = [];
    try { old = JSON.parse(p.answers); } catch { continue; }
    answers.forEach((a, i) => {
      if (questions[i] && questions[i].type === "text" && old[i] && String(a).trim().length > 12 &&
        String(old[i]).trim().toLowerCase() === String(a).trim().toLowerCase()) {
        if (!r.reasons.includes("consistency")) r.reasons.push("consistency");
        r.notes.push("Answer repeats an earlier submission verbatim.");
        r.score = Math.max(0, r.score - 20);
      }
    });
  }
  r.flagged = r.flagged || r.score < 60;
  return r;
}
module.exports = { screen };