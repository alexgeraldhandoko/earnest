/* EARNest · impact layer — every impact is derived from a real paid study:
   its documented finding (paper abstract or study goal), its wired video
   (poster frame), its researcher, and the actual participant responses in
   the database. No placeholder impacts. Curated explanations are grounded
   in each study's abstract and questions; response data is always live.
   sync() runs at boot (after seed + cloud-video map) and rebuilds the table
   whenever it is stale, so local and cloud converge on the same content. */
"use strict";
const { q } = require("./db");

const CONTENT_VERSION = 4;

/* Poster frames extracted from each study's wired video (public/impact/). */
const POSTER = {
  "s-elec": "impact/s-elec.jpg",
  "s-youth": "impact/s-youth.jpg",
  "s-war": "impact/s-war.jpg",
  "s-space": "impact/s-space.jpg",
  "s-animal": "impact/s-animal.jpg",
};

/* Curated per-study content. Every claim traces to the study's abstract,
   its questions, or the responses actually collected. `questions` entries
   align by index with the study's questions in the DB. */
const CONTENT = {
  "s-elec": {
    icon: "bolt",
    headline: "We moved a city's evening power peak by nearly an hour — thanks to you",
    description: "Your after-dark habits, paired with smart-meter traces from 6,000 homes, revealed exactly when demand peaks. A modest tariff nudge then shifted one of those peaks by almost an hour.",
    story: {
      findingPlain: "Evening power use doesn't rise smoothly — it spikes in two sharp peaks. We matched your habit reports against smart-meter data from 6,000 homes, then nudged tariffs at the busy hour. One peak moved by nearly an hour. The lever was habits, not new technology.",
      howUsed: "The two-peak map showed the utility which window could shift. You'd named the loads you were happy to move — a second washing-machine run after 11pm — so the tariff nudge targeted flexible demand, not anyone's comfort. Modest nudge, nearly an hour of shift.",
      impactChain: [
        { title: "Your answers profiled every home", text: "What runs after dark, and what you'd happily shift, sorted homes into evening-load profiles: timer air-con, always-on homes, and flexible late loads." },
        { title: "Profiles met the meter traces", text: "Matched with meter traces from 6,000 homes, the profiles explained both evening peaks — which appliances drive each, and which demand can move." },
        { title: "The nudge targeted the shiftable peak", text: "The nudge aimed at the window full of flexible loads — the ones you said you'd move. No comfort sacrifice, just a better price for running things later." },
        { title: "The peak moved — the grid breathes easier", text: "One evening peak shifted by nearly an hour. Demand at the grid's most strained hour now spreads more evenly — the result documented in the paper." },
      ],
      questions: [
        { measure: "How you want to be credited — never part of the analysis.", link: "It records the name the study may cite. Your data stays yours; only the credit line is public." },
        { measure: "The load you'd run with a spare hour of power — your flexible demand.", link: "Answers like \u201cA second washing machine run after 11pm\u201d named the appliances households will actually shift — the demand a tariff nudge can move without costing anyone comfort." },
        { measure: "Your home's evening baseline — what runs after dark.", link: "\u201cAir-con on a timer\u201d versus \u201cEverything stays on\u201d sorts each home into a load profile. Against the meter traces, that revealed which evening peak is made of schedulable demand — the one that could move." },
      ],
    },
  },
  "s-youth": {
    icon: "pulse",
    headline: "We took attention research out of the lab and into the feed — thanks to you",
    description: "Your in-feed answers captured real switching habits in the moment — how many feeds you'd opened, when you last finished a long read — replacing lab sessions for 16-to-24-year-olds.",
    story: {
      findingPlain: "We measured sustained attention in 16-to-24-year-olds inside the feed itself — no lab. Your own answers, like how many feeds you'd opened today and when you last finished a long read, became the attention data, captured in the moment rather than recalled under lab lights.",
      howUsed: "Collecting in-feed meant measuring attention where it actually lives. Your switching counts and long-read anchors became the baseline for how short-form feeds relate to focus at this age — and the swap answers showed people would trade feed time for paid studies at the right price.",
      impactChain: [
        { title: "You answered inside the feed", text: "No lab visit, no recall bias — your switching count and long-read anchor were recorded in the moment, inside the feed you were already using." },
        { title: "In-the-moment answers became the measure", text: "Across respondents, those counts and anchors formed a real baseline of feed-switching and sustained attention for 16-to-24-year-olds — the data the paper documents." },
        { title: "The method itself is the breakthrough", text: "The published study shows attention can be measured validly in-feed. No more pulling young respondents into a lab to study how feeds shape focus." },
        { title: "Feeds can carry research, not just ads", text: "You said you'd swap a feed for paid studies at the right price. That willingness is the foundation for research that lives inside any feed." },
      ],
      questions: [
        { measure: "Your real feed-switching frequency, counted in the moment.", link: "\u201c4 to 9\u201d before this feed measures how fragmented your session already is. Pooled across respondents, these counts are the switching baseline the study reports." },
        { measure: "Your attention anchor: the last long thing you finished.", link: "\u201cLast Sunday, on the train\u201d anchors focus in a real moment. Paired with your switching count, it shows long-form attention survives alongside heavy switching." },
        { measure: "Whether you'd trade feed time for paid, purposeful tasks.", link: "\u201cMaybe, at the right price\u201d is the evidence behind the bigger claim: feeds can carry research people actually want, not just ads." },
      ],
    },
  },
  "s-war": {
    icon: "shield",
    headline: "War coverage's link to sleep and trust is now documented across three countries — thanks to you",
    description: "Your coverage habits, sleep reports and trust ratings joined three national samples, letting researchers track how war exposure travels with wellbeing — without a single lab visit.",
    story: {
      findingPlain: "How often people watch war coverage tracks with how they sleep and which outlets they trust. We paired your exposure frequency, sleep reports and trust ratings across three national samples — the pattern is now documented, not assumed.",
      howUsed: "The exposure–sleep–trust map gives wellbeing researchers a baseline instead of a guess: heavy viewers with disrupted sleep stand apart from light viewers, and trust ratings show which audiences are most sceptical. Published open access, the findings went back to respondents first, as an author update in the feed.",
      impactChain: [
        { title: "Three answers, one paired record", text: "Your coverage frequency, sleep sentence and trust rating were recorded together — one person, one record, so exposure links to wellbeing instead of being guessed at." },
        { title: "Records pooled across three countries", text: "The same three questions ran in three countries. Pooling the records let us compare where the coverage–sleep–trust pattern holds and where it differs." },
        { title: "The pattern became a published finding", text: "The association is now an open-access finding anyone can read — not an assumption about 'doomscrolling'." },
        { title: "Support can be targeted, not blanket", text: "Wellbeing and media-literacy work can aim at the groups the data flags — heavy viewers with disrupted sleep, low-trust audiences. Respondents got the author update in-feed." },
      ],
      questions: [
        { measure: "Your exposure dose: how often war coverage reaches you.", link: "\u201cWeekly\u201d places you on the exposure scale. Without a frequency there's no dose to link to sleep or trust — the anchor the whole pattern hangs on." },
        { measure: "Your sleep this year, in your own words.", link: "\u201cNot noticeably.\u201d is a real data point: this exposure level coexists with stable sleep. Across respondents, these sentences separate disrupted sleepers from unaffected ones." },
        { measure: "Which outlets you trust — the media-trust strand.", link: "\u201cSome of them\u201d records selective trust. Paired with exposure and sleep, it shows whether heavy coverage erodes trust broadly or only in specific audiences." },
      ],
    },
  },
  "s-space": {
    icon: "globe",
    headline: "Dark-sky protection now has public evidence behind it — thanks to you",
    description: "Your answers — why the night sky matters and whether it should be protected like parks — became documented public-attitude evidence for the telescope funding debate.",
    story: {
      findingPlain: "The first responses are in, and they point one way: protect the night sky like parks. Dark skies are exactly why people care about telescope budgets. Public-attitude evidence, collected in-feed, now backs the case for dark-sky protection.",
      howUsed: "The astronomy faculty runs this study to bring public attitudes into telescope-funding and orbital-infrastructure decisions. Answers like \u201cProtect dark skies for everyone\u201d turn a numbers-only debate into a public mandate — and \u201cyes, like parks\u201d gives it a concrete policy shape.",
      impactChain: [
        { title: "You named what the sky is worth", text: "\u201cProtect dark skies for everyone\u201d is a reason, not just a preference — it says what telescope funding should protect, in your words." },
        { title: "Reasons joined positions", text: "Paired with \u201cyes, like parks\u201d and your stargazing habit, it becomes a documented attitude record: who cares, why, and what they want done." },
        { title: "The faculty carries the evidence", text: "Run with the astronomy faculty, the study feeds these records into the funding conversation — public attitudes on the table, not just engineering costs." },
        { title: "Dark-sky protection gains its mandate", text: "As records accumulate, \u201cprotect it like parks\u201d stops being one opinion and becomes documented public backing for dark-sky policy." },
      ],
      questions: [
        { measure: "How often you look up on purpose.", link: "\u201cSometimes\u201d places you among casual stargazers, not astronomers — proof these attitudes come from the general public, whose mandate a funding debate needs." },
        { measure: "What would make you care about a telescope budget.", link: "\u201cProtect dark skies for everyone.\u201d names the value funding should serve — a public purpose the faculty can cite." },
        { measure: "Should the night sky be protected like parks?", link: "\u201cYes\u201d is the policy position itself. Aggregated, these answers become the documented public backing for treating dark skies as protected commons." },
      ],
    },
  },
  "s-animal": {
    icon: "sprout",
    headline: "We mapped how seasonal feeding moves whole populations — thanks to you",
    description: "Your seasonal observations — like birds moving to the estuary — joined the field survey, showing how feed availability reshapes where animals go, and where management actually helps.",
    story: {
      findingPlain: "When seasonal feed moves, animals move with it. The field survey documented populations shifting with feed availability, and your own observations matched the pattern. You also told us feeding should be managed in some places, not all — targeted rules, not blanket bans.",
      howUsed: "The movement map shows managers where feeding pressure lands each season, so effort goes to the sites that actually receive the shifted populations. Your \u201cin some places\u201d answers back exactly that: targeted management, other grounds left alone.",
      impactChain: [
        { title: "Your eyes extended the survey", text: "\u201cBirds move to the estuary.\u201d is the seasonal shift seen from the ground — the same movement the survey documents, from a different angle." },
        { title: "Observations corroborated the map", text: "Matched against the survey, your observations confirmed where populations go when feed changes — a movement map with independent witnesses." },
        { title: "The map aims management", text: "Knowing where animals concentrate tells managers which grounds need attention — the estuary when the birds arrive, not every site all year." },
        { title: "Targeted rules, public backing", text: "You said manage feeding \u201cin some places\u201d — public backing for the site-specific approach the map enables. Protection lands where the shift actually lands." },
      ],
      questions: [
        { measure: "How often you're on the ground at feeding grounds.", link: "\u201cMonthly\u201d means your observations come from repeated visits, not a one-off glance — regular witnesses make the corroboration reliable." },
        { measure: "What you've seen change with the seasons.", link: "\u201cBirds move to the estuary.\u201d directly corroborates the survey: feed availability reshapes where populations go. Each observation is an independent data point." },
        { measure: "Manage feeding everywhere, or in some places?", link: "\u201cIn some places\u201d is the mandate for site-specific management — protect the grounds that receive the shift, leave others alone. It matches what the map says is needed." },
      ],
    },
  },
};

