/* EARNest · authentication: email+password, sessions, Google & Apple OAuth.
   Real OAuth flows activate when the provider's env keys are set; otherwise a
   clearly-labelled demo sign-in keeps the flow runnable out of the box. */
"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { q, tx } = require("./db");
const config = require("./config");
const { sendMail, welcomeEmail } = require("./email");
const { hashPassword, verifyPassword, newToken, checkRegister } = require("./auth-util");

const UPLOAD_DIR = path.join(__dirname, "..", "data", "uploads");

function mailWelcome(user) {
  const m = welcomeEmail(user.name);
  sendMail({ to: user.email, ...m }).then((r) => {
    if (r.delivered === "outbox") console.log(`welcome email for ${user.email} saved to dev outbox (configure SMTP or Resend to deliver)`);
  }).catch((e) => console.error("welcome email failed:", e.message));
}

const SESSION_DAYS = 30;
const COOKIE = "earnest_session";

function createSession(userId) {
  const token = newToken();
  q.run("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)",
    token, userId, Date.now() + SESSION_DAYS * 86400e3);
  return token;
}
function sessionUser(token) {
  if (!token) return null;
  const s = q.get("SELECT * FROM sessions WHERE token=?", token);
  if (!s) return null;
  if (s.expires_at < Date.now()) { q.run("DELETE FROM sessions WHERE token=?", token); return null; }
  return q.get("SELECT * FROM users WHERE id=?", s.user_id) || null;
}
function destroySession(token) { if (token) q.run("DELETE FROM sessions WHERE token=?", token); }

function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, photo: u.photo, initials: u.initials,
    interests: u.interests, answer_windows: u.answer_windows,
    researcher_mode: !!u.researcher_mode, created_at: u.created_at,
  };
}
function ensureSettings(userId) { q.run("INSERT OR IGNORE INTO settings (user_id) VALUES (?)", userId); }

function register({ name, email, password }) {
  const err = checkRegister({ name, email, password });
  if (err) return { error: err };
  email = String(email).trim().toLowerCase();
  if (q.get("SELECT id FROM users WHERE email=?", email)) return { error: "An account with that email already exists. Sign in instead." };
  const { hash, salt } = hashPassword(password);
  const initials = String(name).trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const id = tx(() => {
    const r = q.run("INSERT INTO users (name,email,password_hash,salt,initials) VALUES (?,?,?,?,?)",
      String(name).trim(), email, hash, salt, initials);
    ensureSettings(r.lastInsertRowid);
    return r.lastInsertRowid;
  });
  const newUser = q.get("SELECT * FROM users WHERE id=?", id);
  mailWelcome(newUser);
  return { token: createSession(id), user: publicUser(newUser) };
}
function login({ email, password }) {
  const u = q.get("SELECT * FROM users WHERE email=?", String(email || "").trim().toLowerCase());
  if (!u || !verifyPassword(password || "", u.password_hash, u.salt))
    return { error: "Email or password is wrong." };
  if (u.suspended) return { error: "This account is suspended. Contact support." };
  return { token: createSession(u.id), user: publicUser(u) };
}

