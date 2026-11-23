/* EARNest · payments: card validation + tokenisation, withdrawal lifecycle.
   Card numbers are validated then discarded: only a processor-style token,
   brand, last4 and expiry are ever stored (PCI-style tokenisation). */
"use strict";
const crypto = require("node:crypto");
const { q, tx } = require("./db");

const MIN_WITHDRAW_CENTS = 1000;      // $10.00 minimum
const FEE_RATE = 0.02;                // platform cut, taken once at withdrawal
const MIN_FEE_CENTS = 25;

function luhnOk(num) {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
}
function detectBrand(num) {
  if (/^4/.test(num)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(num)) return "mastercard";
  if (/^3[47]/.test(num)) return "amex";
  if (/^(6011|65|64[4-9])/.test(num)) return "discover";
  if (/^3(0[0-5]|[68])/.test(num)) return "diners";
  if (/^35/.test(num)) return "jcb";
  return null;
}
const BRAND_LEN = { visa: [13, 16, 19], mastercard: [16], amex: [15], discover: [16, 19], diners: [14, 16, 19], jcb: [16, 19] };
const BRAND_CVC = { amex: 4 };

function validateCard({ number, holder, expMonth, expYear, cvc, zip }) {
  const num = String(number || "").replace(/[\s-]/g, "");
  if (!/^\d{12,19}$/.test(num)) return "Card number should be 12 to 19 digits.";
  const brand = detectBrand(num);
  if (!brand) return "We could not recognise that card network. Visa, Mastercard, Amex and Discover are supported.";
  if (!BRAND_LEN[brand].includes(num.length)) return `That ${brand} number has the wrong length.`;
  if (!luhnOk(num)) return "That card number fails the checksum. Re-check the digits.";
  if (!holder || String(holder).trim().length < 3) return "Add the name on the card.";
  const m = Number(expMonth), y = Number(expYear);
  if (!Number.isInteger(m) || m < 1 || m > 12) return "Expiry month should be 01 to 12 (the MM field).";
  const fullYear = y < 100 ? 2000 + y : y;
  const now = new Date();
  if (!Number.isInteger(fullYear) || fullYear < now.getFullYear() ||
      (fullYear === now.getFullYear() && m < now.getMonth() + 1)) return `That expiry (${String(m).padStart(2,"0")}/${fullYear}) is in the past. Check the year — use YY or YYYY.`;
  if (fullYear > now.getFullYear() + 20) return "That expiry is too far out.";
  const cvcLen = BRAND_CVC[brand] || 3;
  if (!new RegExp(`^\\d{${cvcLen}}$`).test(String(cvc || ""))) return `${brand === "amex" ? "Amex CID" : "CVC"} should be ${cvcLen} digits.`;
  if (zip && !/^[A-Za-z0-9 -]{3,10}$/.test(String(zip))) return "Billing postcode looks off.";
  return null;
}

function addMethod(userId, body) {
  const kind = body.kind || "card";
  let row;
  if (kind === "card") {
    const err = validateCard(body);
    if (err) return { error: err };
    const num = String(body.number).replace(/[\s-]/g, "");
    const brand = detectBrand(num);
    const m = Number(body.expMonth), yRaw = Number(body.expYear);
    row = {
      kind: "card", brand, last4: num.slice(-4),
      exp_month: m, exp_year: yRaw < 100 ? 2000 + yRaw : yRaw,
      holder: String(body.holder).trim(), billing_zip: body.zip ? String(body.zip).trim() : null,
      token: "tok_" + crypto.randomBytes(18).toString("hex"),
    };
  } else if (kind === "bank") {
    const routing = String(body.routing || "").replace(/\s/g, "");
    const account = String(body.account || "").replace(/\s/g, "");
    if (!/^\d{9}$/.test(routing)) return { error: "Routing number should be 9 digits." };
    if (!/^\d{6,17}$/.test(account)) return { error: "Account number should be 6 to 17 digits." };
    if (!body.holder || String(body.holder).trim().length < 3) return { error: "Add the account holder's name." };
    row = { kind: "bank", brand: "bank", last4: account.slice(-4), exp_month: null, exp_year: null, holder: String(body.holder).trim(), billing_zip: null, token: "ba_" + crypto.randomBytes(18).toString("hex") };
  } else if (kind === "paypal") {
    const email = String(body.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: "Enter the email on your PayPal account." };
    row = { kind: "paypal", brand: "paypal", last4: null, exp_month: null, exp_year: null, holder: email, billing_zip: null, token: "pp_" + crypto.randomBytes(18).toString("hex") };
  } else {
    return { error: "Unknown payment method type." };
  }
  const id = tx(() => {
    const count = q.get("SELECT COUNT(*) n FROM payment_methods WHERE user_id=?", userId).n;
    const r = q.run(
      "INSERT INTO payment_methods (user_id,kind,brand,last4,exp_month,exp_year,holder,billing_zip,token,is_default) VALUES (?,?,?,?,?,?,?,?,?,?)",
      userId, row.kind, row.brand, row.last4, row.exp_month, row.exp_year, row.holder, row.billing_zip, row.token, count === 0 ? 1 : 0);
    return r.lastInsertRowid;
  });
  return { id };
}

function quoteWithdrawal(amountCents) {
  const fee = Math.max(MIN_FEE_CENTS, Math.round(amountCents * FEE_RATE));
  return { fee_cents: fee, net_cents: amountCents - fee };
}

function withdraw(userId, amountCents, methodId) {
  if (!Number.isInteger(amountCents) || amountCents < MIN_WITHDRAW_CENTS)
    return { error: `Minimum withdrawal is $${(MIN_WITHDRAW_CENTS / 100).toFixed(2)}.` };
  const method = q.get("SELECT * FROM payment_methods WHERE id=? AND user_id=?", methodId, userId);
  if (!method) return { error: "Choose a destination for the withdrawal." };
  const { fee_cents, net_cents } = quoteWithdrawal(amountCents);
  if (net_cents <= 0) return { error: "That amount is all fee. Withdraw a little more." };
  let id;
  try {
    id = tx(() => {
      const u = q.get("SELECT wallet_cents FROM users WHERE id=?", userId);
      if (u.wallet_cents < amountCents) throw Object.assign(new Error("Not enough in the wallet for that amount."), { status: 400 });
      q.run("UPDATE users SET wallet_cents = wallet_cents - ? WHERE id=?", amountCents, userId);
      const r = q.run("INSERT INTO withdrawals (user_id,method_id,amount_cents,fee_cents,net_cents,status) VALUES (?,?,?,?,?,'processing')",
        userId, methodId, amountCents, fee_cents, net_cents);
      q.run("INSERT INTO wallet_ledger (user_id,delta_cents,kind,note) VALUES (?,?,?,?)",
        userId, -amountCents, "withdrawal", `Withdrawal to ${method.brand}${method.last4 ? " ··" + method.last4 : ""} (fee $${(fee_cents / 100).toFixed(2)})`);
      return r.lastInsertRowid;
    });
  } catch (e) {
    return { error: e.message };
  }
  /* simulated processor settlement: mark paid shortly after */
  setTimeout(() => {
    try { q.run("UPDATE withdrawals SET status='paid', completed_at=datetime('now') WHERE id=? AND status='processing'", id); } catch {}
  }, 5000);
  return { id, fee_cents, net_cents };
}

module.exports = { addMethod, withdraw, quoteWithdrawal, validateCard, detectBrand, luhnOk, MIN_WITHDRAW_CENTS, FEE_RATE, MIN_FEE_CENTS };