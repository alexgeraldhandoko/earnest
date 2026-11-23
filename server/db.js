/* EARNest · database layer — node:sqlite, persistent SQL file.
   Node >= 22.13: works out of the box. Node 22.5–22.12: sqlite sits behind
   --experimental-sqlite, so we transparently restart with that flag. */
"use strict";
let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (e) {
  const flagKnown = process.allowedNodeEnvironmentFlags && process.allowedNodeEnvironmentFlags.has("--experimental-sqlite");
  if (e.code === "ERR_UNKNOWN_BUILTIN_MODULE" && flagKnown && !process.env.EARNEST_SQLITE_REEXEC) {
    const { spawnSync } = require("node:child_process");
    console.log("Node " + process.versions.node + ": enabling node:sqlite via --experimental-sqlite (upgrade to Node 22.13+ to skip this).");
    const r = spawnSync(process.execPath, ["--experimental-sqlite", ...process.execArgv, ...process.argv.slice(1)], {
      stdio: "inherit",
      env: { ...process.env, EARNEST_SQLITE_REEXEC: "1" },
    });
    process.exit(r.status == null ? 1 : r.status);
  }
  console.error("EARNest needs Node.js 22.13 or newer (Node 22.5+ also works via --experimental-sqlite).");
  console.error("You are running " + process.versions.node + ". Upgrade Node, then run npm start again.");
  process.exit(1);
}
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

/* Working data dir: prefer <app>/data; on read-only runtimes (e.g. hosted
   Pages) fall back to a writable temp dir. Supabase is the durable store. */
const APP_DATA = path.join(__dirname, "..", "data");
let DATA_DIR = APP_DATA;
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch {
  DATA_DIR = path.join(os.tmpdir(), "earnest-data");
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const db = new DatabaseSync(path.join(DATA_DIR, "earnest.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT, salt TEXT,
  photo TEXT, initials TEXT,
  interests TEXT DEFAULT '', answer_windows TEXT DEFAULT '',
  researcher_mode INTEGER DEFAULT 0,
  streak_day INTEGER DEFAULT 0, last_active_date TEXT,
  multiplier_left INTEGER DEFAULT 0,
  wallet_cents INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, provider_uid TEXT NOT NULL,
  UNIQUE (provider, provider_uid)
);
CREATE TABLE IF NOT EXISTS researchers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, org TEXT NOT NULL,
  initials TEXT, photo TEXT, since TEXT, avatar_class TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  researcher_id TEXT NOT NULL REFERENCES researchers(id),
  icon TEXT, text TEXT
);
CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY,
  researcher_id TEXT REFERENCES researchers(id),
  title TEXT NOT NULL, authors TEXT, price_cents INTEGER DEFAULT 99, abstract TEXT
);
CREATE TABLE IF NOT EXISTS studies (
  id TEXT PRIMARY KEY,
  researcher_id TEXT NOT NULL REFERENCES researchers(id),
  reward_cents INTEGER NOT NULL, minutes INTEGER, genre TEXT,
  video TEXT, credit TEXT, chip TEXT, title TEXT NOT NULL, sub TEXT,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL, q TEXT NOT NULL, type TEXT NOT NULL,
  placeholder TEXT, options TEXT
);
CREATE TABLE IF NOT EXISTS discoveries (
  id TEXT PRIMARY KEY, genre TEXT, video TEXT, credit TEXT, chip TEXT,
  title TEXT NOT NULL, sub TEXT,
  hearts INTEGER DEFAULT 0, reposts INTEGER DEFAULT 0, comments INTEGER DEFAULT 0,
  ai TEXT, paper_id TEXT REFERENCES papers(id), researcher_id TEXT
);
CREATE TABLE IF NOT EXISTS impact_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT, icon TEXT, grow INTEGER DEFAULT 0, title TEXT, text TEXT,
  paper_id TEXT REFERENCES papers(id)
);
CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_id TEXT NOT NULL REFERENCES studies(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  answers TEXT NOT NULL, timings TEXT, notes TEXT,
  quality_score INTEGER DEFAULT 100, flagged INTEGER DEFAULT 0, flag_reasons TEXT DEFAULT '[]',
  reward_cents INTEGER DEFAULT 0, boosted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS hearts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL, PRIMARY KEY (user_id, item_id)
);
CREATE TABLE IF NOT EXISTS follows (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  researcher_id TEXT NOT NULL REFERENCES researchers(id), PRIMARY KEY (user_id, researcher_id)
);
CREATE TABLE IF NOT EXISTS reposts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL, PRIMARY KEY (user_id, item_id)
);
CREATE TABLE IF NOT EXISTS unlocked_papers (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL REFERENCES papers(id), PRIMARY KEY (user_id, paper_id)
);
CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,              -- card | bank | paypal
  brand TEXT, last4 TEXT, exp_month INTEGER, exp_year INTEGER,
  holder TEXT, billing_zip TEXT, token TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method_id INTEGER NOT NULL REFERENCES payment_methods(id),
  amount_cents INTEGER NOT NULL, fee_cents INTEGER NOT NULL, net_cents INTEGER NOT NULL,
  status TEXT DEFAULT 'processing',   -- processing | paid | failed
  created_at TEXT DEFAULT (datetime('now')), completed_at TEXT
);
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta_cents INTEGER NOT NULL, kind TEXT NOT NULL, note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  researcher_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  premise TEXT,
  reward_cents INTEGER NOT NULL,
  spec TEXT NOT NULL,
  plays INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS game_plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  responses TEXT NOT NULL,
  timings TEXT,
  score INTEGER,
  quality_score INTEGER DEFAULT 100,
  flagged INTEGER DEFAULT 0,
  reward_cents INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  replay INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS comment_likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, comment_id)
);
CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(item_id);
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  autoplay INTEGER DEFAULT 1, streak_reminders INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS researcher_surveys (
  id TEXT PRIMARY KEY,
  researcher_id TEXT NOT NULL REFERENCES researchers(id),
  title TEXT NOT NULL, month TEXT
);
CREATE TABLE IF NOT EXISTS discovery_posts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- news | video | image
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT NOT NULL,
  media_url TEXT,
  source_name TEXT,
  tags TEXT DEFAULT '[]',
  created_at TEXT,
  synced_at TEXT DEFAULT (datetime('now')),
  UNIQUE (url, kind)
);
CREATE INDEX IF NOT EXISTS idx_responses_study ON responses(study_id);
CREATE INDEX IF NOT EXISTS idx_responses_user ON responses(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON wallet_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);

