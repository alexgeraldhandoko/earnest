/* EARNest · runtime configuration store (SQL-backed), env vars as fallback.
   Secrets are never returned by the API — only presence flags. */
"use strict";
const { q } = require("./db");

q.run("CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)");

const KEYS = [
  "google_client_id", "google_client_secret",
  "apple_client_id", "apple_team_id", "apple_key_id", "apple_private_key",
  "smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from",
  "resend_api_key",
  "llm_api_key", "llm_base_url", "llm_model", "llm_fallback_model",
  "gen_provider",
  "storage_adapter", "storage_dir", "discovery_feed_url",
];
const SECRET = new Set(["google_client_secret", "apple_private_key", "smtp_pass", "resend_api_key", "llm_api_key"]);
const ENV_MAP = {
  google_client_id: "GOOGLE_CLIENT_ID", google_client_secret: "GOOGLE_CLIENT_SECRET",
  apple_client_id: "APPLE_CLIENT_ID", apple_team_id: "APPLE_TEAM_ID", apple_key_id: "APPLE_KEY_ID", apple_private_key: "APPLE_PRIVATE_KEY",
  smtp_host: "SMTP_HOST", smtp_port: "SMTP_PORT", smtp_user: "SMTP_USER", smtp_pass: "SMTP_PASS", smtp_from: "SMTP_FROM",
  resend_api_key: "RESEND_API_KEY",
  llm_api_key: "LLM_API_KEY", llm_base_url: "LLM_BASE_URL", llm_model: "LLM_MODEL", llm_fallback_model: "LLM_FALLBACK_MODEL",
  gen_provider: "GEN_PROVIDER",
  storage_adapter: "STORAGE_ADAPTER", storage_dir: "STORAGE_DIR", discovery_feed_url: "DISCOVERY_FEED_URL",
};
function get(key) {
  const row = q.get("SELECT value FROM config WHERE key=?", key);
  if (row && row.value) return row.value;
  return process.env[ENV_MAP[key]] || "";
}
/* single-token credentials must contain no whitespace at all — a copy from a
   wrapped dialog line otherwise smuggles in a newline and Google rejects it */
const STRIP_WS = new Set(["google_client_id", "google_client_secret", "apple_client_id", "apple_team_id", "apple_key_id", "smtp_user", "smtp_pass", "resend_api_key", "llm_api_key"]);
function set(key, value) {
  if (!KEYS.includes(key)) throw new Error("Unknown setting.");
  let v = value == null ? "" : String(value).trim();
  if (STRIP_WS.has(key)) v = v.replace(/\s+/g, "");
  if (v === "") q.run("DELETE FROM config WHERE key=?", key);
  else q.run("INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, v);
}
function mask(v) {
  if (!v) return null;
  return `${v.slice(0, 7)}…${v.slice(-4)} (${v.length} chars)`;
}
function publicState() {
  const out = {};
  for (const k of KEYS) out[k] = SECRET.has(k) ? { set: !!get(k) } : { set: !!get(k), value: get(k) };
  out.google_client_secret_hint = mask(get("google_client_secret"));
  out.google_client_id_hint = mask(get("google_client_id"));
  out.google_configured = !!(get("google_client_id") && get("google_client_secret"));
  out.apple_configured = !!(get("apple_client_id") && get("apple_team_id") && get("apple_key_id") && get("apple_private_key"));
  out.email_configured = !!get("resend_api_key") || !!get("smtp_host");
  out.llm_configured = !!get("llm_api_key");
  /* game generation runs on the founder's QwenWork credits via the local agent
     worker by default; "api" switches to the OpenAI-compatible key above */
  out.gen_provider = (get("gen_provider") || "qwenwork").toLowerCase();
  return out;
}
module.exports = { get, set, publicState, KEYS };