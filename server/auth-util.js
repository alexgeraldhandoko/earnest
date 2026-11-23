/* EARNest · auth utilities: scrypt password hashing, session tokens, input checks */
"use strict";
const crypto = require("node:crypto");

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { hash, salt };
}
function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const stored = Buffer.from(hash, "hex");
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}
const newToken = () => crypto.randomBytes(32).toString("hex");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function checkRegister({ name, email, password }) {
  if (!name || String(name).trim().length < 2) return "Tell us your name (at least 2 characters).";
  if (!EMAIL_RE.test(String(email || ""))) return "That email does not look right.";
  if (!password || String(password).length < 8) return "Password needs at least 8 characters.";
  return null;
}
module.exports = { hashPassword, verifyPassword, newToken, EMAIL_RE, checkRegister };