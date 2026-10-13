/**
 * Finding the address in a real browser, on pages shaped like the ones that
 * came back "no email" while the address was plainly on them.
 *
 * Needs the repo served on 8899 (npm run serve), like the other e2e tests.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { searchEmails, auditSite, launchBrowser } from "../src/audit.js";

const BASE = "http://127.0.0.1:8899/app/test/fixtures";
const up = await fetch(`${BASE}/email-gmail.html`, { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false);
const skip = !up && "no server on :8899";

let browser;
before(async () => { if (up) browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const find = f => searchEmails(`${BASE}/${f}.html`, { browser, allowLocal: true });

test("a Gmail address at the top of the homepage is found, not the designer's", { skip }, async () => {
  const r = await find("email-gmail");
  assert.equal(r.contactEmail, "joesplumbing.kc@gmail.com");
  assert.ok(!r.emailCandidates.includes("pixelco.design@gmail.com") || r.contactEmail !== "pixelco.design@gmail.com");
});

test("an address hidden by Cloudflare is decoded", { skip }, async () => {
  // The page itself only says "[email protected]".
  const r = await find("email-cloudflare");
  assert.equal(r.contactEmail, "halsteadplumbing@gmail.com");
});

test("an address written out as [at] and [dot] is read", { skip }, async () => {
  const r = await find("email-spelled");
  assert.equal(r.contactEmail, "riversidetailoring@yahoo.com");
});

test("an address only on the contact page is found by opening it", { skip }, async () => {
  const r = await find("email-home");
  assert.equal(r.contactEmail, "claycountyroofing@outlook.com");
  assert.match(r.contactEmailWhy, /contact page/);
  assert.equal(r.emailPagesSearched.length, 2, "the homepage, then the contact page - not the about page as well");
  assert.match(r.emailPagesSearched[1], /email-contact\.html$/, "contact is opened before about");
});

test("a site with genuinely no address says so, after looking everywhere", { skip }, async () => {
  /*
    The rule: if it does not have an email, it does not have one - and then
    nothing is sent. But only after the contact page has been read too, and
    without settling for the web designer's address in the footer.
  */
  const r = await find("email-none");
  assert.equal(r.contactEmail, null);
  assert.equal(r.emailPagesSearched.length, 2, "it looked on the contact page before giving up");
  assert.deepEqual(r.emailCandidates, [], "the designer's credit is not even offered");
});

test("a full audit finds the contact-page address too, and screenshots the homepage", { skip }, async () => {
  const a = await auditSite(`${BASE}/email-home.html`, { browser, allowLocal: true });
  assert.equal(a.contactEmail, "claycountyroofing@outlook.com");
  assert.equal(a.emailSearchVersion, 2);
  assert.match(a.title, /^Clay County Roofing$/, "everything measured is the homepage's, not the contact page's");
});
