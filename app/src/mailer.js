/**
 * Sends the letters through his own Gmail account.
 *
 * Gmail, not a mailing service, on purpose: replies land in his inbox, every
 * letter sits in his Sent folder where he can see it, and nothing goes out
 * under anyone else's name. It signs in with a Gmail *app password* - a
 * sixteen-letter password Google issues for one program, which can be
 * revoked without touching his real one. His real password would not work
 * anyway; Google refuses it for programs.
 *
 * The settings live in out/ui/mail.json, next to his leads, on his computer
 * only. The download never contains them, and the page never shows the
 * password back once it is saved.
 */
import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";

export const MAIL_DEFAULTS = {
  user: "mbonyxstudios@gmail.com",
  pass: "",
  /*
    Twenty-five a day. Gmail allows far more, and that is not the limit that
    matters: an account that suddenly sends hundreds of letters to strangers
    gets flagged as spam and can be locked. A steady few dozen a day from a
    real person is what a real person looks like.
  */
  dailyCap: 25,
  // Seconds between letters when sending them all, plus or minus a third so
  // they do not leave on a metronome.
  gapSeconds: 90,
};

const file = dir => path.join(dir, "mail.json");

export function loadMailSettings(dir) {
  try {
    return { ...MAIL_DEFAULTS, ...JSON.parse(fs.readFileSync(file(dir), "utf8")) };
  } catch {
    return { ...MAIL_DEFAULTS };
  }
}

export function saveMailSettings(dir, next) {
  const current = loadMailSettings(dir);
  const merged = { ...current };
  if (typeof next.user === "string" && next.user.trim()) merged.user = next.user.trim().toLowerCase();
  // An empty password field means "keep the one saved", not "delete it".
  if (typeof next.pass === "string" && next.pass.trim()) merged.pass = next.pass.replace(/\s+/g, "");
  if (next.forgetPassword) merged.pass = "";
  if (Number.isFinite(Number(next.dailyCap))) merged.dailyCap = Math.max(1, Math.min(200, Math.round(Number(next.dailyCap))));
  if (Number.isFinite(Number(next.gapSeconds))) merged.gapSeconds = Math.max(20, Math.min(1800, Math.round(Number(next.gapSeconds))));
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file(dir) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file(dir));
  return merged;
}

/** What the page may see: never the password itself. */
export const publicSettings = s => ({
  user: s.user, hasPassword: Boolean(s.pass), dailyCap: s.dailyCap, gapSeconds: s.gapSeconds,
});

/**
 * The connection. MBONYX_SMTP replaces Gmail with another server - the tests
 * point it at one they run themselves, so no letter ever leaves the machine
 * while they run.
 */
export function createTransport(settings) {
  const override = process.env.MBONYX_SMTP ? JSON.parse(process.env.MBONYX_SMTP) : null;
  return nodemailer.createTransport({
    ...(override ?? { host: "smtp.gmail.com", port: 465, secure: true }),
    auth: { user: settings.user, pass: settings.pass },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
  });
}

/** Gmail's errors, in words that say what to do. */
export function explainMailError(e) {
  const m = String(e?.message ?? e ?? "");
  if (/535|Username and Password not accepted|BadCredentials|Invalid login/i.test(m)) {
    return "Gmail refused the sign-in. It needs an app password, not your normal Gmail password - see \"How to get an app password\" below. If you already used one, it may have been typed wrong or revoked.";
  }
  if (/534|Application-specific password required/i.test(m)) {
    return "Gmail wants an app password for this. Turn on 2-Step Verification, then create one - see \"How to get an app password\" below.";
  }
  if (/550|5\.1\.1|does not exist|user unknown|no such user|mailbox unavailable/i.test(m)) {
    return "That address does not exist - Gmail was told so by their mail server. Nothing was delivered.";
  }
  if (/454|4\.7\.0|too many|rate|limit|5\.4\.5/i.test(m)) {
    return "Gmail says too much mail has gone out too quickly. Stop for today and carry on tomorrow - pushing on risks the account being locked.";
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|timeout/i.test(m)) {
    return "Could not reach Gmail. Check the internet connection and try again.";
  }
  return m.split("\n")[0].slice(0, 200) || "Sending failed for a reason Gmail did not say.";
}

/** Sends one letter. Plain text, from his name, with replies coming to him. */
export async function sendLetter(transport, settings, { fromName, to, subject, body }) {
  const info = await transport.sendMail({
    from: { name: fromName || "MBOnyx Studio", address: settings.user },
    to,
    replyTo: settings.user,
    subject,
    text: body,
  });
  // Gmail accepting a letter for an address it then cannot deliver to comes
  // back as a bounce later; refusing outright comes back here.
  if (info.rejected?.length) throw new Error(`550 rejected: ${info.rejected.join(", ")}`);
  return { messageId: info.messageId ?? null };
}
