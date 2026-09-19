/**
 * End-to-end: drives a real browser against the fixture sites in this folder.
 * Needs a local server on 8899 serving the repo root, so it skips itself when
 * one is not running rather than failing the whole suite.
 *
 *   python3 -m http.server 8899 &
 *   CHROMIUM_PATH=/path/to/chrome node --test app/test/*.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { auditSite, launchBrowser } from "../src/audit.js";
import { score } from "../src/score.js";

const BASE = "http://127.0.0.1:8899";
const up = await fetch(BASE, { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false);

let browser;
before(async () => { if (up) browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const audit = f => auditSite(`${BASE}/app/test/fixtures/${f}.html`, { browser, allowLocal: true });

test("a 2011 table-layout site is caught on every major signal", { skip: !up && "no server on :8899" }, async () => {
  const a = await audit("bad-2011");
  assert.equal(a.fetchFailed, false);
  assert.equal(a.isResponsive, false, "980px layout on a 390px phone");
  assert.equal(a.hasViewportMeta, false);
  assert.equal(a.copyrightYear, 2018);
  assert.equal(a.platformIsObsolete, true);
  assert.match(a.platform, /FrontPage/);

  const s = score(a);
  assert.ok(s.score >= 70, `expected tier A, got ${s.score}`);
  assert.equal(s.tier, "A");
});

test("a site with a viewport tag but a 900px table is still not responsive", { skip: !up && "no server on :8899" }, async () => {
  // This is the case the innerWidth bug silently passed.
  const a = await audit("half-fixed");
  assert.equal(a.hasViewportMeta, true, "it does declare a viewport");
  assert.ok(a.mobileScreenWidth <= 400, `screen width must be the phone's, got ${a.mobileScreenWidth}`);
  assert.ok(a.mobileScrollWidth > 900, `content really is wider, got ${a.mobileScrollWidth}`);
  assert.equal(a.isResponsive, false, "declaring a viewport is not the same as fitting in one");
  assert.ok(score(a).score > 0);
});

test("a genuinely good site produces no findings", { skip: !up && "no server on :8899" }, async () => {
  const a = await audit("modern");
  assert.equal(a.isResponsive, true);
  assert.equal(a.hasContactAboveFold, true, "the Call button is in the first screen");
  assert.equal(a.platformIsObsolete, false);
  assert.equal(a.copyrightYear, new Date().getFullYear());

  const s = score(a);
  assert.equal(s.score, 0, `a healthy site must score 0, got ${s.score}: ${s.hits.map(h => h.id)}`);
  assert.equal(s.tier, "D");
});

test("a hero CTA counts as contact, whatever the trade calls it", { skip: !up && "no server on :8899" }, async () => {
  /*
    Regression: the href list only knew "contact", "book", "appointment",
    "quote" and "booking", so a restaurant whose hero CTA is Reserve and a gym
    whose hero CTA is Free Week were both reported as having no way to make
    contact above the fold. Both plainly do.
  */
  for (const slug of ["ember-oak", "forge-athletics"]) {
    const a = await auditSite(`${BASE}/work/${slug}.html`, { browser, allowLocal: true });
    assert.equal(a.hasContactAboveFold, true, `${slug} has a conversion CTA in the first screen`);
  }
});

test("a site with no way to make contact above the fold is still caught", { skip: !up && "no server on :8899" }, async () => {
  // The guard on the widened list: it must not become impossible to fail.
  const a = await auditSite(`${BASE}/app/test/fixtures/no-contact.html`, { browser, allowLocal: true });
  assert.equal(a.fetchFailed, false);
  assert.equal(a.hasContactAboveFold, false);
});

test("the five concept builds all pass their own audit", { skip: !up && "no server on :8899" }, async () => {
  for (const slug of ["lumen-dental", "northpoint-hvac", "ember-oak", "meridian-law", "forge-athletics"]) {
    const a = await auditSite(`${BASE}/work/${slug}.html`, { browser, allowLocal: true });
    assert.equal(a.isResponsive, true, `${slug} must be responsive`);
    assert.equal(a.platformIsObsolete, false, `${slug} must not look obsolete`);
    assert.ok(score(a).score < 25, `${slug} must not be a rebuild candidate`);
  }
});