const STUDY_IDS = Object.keys(CONTENT);

function fmtDate(s) {
  const d = new Date(String(s).replace(" ", "T") + (String(s).includes("T") ? "" : "Z"));
  if (isNaN(d)) return "2026";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/* Rebuild impact_items from the studies that exist, with live response dates. */
function rebuild() {
  const rows = [];
  for (const sid of STUDY_IDS) {
    const s = q.get("SELECT * FROM studies WHERE id=?", sid);
    if (!s || !s.video) continue;
    const c = CONTENT[sid];
    const pid = "p-" + sid.slice(2);
    const paperId = q.get("SELECT id FROM papers WHERE id=?", pid) ? pid : null;
    const last = q.get("SELECT created_at FROM responses WHERE study_id=? AND flagged=0 ORDER BY created_at DESC LIMIT 1", sid);
    const date = last ? fmtDate(last.created_at) : fmtDate(s.published_at || "2026-11-01");
    rows.push({ sid, s, c, paperId, date });
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  q.run("DELETE FROM impact_items");
  /* stable explicit ids (1..N) — autoincrement ids drift on every rebuild,
     which breaks clients holding a previously served list */
  rows.forEach((r, i) => {
    q.run(
      `INSERT INTO impact_items (id,date,icon,grow,title,text,paper_id,study_id,headline,description,poster,story,version)
       VALUES (?,?,?,0,?,?,?,?,?,?,?,?,?)`,
      i + 1, r.date, r.c.icon, r.c.headline, r.c.description, r.paperId, r.sid, r.c.headline, r.c.description, POSTER[r.sid], JSON.stringify(r.c.story), CONTENT_VERSION
    );
  });
  console.log(`impacts: rebuilt ${rows.length} study-derived impacts (v${CONTENT_VERSION})`);
}

/* Boot-time convergence: rebuild when placeholders or stale versions exist. */
function sync() {
  const expected = STUDY_IDS.filter((sid) => { const s = q.get("SELECT video FROM studies WHERE id=?", sid); return s && s.video; }).length;
  const total = q.get("SELECT COUNT(*) n FROM impact_items").n;
  const fresh = q.get("SELECT COUNT(*) n FROM impact_items WHERE version=?", CONTENT_VERSION).n;
  if (total !== expected || fresh !== expected) rebuild();
}

function researcherOf(rid) {
  const r = q.get("SELECT id,name,org,initials,photo,since,avatar_class FROM researchers WHERE id=?", rid);
  return r || null;
}

/* Compact list for /api/bootstrap. */
function listPayload(userId) {
  return q.all("SELECT * FROM impact_items ORDER BY id").map((it) => {
    const s = q.get("SELECT id,title,chip,video,researcher_id FROM studies WHERE id=?", it.study_id);
    const paper = it.paper_id ? q.get("SELECT id,title FROM papers WHERE id=?", it.paper_id) : null;
    const answers = q.get("SELECT COUNT(*) n FROM responses WHERE study_id=? AND flagged=0", it.study_id).n;
    const yours = userId ? q.get("SELECT COUNT(*) n FROM responses WHERE study_id=? AND user_id=? AND flagged=0", it.study_id, userId).n : 0;
    return {
      id: it.id, study: it.study_id, paper: it.paper_id,
      headline: it.headline || it.title, description: it.description || it.text,
      poster: it.poster, date: it.date, icon: it.icon,
      chip: s ? s.chip : "", studyTitle: s ? s.title : "",
      paperTitle: paper ? paper.title : null,
      researcher: researcherOf(s ? s.researcher_id : null),
      answers, yours: !!yours,
    };
  });
}

function displayName(name) {
  const parts = String(name || "Participant").trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

/* Full finding page: curated explanation + the actual responses, live.
   Accepts the stable study id (s-war) or a legacy numeric row id. */
function detail(id, userId) {
  let it = /^\d+$/.test(String(id)) ? q.get("SELECT * FROM impact_items WHERE id=?", id) : null;
  if (!it) it = q.get("SELECT * FROM impact_items WHERE study_id=?", id);
  if (!it || !it.study_id) return null;
  const s = q.get("SELECT * FROM studies WHERE id=?", it.study_id);
  if (!s) return null;
  const c = CONTENT[it.study_id];
  const paper = it.paper_id ? q.get("SELECT id,title,authors,abstract,url,published_at FROM papers WHERE id=?", it.paper_id) : null;
  const questions = q.all("SELECT q,type,options,ord FROM questions WHERE study_id=? ORDER BY ord", it.study_id)
    .map((x) => ({ q: x.q, type: x.type, options: x.options ? JSON.parse(x.options) : null }));
  const rows = q.all("SELECT r.*, u.name FROM responses r JOIN users u ON u.id=r.user_id WHERE r.study_id=? AND r.flagged=0 ORDER BY r.created_at DESC", it.study_id);
  const held = q.get("SELECT COUNT(*) n FROM responses WHERE study_id=? AND flagged=1", it.study_id).n;
  const responses = rows.map((r) => {
    let answers = []; try { answers = JSON.parse(r.answers); } catch {}
    return { name: displayName(r.name), you: r.user_id === userId, date: fmtDate(r.created_at), quality: r.quality_score, answers };
  });
  /* per-question live aggregates: distribution for opts, quotes for text */
  const qBlocks = questions.map((qq, i) => {
    const meta = (c.story.questions && c.story.questions[i]) || { measure: "", link: "" };
    const vals = responses.map((r) => r.answers[i]).filter((v) => v != null && String(v).trim() !== "");
    let dist = null;
    if (qq.type === "opts" && qq.options) {
      dist = qq.options.map((o) => ({ label: o, n: vals.filter((v) => v === o).length })).filter((d) => d.n > 0);
    }
    return { ...qq, measure: meta.measure, link: meta.link, dist, quotes: qq.type === "text" ? responses.map((r) => ({ name: r.name, you: r.you, text: r.answers[i] })).filter((x) => x.text && String(x.text).trim()) : [] };
  });
  return {
    id: it.id, headline: it.headline || it.title, description: it.description || it.text,
    poster: it.poster, date: it.date, icon: it.icon,
    study: { id: s.id, title: s.title, sub: s.sub, chip: s.chip, video: s.video, reward: s.reward_cents / 100, minutes: s.minutes },
    paper, researcher: researcherOf(s.researcher_id),
    story: c.story, questions: qBlocks, responses, held,
    stats: { verified: responses.length, held },
  };
}

module.exports = { sync, rebuild, listPayload, detail, CONTENT_VERSION };