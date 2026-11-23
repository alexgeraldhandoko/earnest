/* EARNest · seed content — the prototype's core studies/reels/demo history plus
   the real-world corpus: 300 researchers, 500 paid studies and 500 discovery
   posts fetched from Crossref, arXiv, Hacker News and NASA (scripts/fetch-seed.mjs).
   Idempotent: legacy core seeds once; the corpus tops up any existing database
   with INSERT OR IGNORE, never overwriting user data. */
"use strict";
const { q, tx } = require("./db");
const { hashPassword, verifyPassword } = require("./auth-util");
const fs = require("node:fs");
const path = require("node:path");

function loadSeedData(name) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "seed-data", name), "utf8")); }
  catch { return []; }
}

/* Idempotent legacy core: every insert is OR IGNORE or dedup-guarded, so this
   runs on EVERY boot and tops up anything a partial Supabase hydration lost
   (a cold start that hydrates mid-flush can miss whole tables). Never
   overwrites live user data. */
function seedLegacy() {
  const hasResp = (sid, uid) => q.get("SELECT 1 x FROM responses WHERE study_id=? AND user_id=?", sid, uid);
  tx(() => {
    const researchers = [
      ["wang-ming", "Wang Ming", "Researcher at Rethink", "WM", "photos/wang-ming.jpg", "Since June 2026", ""],
      ["christina-ang", "Christina Ang", "Researcher at Singtel", "CA", "photos/christina-ang.jpg", "Since May 2026", "avatar-lav"],
      ["matthew-jones", "Matthew Jones", "Researcher at NUS", "MJ", "photos/matthew-jones.jpg", "Since April 2026", "avatar-earn"],
    ];
    for (const r of researchers) q.run("INSERT OR IGNORE INTO researchers (id,name,org,initials,photo,since,avatar_class) VALUES (?,?,?,?,?,?,?)", ...r);
    const awards = [
      ["wang-ming", "medal", "2026 Research Award"],
      ["wang-ming", "trophy", "2025 Professor Award"],
      ["christina-ang", "medal", "2025 Impact Study Award"],
    ];
    for (const [rid, icon, text] of awards)
      if (!q.get("SELECT 1 x FROM awards WHERE researcher_id=? AND text=?", rid, text))
        q.run("INSERT INTO awards (researcher_id,icon,text) VALUES (?,?,?)", rid, icon, text);

    const papers = [
      ["p-elec", "wang-ming", "City Electricity Consumption, January 2026", "Wang Ming, Ben Miller, Zhang et al.", 0, "We analyse household electricity draw across 6,000 dwellings over one cooling season, pairing smart-meter traces with the daily habits respondents reported through EARNest studies. Peak behaviour clusters around two windows; modest tariff nudges shifted one of them by nearly an hour."],
      ["p-animal", "wang-ming", "Animal Feeding & Ecosystem, 2025", "Wang Ming et al.", 0, "A field survey of feeding grounds and the surrounding ecosystem, documenting how seasonal feed availability reshapes local population movement."],
      ["p-youth", "christina-ang", "Social Media & Youth Attention, 2026", "Christina Ang et al.", 0, "Short-form feeds and sustained attention in 16 to 24 year olds, measured with in-feed tasks rather than lab sessions."],
      ["p-war", "matthew-jones", "Psychological Effect of War, 2026", "Matthew Jones et al.", 0, "Exposure to war coverage and reported anxiety, sleep and trust, across three national samples."],
      ["p-launch", null, "Crewed launch operations in the shuttle's final flights, 2011", "KSC engineering directorate", 0, "A procedural record of the final Space Shuttle launches: processing flows, weather holds, and the crew routines documented by the Kennedy Space Center teams."],
      ["p-solar", null, "Upgrading the station's solar wings, Spacewalk 74", "Flight operations team", 0, "Planning analysis for the iROSA array installation: suit mobility limits, torque budgets and the timeline that let two crew members finish a six-hour task in four."],
      ["p-artemis", null, "Rolling a Moon rocket: crawler transport logistics", "Exploration ground systems", 0, "How a fully stacked launch vehicle crosses four miles of crawlerway: load paths, sway limits, and the overnight decisions that set launch day."],
    ];
    for (const p of papers) q.run("INSERT OR IGNORE INTO papers (id,researcher_id,title,authors,price_cents,abstract) VALUES (?,?,?,?,?,?)", ...p);

    const studies = [
      ["s-elec", "wang-ming", 50, 3, "earn", "videos/citylights.mp4", "Earth at night: lights of human activity · NASA GSFC, public domain", "Energy", "How do households actually save electricity?", "A 90-second intro from the researcher, then three questions. Your answers feed a live city study.", 1],
      ["s-youth", "christina-ang", 45, 4, "attention", "videos/cupola.mp4", "Seeing our home in a whole new light · NASA, public domain", "Attention", "What does your feed do to your focus?", "Christina studies attention in 16 to 24 year olds with in-feed tasks instead of lab sessions.", 1],
      ["s-war", "matthew-jones", 60, 5, "study", "videos/antarctic.mp4", "Operation IceBridge: across the Ross · NASA GSFC, public domain", "Wellbeing", "War coverage, sleep and trust: three samples", "A wellbeing study measuring how exposure to war coverage tracks with sleep quality and trust in outlets.", 1],
      ["s-space", "wang-ming", 55, 3, "study", "videos/roman.mp4", "Nancy Grace Roman Space Telescope mission trailer · NASA, public domain", "Space", "Who should the sky belong to?", "Public attitudes to orbital infrastructure and telescope funding, run with the astronomy faculty.", 1],
      ["s-vax", "christina-ang", 65, 4, "earn", "videos/isstour.mp4", "Astronauts share a tour of Boeing's Starliner · NASA JSC, public domain", "Crew health", "Do you trust what a lab result means?", "A crew-health study filmed where astronauts live and work: how people read diagnostics, and what makes a health message land.", 1],
      ["s-animal", "wang-ming", 35, 3, "study", "videos/coralreef.mp4", "Reciprocity in coral reef fishes · CC BY 4.0, PLOS ONE", "Ecosystem", "Animal Feeding & Ecosystem", "A field survey of feeding grounds and the surrounding ecosystem.", 0],
    ];
    for (const s of studies) q.run("INSERT OR IGNORE INTO studies (id,researcher_id,reward_cents,minutes,genre,video,credit,chip,title,sub,active) VALUES (?,?,?,?,?,?,?,?,?,?,?)", ...s);

    const questions = {
      "s-elec": [
        ["What should the study cite you as?", "text", "Name or initials", null],
        ["If you had one spare hour of power a day, what would you run?", "text", "Anything, one line", null],
        ["What runs in your home after dark?", "opts", null, ["Fans and lamps only", "Air-con on a timer", "Everything stays on", "I barely think about it"]],
      ],
      "s-youth": [
        ["How many feeds did you open before this one today?", "opts", null, ["None, you are first", "1 to 3", "4 to 9", "I stopped counting"]],
        ["When did you last finish a long article?", "text", "Be honest, no judgment", null],
        ["Would you swap one feed for paid studies like this?", "opts", null, ["Yes", "Maybe, at the right price", "No"]],
      ],
      "s-war": [
        ["How often do you watch war coverage?", "opts", null, ["Daily", "Weekly", "Rarely", "Never"]],
        ["Has coverage changed your sleep this year?", "text", "One sentence is enough", null],
        ["Do you trust the outlets you watch most?", "opts", null, ["Yes", "Some of them", "Not really"]],
      ],
      "s-space": [
        ["Have you ever looked up on purpose?", "opts", null, ["Most nights", "Sometimes", "Only for events", "Never"]],
        ["What would make you care about a telescope budget?", "text", "One honest line", null],
        ["Should night sky be protected like parks?", "opts", null, ["Yes", "In some places", "No"]],
      ],
      "s-vax": [
        ["When did you last have a lab test?", "opts", null, ["This month", "This year", "Longer ago", "Never"]],
        ["Who explains your results best?", "text", "Doctor, app, nobody…", null],
        ["Would a plain-language report change your trust?", "opts", null, ["A lot", "Somewhat", "Not really"]],
      ],
      "s-animal": [
        ["How often do you visit feeding grounds?", "opts", null, ["Weekly", "Monthly", "Rarely", "Never"]],
        ["What changes with the seasons?", "text", "One line", null],
        ["Should feeding be managed?", "opts", null, ["Yes", "In some places", "No"]],
      ],
    };
    for (const [sid, qs] of Object.entries(questions)) {
      if (q.get("SELECT COUNT(*) n FROM questions WHERE study_id=?", sid).n > 0) continue;
      qs.forEach((qq, i) => q.run("INSERT INTO questions (study_id,ord,q,type,placeholder,options) VALUES (?,?,?,?,?,?)", sid, i, qq[0], qq[1], qq[2], qq[3] ? JSON.stringify(qq[3]) : null));
    }

    const discoveries = [
      ["n-dna", "study", "videos/dna.mp4", "Astronaut Kate Rubins advances DNA sequencing in space · NASA JSC, public domain", "Finding", "Gene-targeted measures open new possibilities", "A 2026 care-research breakthrough. Answers from this feed fed the sampling pool for the trial.", 10700, 489, 370, "AI digest · publication you contributed to", "p-youth"],
      ["n-reef", "attention", "videos/coralreef.mp4", "Reciprocity in coral reef fishes · CC BY 4.0, PLOS ONE", "Field study", "Reef fish keep score, and it holds the reef together", "Direct reciprocity filmed on a working reef: pairs that cooperated yesterday cooperate again today.", 3400, 152, 89, "New from the marine biology feed", "p-animal"],
      ["n-launch", "study", "videos/sts134.mp4", "KSC-11-S-00026, Space Shuttle processing · NASA KSC, public domain", "Archive", "Endeavour's last flight: what launch day taught us", "Crewed launch operations, documented frame by frame by the teams that ran the final shuttle flights.", 8900, 410, 205, "From the operations archive", "p-launch"],
      ["n-walk", "earn", "videos/solar.mp4", "U.S. Spacewalk 74 animation · NASA JSC, public domain", "Milestone", "Upgrading the station's solar wings", "Spacewalk 74 installs new array wings; the animation runs from the crew's own flight plan.", 12100, 640, 288, "Author update · flight operations", "p-solar"],
      ["n-rollout", "earn", "videos/artemis.mp4", "Artemis I launch rollout · NASA KSC, public domain", "Milestone", "Rolling a Moon rocket to the pad", "Artemis I leaves the vehicle assembly building on the crawler: the slowest, most watched ride in Florida.", 15200, 733, 341, "Live from Kennedy Space Center", "p-artemis"],
    ];
    for (const d of discoveries) q.run("INSERT OR IGNORE INTO discoveries (id,genre,video,credit,chip,title,sub,hearts,reposts,comments,ai,paper_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", ...d);

    const impacts = [
      ["Nov 15, 2026", "star", 0, "Research X: medicine prototype", "Has helped to produce a prototype for medicine. 412 respondents contributed answers through the feed.", "p-youth"],
      ["Nov 11, 2026", "sprout", 1, "Research Y: city power", "Has helped households across Singapore reduce evening electricity use, per the published findings.", "p-elec"],
      ["Nov 9, 2026", "star", 0, "Research Z: wellbeing coverage", "Documented how war coverage tracks with sleep quality; respondents received the author update in-feed.", "p-war"],
    ];
    for (const [date, icon, grow, title, text, pid] of impacts)
      if (!q.get("SELECT 1 x FROM impact_items WHERE title=?", title))
        q.run("INSERT INTO impact_items (date,icon,grow,title,text,paper_id) VALUES (?,?,?,?,?,?)", date, icon, grow, title, text, pid);

    q.run("INSERT OR IGNORE INTO researcher_surveys (id,researcher_id,title,month) VALUES ('m-elec','wang-ming','Electricity Usage Patterns','Nov 2026')");
    q.run("INSERT OR IGNORE INTO researcher_surveys (id,researcher_id,title,month) VALUES ('m-youth','wang-ming','Social Media & Youth','Nov 2026')");
    q.run("INSERT OR IGNORE INTO researcher_surveys (id,researcher_id,title,month) VALUES ('m-war','wang-ming','Psychological Effect of War','Jul 2026')");

    /* demo respondent: Gerald, with the prototype's history */
    const demo = hashPassword("demo1234");
    q.run("INSERT OR IGNORE INTO users (name,email,password_hash,salt,photo,initials,interests,answer_windows,streak_day,last_active_date,wallet_cents) VALUES ('Gerald','demo@earnest.app',?,?,?,?, 'energy, attention, wellbeing','commute, lunch',6,date('now','-1 day'),11350)", demo.hash, demo.salt, "photos/gerald.jpg", "G");
    const gerald = q.get("SELECT id FROM users WHERE email='demo@earnest.app'").id;
    q.run("INSERT OR IGNORE INTO settings (user_id) VALUES (?)", gerald);
    q.run("INSERT OR IGNORE INTO follows (user_id,researcher_id) VALUES (?,'wang-ming')", gerald);
    if (q.get("SELECT COUNT(*) n FROM wallet_ledger WHERE user_id=?", gerald).n === 0) {
      const ledger = [
        [45, "study", "Social Media & Youth · answered"],
        [60, "study", "Psychological Effect of War · answered"],
        [35, "study", "Animal Feeding & Ecosystem · answered"],
        [10950, "grant", "Opening balance from earlier studies"],
      ];
      for (const [c, k, n] of ledger) q.run("INSERT INTO wallet_ledger (user_id,delta_cents,kind,note) VALUES (?,?,?,?)", gerald, c, k, n);
    }
    if (!hasResp("s-youth", gerald)) q.run("INSERT INTO responses (study_id,user_id,answers,notes,reward_cents,created_at) VALUES ('s-youth',?,?,?,45,'2026-11-12 09:14:00')", gerald, JSON.stringify(["4 to 9", "Last Sunday, on the train.", "Maybe, at the right price"]), "[]");
    if (!hasResp("s-war", gerald)) q.run("INSERT INTO responses (study_id,user_id,answers,notes,reward_cents,created_at) VALUES ('s-war',?,?,?,60,'2026-11-09 18:02:00')", gerald, JSON.stringify(["Weekly", "Not noticeably.", "Some of them"]), "[]");
    if (!hasResp("s-animal", gerald)) q.run("INSERT INTO responses (study_id,user_id,answers,notes,reward_cents,created_at) VALUES ('s-animal',?,?,?,35,'2026-11-04 12:40:00')", gerald, JSON.stringify(["Monthly", "Birds move to the estuary.", "In some places"]), "[]");

    /* seeded respondents for the researcher dashboard */
    const mkUser = (name, email, photo, initials) => {
      q.run("INSERT OR IGNORE INTO users (name,email,photo,initials) VALUES (?,?,?,?)", name, email, photo, initials);
      return q.get("SELECT id FROM users WHERE email=?", email).id;
    };
    const anna = mkUser("Anna Wong", "anna@example.org", "photos/anna-wong.jpg", "AW");
    const bryan = mkUser("Bryan Whitman", "bryan@example.org", "photos/bryan-whitman.jpg", "BW");
    const li = mkUser("Li Wen", "li@example.org", "photos/li-wen.jpg", "LW");
    if (!hasResp("s-elec", anna)) q.run(`INSERT INTO responses (study_id,user_id,answers,timings,notes,quality_score,flagged,flag_reasons,reward_cents,created_at)
      VALUES ('s-elec',?,?,?, ?,96,0,'[]',50,'2026-11-14 20:11:00')`, anna,
      JSON.stringify(["Anna W.", "A second washing machine run after 11pm.", "Air-con on a timer"]),
      JSON.stringify([18000, 21000, 9000]),
      JSON.stringify(["This gate took 18 s to complete, in line with the median.", "Consistent with her earlier energy answers.", "Typing speed rose to 90 wpm here, indicating high familiarity with the topic."]));
    if (!hasResp("s-elec", bryan)) q.run(`INSERT INTO responses (study_id,user_id,answers,timings,notes,quality_score,flagged,flag_reasons,reward_cents,created_at)
      VALUES ('s-elec',?,?,?, ?,22,1,?,0,'2026-11-12 03:47:00')`, bryan,
      JSON.stringify(["bw", "n/a", "Everything stays on"]),
      JSON.stringify([1100, 900, 1400]),
      JSON.stringify(["Completed in 4 s, well under the human median.", "Answer conflicts with his Oct submission.", "Interaction pattern matches the automated-response profile; held for review."]),
      JSON.stringify(["speed", "consistency", "automation"]));
    const seedComments = [
      ["n-dna", anna, "The in-feed tasks made this so much easier to answer than a lab survey.", "2026-11-16 10:02:00"],
      ["n-dna", li, "Glad my answers fed the sampling pool. More studies like this please.", "2026-11-16 14:40:00"],
      ["n-reef", bryan, "Filmed on a working reef, not a tank. You can tell.", "2026-11-15 09:12:00"],
      ["n-launch", anna, "Watched the whole processing sequence twice. The weather hold part is wild.", "2026-11-14 21:05:00"],
      ["n-walk", li, "Four hours instead of six because of the torque planning. Incredible.", "2026-11-13 18:30:00"],
      ["n-rollout", bryan, "The slowest, most watched ride in Florida. Accurate.", "2026-11-12 07:55:00"],
    ];
    for (const [item, uid, text, when] of seedComments)
      if (!q.get("SELECT 1 x FROM comments WHERE item_id=? AND user_id=? AND text=?", item, uid, text))
        q.run("INSERT INTO comments (item_id,user_id,text,created_at) VALUES (?,?,?,?)", item, uid, text, when);
    if (!hasResp("s-youth", li)) q.run(`INSERT INTO responses (study_id,user_id,answers,timings,notes,quality_score,flagged,flag_reasons,reward_cents,created_at)
      VALUES ('s-youth',?,?,?, ?,98,0,'[]',45,'2026-11-10 08:26:00')`, li,
      JSON.stringify(["4 to 9", "Last Sunday, on the train.", "Maybe"]),
      JSON.stringify([12000, 16000, 8000]),
      JSON.stringify(["Steady reading pace across gates.", "Matches earlier attention answers.", "No anomalies."]));

    q.run("UPDATE studies SET published_at='2026-11-18T09:00:00Z', created_at='2026-11-18 09:00:00', verified=1 WHERE published_at IS NULL");
    q.run("UPDATE discoveries SET published_at='2026-11-18T09:00:00Z', verified=1 WHERE published_at IS NULL");
  });
}