/* ---------- OAuth (live config: in-app settings or env) ---------- */
const OAUTH_META = {
  google: { authUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", scope: "openid email profile" },
  apple: { authUrl: "https://appleid.apple.com/auth/authorize", tokenUrl: "https://appleid.apple.com/auth/token", scope: "name email" },
};
function liveCfg(provider) {
  const meta = OAUTH_META[provider];
  if (!meta) return null;
  if (provider === "google") {
    const clientId = config.get("google_client_id"), clientSecret = config.get("google_client_secret");
    return { ...meta, clientId, clientSecret, configured: !!(clientId && clientSecret) };
  }
  const clientId = config.get("apple_client_id"), team = config.get("apple_team_id"), kid = config.get("apple_key_id"), key = config.get("apple_private_key");
  return { ...meta, clientId, team, kid, key, configured: !!(clientId && team && kid && key) };
}
function providerState() {
  return { google: { configured: liveCfg("google").configured }, apple: { configured: liveCfg("apple").configured } };
}
const oauthStates = new Map(); // state -> { provider, created }

function appleClientSecret() {
  const team = config.get("apple_team_id"), kid = config.get("apple_key_id"), client = config.get("apple_client_id");
  const key = config.get("apple_private_key").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "ES256", kid });
  const body = b64({ iss: team, iat: now, exp: now + 3600, aud: "https://appleid.apple.com", sub: client });
  const signer = crypto.createSign("SHA256");
  signer.update(`${head}.${body}`);
  const sig = signer.sign(key).toString("base64url");
  return `${head}.${body}.${sig}`;
}
function oauthStart(provider, redirectBase) {
  const cfg = liveCfg(provider);
  if (!cfg) return { error: "Unknown provider." };
  if (!cfg.configured) return { demo: true };
  const state = newToken();
  const redirectUri = `${redirectBase}/api/auth/oauth/${provider}/callback`;
  oauthStates.set(state, { provider, created: Date.now(), redirectUri });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri, response_type: "code", scope: cfg.scope, state,
  });
  /* Force Google's account chooser every time so signing out really signs out:
     without this, Google silently reuses the last account and skips consent. */
  if (provider === "google") params.set("prompt", "select_account");
  if (provider === "apple") params.set("response_mode", "form_post");
  return { redirect: `${cfg.authUrl}?${params}` };
}
async function oauthCallback(provider, code, state, redirectBase) {
  const cfg = liveCfg(provider);
  const st = oauthStates.get(state);
  oauthStates.delete(state);
  if (!cfg || !cfg.configured || !st || st.provider !== provider || Date.now() - st.created > 600e3)
    return { error: "Sign-in link expired. Try again." };
  const redirectUri = st.redirectUri || `${redirectBase}/api/auth/oauth/${provider}/callback`;
  const clientId = cfg.clientId;
  const clientSecret = provider === "google" ? cfg.clientSecret : appleClientSecret();
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri });
  const tokRes = await fetch(cfg.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!tokRes.ok) {
    let detail = "";
    try { const j = await tokRes.json(); detail = j.error_description || j.error || ""; } catch {}
    console.error(`OAuth ${provider} token exchange failed (${tokRes.status}):`, detail, "| redirect_uri:", redirectUri);
    const hint =
      /redirect_uri_mismatch/i.test(detail) ? ` The redirect URI Earnest sent (${redirectUri}) is not listed in your Google client's Authorized redirect URIs. Add it exactly.` :
      /invalid_client/i.test(detail) ? " The Client ID or Client secret is wrong. Re-copy the secret from Google Cloud Console → Clients → your client." :
      /invalid_grant/i.test(detail) ? " The sign-in code expired or was already used. Click Continue with Google again." :
      "";
    return { error: `Google rejected the sign-in: ${detail || tokRes.status}.${hint}` };
  }
  const tok = await tokRes.json();
  let uid, email, name, photo = null;
  if (provider === "google") {
    const ui = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } });
    if (!ui.ok) return { error: "Could not read your Google profile." };
    const p = await ui.json();
    uid = p.sub; email = p.email; name = p.name || (p.email || "").split("@")[0];
    if (p.picture) photo = await fetchAvatar(p.picture, provider, uid);
  } else {
    const [, payload] = String(tok.id_token).split(".");
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    uid = p.sub; email = p.email; name = (email || "Apple user").split("@")[0];
  }
  return upsertOauth(provider, uid, email, name, photo);
}
/* Pull the provider's profile picture onto this server so the avatar keeps
   working without hot-linking Google's CDN. Falls back to null on any failure. */
async function fetchAvatar(url, provider, uid) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = String(r.headers.get("content-type") || "");
    if (!/^image\//.test(ct)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 5e6) return null;
    const ext = ct.includes("png") ? ".png" : ct.includes("webp") ? ".webp" : ct.includes("gif") ? ".gif" : ".jpg";
    const file = `avatar-${provider}-${String(uid).replace(/[^\w-]/g, "")}${ext}`;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
    return `/uploads/${file}`;
  } catch { return null; }
}
function upsertOauth(provider, uid, email, name, photo) {
  const existing = q.get("SELECT * FROM oauth_accounts WHERE provider=? AND provider_uid=?", provider, String(uid));
  let userId;
  if (existing) userId = existing.user_id;
  else {
    const byEmail = email && q.get("SELECT * FROM users WHERE email=?", String(email).toLowerCase());
    userId = tx(() => {
      let id;
      if (byEmail) id = byEmail.id;
      else {
        const initials = String(name || "E").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
        id = q.run("INSERT INTO users (name,email,initials,photo) VALUES (?,?,?,?)",
          name || "Respondent", email ? String(email).toLowerCase() : `${provider}_${uid}@oauth.earnest.local`, initials, photo ?? null).lastInsertRowid;
      }
      q.run("INSERT INTO oauth_accounts (user_id,provider,provider_uid) VALUES (?,?,?)", id, provider, String(uid));
      ensureSettings(id);
      return id;
    });
    mailWelcome(q.get("SELECT * FROM users WHERE id=?", userId));
  }
  if (photo) {
    /* keep the avatar fresh on every sign-in, including the public researcher card */
    q.run("UPDATE users SET photo=? WHERE id=?", photo, userId);
    q.run("UPDATE researchers SET photo=? WHERE id=?", photo, "u-" + userId);
  }
  return { token: createSession(userId), user: publicUser(q.get("SELECT * FROM users WHERE id=?", userId)) };
}
/* Demo sign-in when provider keys are not configured: a local account per provider,
   labelled as demo in the UI. Never enabled once real keys exist. */
