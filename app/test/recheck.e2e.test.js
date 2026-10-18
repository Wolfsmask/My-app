/**
 * Leads saved with a phone problem found the old way are checked again
 * before a letter about them can go out.
 *
 * The old check looked once, through a browser that did not say it was a
 * phone, and counted content the page had clipped. One owner answered a
 * letter built on it with "it does adjust - check your device settings", and
 * they were right. Every saved verdict from that check is redone the new way
 * (as a phone, twice) the next time letters are written, and a letter whose
 * verdict has not been redone yet cannot be sent.
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

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = "http://127.0.0.1:8899/app/test/fixtures";
const up = await fetch(`${FIX}/phone-ua-sniff.html`, { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false);
const skip = !up && "no server on :8899";
const PORT = 8233;
const APP = `http://127.0.0.1:${PORT}`;
const ADDRESS = "PO Box 84, Liberty, MO 64069";

// What the old check saved: a single look, no phoneConfirmed, no version.
const oldPhoneHit = { id: "not_responsive", points: 40, label: "Breaks on a phone", evidence: "On a phone: the page lays out 1000px wide." };
const oldTextHit = { id: "text_too_small", points: 8, label: "Text too small", evidence: "Body text is 13px." };
const saved = (name, file, hits, audit = {}) => ({
  business: { name, town: "Liberty, MO", website: `${FIX}/${file}` },
  tier: "A", score: 60, confidence: 90, review: "keep",
  hits,
  audit: {
    emailSearchVersion: 2, contactEmail: `office@${name.toLowerCase().replace(/\W+/g, "")}.test`,
    isResponsive: false, mobileScreenWidth: 390, mobileScrollWidth: 1000, mobileOverflowPct: 156, mobileCutOff: 5,
    ...audit,
  },
});

let dir, server;
const leadsFile = () => JSON.parse(fs.readFileSync(path.join(dir, "leads.json"), "utf8"));
const byName = (list, n) => list.find(x => (x.business?.name ?? x.name) === n);
const drafts = () => fetch(`${APP}/api/emails`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sender: { address: ADDRESS } }),
}).then(r => r.json());

before(async () => {
  if (!up) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbonyx-recheck-"));
  fs.writeFileSync(path.join(dir, "migrations.json"), JSON.stringify({ oldSavesMarkedSent: "2026-10-01T00:00:00Z" }));
  fs.writeFileSync(path.join(dir, "leads.json"), JSON.stringify([
    // Each of these fits a phone. The old check said otherwise.
    saved("Sniffs The Device", "phone-ua-sniff.html", [oldPhoneHit]),
    saved("Clips Its Overflow", "phone-hidden-overflow.html", [oldPhoneHit]),
    saved("Rem Sized Text", "phone-rem-trick.html", [oldTextHit], { isResponsive: true, textTooSmall: true, bodyFontSize: 13 }),
    // Genuinely breaks on a phone: tiny text in a page shrunk to fit.
    saved("Really Broken", "phone-tiny-text.html", [oldPhoneHit]),
    // No longer loads: nothing about it can be confirmed.
    saved("Gone Now", "no-such-page.html", [oldPhoneHit]),
  ]));
  server = spawn(process.execPath, [path.join(here, "..", "ui.mjs")], {
    env: { ...process.env, PORT: String(PORT), MBONYX_OUT: dir, MBONYX_ALLOW_LOCAL: "1" },
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    if (await fetch(APP, { signal: AbortSignal.timeout(500) }).then(r => r.ok).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 250));
  }
});

after(() => {
  server?.kill();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test("a letter built on an old phone verdict cannot be sent until it is checked again", { skip }, async () => {
  const data = await drafts();
  assert.equal(data.needSearch, 5, "all five are due a second look");
  for (const d of data.drafts) {
    assert.equal(d.sendable, false, d.name);
    assert.ok(d.warnings.some(w => /has not been looked at again yet/.test(w)), d.name);
  }
});

test("checking again clears sites that fit a phone, and keeps the one that does not", { skip }, async () => {
  const res = await fetch(`${APP}/api/emails/find`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const events = (await res.text()).trim().split("\n").map(l => JSON.parse(l));
  assert.equal(events.at(-1).type, "done", JSON.stringify(events.at(-1)));
  assert.equal(events.at(-1).total, 5);

  const leads = leadsFile();
  for (const l of leads) assert.equal(l.audit.phoneCheckVersion, 2, `${l.business.name} was checked the new way`);

  for (const n of ["Sniffs The Device", "Clips Its Overflow"]) {
    const l = byName(leads, n);
    assert.equal(l.audit.isResponsive, true, n);
    assert.equal(l.hits.some(h => h.id === "not_responsive"), false, `${n} no longer scores a phone problem`);
  }
  const rem = byName(leads, "Rem Sized Text");
  assert.equal(rem.audit.textTooSmall, false, `measured again: ${rem.audit.bodyFontSize}px`);
  assert.equal(rem.hits.some(h => h.id === "text_too_small"), false);

  const broken = byName(leads, "Really Broken");
  assert.equal(broken.audit.phoneConfirmed, true, "both looks agree");
  assert.equal(broken.audit.phoneUnreadable, true);
  assert.ok(broken.hits.some(h => h.id === "not_responsive"), "the real one keeps its finding");
  assert.match(broken.hits.find(h => h.id === "not_responsive").evidence, /checked twice/);

  const gone = byName(leads, "Gone Now");
  assert.equal(gone.audit.phoneConfirmed, false, "could not be checked, so it is not trusted");
  assert.equal(gone.hits.some(h => h.id === "not_responsive"), false);
});

test("and no letter says anything about a phone that was not confirmed", { skip }, async () => {
  const data = await drafts();
  assert.equal(data.needSearch, 0, "nothing is checked twice over");
  const phoneTalk = /phone|dragged|off the side|shrunk|zoom|too small/i;
  for (const n of ["Sniffs The Device", "Clips Its Overflow", "Rem Sized Text", "Gone Now"]) {
    const d = byName(data.drafts, n);
    if (!d) continue; // nothing left worth a letter is also a right answer
    assert.ok(!phoneTalk.test(d.subject + "\n" + d.body.split("\n\n").slice(0, 3).join("\n")), `${n}: ${d.subject}\n${d.body}`);
    assert.equal(d.warnings.some(w => /looked at again/.test(w)), false, n);
  }
  const broken = byName(data.drafts, "Really Broken");
  assert.match(broken.subject + broken.body, /phone/i, "the confirmed one is still written about");
  assert.equal(broken.warnings.some(w => /not measured/.test(w)), false, broken.warnings.join("\n"));
});
