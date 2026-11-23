/* EARNest · email delivery. Real sending via Resend API or any SMTP server
   (zero dependencies, STARTTLS/SSL + AUTH LOGIN). Without a provider, mail is
   written to data/outbox as .eml files and viewable in-app (dev outbox). */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const tls = require("node:tls");
const config = require("./config");

const OUTBOX = path.join(require("./db").DATA_DIR, "outbox");
fs.mkdirSync(OUTBOX, { recursive: true });

function smtpSend({ host, port, user, pass, from, to, subject, html }) {
  return new Promise((resolve, reject) => {
    const secure = Number(port) === 465;
    let sock = secure ? tls.connect({ host, port: Number(port), servername: host }) : net.connect({ host, port: Number(port) });
    let buf = "";
    const steps = [];
    const cmd = (c) => sock.write(c + "\r\n");
    const fail = (e) => { try { sock.destroy(); } catch {} reject(e); };
    const timer = setTimeout(() => fail(new Error("SMTP timeout")), 20000);
    const finish = () => { clearTimeout(timer); try { sock.end(); } catch {} resolve(); };

    const ehloName = "earnest.local";
    let stage = "greet";
    const onData = (d) => {
      buf += d.toString("utf8");
      const lines = buf.split("\r\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        const code = line.slice(0, 3);
        const more = line[3] === "-";
        if (more) continue;
        if (code[0] === "4" || code[0] === "5") return fail(new Error("SMTP error: " + line));
        switch (stage) {
          case "greet": stage = "ehlo"; cmd("EHLO " + ehloName); break;
          case "ehlo":
            if (!secure && /STARTTLS/i.test(line)) { stage = "starttls"; cmd("STARTTLS"); }
            else if (user && pass) { stage = "auth"; cmd("AUTH LOGIN"); }
            else { stage = "from"; cmd(`MAIL FROM:<${from}>`); }
            break;
          case "starttls":
            sock.removeAllListeners("data");
            sock = tls.connect({ socket: sock, servername: host }, () => { stage = "ehlo"; cmd("EHLO " + ehloName); sock.on("data", onData); });
            sock.on("error", fail);
            break;
          case "auth": stage = "user"; cmd(Buffer.from(user).toString("base64")); break;
          case "user": stage = "pass"; cmd(Buffer.from(pass).toString("base64")); break;
          case "pass": stage = "from"; cmd(`MAIL FROM:<${from}>`); break;
          case "from": stage = "rcpt"; cmd(`RCPT TO:<${to}>`); break;
          case "rcpt": stage = "data"; cmd("DATA"); break;
          case "data": {
            stage = "quit";
            const msg = [
              `From: EARNest <${from}>`, `To: <${to}>`, `Subject: ${subject}`,
              "MIME-Version: 1.0", 'Content-Type: text/html; charset="utf-8"', "", html, ".",
            ].join("\r\n");
            cmd(msg);
            break;
          }
          case "quit": cmd("QUIT"); stage = "done"; finish(); break;
        }
      }
    };
    sock.on("data", onData);
    sock.on("error", fail);
  });
}

async function sendMail({ to, subject, html }) {
  const resend = config.get("resend_api_key");
  const from = config.get("smtp_from") || "EARNest <onboarding@resend.dev>";
  if (resend) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) throw new Error("Resend: " + (await res.text()).slice(0, 200));
    return { delivered: "resend" };
  }
  const host = config.get("smtp_host");
  if (host) {
    await smtpSend({
      host, port: config.get("smtp_port") || 587,
      user: config.get("smtp_user"), pass: config.get("smtp_pass"),
      from: config.get("smtp_from") || config.get("smtp_user"), to, subject, html,
    });
    return { delivered: "smtp" };
  }
  const file = path.join(OUTBOX, `${Date.now()}-${to.replace(/[^\w.@-]/g, "_")}.eml`);
  fs.writeFileSync(file, `From: ${from}\nTo: ${to}\nSubject: ${subject}\nContent-Type: text/html; charset=utf-8\n\n${html}`);
  return { delivered: "outbox", file: path.basename(file) };
}

function welcomeEmail(name) {
  return {
    subject: "Welcome to EARNest — your account is ready",
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c2030">
      <h1 style="font-size:22px;letter-spacing:-0.02em">earnest</h1>
      <p>Hi ${String(name).replace(/[<>&]/g, "")},</p>
      <p>Your EARNest account is ready. You can now answer short studies from real researchers, build streaks, and earn rewards you can withdraw to your card, bank or PayPal.</p>
      <p style="color:#5a6072;font-size:14px">Every answer passes a quality screen before it reaches a researcher. Answer one study a day for seven days and your next ten answers pay double.</p>
      <p style="color:#5a6072;font-size:12px">You received this email because an EARNest account was created with this address.</p>
    </div>`,
  };
}
function listOutbox() {
  return fs.readdirSync(OUTBOX).filter((f) => f.endsWith(".eml")).sort().reverse().slice(0, 50)
    .map((f) => ({ file: f, when: Number(f.split("-")[0]) }));
}
function readOutbox(file) {
  if (!/^[\w.@-]+\.eml$/.test(file)) return null;
  const p = path.join(OUTBOX, file);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}
module.exports = { sendMail, welcomeEmail, listOutbox, readOutbox };