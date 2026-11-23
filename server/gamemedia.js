/* EARNest · game research media. Every game is a research instrument and ships
   with the same front-of-house a paid study has: an intro film, a topic chip and
   a duration. Films are the bundled public-domain NASA/CC clips (same pool the
   core studies use), matched to the researcher's context by keyword so the
   footage reads as the study's b-roll. Deterministic: the same game always gets
   the same film, on every device and every boot. */
"use strict";

const CLIPS = [
  { key: "citylights", video: "videos/citylights.mp4", credit: "Earth at night: lights of human activity · NASA GSFC, public domain", chip: "Energy",
    words: ["energy", "electricity", "power", "sleep", "tired", "fatigue", "habit", "home", "household", "budget", "money", "spend", "meal", "food", "heat", "heatwave", "warm", "city", "balcony", "plant", "garden"] },
  { key: "cupola", video: "videos/cupola.mp4", credit: "Seeing our home in a whole new light · NASA, public domain", chip: "Attention",
    words: ["focus", "attention", "distraction", "phone", "scroll", "screen", "memory", "notice", "observe", "scrutiny", "detect", "fake", "misinformation", "review"] },
  { key: "coralreef", video: "videos/coralreef.mp4", credit: "Reciprocity in coral reef fishes · CC BY 4.0, PLOS ONE", chip: "Ecosystem",
    words: ["reef", "ocean", "sea", "fish", "animal", "ecosystem", "nature", "cooperat", "recipro", "feeding", "environment"] },
  { key: "antarctic", video: "videos/antarctic.mp4", credit: "Operation IceBridge: across the Ross · NASA GSFC, public domain", chip: "Climate",
    words: ["climate", "ice", "polar", "warming", "planet", "earth", "sustainab", "carbon", "weather", "wellbeing", "stress", "mood"] },
  { key: "dna", video: "videos/dna.mp4", credit: "Astronaut Kate Rubins advances DNA sequencing in space · NASA JSC, public domain", chip: "Health",
    words: ["health", "medical", "dna", "gene", "body", "diagnos", "lab", "trust", "vaccine", "care", "sleep quality"] },
  { key: "isstour", video: "videos/isstour.mp4", credit: "Astronauts share a tour of Boeing's Starliner · NASA JSC, public domain", chip: "Social",
    words: ["crew", "team", "social", "friend", "belong", "lonely", "community", "peer", "group", "fair", "fairness", "blame", "jury", "judge", "moral", "school", "smok", "student", "bystander", "intervene", "witness", "metro", "station", "commute", "harass"] },
  { key: "roman", video: "videos/roman.mp4", credit: "Nancy Grace Roman Space Telescope mission trailer · NASA, public domain", chip: "Space",
    words: ["space", "sky", "orbit", "telescope", "star", "moon", "mars", "astronom", "satellite"] },
  { key: "sts134", video: "videos/sts134.mp4", credit: "KSC-11-S-00026, Space Shuttle processing · NASA KSC, public domain", chip: "Decisions",
    words: ["risk", "pressure", "decision", "time", "urgency", "launch", "safety", "disaster", "choice", "trade-off", "tradeoff", "hesitat"] },
  { key: "solar", video: "videos/solar.mp4", credit: "U.S. Spacewalk 74 animation · NASA JSC, public domain", chip: "Effort",
    words: ["work", "effort", "task", "goal", "build", "upgrade", "exercise", "practice", "skill", "attention capture", "office", "deadline", "colleague", "workplace", "overtime", "boss"] },
  { key: "artemis", video: "videos/artemis.mp4", credit: "Artemis I launch rollout · NASA KSC, public domain", chip: "Future",
    words: ["future", "mission", "journey", "explore", "ambition", "story", "narrative", "identity", "aspiration"] },
];

const KIND_DEFAULT = { story: "artemis" };
const KIND_MINUTES = { story: 4 };

/* Pick the film whose topic words best match the research context; fall back to
   the kind's default film, then a stable hash so nothing is ever left blank. */
function assign(kind, context) {
  const text = String(context || "").toLowerCase();
  let best = null, bestScore = 0;
  for (const c of CLIPS) {
    let s = 0;
    /* word-start boundaries: "fish" must not match inside "selfishness" */
    for (const w of c.words) if (new RegExp("\\b" + w).test(text)) s += 1;
    if (s > bestScore) { best = c; bestScore = s; }
  }
  if (!best) best = CLIPS.find((c) => c.key === KIND_DEFAULT[kind]) || CLIPS[0];
  return { video: best.video, credit: best.credit, chip: best.chip, minutes: KIND_MINUTES[kind] || 3 };
}

/* Headlines: a game is presented like a paid study — the card title is the
   hook that makes people want to take part, never the instrument's internal
   name. Library games carry curated headlines; generated games carry the
   AI-written spec.headline; anything else falls back to the kind's hook. */
const HEADLINES = {
  "g-mv-01": "A new school, a pack behind the gym. What do you do to belong?",
  "g-mv-02": "Nine witnesses, one platform. Are you the one who steps in?",
  "g-mv-03": "'Not mandatory mandatory.' What does your evening actually cost?",
};
const KIND_HOOK = {
  story: "Live the story — your choices become the evidence.",
};
function headlineFor(g) {
  if (g && g.headline) return String(g.headline).slice(0, 120);
  if (g && HEADLINES[g.id]) return HEADLINES[g.id];
  const spec = g && g.spec;
  const hook = spec && (spec.headline || (spec.study && spec.study.hook));
  if (hook) return String(hook).slice(0, 120);
  return KIND_HOOK[g && g.kind] || "Play a real study. Your choices are the data.";
}

module.exports = { assign, headlineFor, CLIPS };