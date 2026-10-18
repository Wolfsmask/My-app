/**
 * Finding the address in a real browser, on pages shaped like the ones that
 * came back "no email" while the address was plainly on them.
 *
 * Needs the repo served on 8899 (npm run serve), like the other e2e tests.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { searchEmails, auditSite, launchBrowser } from "../src/audit.js";
import { collectEmailsInPage } from "../src/emails.js";

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
  assert.ok(r.emailPagesSearched.some(u => /email-none-contact\.html$/.test(u)), "it looked on the contact page before giving up");
  assert.equal(r.emailSearchBlocked, false, "nothing blocked it - there is simply nothing there");
  assert.deepEqual(r.emailCandidates, [], "the designer's credit is not even offered");
});

test("a full audit finds the contact-page address too, and screenshots the homepage", { skip }, async () => {
  const a = await auditSite(`${BASE}/email-home.html`, { browser, allowLocal: true });
  assert.equal(a.contactEmail, "claycountyroofing@outlook.com");
  assert.equal(a.emailSearchVersion, 3);
  assert.match(a.title, /^Clay County Roofing$/, "everything measured is the homepage's, not the contact page's");
});

test("a footer that only loads once you scroll down is read", { skip }, async () => {
  const r = await find("email-lazy-footer");
  assert.equal(r.contactEmail, "libertyautoglass@everestkc.net");
});

test("a site with no 'contact' link is followed through 'Get a free estimate'", { skip }, async () => {
  const r = await find("email-quote");
  assert.equal(r.contactEmail, "kearneyconcrete@kc.rr.com");
  assert.match(r.contactEmailFoundOn, /email-quote-page\.html$/);
});

test("addresses hidden from spam robots are read the way a person reads them", { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE}/email-tricks.html`);
    const got = new Set((await page.evaluate(collectEmailsInPage)).candidates.map(c => c.address.toLowerCase()));
    for (const a of ["frontdesk@smiledental.com", "hello@smiledental.com", "billing@smiledental.com", "appointments@smiledental.com"]) {
      assert.ok(got.has(a), `${a} - got ${[...got].join(", ")}`);
    }
    assert.equal([...got].some(a => /^(us|8)@/.test(a)), false, "an @handle and a time are not addresses");
  } finally {
    await page.close();
  }
});

test("a site that would not let the check in is reported as blocked, not as having no address", { skip }, async () => {
  const r = await find("email-blocked");
  assert.equal(r.contactEmail, null);
  assert.equal(r.emailSearchBlocked, true);
  assert.equal(r.emailPagesSearched.length, 1, "and it does not go guessing at pages behind the wall");
});

test("an address only the desktop version shows is found by a full audit", { skip }, async () => {
  // The audit looks as a phone first; nothing there, so it looks again as a
  // desktop browser before calling it none.
  const a = await auditSite(`${BASE}/email-desktop-only.html`, { browser, allowLocal: true });
  assert.equal(a.contactEmail, "smithvilleseptic@swbell.net");
});
