/* EARNest · JSON API */
"use strict";
const { q, tx } = require("./db");
const auth = require("./auth");
const config = require("./config");
const email = require("./email");
const payments = require("./payments");
const { screen } = require("./quality");
const llm = require("./llm");
const storage = require("./storage");
const scrape = require("./scrape");
const pipeline = require("./pipeline");
const agentqueue = require("./agentqueue");
const recommend = require("./recommend");
const reader = require("./reader");
const impacts = require("./impacts");
const botdetect = require("./botdetect");
const gamemedia = require("./gamemedia");
const gameart = require("./gameart");
const { TOPICS, GOALS, FORMATS, WINDOWS } = require("./topics");

const SURVEY_STUDY = { "m-elec": "s-elec", "m-youth": "s-youth", "m-war": "s-war" };
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const UPLOAD_DIR = path.join(require("./db").DATA_DIR, "uploads");
function studyIdFor(surveyId) {
  if (SURVEY_STUDY[surveyId]) return SURVEY_STUDY[surveyId];
  return q.get("SELECT id FROM studies WHERE id=?", surveyId) ? surveyId : null;
}
function ensureUserResearcher(u) {
  const id = "u-" + u.id;
  if (!q.get("SELECT id FROM researchers WHERE id=?", id)) {
    q.run("INSERT INTO researchers (id,name,org,initials,photo,since,avatar_class) VALUES (?,?,?,?,?,?,?)",
      id, u.name, "Independent researcher", u.initials || "R", u.photo, "Since " + new Date().getFullYear(), "");
  }
  return id;
}
const validateAnySpec = (spec) => llm.validateSpec(spec);
const fmtCount = (n) => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n);
const fmtDate = (sql) => {
  const d = new Date(String(sql).replace(" ", "T") + "Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86400e3).toISOString().slice(0, 10);

function walletState(u) {
  return { wallet_cents: u.wallet_cents, streak_day: u.streak_day, multiplier_left: u.multiplier_left };
}
function methodsOf(userId) {
  return q.all("SELECT id,kind,brand,last4,exp_month,exp_year,holder,is_default,created_at FROM payment_methods WHERE user_id=? ORDER BY is_default DESC, id", userId)
    .map((m) => ({ ...m, is_default: !!m.is_default }));
}
function withdrawalsOf(userId) {
  return q.all(`SELECT w.*, m.kind, m.brand, m.last4 FROM withdrawals w JOIN payment_methods m ON m.id=w.method_id WHERE w.user_id=? ORDER BY w.id DESC LIMIT 50`, userId);
}
function completedOf(userId) {
  return q.all(`SELECT r.id, r.study_id, r.reward_cents, r.boosted, r.created_at, s.title, re.name org
    FROM responses r JOIN studies s ON s.id=r.study_id JOIN researchers re ON re.id=s.researcher_id
    WHERE r.user_id=? AND r.reward_cents>0 ORDER BY r.created_at DESC`, userId)
    .map((r) => ({ id: "c" + r.id, title: r.title, org: r.org, reward: r.reward_cents / 100, date: fmtDate(r.created_at) }));
}
function answeredOf(userId) {
  const out = {};
  for (const r of q.all("SELECT * FROM responses WHERE user_id=? ORDER BY id", userId)) {
    out[r.study_id] = { answers: JSON.parse(r.answers), amount: r.reward_cents / 100, boosted: !!r.boosted, flagged: !!r.flagged };
  }
  return out;
}
function researchersPayload() {
  const out = {};
  for (const r of q.all("SELECT * FROM researchers")) {
    out[r.id] = {
      name: r.name, org: r.org, initials: r.initials, photo: r.photo, since: r.since, avatar: r.avatar_class,
      awards: q.all("SELECT icon,text FROM awards WHERE researcher_id=?", r.id),
      papers: q.all("SELECT id,title FROM papers WHERE researcher_id=?", r.id)
        .map((p) => ({ id: p.id, title: p.title, year: (p.title.match(/20\d\d/) || ["2026"])[0] })),
    };
  }
  return out;
}
function studyRow(s) {
  return {
    id: s.id, kind: "study", researcher: s.researcher_id, reward: s.reward_cents / 100, minutes: s.minutes,
    genre: s.genre, video: s.video, image: s.image, media_kind: s.video ? "video" : "image",
    credit: s.credit, chip: s.chip, title: s.title, sub: s.sub,
    abstract: s.abstract, authors: s.authors, source_url: s.source_url, verified: !!s.verified,
    questions: q.all("SELECT q,type,placeholder,options,meta FROM questions WHERE study_id=? ORDER BY ord", s.id)
      .map((x) => ({ q: x.q, type: x.type, placeholder: x.placeholder, options: x.options ? JSON.parse(x.options) : undefined, meta: x.meta ? JSON.parse(x.meta) : undefined })),
  };
}
function studiesPayload(orderIds) {
  const rows = q.all("SELECT * FROM studies WHERE active=1");
  const byId = new Map(rows.map((s) => [s.id, s]));
  const ordered = orderIds ? orderIds.map((id) => byId.get(id)).filter(Boolean) : rows;
  return ordered.map(studyRow);
}
/* professional headshots for discovery lead authors that have no researcher
   profile. Keyed by lead author name; unknown authors get a deterministic
   demographic-matched face from the pool, so no placeholder ever shows. */
const AUTHOR_PHOTOS = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "seed-data", "author-photos.json"), "utf8")); } catch { return {}; } })();
const AUTHOR_POOLS = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "seed-data", "author-pools.json"), "utf8")); } catch { return {}; } })();
const EA_NAMES = new Set(["wang","li","zhang","liu","chen","yang","huang","hu","zhou","xu","yin","mu","shi","gao","zhong","lai","xiang","dong","kim","park","cha","byun","iwata","shirasawa","asakawa","fujita","to","zeng","yue","zou","guo","jiang","tan","lim","chan","wong","ang","ng","ong","lee","ho","yu","he","ma","luo","sun","zhu","lin","xie","deng","feng","cao","peng","xiao","cheng","du","ye","wei","su","lu","ding","ren","shen","yao","jin","qian","dai","xia","fan","fang","meng","qin","bai","xue","kong","shao","wan","duan","lei","long","tao","hao","gong","shu","jian","kuang","yan","ping","rui","jing","ting","xuan","bo","chao","kun","gang","hua","ming","nan","qing","sheng","xiang","xin","yi","yong","zhen","zhi","hong","jun","kai","liang","min","ning","qi","rong","tian","wen","xi","ze","zhao","zheng","ji","duong","tang","kang","cai","wan","yuan","yunqi","xuyang","yiyang","yuzhi","guoxin","shenghua","wenkai","yicheng","doyun","handa","yanda","yuxiang","chang","mengxiao","jinzhe","zhen","yang","yunqi","peiran","linchao","zeteng","yinkun","fanzhe","shuang","junxi","chenwen","taegyu","chanwoo","jiwoo","fanding","jie","wu"]);
const SA_NAMES = new Set(["singh","sharma","gupta","kumar","sethuraman","dawar","roy","saha","boparai","natarajan","saxena","sreenath","vasishta","raja","niraimathi","saravanan","bala","tummalapalli","barhaiya","azeem","iqbal","fayaz","basharpoor","prom","dey","mallick","chaiear","aekplakorn","suneja","aden","kalyan","vemula","chiranjeevee","reddy","patel","shah","mehta","verma","iyer","menon","nair","pillai","das","bose","ghosh","banerjee","chatterjee","mukherjee","khan","ahmed","ali","rahman","hossain","islam","uddin","chowdhury","akhter","sultana","begum","perera","fernando","silva","wijesekara","dissanayake","bandara","jayawardena","wickramasinghe","rajapaksa","senanayake","gunawardena","amarasinghe","pathirana","karunaratne","herath","ekanayake","shetty","dubey","rowther","gopika","majumdar","patra","dhital","sah","desai","gunjal","khemnar","poojary","sushmit","adib","gem","zami","shanaz","hasan","allahyar","atreja","rahul","jahilal","vedula","hanspal","abrahamyan","nakka","alam","jagtap","codipilly","khosravi"]);
const F_NAMES = new Set(["nina","julita","caren","alicja","alison","kate","neha","caroline","gulnaz","kerry","brittany","erika","dominika","sonia","rebekka","tania","ivette","shrooq","durre","carla","tatiana","flavia","cathie","roxana","carina","lili","carmen","katharina","renata","vasilica","norin","denisa","iustina","alice","amna","oleksandra","ioana","helene","sauda","heba","mentari","bianca","daniela","jenny","anamaria","asma","prachi","taqiya","crystal","diana","denise","marilyn","sabrina","zara","faezeh","tahereh","eman","ranim","meity","indri","uswatun","carolyn","laurence","kinjal","celia","brigitte","aase","didem","neylan","goun","mi","shanshan","xurong","ting","ying","yingying","fang","na","ling","qin","meiying","xiaoling","yan","jing","shu","yue","xin","di","ping","rui","hua","juan","mei","lan","xiu","hong","yun","xue","jia","wen","hui","nan","qian","rong","shan","xia","yao","yi","yu","zhen","zhi","jacqueline","kristina","anastasia","elina","michaela","lisa","emma","jenneke","julie","ana","ailar","lidya","tasneem","gopika","elizabeth","roza","disa","paolina","barbara","angelique","mitra","aishwarya","harleen","lusine","nagham","rotem","laia","yiyang","yuanyuan","mengxiao","jinzhe","dandan","zitao","wendan","jiwoo","kum","shuang","fanzhe","yinkun","zeteng","wenkai","peiran","yunqi","yuanyuan"]);
function authorPhoto(author) {
  const lead = String(author || "").split(",")[0].trim();
  if (AUTHOR_PHOTOS[lead]) return AUTHOR_PHOTOS[lead];
  const parts = lead.toLowerCase().replace(/[^a-zà-ž\s.'-]/gi, "").split(/[\s.]+/).filter(Boolean);
  const first = parts[0] || "", last = parts[parts.length - 1] || "";
  const region = EA_NAMES.has(last) || EA_NAMES.has(first) ? "eastasian" : SA_NAMES.has(last) ? "southasian" : "western";
  const gender = F_NAMES.has(first) ? "f" : "m";
  const pool = AUTHOR_POOLS[region + "|" + gender] || AUTHOR_POOLS["western|" + gender] || Object.values(AUTHOR_POOLS)[0] || [];
  if (!pool.length) return null;
  let h = 0;
  for (let i = 0; i < lead.length; i++) h = (h * 31 + lead.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}
function discoveryRow(d) {
  let tags = [];
  try { tags = JSON.parse(d.tags || "[]"); } catch {}
  return {
    id: d.id, kind: "news", genre: d.genre, video: d.video, image: d.image,
    media_kind: d.media_kind || (d.video ? "video" : "image"),
    credit: d.credit, chip: d.chip, title: d.title, sub: d.sub, summary: d.summary, has_blog: !!d.blog,
    source_url: d.source_url, author: d.author, author_photo: authorPhoto(d.author), verified: !!d.verified, published_at: d.published_at, tags,
    researcher: d.researcher_id || (q.get("SELECT researcher_id FROM papers WHERE id=?", d.paper_id) || {}).researcher_id || null,
    rail: { heart: fmtCount(d.hearts), repost: fmtCount(d.reposts), comment: fmtCount(d.comments + q.get("SELECT COUNT(*) n FROM comments WHERE item_id=?", d.id).n) }, ai: d.ai, paper: d.paper_id,
  };
}
function discoveriesPayload(orderIds) {
  const rows = q.all("SELECT * FROM discoveries WHERE COALESCE(active,1)=1");
  const byId = new Map(rows.map((d) => [d.id, d]));
  const ordered = orderIds ? orderIds.map((id) => byId.get(id)).filter(Boolean) : rows;
  return ordered.map(discoveryRow);
}
function preferencesOf(userId) {
  const p = q.get("SELECT * FROM user_preferences WHERE user_id=?", userId);
  if (!p) return null;
  const parse = (s) => { try { return JSON.parse(s || "[]"); } catch { return []; } };
  return { topics: parse(p.topics), fields: parse(p.fields), goals: parse(p.goals), formats: parse(p.formats), windows: p.windows || "" };
}
function bootstrap(u) {
  const papers = {};
  for (const p of q.all("SELECT * FROM papers")) papers[p.id] = { title: p.title, authors: p.authors, price: 0, free: true, abstract: p.abstract, url: p.url, published_at: p.published_at };
  const studyOrder = recommend.rankFeed(u.id, "study", { limit: 40 });
  const postOrder = recommend.rankFeed(u.id, "post", { limit: 40 });
  return {
    user: auth.publicUser(u), ...walletState(u),
    settings: q.get("SELECT * FROM settings WHERE user_id=?", u.id) || { autoplay: 1, streak_reminders: 1 },
    preferences: preferencesOf(u.id),
    researchers: researchersPayload(), papers,
    studies: studiesPayload(studyOrder), discoveries: discoveriesPayload(postOrder),
    impact: impacts.listPayload(u.id),
    completed: completedOf(u.id),
    follows: Object.fromEntries(q.all("SELECT researcher_id FROM follows WHERE user_id=?", u.id).map((r) => [r.researcher_id, true])),
    hearts: Object.fromEntries(q.all("SELECT item_id FROM hearts WHERE user_id=?", u.id).map((r) => [r.item_id, true])),
    reposts: Object.fromEntries(q.all("SELECT item_id FROM reposts WHERE user_id=?", u.id).map((r) => [r.item_id, true])),
    answered: answeredOf(u.id),
    unlocked: Object.fromEntries(q.all("SELECT paper_id FROM unlocked_papers WHERE user_id=?", u.id).map((r) => [r.paper_id, true])),
    methods: methodsOf(u.id), withdrawals: withdrawalsOf(u.id),
    ledger: q.all("SELECT delta_cents,kind,note,created_at FROM wallet_ledger WHERE user_id=? ORDER BY id DESC LIMIT 60", u.id),
    oauth: auth.providerState(), config: config.publicState(),
    pipeline: pipeline.status(),
    withdraw: { min_cents: payments.MIN_WITHDRAW_CENTS, fee_rate: payments.FEE_RATE, min_fee_cents: payments.MIN_FEE_CENTS },
  };
}

/* streak + multiplier, applied inside the caller's transaction */
function bumpStreak(u) {
  const t = today();
  if (u.last_active_date === t) return { milestone: false };
  const streak = u.last_active_date === yesterday() ? Math.min(u.streak_day + 1, 7) : 1;
  let mult = u.multiplier_left, milestone = false;
  if (streak >= 7 && u.streak_day < 7) { mult = 10; milestone = true; }
  q.run("UPDATE users SET streak_day=?, last_active_date=?, multiplier_left=? WHERE id=?", streak, t, mult, u.id);
  return { milestone };
}
function payReward(u, baseCents, kind, note) {
  const boosted = u.multiplier_left > 0;
  const amount = boosted ? baseCents * 2 : baseCents;
  q.run("UPDATE users SET wallet_cents = wallet_cents + ?, multiplier_left = MAX(multiplier_left - 1, 0) WHERE id=?", amount, u.id);
  q.run("INSERT INTO wallet_ledger (user_id,delta_cents,kind,note) VALUES (?,?,?,?)", u.id, amount, kind, note + (boosted ? " (2x streak)" : ""));
  const streak = bumpStreak(q.get("SELECT * FROM users WHERE id=?", u.id));
  return { amount, boosted, ...streak };
}

async function handle(req, res, url, body, user, token) {
  const p = url.pathname;
  const method = req.method;
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  const ok = (obj) => json(200, obj);
  const bad = (msg) => json(400, { error: msg });
  const needUser = () => { if (!user) { json(401, { error: "Sign in to continue." }); return false; } return true; };
  const setCookie = (t) => res.setHeader("Set-Cookie", `${auth.COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${auth.SESSION_DAYS * 86400}`);

  /* ---- auth ---- */
  if (p === "/api/auth/register" && method === "POST") {
    const r = auth.register(body || {});
    if (r.error) return bad(r.error);
    setCookie(r.token); return ok({ user: r.user });
  }
  if (p === "/api/auth/login" && method === "POST") {
    const r = auth.login(body || {});
    if (r.error) return bad(r.error);
    setCookie(r.token); return ok({ user: r.user });
  }
  if (p === "/api/auth/logout" && method === "POST") {
    auth.destroySession(token);
    res.setHeader("Set-Cookie", `${auth.COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return ok({ ok: true });
  }
  if (p === "/api/auth/me" && method === "GET") return ok({ user: user ? auth.publicUser(user) : null });
  if (p === "/api/auth/account" && method === "DELETE") {
    if (!needUser()) return;
    auth.deleteAccount(user.id);
    res.setHeader("Set-Cookie", `${auth.COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return ok({ ok: true });
  }
  let m = p.match(/^\/api\/auth\/oauth\/(google|apple)\/start$/);
  if (m && method === "GET") {
    const host = req.headers.host || "localhost";
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host);
    const base = process.env.PUBLIC_BASE_URL || `${isLocal && req.headers["x-forwarded-proto"] !== "https" ? "http" : "https"}://${host}`;
    const r = auth.oauthStart(m[1], base);
    return ok(r);
  }
  m = p.match(/^\/api\/auth\/oauth\/(google|apple)\/callback$/);
  if (m) {
    const host = req.headers.host || "localhost";
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host);
    const base = process.env.PUBLIC_BASE_URL || `${isLocal && req.headers["x-forwarded-proto"] !== "https" ? "http" : "https"}://${host}`;
    const code = method === "POST" ? body.code : url.searchParams.get("code");
    const state = method === "POST" ? body.state : url.searchParams.get("state");
    const r = await auth.oauthCallback(m[1], code, state, base);
    if (r.error) return json(400, { error: r.error });
    setCookie(r.token);
    res.writeHead(302, { Location: "/#/feed" }); return res.end();
  }
  m = p.match(/^\/api\/auth\/oauth\/(google|apple)\/demo$/);
  if (m && method === "POST") {
    const r = auth.oauthDemo(m[1]);
    if (r.error) return bad(r.error);
    setCookie(r.token); return ok({ user: r.user, demo: true });
  }

  /* ---- runtime configuration & dev outbox ---- */
  if (p === "/api/config" && method === "GET") { if (!needUser()) return; return ok(config.publicState()); }
  if (p === "/api/config" && method === "PUT") {
    if (!needUser()) return;
    try {
      for (const [k, v] of Object.entries(body || {})) config.set(k, v);
    } catch (e) { return bad(e.message); }
    return ok(config.publicState());
  }
  if (p === "/api/config/test-email" && method === "POST") {
    if (!needUser()) return;
    try {
      const r = await email.sendMail({ to: user.email, subject: "EARNest test email", html: "<p>Your EARNest email delivery is working.</p>" });
      return ok(r);
    } catch (e) { return bad("Email failed: " + e.message); }
  }
  if (p === "/api/dev/outbox" && method === "GET") {
    if (!needUser()) return;
    if (config.publicState().email_configured) return ok({ messages: [], note: "A real email provider is configured; mail is delivered, not stored." });
    return ok({ messages: email.listOutbox() });
  }
  m = p.match(/^\/api\/dev\/outbox\/([\w.@-]+)$/);
  if (m && method === "GET") {
    if (!needUser()) return;
    const raw = email.readOutbox(m[1]);
    if (!raw) return bad("Unknown message.");
    return ok({ raw });
  }

  /* ---- session data ---- */
  if (p === "/api/bootstrap" && method === "GET") { if (!needUser()) return; return ok(bootstrap(user)); }
  if (p === "/api/feed" && method === "GET") {
    if (!needUser()) return;
    const tab = url.searchParams.get("tab") === "discover" ? "post" : "study";
    const refresh = url.searchParams.get("refresh") === "1";
    const order = recommend.rankFeed(user.id, tab, { limit: 30, refresh });
    return ok(tab === "post" ? discoveriesPayload(order) : studiesPayload(order));
  }
  /* implicit feedback → the ranking model (dwell, watch fraction, skips…) */
  if (p === "/api/events" && method === "POST") {
    if (!needUser()) return;
    const kind = String(body.kind || "");
    if (!["dwell", "watch", "skip", "not_interested", "complete"].includes(kind)) return bad("Unknown event kind.");
    recommend.event(user.id, String(body.item_id || ""), kind, Number(body.value) || 0);
    return ok({ ok: true });
  }
  /* ---- onboarding & preferences (Instagram/X-style explicit interest picks) ---- */
  if (p === "/api/onboarding/topics" && method === "GET") {
    return ok({ topics: TOPICS, goals: GOALS, formats: FORMATS, windows: WINDOWS });
  }
  if (p === "/api/preferences" && method === "GET") {
    if (!needUser()) return;
    return ok({ preferences: preferencesOf(user.id) });
  }
  if (p === "/api/preferences" && method === "PUT") {
    if (!needUser()) return;
    const ids = new Set(TOPICS.map((t) => t.id));
    const topics = (Array.isArray(body.topics) ? body.topics : []).filter((t) => ids.has(t)).slice(0, 12);
    if (!topics.length) return bad("Pick at least one topic so the feed can match you.");
    const fieldSet = new Set(TOPICS.flatMap((t) => t.fields));
    const fields = (Array.isArray(body.fields) ? body.fields : []).filter((f) => fieldSet.has(f)).slice(0, 20);
    const goals = (Array.isArray(body.goals) ? body.goals : []).filter((g) => GOALS.some((x) => x.id === g));
    const formats = (Array.isArray(body.formats) ? body.formats : []).filter((f) => FORMATS.some((x) => x.id === f));
    const windows = String(body.windows || "").slice(0, 200);
    q.run(`INSERT INTO user_preferences (user_id,topics,fields,goals,formats,windows,updated_at) VALUES (?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET topics=excluded.topics, fields=excluded.fields, goals=excluded.goals, formats=excluded.formats, windows=excluded.windows, updated_at=datetime('now')`,
      user.id, JSON.stringify(topics), JSON.stringify(fields), JSON.stringify(goals), JSON.stringify(formats), windows);
    recommend.invalidate(user.id);
    return ok({ preferences: preferencesOf(user.id) });
  }
  /* ---- search (server-side match + personalized ordering) ---- */
  if (p === "/api/search" && method === "GET") {
    if (!needUser()) return;
    const ql = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const like = "%" + ql + "%";
    /* node:sqlite throws if bind values are passed to a statement with no
       placeholders — only pass params when there is actually a query.
       Score each item ONCE (decorate-sort-undecorate): scoring inside the
       sort comparator ran the ranker O(n log n) times and made search lag. */
    const ranked = (rows) => rows
      .map((it) => ({ it, s: recommend.scoreFor(user.id, it.id) }))
      .sort((a, b) => b.s - a.s);
    const scoredStudies = ranked((ql
      ? q.all("SELECT * FROM studies WHERE active=1 AND (LOWER(title) LIKE ? OR LOWER(sub) LIKE ? OR LOWER(abstract) LIKE ?) LIMIT 60", like, like, like)
      : q.all("SELECT * FROM studies WHERE active=1 LIMIT 60")).map(studyRow));
    const scoredDiscoveries = ranked((ql
      ? q.all("SELECT * FROM discoveries WHERE COALESCE(active,1)=1 AND (LOWER(title) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(tags) LIKE ?) LIMIT 60", like, like, like)
      : q.all("SELECT * FROM discoveries WHERE COALESCE(active,1)=1 LIMIT 60")).map(discoveryRow));
    const studies = scoredStudies.map((x) => x.it);
    const discoveries = scoredDiscoveries.map((x) => x.it);
    /* People: only the top three, ranked by each researcher's strongest
       matched post (follows win ties) — not the whole directory. */
    const best = new Map();
    for (const { it, s } of scoredStudies.concat(scoredDiscoveries)) {
      if (it.researcher && s > (best.get(it.researcher) ?? -Infinity)) best.set(it.researcher, s);
    }
    const followed = new Set(q.all("SELECT researcher_id FROM follows WHERE user_id=?", user.id).map((r) => r.researcher_id));
    const rank = (r) => (best.get(r.id) ?? 0) + (followed.has(r.id) ? 1 : 0);
    const researchers = (ql
      ? q.all("SELECT * FROM researchers WHERE LOWER(name) LIKE ? OR LOWER(org) LIKE ? LIMIT 30", like, like)
      : q.all("SELECT * FROM researchers LIMIT 30"))
      .map((r) => ({ id: r.id, name: r.name, org: r.org, initials: r.initials, photo: r.photo, avatar: r.avatar_class }))
      .sort((a, b) => rank(b) - rank(a))
      .slice(0, 3);
    const papers = (ql
      ? q.all("SELECT * FROM papers WHERE LOWER(title) LIKE ? LIMIT 30", like)
      : q.all("SELECT * FROM papers LIMIT 30"))
      .map((pp) => ({ id: pp.id, title: pp.title, researcher: pp.researcher_id }));
    return ok({ researchers, papers, studies, discoveries });
  }

  /* ---- in-app source reader (no external bounce) ---- */
  m = p.match(/^\/api\/reader\/(post|study|paper)\/([\w-]+)$/);
  if (m && method === "GET") {
    if (!needUser()) return;
    try {
      const doc = await reader.getReader(m[1], m[2]);
      if (!doc) return bad("Unknown source.");
      return ok(doc);
    } catch (e) { return bad("Could not load the source: " + e.message); }
  }

  /* ---- impact finding page: study-derived finding + live responses ---- */
  m = p.match(/^\/api\/impact\/(\d+)$/);
  if (m && method === "GET") {
    if (!needUser()) return;
    const d = impacts.detail(Number(m[1]), user.id);
    if (!d) return bad("Unknown impact.");
    return ok(d);
  }

  /* ---- answering & games ---- */
  m = p.match(/^\/api\/studies\/([\w-]+)$/);
  if (m && method === "GET") {
    if (!needUser()) return;
    /* direct id lookup also serves inactive studies (e.g. an impact's study
       reel); the feed listing itself still filters active=1 */
    const s = q.get("SELECT * FROM studies WHERE id=?", m[1]);
    if (!s) return bad("Unknown study.");
    return ok(studyRow(s));
  }
  m = p.match(/^\/api\/studies\/([\w-]+)\/respond$/);
  if (m && method === "POST") {
    if (!needUser()) return;
    const s = q.get("SELECT * FROM studies WHERE id=?", m[1]);
    if (!s) return bad("Unknown study.");
    const questions = q.all("SELECT * FROM questions WHERE study_id=? ORDER BY ord", s.id);
    const answers = Array.isArray(body.answers) ? body.answers.slice(0, questions.length) : [];
    if (answers.length !== questions.length || answers.some((a) => !String(a || "").trim()))
      return bad("Every question needs an answer.");
    const already = q.get("SELECT id FROM responses WHERE study_id=? AND user_id=? AND reward_cents>0", s.id, user.id);
    if (already) return bad("You already answered this study.");
    const qr = screen(s.id, user.id, answers, body.timings, body.paradata);
    const result = tx(() => {
      const u = q.get("SELECT * FROM users WHERE id=?", user.id);
      let pay = { amount: 0, boosted: false, milestone: false };
      if (!qr.flagged) pay = payReward(u, s.reward_cents, "study", s.title);
      q.run(`INSERT INTO responses (study_id,user_id,answers,timings,notes,quality_score,flagged,flag_reasons,reward_cents,boosted,paradata,bot_prob)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        s.id, user.id, JSON.stringify(answers), JSON.stringify(body.timings || []), JSON.stringify(qr.notes),
        qr.score, qr.flagged ? 1 : 0, JSON.stringify(qr.reasons), pay.amount, pay.boosted ? 1 : 0,
        JSON.stringify({ ...(body.paradata || {}), analysis: qr.per_question || [] }), qr.bot_prob || 0);
      return pay;
    });
    recommend.event(user.id, s.id, "complete");
    const u2 = q.get("SELECT * FROM users WHERE id=?", user.id);
    return ok({ ...result, quality: qr, ...walletState(u2), completed: completedOf(user.id), answered: answeredOf(user.id) });
  }
  /* ---- social ---- */
  m = p.match(/^\/api\/(hearts|reposts)\/([\w-]+)$/);
  if (m && method === "POST") {
    if (!needUser()) return;
    const table = m[1];
    const has = q.get(`SELECT 1 x FROM ${table} WHERE user_id=? AND item_id=?`, user.id, m[2]);
    if (has) q.run(`DELETE FROM ${table} WHERE user_id=? AND item_id=?`, user.id, m[2]);
    else q.run(`INSERT INTO ${table} (user_id,item_id) VALUES (?,?)`, user.id, m[2]);
    if (table === "hearts" && !has && q.get("SELECT id FROM discoveries WHERE id=?", m[2]))
      q.run("UPDATE discoveries SET hearts = hearts + 1 WHERE id=?", m[2]);
    if (table === "reposts" && !has && q.get("SELECT id FROM discoveries WHERE id=?", m[2]))
      q.run("UPDATE discoveries SET reposts = reposts + 1 WHERE id=?", m[2]);
    if (!has) recommend.event(user.id, m[2], table === "hearts" ? "heart" : "repost");
    return ok({ active: !has });
  }
  m = p.match(/^\/api\/follows\/([\w-]+)$/);
  if (m && method === "POST") {
    if (!needUser()) return;
    if (!q.get("SELECT id FROM researchers WHERE id=?", m[1])) return bad("Unknown researcher.");
    const has = q.get("SELECT 1 x FROM follows WHERE user_id=? AND researcher_id=?", user.id, m[1]);
    if (has) q.run("DELETE FROM follows WHERE user_id=? AND researcher_id=?", user.id, m[1]);
    else { q.run("INSERT INTO follows (user_id,researcher_id) VALUES (?,?)", user.id, m[1]); recommend.event(user.id, m[1], "follow"); }
    return ok({ active: !has });
  }
  /* papers are free to read — the pay-to-unlock wall was removed */
  m = p.match(/^\/api\/papers\/([\w-]+)\/unlock$/);
  if (m && method === "POST") {
    if (!needUser()) return;
    const paper = q.get("SELECT * FROM papers WHERE id=?", m[1]);
    if (!paper) return bad("Unknown paper.");
    q.run("INSERT OR IGNORE INTO unlocked_papers (user_id,paper_id) VALUES (?,?)", user.id, paper.id);
    return ok({ unlocked: true, free: true, ...walletState(user) });
  }

  /* ---- profile & settings ---- */
  if (p === "/api/profile" && method === "PUT") {
    if (!needUser()) return;
    const name = String(body.name || user.name).trim().slice(0, 60);
    if (name.length < 2) return bad("Name needs at least 2 characters.");
    q.run("UPDATE users SET name=?, interests=?, answer_windows=? WHERE id=?",
      name, String(body.interests || "").slice(0, 200), String(body.answer_windows || "").slice(0, 200), user.id);
    return ok({ user: auth.publicUser(q.get("SELECT * FROM users WHERE id=?", user.id)) });
  }
  if (p === "/api/researcher-mode" && method === "POST") {
    if (!needUser()) return;
    q.run("UPDATE users SET researcher_mode=? WHERE id=?", body.on ? 1 : 0, user.id);
    return ok({ researcher_mode: !!body.on });
  }
  if (p === "/api/settings" && method === "PUT") {
    if (!needUser()) return;
    q.run("UPDATE settings SET autoplay=?, streak_reminders=? WHERE user_id=?", body.autoplay ? 1 : 0, body.streak_reminders ? 1 : 0, user.id);
    return ok({ ok: true });
  }

  /* ---- wallet & payments ---- */
  if (p === "/api/wallet" && method === "GET") {
    if (!needUser()) return;
    return ok({ ...walletState(user), ledger: q.all("SELECT delta_cents,kind,note,created_at FROM wallet_ledger WHERE user_id=? ORDER BY id DESC LIMIT 60", user.id), withdrawals: withdrawalsOf(user.id), methods: methodsOf(user.id) });
  }
  if (p === "/api/payment-methods" && method === "GET") { if (!needUser()) return; return ok({ methods: methodsOf(user.id) }); }
  if (p === "/api/payment-methods" && method === "POST") {
    if (!needUser()) return;
    const r = payments.addMethod(user.id, body || {});
    if (r.error) return bad(r.error);
    return ok({ id: r.id, methods: methodsOf(user.id) });
  }
  m = p.match(/^\/api\/payment-methods\/(\d+)$/);
  if (m && method === "DELETE") {
    if (!needUser()) return;
    const mid = Number(m[1]);
    const pending = q.get("SELECT 1 x FROM withdrawals WHERE method_id=? AND status='processing'", mid);
    if (pending) return bad("A withdrawal to this method is still processing.");
    const r = q.run("DELETE FROM payment_methods WHERE id=? AND user_id=?", mid, user.id);
    if (r.changes === 0) return bad("Unknown method.");
    const first = q.get("SELECT id FROM payment_methods WHERE user_id=? ORDER BY id LIMIT 1", user.id);
    if (first) q.run("UPDATE payment_methods SET is_default=1 WHERE id=?", first.id);
    return ok({ methods: methodsOf(user.id) });
  }
  m = p.match(/^\/api\/payment-methods\/(\d+)\/default$/);
  if (m && method === "POST") {
    if (!needUser()) return;
    const mid = Number(m[1]);
    if (!q.get("SELECT id FROM payment_methods WHERE id=? AND user_id=?", mid, user.id)) return bad("Unknown method.");
    tx(() => { q.run("UPDATE payment_methods SET is_default=0 WHERE user_id=?", user.id); q.run("UPDATE payment_methods SET is_default=1 WHERE id=?", mid); });
    return ok({ methods: methodsOf(user.id) });
  }
  if (p === "/api/withdrawals/quote" && method === "GET") {
    if (!needUser()) return;
    const cents = Math.floor(Number(url.searchParams.get("amount_cents")) || 0);
    return ok({ amount_cents: cents, ...payments.quoteWithdrawal(cents), min_cents: payments.MIN_WITHDRAW_CENTS });
  }
  if (p === "/api/withdrawals" && method === "GET") { if (!needUser()) return; return ok({ withdrawals: withdrawalsOf(user.id) }); }
  if (p === "/api/withdrawals" && method === "POST") {
    if (!needUser()) return;
    const r = payments.withdraw(user.id, Math.floor(Number(body.amount_cents) || 0), Number(body.method_id) || 0);
    if (r.error) return bad(r.error);
    return ok({ ...r, ...walletState(q.get("SELECT * FROM users WHERE id=?", user.id)), withdrawals: withdrawalsOf(user.id) });
  }

  /* ---- AI games ---- */
  if (p === "/api/llm/test" && method === "POST") {
    if (!needUser()) return;
    try { return ok(await llm.testConnection()); } catch (e) { return bad(e.message); }
  }
  if (p === "/api/games" && method === "GET") {
    if (!needUser()) return;
    const rows = storage.list();
    const names = new Map(q.all("SELECT id,name FROM researchers").map((r) => [r.id, r.name]));
    return ok({ games: rows.map((g) => ({ ...g, spec: (storage.load(g.id) || {}).spec || null, researcher_name: names.get(g.researcher_id) || null, played: !!q.get("SELECT 1 x FROM game_plays WHERE game_id=? AND user_id=?", g.id, user.id) })) });
  }
  /* ---- story games: generate from the researcher's brief ---- */
  if (p === "/api/games/generate" && method === "POST") {
    if (!needUser()) return;
    if (!user.researcher_mode) return json(403, { error: "Turn on researcher mode to create games." });
    const kind = "story";
    /* default provider: the founder's QwenWork credits via the local agent worker */
    if ((config.get("gen_provider") || "qwenwork").toLowerCase() !== "api") {
      try {
        const id = agentqueue.enqueue({ kind, answers: body.answers, researcherId: ensureUserResearcher(user) });
        require("./gamebuilder").kick(); // cloud worker builds it immediately when authorized
        return ok({ id, queued: true });
      } catch (e) { return json(e.status || 400, { error: e.message }); }
    }
    try {
      const spec = await llm.generateGame(kind, body.answers);
      /* every successful generation is persisted immediately (draft) — it can be
         reopened from the library later without calling the provider again */
      const cfg = llm.llmCfg();
      const id = "g-" + crypto.randomBytes(4).toString("hex");
      const art = gameart.ensureArt(id, spec);
      storage.save({
        id, researcher_id: ensureUserResearcher(user), kind: spec.kind,
        title: String(spec.title).slice(0, 80), premise: String(spec.premise || "").slice(0, 300),
        reward_cents: 0, prompt: JSON.stringify(body.answers || {}),
        provider: (() => { try { return new URL(cfg.base).host; } catch { return cfg.base; } })(),
        model: cfg.model, status: "draft", spec,
        ...gamemedia.assign(spec.kind, (body.answers || {}).research_context),
        headline: gamemedia.headlineFor({ kind: spec.kind, spec }),
        logo: art.logo, poster: art.poster,
      });
      return ok({ id, spec });
    } catch (e) { return bad(e.message); }
  }
  if (p === "/api/games" && method === "POST") {
    if (!needUser()) return;
    if (!user.researcher_mode) return json(403, { error: "Turn on researcher mode to publish games." });
    const rewardCents = Math.round(Number(body.reward) * 100);
    if (!Number.isFinite(rewardCents) || rewardCents < 5 || rewardCents > 5000) return bad("Reward should be between $0.05 and $50.00.");
    const rid = ensureUserResearcher(user);
    /* publishing a previously generated draft updates that row — no duplicate */
    if (body.id) {
      const existing = storage.load(String(body.id));
      if (!existing) return bad("Unknown game.");
      if (existing.researcher_id !== rid) return json(403, { error: "Only the game's researcher can publish it." });
      const spec = body.spec || existing.spec;
      const err = validateAnySpec(spec);
      if (err) return bad(err);
      const art = gameart.ensureArt(existing.id, spec);
      storage.save({ ...existing, kind: spec.kind, title: String(spec.title).slice(0, 80), premise: String(spec.premise || "").slice(0, 300), reward_cents: rewardCents, status: "published", spec, logo: art.logo, poster: art.poster });
      return ok({ id: existing.id });
    }
    const spec = body.spec;
    const err = validateAnySpec(spec);
    if (err) return bad(err);
    const id = "g-" + crypto.randomBytes(4).toString("hex");
    const art = gameart.ensureArt(id, spec);
    storage.save({
      id, researcher_id: rid, kind: spec.kind, title: String(spec.title).slice(0, 80),
      premise: String(spec.premise || "").slice(0, 300), reward_cents: rewardCents,
      prompt: "", provider: "", model: "", status: "published", spec,
      ...gamemedia.assign(spec.kind, spec.study && spec.study.context),
      headline: gamemedia.headlineFor({ kind: spec.kind, spec }),
      logo: art.logo, poster: art.poster,
    });
    return ok({ id });
  }
  m = p.match(/^\/api\/games\/([\w-]+)$/);
  if (m && method === "GET") {
    if (!needUser()) return;
    const meta = storage.loadMeta(m[1]);
    if (!meta) return bad("Unknown game.");
    const full = meta.status === "draft" || meta.status === "published" ? storage.load(m[1]) : null;
    return ok({ id: meta.id, kind: meta.kind, title: meta.title, headline: meta.headline || null, premise: meta.premise || "", researcher_id: meta.researcher_id, plays: meta.plays || 0, reward_cents: meta.reward_cents, status: meta.status, error: meta.error || null, video: meta.video || null, credit: meta.credit || null, chip: meta.chip || null, minutes: meta.minutes || null, logo: meta.logo || null, poster: meta.poster || null, prompt: meta.prompt || "", spec: full ? full.spec : null, played: !!q.get("SELECT 1 x FROM game_plays WHERE game_id=? AND user_id=?", meta.id, user.id) });
  }
  /* ---- QwenWork-credit builder worker (loopback only — runs on this machine) ---- */
  const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
  if (p === "/api/agent-queue" && method === "GET") {
    if (!loopback) return json(403, { error: "Local worker only." });
    return ok({ jobs: agentqueue.pending(), remaining_today: agentqueue.remainingToday(), daily_cap: agentqueue.DAILY_CAP, cloud_builder: require("./gamebuilder").ready() });
  }
  m = p.match(/^\/api\/agent-queue\/([\w-]+)\/(complete|fail|requeue)$/);
  if (m && method === "POST") {
    if (!loopback) return json(403, { error: "Local worker only." });
    const r = m[2] === "complete" ? agentqueue.complete(m[1], body && body.spec)
      : m[2] === "requeue" ? agentqueue.requeue(m[1])
      : agentqueue.fail(m[1], body && body.error);
    if (r.error) return bad(r.error);
    return ok(r);
  }
  m = p.match(/^\/api\/games\/([\w-]+)\/complete$/);
  if (m && method === "POST") {
    if (!needUser()) return;
    const g = storage.load(m[1]);
    if (!g) return bad("Unknown game.");
    /* replays are welcome — they just don't pay again */
    const replay = !!q.get("SELECT 1 x FROM game_plays WHERE game_id=? AND user_id=?", g.id, user.id);
    const responses = Array.isArray(body.responses) ? body.responses : [];
    if (!responses.length) return bad("No responses recorded.");
    const timings = Array.isArray(body.timings) ? body.timings.map(Number) : [];
    /* quality: completeness + human pace + the bot-detection model.
       Story games: one recorded answer per question beat — analysed with the
       same per-question pipeline as paid surveys. */
    const spec = g.spec;
    const inputScenes = (spec.scenes || []).filter((sc) => sc.input);
    const expected = inputScenes.length;
    const beats = botdetect.gameQuestionBeats(responses);
    let answers, qTimings, questions;
    if (expected) {
      questions = botdetect.gameQuestionsFromScenes(inputScenes);
      answers = beats.map((r) => String(r.answer == null ? "" : r.answer));
      qTimings = beats.map((r) => Number(r.ms) || 0);
    } else {
      questions = [];
      answers = responses.map((r) => typeof r === "object" && r !== null ? JSON.stringify(r.payload != null ? r.payload : r) : String(r));
      qTimings = timings;
    }
    const bd = botdetect.evaluate(answers, qTimings, body.paradata, questions, { userId: user.id, gameId: g.id });
    let score = bd.score; const reasons = [...bd.reasons];
    if (beats.length < expected) { score -= 50; reasons.push("attention"); }
    if (qTimings.length && qTimings.reduce((a, b) => a + b, 0) < expected * 800) { score -= 45; reasons.push("speed"); }
    score = Math.max(0, Math.min(100, score));
    const flagged = score < 60 || bd.flagged;
    const storedPd = { ...(body.paradata || {}), reasons: [...new Set(reasons)], notes: bd.notes, analysis: bd.per_question };
    let pay = { amount: 0, boosted: false, milestone: false };
    tx(() => {
      const u = q.get("SELECT * FROM users WHERE id=?", user.id);
      if (!flagged && !replay) pay = payReward(u, g.reward_cents, "game", `Game · ${g.title}`);
      q.run("INSERT INTO game_plays (game_id,user_id,responses,timings,score,quality_score,flagged,reward_cents,paradata,bot_prob,replay) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        g.id, user.id, JSON.stringify(responses), JSON.stringify(timings), Number(body.score) || null, score, flagged ? 1 : 0, pay.amount,
        JSON.stringify(storedPd), bd.bot_prob || 0, replay ? 1 : 0);
      q.run("UPDATE games SET plays = plays + 1 WHERE id=?", g.id);
    });
    const u2 = q.get("SELECT * FROM users WHERE id=?", user.id);
    return ok({ ...pay, replay, flagged, quality: { score, reasons: [...new Set(reasons)], bot_prob: bd.bot_prob }, ...walletState(u2) });
  }
  m = p.match(/^\/api\/games\/([\w-]+)\/plays$/);
  if (m && method === "GET") {
    if (!needUser()) return;
    const g = q.get("SELECT * FROM games WHERE id=?", m[1]);
    if (!g) return bad("Unknown game.");
    if (g.researcher_id !== "u-" + user.id && !q.get("SELECT 1 x FROM researchers WHERE id=? AND id='wang-ming'", g.researcher_id))
      return json(403, { error: "Only the game's researcher can see its responses." });
    const rows = q.all(`SELECT gp.*, u.name, u.initials, u.photo FROM game_plays gp JOIN users u ON u.id=gp.user_id WHERE gp.game_id=? ORDER BY gp.id DESC`, g.id);
    return ok({
      title: g.title, kind: g.kind,
      plays: rows.map((r) => ({ id: r.id, name: r.name, initials: r.initials, photo: r.photo, date: fmtDate(r.created_at), responses: JSON.parse(r.responses), score: r.score, flagged: !!r.flagged, quality_score: r.quality_score, bot_prob: r.bot_prob || 0, reward_cents: r.reward_cents })),
    });
  }

  m = p.match(/^\/api\/games\/([\w-]+)\/plays\/(\d+)$/);
  if (m && method === "GET") {
    if (!needUser()) return;
    const g = q.get("SELECT * FROM games WHERE id=?", m[1]);
    if (!g) return bad("Unknown game.");
    if (g.researcher_id !== "u-" + user.id && !q.get("SELECT 1 x FROM researchers WHERE id=? AND id='wang-ming'", g.researcher_id))
      return json(403, { error: "Only the game's researcher can see its responses." });
    const r = q.get("SELECT gp.*, u.name, u.photo FROM game_plays gp JOIN users u ON u.id=gp.user_id WHERE gp.id=? AND gp.game_id=?", Number(m[2]), g.id);
    if (!r) return bad("Unknown play.");
    let pd = {}, responses = [];
    try { pd = JSON.parse(r.paradata || "{}"); } catch {}
    try { responses = JSON.parse(r.responses); } catch {}
    const full = storage.load(g.id);
    const inputScenes = full && full.spec ? (full.spec.scenes || []).filter((sc) => sc.input) : [];
    const beats = botdetect.gameQuestionBeats(responses);
    const questions = inputScenes.length ? botdetect.gameQuestionsFromScenes(inputScenes) : beats.map((b) => ({ q: b.question, type: "text" }));
    const perQuestion = Array.isArray(pd.analysis) && pd.analysis.length ? pd.analysis : botdetect.gamePerQuestion(beats, pd, questions);
    const reasons = Array.isArray(pd.reasons) ? pd.reasons : (r.bot_prob >= 0.8 ? ["bot"] : (r.flagged || r.bot_prob >= 0.5) ? ["review"] : []);
    return ok({
      name: r.name, date: fmtDate(r.created_at), flagged: !!r.flagged,
      answers: beats.map((b) => b.timed_out ? "(no decision — time ran out)" : String(b.answer == null ? "" : b.answer)),
      reasons, score: r.quality_score, bot_prob: r.bot_prob || 0,
      timings: beats.map((b) => Number(b.ms) || 0),
      per_question: perQuestion,
      env: pd.env || null, session: pd.session || null,
      questions: questions.map((qq) => ({ q: qq.q, type: qq.type })),
      title: g.title, game_score: r.score, replay: !!r.replay,
      model_notes: Array.isArray(pd.notes) ? pd.notes : [],
      dialogue_beats: responses.length - beats.length,
    });
  }
  m = p.match(/^\/api\/games\/([\w-]+)\/aggregate$/);
  if (m && method === "GET") {
    if (!needUser()) return;
    const g = q.get("SELECT * FROM games WHERE id=?", m[1]);
    if (!g) return bad("Unknown game.");
    if (g.researcher_id !== "u-" + user.id && !q.get("SELECT 1 x FROM researchers WHERE id=? AND id='wang-ming'", g.researcher_id))
      return json(403, { error: "Only the game's researcher can see its responses." });
    const full = storage.load(g.id);
    let inputScenes = full && full.spec ? (full.spec.scenes || []).filter((sc) => sc.input) : [];
    if (!inputScenes.length) {
      /* legacy games without a stored spec: derive the question beats from the plays themselves */
      const seen = new Map();
      for (const row of q.all("SELECT responses FROM game_plays WHERE game_id=? ORDER BY id", g.id)) {
        try {
          for (const b of botdetect.gameQuestionBeats(JSON.parse(row.responses)))
            if (!seen.has(b.question)) seen.set(b.question, { id: b.scene, input: { question: b.question, type: "text" } });
        } catch {}
      }
      inputScenes = [...seen.values()];
    }
    if (!inputScenes.length) return bad("No question beats recorded for this game yet.");
    return ok({ title: g.title, ...botdetect.aggregateGameAnalysis(g.id, inputScenes) });
  }

  /* ---- on-demand webscrape (LLM step on the configured provider) ---- */
  if (p === "/api/scrape" && method === "POST") {
    if (!needUser()) return;
    try { return ok(await scrape.scrape(body && body.url)); } catch (e) { return bad(e.message); }
  }

  /* ---- hourly research pipeline (scrape → format → save → discover) ---- */
  if (p === "/api/pipeline/status" && method === "GET") {
    if (!needUser()) return;
    return ok(pipeline.status());
  }
  if (p === "/api/pipeline/refresh" && method === "POST") {
    if (!needUser()) return;
    if (!user.researcher_mode) return json(403, { error: "Turn on researcher mode to run the pipeline." });
    const st = await pipeline.run();
    return ok({ ...st, discoveries: discoveriesPayload(recommend.rankFeed(user.id, "post", { limit: 40, refresh: true })) });
  }

  /* ---- researcher content creation ---- */
  if (p === "/api/upload" && method === "POST") {
    if (!needUser()) return;
    if (!user.researcher_mode) return json(403, { error: "Turn on researcher mode to upload media." });
    const { raw, ct } = body || {};
    if (!raw || !raw.length) return bad("Empty upload.");
    const ext = { "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "image/jpeg": ".jpg", "image/png": ".png", "image/webm": ".webp", "image/webp": ".webp" }[ct];
    if (!ext) return bad("Upload an mp4/webm/mov video or a jpg/png/webp image.");
    const name = crypto.randomBytes(12).toString("hex") + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), raw);
    return ok({ path: "/uploads/" + name });
  }
  if (p === "/api/studies" && method === "POST") {
    if (!needUser()) return;
    if (!user.researcher_mode) return json(403, { error: "Turn on researcher mode to publish studies." });
    const title = String(body.title || "").trim();
    const sub = String(body.sub || "").trim();
    const video = String(body.video || "").trim();
    const image = String(body.image || "").trim();
    const questions = Array.isArray(body.questions) ? body.questions : [];
    if (title.length < 8) return bad("Give the study a title (at least 8 characters).");
    if (!video && !image) return bad("Upload the intro video or image for the reel.");
    if (!questions.length) return bad("Add at least one question.");
    for (const qq of questions) {
      if (!String(qq.q || "").trim()) return bad("Every question needs text.");
      if (qq.type === "opts" && (!Array.isArray(qq.options) || qq.options.filter((o) => String(o).trim()).length < 2)) return bad("Choice questions need at least two options.");
    }
    const rewardCents = Math.round(Number(body.reward) * 100);
    if (!Number.isFinite(rewardCents) || rewardCents < 5 || rewardCents > 5000) return bad("Reward should be between $0.05 and $50.00.");
    const rid = ensureUserResearcher(user);
    const id = "s-" + crypto.randomBytes(4).toString("hex");
    tx(() => {
      q.run("INSERT INTO studies (id,researcher_id,reward_cents,minutes,genre,video,image,credit,chip,title,sub,active,verified,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,1,datetime('now'))",
        id, rid, rewardCents, Math.max(1, Math.min(30, Number(body.minutes) || 3)),
        ["study", "attention", "earn"].includes(body.genre) ? body.genre : "study",
        video || null, image || null, String(body.credit || "Uploaded by the researcher"), String(body.chip || "Study").slice(0, 24), title, sub);
      questions.forEach((qq, i) => q.run("INSERT INTO questions (study_id,ord,q,type,placeholder,options) VALUES (?,?,?,?,?,?)",
        id, i, String(qq.q).trim(), qq.type === "opts" ? "opts" : "text", String(qq.placeholder || "").slice(0, 80),
        qq.type === "opts" ? JSON.stringify(qq.options.map((o) => String(o).trim()).filter(Boolean)) : null));
      q.run("INSERT INTO researcher_surveys (id,researcher_id,title,month) VALUES (?,?,?,?)", id, rid, title,
        new Date().toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }));
    });
    recommend.loadItems();
    return ok({ id, studies: studiesPayload(recommend.rankFeed(user.id, "study", { limit: 40 })) });
  }
  if (p === "/api/discoveries" && method === "POST") {
    if (!needUser()) return;
    if (!user.researcher_mode) return json(403, { error: "Turn on researcher mode to publish posts." });
    const title = String(body.title || "").trim();
    const video = String(body.video || "").trim();
    const image = String(body.image || "").trim();
    if (title.length < 8) return bad("Give the post a title (at least 8 characters).");
    if (!video && !image) return bad("Upload the video or image for the post.");
    const rid = ensureUserResearcher(user);
    const id = "n-" + crypto.randomBytes(4).toString("hex");
    q.run("INSERT INTO discoveries (id,genre,video,image,credit,chip,title,sub,hearts,reposts,comments,ai,paper_id,media_kind,verified,published_at) VALUES (?,?,?,?,?,?,?,?,0,0,0,?,NULL,?,1,datetime('now'))",
      id, ["study", "attention", "earn"].includes(body.genre) ? body.genre : "study", video || null, image || null,
      String(body.credit || "Uploaded by the researcher"), String(body.chip || "Update").slice(0, 24), title, String(body.sub || "").trim(),
      `Author update · ${user.name}`, video ? "video" : "image");
    q.run("UPDATE discoveries SET researcher_id=? WHERE id=?", rid, id);
    recommend.loadItems();
    return ok({ id, discoveries: discoveriesPayload(recommend.rankFeed(user.id, "post", { limit: 40 })) });
  }

  /* ---- comments ---- */
  m = p.match(/^\/api\/comments\/([\w-]+)$/);
  if (m && method === "GET") {
    if (!needUser()) return;
    const rows = q.all(`SELECT c.*, u.name, u.photo, u.initials FROM comments c JOIN users u ON u.id=c.user_id WHERE c.item_id=? ORDER BY c.id DESC LIMIT 200`, m[1]);
    return ok({
      comments: rows.map((c) => ({
        id: c.id, name: c.name, photo: c.photo, initials: c.initials, text: c.text, date: fmtDate(c.created_at),
        likes: q.get("SELECT COUNT(*) n FROM comment_likes WHERE comment_id=?", c.id).n,
        liked: !!q.get("SELECT 1 x FROM comment_likes WHERE comment_id=? AND user_id=?", c.id, user.id),
        mine: c.user_id === user.id,
      })),
    });
  }
  if (m && method === "POST") {
    if (!needUser()) return;
    const text = String((body && body.text) || "").trim();
    if (!text) return bad("Write a comment first.");
    if (text.length > 500) return bad("Comments are limited to 500 characters.");
    const r = q.run("INSERT INTO comments (item_id,user_id,text) VALUES (?,?,?)", m[1], user.id, text);
    return ok({ id: r.lastInsertRowid });
  }
  m = p.match(/^\/api\/comments\/(\d+)$/);
  if (m && method === "DELETE") {
    if (!needUser()) return;
    const r = q.run("DELETE FROM comments WHERE id=? AND user_id=?", Number(m[1]), user.id);
    if (r.changes === 0) return bad("You can only delete your own comments.");
    return ok({ ok: true });
  }
  m = p.match(/^\/api\/comments\/(\d+)\/like$/);
  if (m && method === "POST") {
    if (!needUser()) return;
    const cid = Number(m[1]);
    if (!q.get("SELECT id FROM comments WHERE id=?", cid)) return bad("Unknown comment.");
    const has = q.get("SELECT 1 x FROM comment_likes WHERE user_id=? AND comment_id=?", user.id, cid);
    if (has) q.run("DELETE FROM comment_likes WHERE user_id=? AND comment_id=?", user.id, cid);
    else q.run("INSERT INTO comment_likes (user_id,comment_id) VALUES (?,?)", user.id, cid);
    return ok({ liked: !has, likes: q.get("SELECT COUNT(*) n FROM comment_likes WHERE comment_id=?", cid).n });
  }

  /* ---- researcher dashboard ---- */
  if (p === "/api/dashboard" && method === "GET") {
    if (!needUser()) return;
    const rid = user.researcher_mode ? "u-" + user.id : "wang-ming";
    const surveys = q.all("SELECT * FROM researcher_surveys WHERE researcher_id=? ORDER BY rowid DESC", rid);
    const withCounts = surveys.map((sv) => ({ ...sv, responses: q.get("SELECT COUNT(*) n FROM responses WHERE study_id=?", studyIdFor(sv.id) || sv.id).n }));
    const games = q.all("SELECT id,kind,title,plays,reward_cents FROM games WHERE researcher_id=? ORDER BY rowid DESC", rid);
    return ok({ published: withCounts.length, surveys: withCounts, games, own: rid !== "wang-ming" });
  }
  m = p.match(/^\/api\/responses\/([\w-]+)$/);
  if (m && method === "GET") {
    if (!needUser()) return;
    const sid = studyIdFor(m[1]);
    if (!sid) return bad("Unknown survey.");
    const rows = q.all(`SELECT r.*, u.name, u.photo, u.initials FROM responses r JOIN users u ON u.id=r.user_id WHERE r.study_id=? ORDER BY r.created_at DESC`, sid);
    return ok({
      title: (q.get("SELECT title FROM researcher_surveys WHERE id=?", m[1]) || q.get("SELECT title FROM studies WHERE id=?", sid)).title,
      responses: rows.map((r) => ({ id: "r" + r.id, name: r.name, photo: r.photo, initials: r.initials, date: fmtDate(r.created_at), flagged: !!r.flagged, quality_score: r.quality_score, bot_prob: r.bot_prob || 0 })),
    });
  }
  m = p.match(/^\/api\/response\/([\w-]+)\/r(\d+)$/);
  if (m && method === "GET") {
    if (!needUser()) return;
    const sid = studyIdFor(m[1]);
    const r = q.get(`SELECT r.*, u.name, u.photo FROM responses r JOIN users u ON u.id=r.user_id WHERE r.id=? AND r.study_id=?`, Number(m[2]), sid);
    if (!r) return bad("Unknown response.");
    let pd = {};
    try { pd = JSON.parse(r.paradata || "{}"); } catch {}
    const questions = q.all("SELECT q,type FROM questions WHERE study_id=? ORDER BY ord", sid);
    return ok({
      name: r.name, date: fmtDate(r.created_at), flagged: !!r.flagged,
      answers: JSON.parse(r.answers), notes: JSON.parse(r.notes || "[]"),
      reasons: JSON.parse(r.flag_reasons || "[]"), score: r.quality_score,
      bot_prob: r.bot_prob || 0,
      timings: JSON.parse(r.timings || "[]"),
      per_question: Array.isArray(pd.analysis) ? pd.analysis : [],
      env: pd.env || null, session: pd.session || null,
      questions: questions.map((qq) => ({ q: qq.q, type: qq.type })),
      title: (q.get("SELECT title FROM researcher_surveys WHERE id=?", m[1]) || q.get("SELECT title FROM studies WHERE id=?", sid)).title,
    });
  }
  m = p.match(/^\/api\/aggregate\/([\w-]+)$/);
  if (m && method === "GET") {
    if (!needUser()) return;
    const sid = studyIdFor(m[1]);
    if (!sid) return bad("Unknown survey.");
    const a = botdetect.aggregateAnalysis(sid);
    return ok({ title: (q.get("SELECT title FROM researcher_surveys WHERE id=?", m[1]) || q.get("SELECT title FROM studies WHERE id=?", sid)).title, ...a });
  }

  return json(404, { error: "Not found." });
}
module.exports = { handle, bootstrap };