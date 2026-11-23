/* EARNest Founder Cockpit · demo data (all fictional, client-side only) */
"use strict";

const DEMO = {
  founder: "Gerald",
  credits: { used: 895, cap: 2000 },

  kpis: {
    dau: 4820, wau: 19340, responses: 1268, liability: 642.30,
    revenue: 1893.40, flagRate: 4.2, discoverSize: 2847, discoverIngest: 96,
    studies: 1184, coverageBalance: 92,
    sparks: {
      dau: [38, 41, 40, 44, 47, 46, 52, 55, 53, 58, 61, 64],
      responses: [20, 24, 22, 28, 31, 29, 35, 38, 36, 42, 45, 48],
      revenue: [12, 14, 13, 17, 16, 19, 22, 21, 25, 27, 26, 30],
      liability: [30, 32, 31, 35, 34, 38, 37, 41, 40, 44, 43, 46],
    },
  },

  agents: [
    { id: "a-sourcer", name: "Study Sourcer", icon: "flask", role: "Scrape → verify → transform paid studies, gap-first", schedule: "Hourly · :15", status: "idle", last: "12m ago", next: "48m", jobs: 3, credits: 140, budget: 300, success: 98 },
    { id: "a-discover", name: "Discovery Pipeline", icon: "globe", role: "arXiv / HN / NASA → Discover findings", schedule: "Hourly", status: "running", last: "now", next: "51m", jobs: 4, credits: 90, budget: 200, success: 99 },
    { id: "a-game", name: "Game Builder", icon: "bot", role: "Writes game specs on QwenWork credits", schedule: "Every 10m", status: "idle", last: "4m ago", next: "6m", jobs: 6, credits: 320, budget: 500, success: 96 },
    { id: "a-deck", name: "Deck Writer", icon: "doc", role: "Refreshes investor deck from metrics snapshots", schedule: "Mon · 08:00", status: "idle", last: "4d ago", next: "2d", jobs: 0, credits: 60, budget: 150, success: 100 },
    { id: "a-growth", name: "Growth & CRM", icon: "mega", role: "Hashmeta content, visibility checks, lead nurture", schedule: "Daily · 07:30", status: "failed", last: "2h ago", next: "21h", jobs: 0, credits: 45, budget: 250, success: 88 },
    { id: "a-ops", name: "Ops Reporter", icon: "chart", role: "Morning agenda, KPI snapshot, alert digest", schedule: "Daily · 06:00", status: "idle", last: "5h ago", next: "19h", jobs: 1, credits: 30, budget: 100, success: 100 },
    { id: "a-leadscout", name: "Lead Scout", icon: "radar", role: "Monitors LinkedIn / Instagram / Facebook / X / email for researchers likely to convert", schedule: "Every 30m", status: "running", last: "now", next: "22m", jobs: 9, credits: 120, budget: 300, success: 93 },
    { id: "a-invscout", name: "Investor Scout", icon: "target", role: "Scores chats & posts for investors most likely to fund Earnest", schedule: "Hourly · :40", status: "idle", last: "18m ago", next: "42m", jobs: 4, credits: 80, budget: 200, success: 91 },
  ],

  alerts: [
    { level: "err", text: "Growth & CRM run failed", sub: "Bridge timeout after 200s — worker may be offline. Retry queued.", view: "agents" },
    { level: "warn", text: "Coverage gap: Quantum & physics", sub: "3 of 5 subtopics at zero active studies. Sourcer job proposed.", view: "research" },
    { level: "warn", text: "Withdrawal stuck in processing", sub: "w-1042 · $31.20 · processing for 6h (simulated processor).", view: "money" },
  ],

  agenda: [
    "4 proposals awaiting approval (1 high-risk takedown)",
    "3 flagged responses to review in Quality & Trust — backlog 2h",
    "1 withdrawal over the $20 threshold",
    "Source Quantum & physics gap before adding elsewhere",
    "Approve November investor-deck refresh",
  ],

  activity: [
    { tone: "lav", icon: "bot", text: "<b>Game Builder</b> completed <b>“Signal Check: Reef Edition”</b> → draft", time: "4m ago" },
    { tone: "money", icon: "coin", text: "Withdrawal <b>w-1041</b> settled · <b>$12.50</b> to PayPal", time: "9m ago" },
    { tone: "blue", icon: "flask", text: "<b>Study Sourcer</b> verified NCT07697092 · all gates green", time: "12m ago" },
    { tone: "blue", icon: "globe", text: "<b>Discovery Pipeline</b> added 4 findings · catalog 2,847", time: "26m ago" },
    { tone: "error", icon: "shield", text: "Response <b>r-88213</b> flagged · score 41 · held unpaid", time: "31m ago" },
    { tone: "earn", icon: "users", text: "<b>Maya R.</b> hit a 7-day streak · 2x window opened", time: "44m ago" },
    { tone: "money", icon: "doc", text: "Invoice <b>inv-207</b> paid · Dr. Okafor · <b>$240.00</b>", time: "5h ago" },
    { tone: "lav", icon: "radar", text: "<b>Lead Scout</b> scored 9 chats · 3 hot researcher leads", time: "8m ago" },
    { tone: "blue", icon: "target", text: "<b>Investor Scout</b> flagged <b>Sebrina Fund</b> · likelihood 87", time: "18m ago" },
  ],

  approvals: [
    {
      id: "ap-1", flow: "studies", risk: "low", agent: "Study Sourcer", status: "pending",
      title: "New paid study · “Mapping how reef soundscapes guide coral recovery”",
      payload: "Chip: Coral reefs · Reward $0.60 · 4 min · 4 questions. Citizen-science acoustic monitoring with a real participant questionnaire.",
      evidence: [
        { ok: true, text: "DOI 10.1038/s41598-024-XXXXX resolves · title & authors match" },
        { ok: true, text: "Genuine participant need · modelable as 4-question sheet" },
        { ok: true, text: "Copy lint pass · goal title · pitch 231 chars · chip exact" },
        { ok: true, text: "Fills coverage gap · Ocean & wildlife had 2 empty cells" },
      ],
    },
    {
      id: "ap-2", flow: "payouts", risk: "medium", agent: "Ops Reporter", status: "pending",
      title: "Withdrawal over threshold · $24.00",
      payload: "Maya R. → PayPal (•••• 4417). Fee $0.48 (2%). Wallet debits on approval; settles processing → paid.",
      evidence: [
        { ok: true, text: "Avg quality 92 across 41 responses · zero flags" },
        { ok: true, text: "No device/IP cluster · bot score 0.02" },
        { ok: true, text: "Balance covers amount + fee · ledger reconciled" },
      ],
    },
    {
      id: "ap-5", flow: "deck", risk: "low", agent: "Deck Writer", status: "pending",
      title: "Investor deck refresh · November traction",
      payload: "3 slides changed: traction (DAU 4,820), unit economics (cost/quality response $0.41), marketplace liquidity. Diff attached.",
      evidence: [
        { ok: true, text: "All figures from frozen metrics snapshot 2026-11-21" },
        { ok: true, text: "No PII · aggregate only" },
      ],
    },
    {
      id: "ap-6", flow: "takedown", risk: "high", agent: "Community Mod", status: "pending",
      title: "Takedown request · comment on “Sleep & kindness”",
      payload: "3 user reports: spam link in comment c-5521. Proposed action: remove comment + warn author. Always-ask policy.",
      evidence: [
        { ok: true, text: "Link matches known spam pattern · 3 independent reports" },
        { ok: true, text: "Author account 2d old · 12 identical comments" },
      ],
    },
  ],

  topics: [
    { name: "AI & machine learning", cells: [4, 3, 2, 3, 4] },
    { name: "Space & astronomy", cells: [2, 2, 1, 2, 3] },
    { name: "Climate & energy", cells: [3, 2, 2, 3, 2] },
    { name: "Health & medicine", cells: [4, 3, 4, 2, 3] },
    { name: "Brain & behaviour", cells: [6, 7, 6, 5, 7] },
    { name: "Ocean & wildlife", cells: [1, 2, 2, 1, 0] },
    { name: "Cities & transport", cells: [2, 1, 2, 2, 1] },
    { name: "Food & agriculture", cells: [2, 2, 1, 2, 2] },
    { name: "Materials & devices", cells: [1, 1, 0, 2, 1] },
    { name: "Economics & work", cells: [3, 2, 2, 1, 2] },
    { name: "Robotics & drones", cells: [1, 2, 1, 1, 2] },
    { name: "Quantum & physics", cells: [1, 0, 0, 0, 1] },
    { name: "Genetics & bio", cells: [2, 2, 1, 2, 2] },
    { name: "Security & privacy", cells: [2, 1, 2, 2, 1] },
    { name: "Media & misinformation", cells: [2, 2, 1, 2, 2] },
    { name: "Earth & environment", cells: [2, 1, 2, 2, 1] },
    { name: "Psychology & society", cells: [3, 2, 2, 3, 2] },
    { name: "Education & learning", cells: [2, 2, 1, 1, 2] },
    { name: "Chemistry", cells: [1, 1, 0, 1, 1] },
    { name: "Mathematics & stats", cells: [1, 2, 1, 1, 2] },
    { name: "Sport & performance", cells: [2, 1, 1, 2, 1] },
    { name: "Art, design & audio", cells: [2, 1, 2, 1, 2] },
  ],
  subtopics: ["Field A", "Field B", "Field C", "Field D", "Field E"],

  sourcing: {
    scrape: [
      { title: "Reef acoustic enrichment trial", meta: "DOI · Ocean & wildlife", gates: [] },
      { title: "Fusion plasma control survey", meta: "DOI · Quantum & physics", gates: [] },
    ],
    verify: [
      { title: "Superconductor qubit noise study", meta: "NCT07712301", gates: [["Real", 1], ["Need", 1], ["Model", 1], ["Status", 1], ["Dedupe", 1], ["Ethics", 1]] },
      { title: "Catalysis citizen sampling", meta: "DOI · Chemistry", gates: [["Real", 1], ["Need", 1], ["Model", 0], ["Status", 1], ["Dedupe", 1], ["Ethics", 1]] },
    ],
    transform: [
      { title: "Mapping reef soundscapes", meta: "pitch 231 chars · 4 Qs", gates: [["Lint", 1], ["Chip", 1]] },
    ],
    apply: [
      { title: "Understanding self-worth sources", meta: "s-2148 · staged", gates: [["Backup", 1]] },
    ],
    sync: [
      { title: "November batch · 6 studies", meta: "snapshot exported", gates: [["Owner", 1]] },
    ],
  },

  pipeline: { paused: false, lastRun: "26m ago", added: 4, errors: 0, cursor: "Climate & energy · 12/22", sources: ["arXiv", "Hacker News", "NASA"], ingestToday: 96 },

  studies: [
    { id: "s-2141", title: "Finding out if good sleep makes us kinder", chip: "Sleep", reward: 60, min: 4, resp: 312, quality: 91, active: true },
    { id: "s-2139", title: "Catching depression earlier", chip: "Mental health", reward: 75, min: 5, resp: 508, quality: 88, active: true },
    { id: "s-2136", title: "Understanding where self-worth comes from", chip: "Wellbeing", reward: 55, min: 3, resp: 274, quality: 93, active: true },
    { id: "s-2132", title: "How crowds decide under pressure", chip: "Decision-making", reward: 65, min: 4, resp: 189, quality: 90, active: true },
    { id: "s-2128", title: "Tracking attention in noisy feeds", chip: "Attention", reward: 50, min: 3, resp: 421, quality: 86, active: true },
    { id: "s-2125", title: "What makes a fact feel true", chip: "Fact-checking", reward: 60, min: 4, resp: 156, quality: 92, active: true },
    { id: "s-2119", title: "Fairness in split-second choices", chip: "Fairness", reward: 70, min: 5, resp: 98, quality: 89, active: false },
    { id: "s-2114", title: "Reading trust in human-robot teams", chip: "Human-robot interaction", reward: 65, min: 4, resp: 64, quality: 94, active: true },
  ],

  gameQueue: {
    budget: { used: 6, cap: 10 },
    items: [
      { id: "g-9f2a", title: "Signal Check: Reef Edition", kind: "signal", status: "draft", reward: 50 },
      { id: "g-7c11", title: "The Lifeboat Dilemma", kind: "disaster", status: "draft", reward: 65 },
      { id: "g-3b8e", title: "Building a city, block by block", kind: "build", status: "building", reward: 0 },
      { id: "g-1d40", title: "Jury of your peers", kind: "jury", status: "queued", reward: 0 },
      { id: "g-0a99", title: "A story about honesty", kind: "story", status: "queued", reward: 0 },
    ],
    published: 42,
  },

  flagged: [
    { id: "r-88213", study: "Catching depression earlier", user: "devnull_22", score: 41, timing: 18, attention: 0, consistency: 55, age: "31m", history: "First flag · 3 responses" },
    { id: "r-88190", study: "Tracking attention in noisy feeds", user: "quickcash99", score: 52, timing: 30, attention: 50, consistency: 61, age: "1h", history: "2 prior flags · 19 responses" },
    { id: "r-88164", study: "How crowds decide under pressure", user: "sam.k", score: 58, timing: 62, attention: 100, consistency: 44, age: "2h", history: "Clean · 27 responses" },
  ],
  qualityDist: [2, 1, 3, 6, 11, 18, 26, 34, 41, 30],
  botCases: [
    { id: "case-7", title: "Device cluster · 5 accounts, 1 fingerprint", detail: "Shared device hash across 5 wallets · $83.10 combined · streak farming pattern", risk: "high" },
    { id: "case-6", title: "Impossible timing · 12 answers in 40s", detail: "Single IP · answers faster than render time · bot score 0.94", risk: "high" },
    { id: "case-5", title: "Referral ring · circular follows", detail: "8 accounts mutual-follow + repost loop · low response quality", risk: "medium" },
  ],

  withdrawals: [
    { id: "w-1042", user: "Leo T.", amount: 31.20, fee: 0.62, dest: "Bank •••• 8821", status: "processing", age: "6h" },
    { id: "w-1041", user: "Priya N.", amount: 12.50, fee: 0.25, dest: "PayPal", status: "paid", age: "9m" },
    { id: "w-1040", user: "Maya R.", amount: 24.00, fee: 0.48, dest: "PayPal •••• 4417", status: "awaiting", age: "12m" },
    { id: "w-1039", user: "Tom H.", amount: 8.75, fee: 0.25, dest: "Card •••• 3310", status: "paid", age: "1h" },
  ],
  ledger: [
    { id: "l-9921", user: "Maya R.", type: "answer", amount: 1.20, note: "s-2141 · 2x window", time: "44m" },
    { id: "l-9920", user: "Priya N.", type: "withdrawal", amount: -12.50, note: "w-1041", time: "9m" },
    { id: "l-9919", user: "Leo T.", type: "withdrawal", amount: -31.20, note: "w-1042 · hold", time: "6h" },
    { id: "l-9918", user: "sam.k", type: "answer", amount: 0.65, note: "s-2132", time: "2h" },
    { id: "l-9917", user: "Dr. Okafor", type: "invoice", amount: 240.00, note: "inv-207 · platform revenue", time: "5h" },
    { id: "l-9916", user: "quickcash99", type: "hold", amount: 0.50, note: "r-88190 · flagged", time: "1h" },
  ],
  invoices: [
    { id: "inv-207", researcher: "Dr. Okafor · UCL", study: "Sleep & kindness", responses: 400, amount: 240.00, status: "paid" },
    { id: "inv-206", researcher: "Dr. Reyes · MIT", study: "Crowds under pressure", responses: 250, amount: 162.50, status: "sent" },
    { id: "inv-205", researcher: "Dr. Lindqvist · Karolinska", study: "Catching depression earlier", responses: 600, amount: 450.00, status: "paid" },
  ],
  economics: { costPerResponse: 0.41, takeRate: 18, marginPerStudy: 0.22, avgReward: 0.61 },

  users: [
    { name: "Maya R.", email: "maya@example.com", wallet: 41.20, streak: 7, responses: 41, quality: 92, flags: 0, status: "active", av: 1 },
    { name: "Leo T.", email: "leo@example.com", wallet: 8.10, streak: 3, responses: 18, quality: 88, flags: 0, status: "active", av: 2 },
    { name: "Priya N.", email: "priya@example.com", wallet: 22.75, streak: 12, responses: 63, quality: 95, flags: 0, status: "active", av: 3 },
    { name: "sam.k", email: "sam@example.com", wallet: 14.30, streak: 2, responses: 27, quality: 84, flags: 1, status: "active", av: 4 },
    { name: "quickcash99", email: "qc99@example.com", wallet: 3.10, streak: 0, responses: 19, quality: 47, flags: 2, status: "watch", av: 5 },
    { name: "devnull_22", email: "dn22@example.com", wallet: 0.50, streak: 0, responses: 3, quality: 41, flags: 1, status: "watch", av: 1 },
  ],
  researcherQueue: [
    { name: "Dr. Amara Okafor", org: "UCL · Sleep & decision lab", studies: 3, verified: true },
    { name: "Dr. Luis Reyes", org: "MIT · Collective behaviour", studies: 2, verified: true },
    { name: "N. Haddad", org: "Independent · HCI", studies: 0, verified: false },
  ],

  reports: [
    { id: "rep-31", target: "comment c-5521", reason: "Spam link", reports: 3, status: "open", proposed: "Remove + warn author" },
    { id: "rep-30", target: "repost r-2210", reason: "Misleading claim", reports: 1, status: "open", proposed: "Label + reduce reach" },
    { id: "rep-29", target: "comment c-5498", reason: "Harassment", reports: 2, status: "resolved", proposed: "Removed · author warned" },
  ],

  growth: {
    kpis: { sessions: 18420, users: 12980, pageviews: 41230, bounce: 38.2, avgDuration: "2m 41s", leads: 62, hotLeads: 7, conversion: 4.8, pipelineValue: 48600, citations: 14, keywordsTop10: 9 },
    hashmeta: {
      cms: {
        status: "live", lastPublish: "2d ago", pages: 6, posts: 24, media: 132, collections: 3, forms: 4, queue: 2,
        topPages: [
          { path: "/", title: "Home · earn from research", views: 9210, conv: 5.2 },
          { path: "/researchers", title: "For researchers", views: 4180, conv: 8.1 },
          { path: "/how-it-works", title: "How Earnest works", views: 3060, conv: 3.4 },
          { path: "/blog/quality-screen", title: "The quality screen", views: 1890, conv: 2.1 },
        ],
        blog: { writers: 2, scheduled: 5, published: 24, reviews: 2 },
      },
      seo: {
        clicks: 3120, impressions: 84200, ctr: 3.7, position: 11.4, indexed: 31, backlinks: 48,
        topQueries: [
          { q: "paid research studies", clicks: 620, pos: 4 },
          { q: "gamified science participation", clicks: 410, pos: 2 },
          { q: "earn money answering surveys", clicks: 380, pos: 11 },
          { q: "participant paid studies", clicks: 290, pos: 6 },
        ],
        aiVisibility: { chatgpt: true, gemini: true, perplexity: false, citations: 14 },
        visibility: [
          { kw: "paid research studies", google: 4, ai: true },
          { kw: "earn money answering surveys", google: 11, ai: false },
          { kw: "gamified science participation", google: 2, ai: true },
        ],
      },
      crm: {
        capture: 34, nurture: 18, convert: 7, won: 3, value: 48600,
        rates: { captureToNurture: 53, nurtureToConvert: 39, convertToWon: 43 },
        sources: [
          { name: "Hashmeta forms", leads: 26, won: 2 },
          { name: "AI answer referrals", leads: 14, won: 1 },
          { name: "Google organic", leads: 12, won: 0 },
          { name: "Social listening", leads: 10, won: 0 },
        ],
        sequences: [
          { name: "Researcher welcome", enrolled: 18, open: 62, reply: 21 },
          { name: "Quality methodology nurture", enrolled: 11, open: 55, reply: 18 },
        ],
        submissions: [
          { id: "sub-118", name: "Dr. K. Tanaka", form: "Researcher inquiry", when: "2h ago", status: "new" },
          { id: "sub-117", name: "Helix Labs", form: "Bulk responses", when: "5h ago", status: "contacted" },
          { id: "sub-116", name: "Prof. E. Moreau", form: "Researcher inquiry", when: "1d ago", status: "qualified" },
        ],
      },
    },
    leads: [
      { name: "Dr. K. Tanaka", org: "RIKEN", stage: "nurture", source: "Hashmeta form", next: "Send quality methodology" },
      { name: "Helix Labs", org: "Biotech startup", stage: "convert", source: "AI answer referral", next: "Proposal · 500 responses" },
      { name: "Prof. E. Moreau", org: "Sorbonne", stage: "capture", source: "Google · paid studies", next: "Qualify budget" },
      { name: "CivicLab SG", org: "Non-profit", stage: "won", source: "Referral", next: "Onboard · 2 studies" },
    ],
    listening: {
      scanned: 1240, leadsIdentified: 62, hot: 7, agent: "Lead Scout",
      platforms: [
        { name: "LinkedIn", icon: "linkedin", mentions: 410, leads: 24, hot: 4 },
        { name: "Instagram", icon: "instagram", mentions: 280, leads: 12, hot: 1 },
        { name: "Facebook", icon: "facebook", mentions: 190, leads: 9, hot: 1 },
        { name: "X", icon: "x", mentions: 220, leads: 11, hot: 1 },
        { name: "Email", icon: "mail", mentions: 96, leads: 6, hot: 0 },
        { name: "Reddit", icon: "reddit", mentions: 44, leads: 0, hot: 0 },
      ],
      leads: [
        { id: "lead-1", name: "Dr. Amara Okafor", handle: "@a.okafor", platform: "LinkedIn", icon: "linkedin", role: "Sleep & decision lab lead", org: "UCL", score: 92, signal: "Posted asking for “quality-screened participant panels” for a sleep study; 3 replies tagging survey tools.", reason: "Active buyer intent · budget mentioned · matches sleep topic", next: "Send methodology + 400-response quote", status: "hot" },
        { id: "lead-2", name: "Helix Labs", handle: "@helixlabs", platform: "X", icon: "x", role: "Biotech startup", org: "Helix Labs", score: 88, signal: "Thread on recruiting 500 respondents for a nutrition trial; complaining about panel quality.", reason: "Explicit volume need · pain point we solve", next: "Proposal · 500 responses", status: "hot" },
        { id: "lead-3", name: "Prof. E. Moreau", handle: "emoreau@sorbonne.fr", platform: "Email", icon: "mail", role: "Professor", org: "Sorbonne", score: 81, signal: "Replied to nurture email asking about attention-gate methodology and pricing.", reason: "Engaged · methodology question = strong fit", next: "Qualify budget · share quality docs", status: "hot" },
        { id: "lead-4", name: "Dr. Luis Reyes", handle: "@lreyes.mit", platform: "Instagram", icon: "instagram", role: "Collective behaviour", org: "MIT", score: 74, signal: "Story poll on “paid vs unpaid research participation”; DM'd asking how Earnest screens bots.", reason: "Curious · bot-screening interest", next: "Share bot-detection overview", status: "warm" },
        { id: "lead-5", name: "CivicLab SG", handle: "civiclab.sg", platform: "Facebook", icon: "facebook", role: "Non-profit", org: "CivicLab SG", score: 69, signal: "Comment in a citizen-science group looking for paid community surveys.", reason: "Mission fit · modest budget", next: "Intro call · 2 pilot studies", status: "warm" },
        { id: "lead-6", name: "N. Haddad", handle: "@nhaddad.hci", platform: "LinkedIn", icon: "linkedin", role: "Independent HCI", org: "Independent", score: 58, signal: "Liked 3 posts about gamified studies; no direct ask yet.", reason: "Passive interest · nurture", next: "Add to welcome sequence", status: "nurture" },
      ],
    },
    campaigns: [
      { name: "Launch · SG founders", channel: "Hashmeta + social", signups: 412, firstAnswers: 268, cost: 180 },
      { name: "Streak week promo", channel: "In-app + email", signups: 156, firstAnswers: 121, cost: 40 },
      { name: "Researcher outreach · Q4", channel: "LinkedIn + email", signups: 38, firstAnswers: 22, cost: 95 },
    ],
  },

  deploy: {
    kpis: { uptime: 99.98, p50: 62, p95: 184, errorRate: 0.12, requestsMin: 340, bandwidth: "1.2 GB", cacheHit: 91, sslDays: 74 },
    local: { version: "v1.4.2", status: "running", uptime: "3d 4h", cpu: 18, mem: 412 },
    cloud: { version: "v1.4.1", page: "xuw6xcjq.qwenwork.page", status: "live", lastPublish: "1d ago", sync: "ok", region: "ap-southeast-1", cdn: "on" },
    preview: { version: "v1.4.2-rc", status: "staging", url: "preview · internal", sync: "pending" },
    steps: [
      { label: "Build snapshot", state: "done" },
      { label: "Diff preview", state: "done" },
      { label: "Owner-task republish", state: "active" },
      { label: "Verify live", state: "todo" },
    ],
    diff: { added: 6, deactivated: 2, copy: 4 },
    health: { apiLatency: 84, bridge: "online", dbSize: "48 MB", wal: "clean", errors24h: 1 },
    statusCodes: [
      { code: "2xx", pct: 99.4, tone: "money" },
      { code: "3xx", pct: 0.4, tone: "blue" },
      { code: "4xx", pct: 0.18, tone: "earn" },
      { code: "5xx", pct: 0.02, tone: "error" },
    ],
    deployments: [
      { id: "dep-31", version: "v1.4.1", env: "cloud", when: "1d ago", dur: "42s", status: "success", by: "Owner task" },
      { id: "dep-30", version: "v1.4.0", env: "cloud", when: "3d ago", dur: "39s", status: "success", by: "Owner task" },
      { id: "dep-29", version: "v1.3.9", env: "cloud", when: "5d ago", dur: "51s", status: "rolled back", by: "Founder" },
      { id: "dep-28", version: "v1.3.8", env: "cloud", when: "6d ago", dur: "44s", status: "success", by: "Owner task" },
    ],
    changelog: [
      { v: "v1.4.2", note: "Coverage-gap sourcing + approval inbox", when: "today" },
      { v: "v1.4.1", note: "Quality screen v2 · timing telemetry", when: "1d ago" },
      { v: "v1.4.0", note: "QwenWork credit bridge for games", when: "3d ago" },
    ],
  },

  investors: {
    snapshot: { period: "2026-11-21", dau: 4820, responses: 1268, revenue: 1893.40, liability: 642.30, quality: 95.8, coverage: 92 },
    deck: { updated: "3 slides", slides: ["Traction", "Unit economics", "Marketplace liquidity"], status: "awaiting approval" },
    contacts: [
      { name: "Sebrina Fund", contact: "K. Lim", last: "4d ago", next: "November update" },
      { name: "BIMC Ventures", contact: "R. Tan", last: "1w ago", next: "Deck refresh" },
      { name: "Angel · J. Wu", contact: "J. Wu", last: "2d ago", next: "Intro call" },
    ],
    dataRoom: ["Metrics CSV", "Coverage audit", "Quality methodology", "Financial summary"],
    listening: { scanned: 860, identified: 23, hot: 5, agent: "Investor Scout" },
    suggested: [
      { id: "inv-1", name: "Sebrina Fund", contact: "K. Lim", platform: "LinkedIn", icon: "linkedin", focus: "Frontier tech · AI", score: 87, signal: "Partner posted about “AI-native marketplaces with real unit economics”; liked Earnest's traction thread.", reason: "Thesis fit · engaged with our content · family office", next: "Send November update + deck", status: "hot", av: 1 },
      { id: "inv-2", name: "BIMC Ventures", contact: "R. Tan", platform: "Email", icon: "mail", focus: "SME AI · Singapore", score: 82, signal: "Replied to intro asking for the quality methodology and margin per study.", reason: "Active diligence · requested metrics", next: "Share data room · margin detail", status: "hot", av: 2 },
      { id: "inv-3", name: "J. Wu", contact: "Angel", platform: "X", icon: "x", focus: "Consumer · gamification", score: 78, signal: "Quote-posted Earnest's streak mechanic: “this is how you make research sticky.”", reason: "Public enthusiasm · consumer thesis", next: "Intro call · demo the feed", status: "hot", av: 3 },
      { id: "inv-4", name: "Hikari Angels", contact: "M. Sato", platform: "Instagram", icon: "instagram", focus: "Deep tech · automation", score: 66, signal: "Followed Earnest + saved 3 posts; DM asked about the agent workforce.", reason: "Curious · automation angle", next: "Share the cockpit demo", status: "warm", av: 4 },
      { id: "inv-5", name: "Digital China VC", contact: "L. Chen", platform: "Facebook", icon: "facebook", focus: "Data cloud · APAC", score: 61, signal: "Commented on a research-data post asking about scale and coverage.", reason: "Scale interest · early", next: "Add to nurture · coverage audit", status: "warm", av: 5 },
      { id: "inv-6", name: "K. Lim", contact: "Angel", platform: "LinkedIn", icon: "linkedin", focus: "EdTech · science", score: 54, signal: "Liked 2 posts; no direct interaction yet.", reason: "Passive · nurture", next: "Invite to demo day", status: "nurture", av: 1 },
    ],
  },

  runs: [
    { agent: "Game Builder", started: "4m ago", dur: "38s", jobs: 1, credits: 52, status: "ok" },
    { agent: "Discovery Pipeline", started: "26m ago", dur: "51s", jobs: 4, credits: 22, status: "ok" },
    { agent: "Study Sourcer", started: "12m ago", dur: "1m 12s", jobs: 1, credits: 41, status: "ok" },
    { agent: "Growth & CRM", started: "2h ago", dur: "200s", jobs: 0, credits: 45, status: "failed" },
    { agent: "Ops Reporter", started: "5h ago", dur: "24s", jobs: 1, credits: 30, status: "ok" },
    { agent: "Game Builder", started: "14m ago", dur: "41s", jobs: 1, credits: 55, status: "ok" },
    { agent: "Discovery Pipeline", started: "1h ago", dur: "48s", jobs: 4, credits: 21, status: "ok" },
    { agent: "Lead Scout", started: "8m ago", dur: "1m 04s", jobs: 9, credits: 38, status: "ok" },
    { agent: "Investor Scout", started: "18m ago", dur: "52s", jobs: 4, credits: 26, status: "ok" },
  ],
  bridge: { pending: 1, done: 23, failed: 1, processed: 142, timeoutRate: 2.1, worker: "online" },

  connections: [
    { name: "Google sign-in", status: "connected", detail: "OAuth client · real redirect" },
    { name: "Apple sign-in", status: "demo", detail: "Demo button · Services ID not set" },
    { name: "Email · Resend", status: "connected", detail: "API key •••• 7f2a" },
    { name: "Payment processor", status: "simulated", detail: "Wire Stripe/Adyen in payments.js" },
    { name: "QwenWork bridge", status: "connected", detail: "Loopback file queue · worker online" },
  ],
  policies: [
    { k: "Auto-approve withdrawals below", v: "$5.00" },
    { k: "Always-ask payout threshold", v: "$20.00" },
    { k: "Quality flag threshold", v: "score < 60" },
    { k: "Reward bounds", v: "$0.50 – $0.75" },
    { k: "Discover ingest rate limit", v: "4 topics / run" },
    { k: "Game credit budget (demo)", v: "10 / day" },
    { k: "Takedown / public content", v: "always ask" },
  ],
  audit: [
    { actor: "Founder", action: "approved", target: "ap-0 · study s-2141", when: "1h ago" },
    { actor: "Game Builder", action: "created draft", target: "g-9f2a", when: "4m ago" },
    { actor: "Quality Screen", action: "flagged", target: "r-88213 · held unpaid", when: "31m ago" },
    { actor: "Founder", action: "settled", target: "w-1041 · $12.50", when: "9m ago" },
    { actor: "Discovery Pipeline", action: "ingested", target: "4 findings", when: "26m ago" },
    { actor: "Founder", action: "rejected", target: "ap-0 · pitch too long", when: "2h ago" },
  ],
};