function oauthDemo(provider) {
  const cfg = liveCfg(provider);
  if (!cfg) return { error: "Unknown provider." };
  if (cfg.configured) return { error: "Real sign-in is configured; use it." };
  return upsertOauth(provider, `demo-${provider}`, `demo.${provider}@earnest.app`,
    provider === "google" ? "Google Demo" : "Apple Demo");
}

/* Full account deletion: personal data first, then anything the user published
   as a researcher, then the identity itself. Explicit order keeps every foreign
   key satisfied (responses, impact_items and discoveries have no ON DELETE). */
function deleteAccount(userId) {
  const rid = "u-" + userId;
  tx(() => {
    const studyIds = q.all("SELECT id FROM studies WHERE researcher_id=?", rid).map((r) => r.id);
    const paperIds = q.all("SELECT id FROM papers WHERE researcher_id=?", rid).map((r) => r.id);
    const itemIds = [...studyIds, ...q.all("SELECT id FROM discoveries WHERE researcher_id=?", rid).map((r) => r.id)];
    const ph = (ids) => ids.map(() => "?").join(",");
    if (studyIds.length) q.run(`DELETE FROM responses WHERE study_id IN (${ph(studyIds)})`, ...studyIds);
    if (itemIds.length) {
      const cids = q.all(`SELECT id FROM comments WHERE item_id IN (${ph(itemIds)})`, ...itemIds).map((r) => r.id);
      if (cids.length) q.run(`DELETE FROM comment_likes WHERE comment_id IN (${ph(cids)})`, ...cids);
      q.run(`DELETE FROM comments WHERE item_id IN (${ph(itemIds)})`, ...itemIds);
    }
    if (paperIds.length) {
      q.run(`DELETE FROM impact_items WHERE paper_id IN (${ph(paperIds)})`, ...paperIds);
      q.run(`DELETE FROM discoveries WHERE paper_id IN (${ph(paperIds)})`, ...paperIds);
      q.run(`DELETE FROM unlocked_papers WHERE paper_id IN (${ph(paperIds)})`, ...paperIds);
      q.run(`DELETE FROM papers WHERE id IN (${ph(paperIds)})`, ...paperIds);
    }
    q.run("DELETE FROM studies WHERE researcher_id=?", rid);
    q.run("DELETE FROM discoveries WHERE researcher_id=?", rid);
    q.run("DELETE FROM games WHERE researcher_id=?", rid);
    q.run("DELETE FROM awards WHERE researcher_id=?", rid);
    q.run("DELETE FROM researcher_surveys WHERE researcher_id=?", rid);
    q.run("DELETE FROM follows WHERE researcher_id=?", rid);
    q.run("DELETE FROM researchers WHERE id=?", rid);
    q.run("DELETE FROM responses WHERE user_id=?", userId);
    q.run("DELETE FROM game_plays WHERE user_id=?", userId);
    q.run("DELETE FROM comment_likes WHERE user_id=?", userId);
    q.run("DELETE FROM comments WHERE user_id=?", userId);
    q.run("DELETE FROM hearts WHERE user_id=?", userId);
    q.run("DELETE FROM follows WHERE user_id=?", userId);
    q.run("DELETE FROM reposts WHERE user_id=?", userId);
    q.run("DELETE FROM unlocked_papers WHERE user_id=?", userId);
    q.run("DELETE FROM withdrawals WHERE user_id=?", userId);
    q.run("DELETE FROM payment_methods WHERE user_id=?", userId);
    q.run("DELETE FROM wallet_ledger WHERE user_id=?", userId);
    q.run("DELETE FROM settings WHERE user_id=?", userId);
    q.run("DELETE FROM oauth_accounts WHERE user_id=?", userId);
    q.run("DELETE FROM sessions WHERE user_id=?", userId);
    q.run("DELETE FROM users WHERE id=?", userId);
  });
}
module.exports = { COOKIE, SESSION_DAYS, createSession, sessionUser, destroySession, publicUser, register, login, providerState, oauthStart, oauthCallback, oauthDemo, deleteAccount };