/* corpus top-up — safe on existing databases */
function topUpCorpus() {
  const researchers = loadSeedData("researchers.json");
  const studies = loadSeedData("studies.json");
  const discoveries = loadSeedData("discoveries.json");
  if (!researchers.length && !studies.length && !discoveries.length) return;
  tx(() => {
    for (const r of researchers) {
      q.run("INSERT OR IGNORE INTO researchers (id,name,org,initials,photo,since,avatar_class) VALUES (?,?,?,?,NULL,?,?)",
        r.id, r.name, r.org, r.initials, "Since " + String(r.since || "2025").slice(0, 7), r.avatar_class || "");
      for (const p of r.papers || []) {
        q.run("INSERT OR IGNORE INTO papers (id,researcher_id,title,authors,price_cents,abstract,url,published_at) VALUES (?,?,?,?,0,?,?,?)",
          p.id, r.id, p.title, p.authors, p.abstract, p.url, p.published_at);
      }
    }
    for (const s of studies) {
      const video = s.media && s.media.video ? s.media.video : null;
      const image = s.media && s.media.image ? s.media.image : null;
      const host = (() => { try { return new URL(s.source_url).hostname.replace(/^www\./, ""); } catch { return "verified research"; } })();
      const r = q.run(`INSERT OR IGNORE INTO studies (id,researcher_id,reward_cents,minutes,genre,video,image,credit,chip,title,sub,active,source_url,authors,abstract,verified,published_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
        s.id, s.researcher_id, s.reward_cents, s.minutes, s.genre, video, image,
        `${s.authors} · ${host} · open access`, "Study", s.title, s.sub, 1, s.source_url, s.authors, s.abstract, s.verified ? 1 : 0, s.published_at || null);
      if (r.changes) {
        (s.questions || []).forEach((qq, i) => q.run("INSERT INTO questions (study_id,ord,q,type,placeholder,options,meta) VALUES (?,?,?,?,?,?,?)",
          s.id, i, qq.q, qq.type, qq.placeholder || null, qq.options ? JSON.stringify(qq.options) : null, qq.meta ? JSON.stringify(qq.meta) : null));
        q.run("INSERT OR IGNORE INTO researcher_surveys (id,researcher_id,title,month) VALUES (?,?,?,?)", s.id, s.researcher_id, s.title,
          new Date(s.published_at || Date.now()).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }));
      }
    }
    for (const d of discoveries) {
      const video = d.media_kind === "video" ? d.media_url : null;
      const image = d.media_kind === "image" ? d.media_url : null;
      q.run(`INSERT OR IGNORE INTO discoveries (id,genre,video,image,credit,chip,title,sub,hearts,reposts,comments,ai,paper_id,researcher_id,source_url,media_kind,author,verified,published_at,tags,summary)
        VALUES (?,?,?,?,?,?,?,?,0,0,0,?,NULL,NULL,?,?,?,?,?,?,?)`,
        d.id, d.kind === "news" ? "study" : d.kind, video, image,
        `${d.author || d.source_name} · ${d.source_name}`, d.source_name.split(" · ")[0].slice(0, 24),
        d.title, d.summary, `Curated from ${d.source_name}`, d.url, d.media_kind, d.author, d.verified ? 1 : 0,
        d.published_at, JSON.stringify(d.tags || []), d.summary);
    }
    q.run("UPDATE studies SET published_at='2026-11-18T09:00:00Z', created_at='2026-11-18 09:00:00', verified=1 WHERE published_at IS NULL");
    q.run("UPDATE discoveries SET published_at='2026-11-18T09:00:00Z', verified=1 WHERE published_at IS NULL AND source_url IS NULL");
  });
}

function seedGames() {
  /* The story-game library ships as server/seed-data/cloud-games.json and is
     applied by gamesync.sync() after hydration — nothing to seed here. */
}

/* score legacy demo responses with the bot model so the researcher view is meaningful */
function backfillBotScores() {
  const rows = q.all("SELECT id, study_id, user_id, answers, timings FROM responses WHERE bot_prob=0 AND (paradata IS NULL OR paradata='{}')");
  if (!rows.length) return;
  const botdetect = require("./botdetect");
  for (const r of rows) {
    const questions = q.all("SELECT * FROM questions WHERE study_id=? ORDER BY ord", r.study_id).map((qq) => {
      let meta = null; try { meta = qq.meta ? JSON.parse(qq.meta) : null; } catch {}
      return { ...qq, meta };
    });
    let answers = [], timings = [];
    try { answers = JSON.parse(r.answers); } catch {}
    try { timings = JSON.parse(r.timings || "[]"); } catch {}
    const ev = botdetect.evaluate(answers, timings, {}, questions, { studyId: r.study_id, userId: r.user_id });
    q.run("UPDATE responses SET bot_prob=?, paradata=? WHERE id=?", ev.bot_prob, JSON.stringify({ analysis: ev.per_question }), r.id);
  }
}

/* researcher headshots — idempotent backfill so existing databases (incl. the
   cloud DB, which is never re-seeded) pick up the current profile photos.
   Force-updates mapped ids: direct local DB edits bypass the Supabase mirror,
   so the cloud rows may still hold stale/empty photo values. */
function backfillResearcherPhotos() {
  const map = loadSeedData("researcher-photos.json");
  if (!map || typeof map !== "object") return;
  /* ensure every directory profile exists (cloud DB may predate newer researchers) */
  const dir = loadSeedData("researcher-directory.json");
  if (Array.isArray(dir)) {
    for (const r of dir) {
      q.run("INSERT OR IGNORE INTO researchers (id,name,org,initials,photo,since,avatar_class) VALUES (?,?,?,?,NULL,'Since 2025','')",
        r.id, r.name, r.org, r.initials || "R");
    }
  }
  let n = 0;
  for (const [id, photo] of Object.entries(map)) {
    n += q.run("UPDATE researchers SET photo=? WHERE id=? AND (photo IS NULL OR photo<>?)", photo, id, photo).changes;
  }
  if (n) console.log(`backfilled ${n} researcher photos`);
  /* user-owned researcher profiles (u-<id>) inherit the account avatar */
  const un = q.run(`UPDATE researchers SET photo=(SELECT u.photo FROM users u WHERE 'u-'||u.id=researchers.id)
    WHERE id LIKE 'u-%' AND (photo IS NULL OR photo='')
    AND EXISTS (SELECT 1 FROM users u WHERE 'u-'||u.id=researchers.id AND u.photo IS NOT NULL AND u.photo<>'')`).changes;
  if (un) console.log(`synced ${un} user researcher avatars`);
}

/* Founder Cockpit admin — runs on EVERY boot, after Supabase hydration.
   Guarantees admin@earnest.app exists with a working password and role='admin',
   and keeps the founder's Google account admin too. Override the password with
   the ADMIN_PASSWORD env var; the default is documented in DEPLOY.md. */
function ensureAdmin() {
  const email = "admin@earnest.app";
  const password = process.env.ADMIN_PASSWORD || "EarnestAdmin#2026";
  const u = q.get("SELECT * FROM users WHERE email=?", email);
  if (!u) {
    const { hash, salt } = hashPassword(password);
    const r = q.run("INSERT INTO users (name,email,password_hash,salt,initials,role) VALUES ('Founder',?,?,?, 'F','admin')", email, hash, salt);
    q.run("INSERT OR IGNORE INTO settings (user_id) VALUES (?)", r.lastInsertRowid);
    console.log("admin seeded: admin@earnest.app");
  } else {
    if (u.role !== "admin") q.run("UPDATE users SET role='admin' WHERE id=?", u.id);
    /* self-heal: if the stored password doesn't match the known admin password
       (e.g. an old row with an unknown password), reset it so login always works */
    if (!verifyPassword(password, u.password_hash, u.salt)) {
      const { hash, salt } = hashPassword(password);
      q.run("UPDATE users SET password_hash=?, salt=? WHERE id=?", hash, salt, u.id);
      console.log("admin password reset: admin@earnest.app");
    }
  }
  /* founder's Google sign-in account is a cockpit admin as well */
  q.run("UPDATE users SET role='admin' WHERE email='alexandergerald923@gmail.com' AND role<>'admin'");
}

function seed() {
  seedLegacy(); // idempotent — tops up legacy core rows lost to partial hydration
  ensureAdmin();
  topUpCorpus();
  backfillResearcherPhotos();
  seedGames();
  backfillBotScores();
  const counts = {
    researchers: q.get("SELECT COUNT(*) n FROM researchers").n,
    studies: q.get("SELECT COUNT(*) n FROM studies").n,
    discoveries: q.get("SELECT COUNT(*) n FROM discoveries").n,
  };
  console.log(`seeded earnest.db — ${counts.researchers} researchers, ${counts.studies} studies, ${counts.discoveries} discovery posts`);
}
module.exports = { seed };