/* ---- personalization & integrity layer ---- */
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  topics TEXT NOT NULL DEFAULT '[]',
  fields TEXT NOT NULL DEFAULT '[]',
  goals TEXT NOT NULL DEFAULT '[]',
  formats TEXT NOT NULL DEFAULT '[]',
  windows TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS feed_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, item_id TEXT NOT NULL, item_type TEXT NOT NULL,
  kind TEXT NOT NULL, value REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_user ON feed_events(user_id, id);
CREATE TABLE IF NOT EXISTS user_vectors (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  implicit TEXT DEFAULT '{}', n_pos INTEGER DEFAULT 0,
  type_affinity REAL DEFAULT 0.5, neg_topics TEXT DEFAULT '{}',
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS seen_items (
  user_id INTEGER NOT NULL, item_id TEXT NOT NULL, ts TEXT,
  PRIMARY KEY (user_id, item_id)
);
CREATE TABLE IF NOT EXISTS item_stats (
  item_id TEXT PRIMARY KEY, item_type TEXT,
  impressions INTEGER DEFAULT 0, positives INTEGER DEFAULT 0, negatives INTEGER DEFAULT 0
);
`);

/* lightweight migrations for databases created before a column existed */
try { db.exec("ALTER TABLE discoveries ADD COLUMN researcher_id TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN prompt TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN provider TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN model TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN status TEXT DEFAULT 'published'"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN error TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN video TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN credit TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN chip TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN minutes INTEGER"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN headline TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN logo TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN poster TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN bot_ewma REAL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE questions ADD COLUMN meta TEXT"); } catch {}
try { db.exec("ALTER TABLE responses ADD COLUMN paradata TEXT DEFAULT '{}'"); } catch {}
try { db.exec("ALTER TABLE responses ADD COLUMN bot_prob REAL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE game_plays ADD COLUMN paradata TEXT DEFAULT '{}'"); } catch {}
try { db.exec("ALTER TABLE game_plays ADD COLUMN bot_prob REAL DEFAULT 0"); } catch {}
/* replays: drop UNIQUE(game_id,user_id) so a game can be played again (no reward),
   and tag repeat plays. Rebuild once, preserving every existing row. */
try {
  const cols = db.prepare("PRAGMA table_info(game_plays)").all();
  if (!cols.some((c) => c.name === "replay")) {
    db.exec(`CREATE TABLE game_plays_rebuild (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      responses TEXT NOT NULL, timings TEXT, score INTEGER,
      quality_score INTEGER DEFAULT 100, flagged INTEGER DEFAULT 0,
      reward_cents INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
      paradata TEXT DEFAULT '{}', bot_prob REAL DEFAULT 0, replay INTEGER DEFAULT 0);
      INSERT INTO game_plays_rebuild (id,game_id,user_id,responses,timings,score,quality_score,flagged,reward_cents,created_at,paradata,bot_prob)
        SELECT id,game_id,user_id,responses,timings,score,quality_score,flagged,reward_cents,created_at,paradata,bot_prob FROM game_plays;
      DROP TABLE game_plays;
      ALTER TABLE game_plays_rebuild RENAME TO game_plays;`);
  }
} catch (e) { console.error("game_plays replay migration:", e.message); }
try { db.exec("ALTER TABLE discoveries ADD COLUMN source_url TEXT"); } catch {}
try { db.exec("ALTER TABLE discoveries ADD COLUMN media_kind TEXT DEFAULT 'video'"); } catch {}
try { db.exec("ALTER TABLE discoveries ADD COLUMN author TEXT"); } catch {}
try { db.exec("ALTER TABLE discoveries ADD COLUMN verified INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE discoveries ADD COLUMN published_at TEXT"); } catch {}
try { db.exec("ALTER TABLE discoveries ADD COLUMN tags TEXT DEFAULT '[]'"); } catch {}
try { db.exec("ALTER TABLE discoveries ADD COLUMN summary TEXT"); } catch {}
try { db.exec("ALTER TABLE discoveries ADD COLUMN image TEXT"); } catch {}
try { db.exec("ALTER TABLE discoveries ADD COLUMN active INTEGER DEFAULT 1"); } catch {}
try { db.exec("ALTER TABLE discoveries ADD COLUMN blog TEXT"); } catch {}
try { db.exec("ALTER TABLE discoveries ADD COLUMN orig_title TEXT"); } catch {}
try { db.exec("ALTER TABLE discoveries ADD COLUMN orig_sub TEXT"); } catch {}
try { db.exec("ALTER TABLE studies ADD COLUMN image TEXT"); } catch {}
try { db.exec("ALTER TABLE studies ADD COLUMN source_url TEXT"); } catch {}
try { db.exec("ALTER TABLE studies ADD COLUMN authors TEXT"); } catch {}
try { db.exec("ALTER TABLE studies ADD COLUMN abstract TEXT"); } catch {}
try { db.exec("ALTER TABLE studies ADD COLUMN verified INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE studies ADD COLUMN published_at TEXT"); } catch {}
try { db.exec("ALTER TABLE studies ADD COLUMN created_at TEXT"); } catch {}
try { db.exec("ALTER TABLE papers ADD COLUMN url TEXT"); } catch {}
try { db.exec("ALTER TABLE papers ADD COLUMN published_at TEXT"); } catch {}
try { db.exec("ALTER TABLE impact_items ADD COLUMN study_id TEXT"); } catch {}
try { db.exec("ALTER TABLE impact_items ADD COLUMN headline TEXT"); } catch {}
try { db.exec("ALTER TABLE impact_items ADD COLUMN description TEXT"); } catch {}
try { db.exec("ALTER TABLE impact_items ADD COLUMN poster TEXT"); } catch {}
try { db.exec("ALTER TABLE impact_items ADD COLUMN story TEXT"); } catch {}
try { db.exec("ALTER TABLE impact_items ADD COLUMN version INTEGER"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN suspended INTEGER DEFAULT 0"); } catch {}

/* ---- founder cockpit: social inbox + audit trail ---- */
db.exec(`
CREATE TABLE IF NOT EXISTS social_conversations (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'instagram',
  handle TEXT, display_name TEXT, avatar TEXT,
  bot_paused INTEGER DEFAULT 0, needs_human INTEGER DEFAULT 0,
  unread INTEGER DEFAULT 0,
  last_message_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS social_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  direction TEXT NOT NULL,            -- in | out
  actor TEXT NOT NULL,                -- customer | ai | admin
  external_mid TEXT UNIQUE,
  text TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_social_msg_conv ON social_messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

let changeHook = null;
function onChange(cb) { changeHook = cb; }
const q = {
  get: (sql, ...p) => db.prepare(sql).get(...p),
  all: (sql, ...p) => db.prepare(sql).all(...p),
  run: (sql, ...p) => { const r = db.prepare(sql).run(...p); if (changeHook) changeHook(sql); return r; },
};
function tx(fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const out = fn(); db.exec("COMMIT"); return out; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}
module.exports = { db, q, tx, onChange, DATA_DIR, APP_DATA };