/**
 * The Emails tab, driven in a real browser, sending through a fake mail
 * server so that nothing leaves the machine.
 *
 * Covers what he asked for, end to end: addresses found on the homepage and
 * on the contact page for leads saved before the finder was fixed; a lead
 * with genuinely no address never sent; Send now; Send all, one at a time,
 * and Stop; "I sent it myself" and Drop taking a letter out for good; and the
 * do-not-email list.
 *
 * Needs the repo served on 8899 for the fixture sites, like the other e2e
 * tests.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startFakeSmtp } from "./fake-smtp.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = "http://127.0.0.1:8899/app/test/fixtures";
const up = await fetch(`${FIX}/email-gmail.html`, { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false);
const skip = !up && "no server on :8899";
const PORT = 8232;
const APP = `http://127.0.0.1:${PORT}`;

const hit = (id, points, evidence) => ({ id, points, label: id, evidence });
const lead = (name, site, extra = {}) => ({
  business: { name, town: "Liberty, MO", website: site },
  tier: "A", score: 60, confidence: 90,
  hits: [hit("looks_dated", 29, "The design reads as the early 2010s: Open Sans as the body font.")],
  audit: { visualAgeSignals: 4, emailSearchVersion: 2, ...(extra.audit ?? {}) },
  ...extra.top,
});

let dir, smtp, server, browser, page;
const asked = [];

before(async () => {
  if (!up) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbonyx-mail-"));
  smtp = await startFakeSmtp();
  fs.writeFileSync(path.join(dir, "leads.json"), JSON.stringify([
    // Saved before the finder was fixed: searched the old way, no address.
    lead("Joe's Plumbing", `${FIX}/email-gmail.html`, { audit: { emailSearchVersion: 1, contactEmail: null } }),
    lead("Clay County Roofing", `${FIX}/email-home.html`, { audit: { emailSearchVersion: 1, contactEmail: null } }),
    lead("Northland Lawn", `${FIX}/email-none.html`, { audit: { emailSearchVersion: 1, contactEmail: null } }),
    // Already searched and ready.
    lead("Ready One", "https://ready-one.test", { audit: { contactEmail: "office@ready-one.test" } }),
    lead("Ready Two", "https://ready-two.test", { audit: { contactEmail: "office@ready-two.test" } }),
    lead("Ready Three", "https://ready-three.test", { audit: { contactEmail: "office@ready-three.test" } }),
    // Has an address but nothing specific was measured: needs a look.
    { ...lead("Vague Co", "https://vague.test", { audit: { contactEmail: "hi@vague.test" } }), hits: [] },
  ]));
  fs.writeFileSync(path.join(dir, "mail.json"), JSON.stringify({
    user: "mbonyxstudios@gmail.com", pass: "abcdabcdabcdabcd", dailyCap: 25, gapSeconds: 2,
  }));

  server = spawn(process.execPath, [path.join(here, "..", "ui.mjs")], {
    env: {
      ...process.env, PORT: String(PORT), MBONYX_OUT: dir, MBONYX_ALLOW_LOCAL: "1",
      MBONYX_SMTP: JSON.stringify({ host: "127.0.0.1", port: smtp.port, secure: false, ignoreTLS: true }),
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    if (await fetch(APP, { signal: AbortSignal.timeout(500) }).then(r => r.ok).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
  page.on("dialog", d => { asked.push(d.message()); d.accept(); });
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.click('.tab[data-tab="mail"]');
});

after(async () => {
  await browser?.close();
  server?.kill();
  await smtp?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const cards = () => page.$$eval("#drafts .draft:not(.gone)", els => els.map(e => ({
  name: e.querySelector("h4").textContent,
  canSend: !!e.querySelector(".sendnow"),
  to: e.querySelector(".to")?.textContent ?? "",
  noEmail: e.classList.contains("noemail"),
})));

test("writing first finds the addresses the old search missed", { skip }, async () => {
  await page.click("#writeall");
  await page.waitForFunction(() => /ready to send/.test(document.getElementById("mailstatus").textContent), null, { timeout: 60000 });
  const all = await cards();
  const by = n => all.find(c => c.name === n);

  assert.equal(by("Joe's Plumbing").canSend, true);
  assert.match(by("Joe's Plumbing").to, /joesplumbing\.kc@gmail\.com/, "the Gmail at the top of the homepage");
  assert.match(by("Clay County Roofing").to, /claycountyroofing@outlook\.com/, "the address only on the contact page");
  assert.match(by("Clay County Roofing").to, /contact page/);

  // Genuinely none: grouped apart, never sendable.
  assert.equal(by("Northland Lawn").noEmail, true);
  assert.equal(by("Northland Lawn").canSend, false);
  assert.match(by("Northland Lawn").to, /No email address anywhere on their site/);

  assert.equal(by("Vague Co").canSend, false, "a letter with nothing specific in it is never sent automatically");
  assert.equal(all.filter(c => c.canSend).length, 5);
});

test("Send now sends that one letter through Gmail and takes it off the list", { skip }, async () => {
  const before = smtp.messages.length;
  await page.click('.draft:has(h4:text-is("Joe\'s Plumbing")) .sendnow');
  await page.waitForFunction(() => ![...document.querySelectorAll("#drafts .draft:not(.gone) h4")].some(h => h.textContent === "Joe's Plumbing"), null, { timeout: 15000 });

  assert.equal(smtp.messages.length, before + 1);
  const m = smtp.messages.at(-1);
  assert.deepEqual(m.to, ["joesplumbing.kc@gmail.com"]);
  assert.equal(m.from, "mbonyxstudios@gmail.com");
  assert.match(m.raw, /PO Box 84, Liberty, MO 64069/, "the postal address the law requires is in it");
  assert.match(m.raw, /no thanks/, "and the way to opt out");
});

test("I sent it myself, and Drop, take letters out without sending anything", { skip }, async () => {
  const before = smtp.messages.length;
  await page.click('.draft:has(h4:text-is("Clay County Roofing")) [data-status="sent"]');
  await page.click('.draft:has(h4:text-is("Vague Co")) [data-status="dropped"]');
  await page.waitForTimeout(1600);
  const names = (await cards()).map(c => c.name);
  assert.ok(!names.includes("Clay County Roofing") && !names.includes("Vague Co"));
  assert.equal(smtp.messages.length, before, "neither of those sent anything");
});

test("Send all goes one at a time, and Stop stops it", { skip }, async () => {
  const before = smtp.messages.length;
  await page.click("#sendall");
  // The first letter goes straight away; then there is a pause.
  await page.waitForFunction(n => document.getElementById("sendprogress").textContent.startsWith("Next:"), null, { timeout: 15000 });
  assert.equal(smtp.messages.length, before + 1, "one letter, then a wait - never all at once");
  await page.click("#sendstop");
  await page.waitForTimeout(3500);
  assert.equal(smtp.messages.length, before + 1, "nothing more goes after Stop");
  assert.match(await page.textContent("#sendprogress"), /Stopped/);

  // Started again, it finishes the rest.
  await page.click("#sendall");
  await page.waitForFunction(() => /^Done/.test(document.getElementById("sendprogress").textContent), null, { timeout: 30000 });
  assert.equal(smtp.messages.length, before + 3, "the three ready letters, each once");
  const sentTo = smtp.messages.map(m => m.to[0]);
  assert.equal(new Set(sentTo).size, sentTo.length, "no address was written to twice");
});

test("nothing sent or dropped is ever written again", { skip }, async () => {
  await page.click("#writeall");
  await page.waitForTimeout(1500);
  const names = (await cards()).map(c => c.name);
  assert.deepEqual(names, ["Northland Lawn"], "only the one with no address is left, and it cannot be sent");
});

test("the sent list records everything, and an opt-out is permanent", { skip }, async () => {
  await page.click("#sentbox summary");
  const rows = await page.$$eval("#sentlist .sentrow", els => els.map(e => e.textContent));
  assert.equal(rows.length, 5, "four through Gmail, one by hand");
  await page.click('#sentlist .sentrow:has-text("Ready One") [data-optout]');
  await page.waitForTimeout(800);
  const suppressed = JSON.parse(fs.readFileSync(path.join(dir, "suppressed.json"), "utf8"));
  assert.ok(suppressed.includes("office@ready-one.test"));
});

test("the daily limit stops the sending", { skip }, async () => {
  const api = (route, body) => fetch(`${APP}${route}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
  }).then(r => r.json());

  // Give the last lead an address by hand, so there is a ready letter left.
  assert.equal((await api("/api/mail/use", { website: `${FIX}/email-none.html`, address: "owner@northlandlawn.test" })).ok, true);

  // Four went out through Gmail today. A limit of four means this one may not.
  await api("/api/mail/settings", { dailyCap: 4 });
  const blocked = await api("/api/mail/send", { website: `${FIX}/email-none.html` });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /limit of 4/);
  const before = smtp.messages.length;

  // Raised, it goes.
  await api("/api/mail/settings", { dailyCap: 5 });
  const sent = await api("/api/mail/send", { website: `${FIX}/email-none.html` });
  assert.equal(sent.ok, true, sent.message);
  assert.equal(smtp.messages.length, before + 1);
  assert.deepEqual(smtp.messages.at(-1).to, ["owner@northlandlawn.test"]);
});
