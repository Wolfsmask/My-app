import { test } from "node:test";
import assert from "node:assert/strict";
import { score, disqualify, qualifies, tierFor } from "../src/score.js";
import { findCopyrightYear, detectPlatform } from "../src/audit.js";

const YEAR = new Date().getFullYear();

/** A site with everything wrong. */
const awful = {
  isResponsive: false, mobileScrollWidth: 980,
  sslValid: false, sslExpiredAt: "2024-03-03",
  copyrightYear: YEAR - 8,
  platformIsObsolete: true, platform: "Microsoft FrontPage",
  brokenLinks: 2, brokenImages: 1,
  hasContactAboveFold: false,
};

/** A site with nothing wrong. */
const fine = {
  isResponsive: true, mobileScrollWidth: 390,
  sslValid: true,
  copyrightYear: YEAR,
  platformIsObsolete: false, platform: "custom or unknown",
  brokenLinks: 0, brokenImages: 0,
  hasContactAboveFold: true,
};

test("a site with every problem scores 100 and lands in tier A", () => {
  const r = score(awful);
  assert.equal(r.score, 100);
  assert.equal(r.tier, "A");
  assert.equal(r.hits.length, 6);
});

test("a healthy site scores 0 and is dropped as tier D", () => {
  const r = score(fine);
  assert.equal(r.score, 0);
  assert.equal(r.tier, "D");
  assert.deepEqual(r.hits, []);
});

test("embarrassment outweighs performance, which is the whole point", () => {
  // Only mobile broken, everything else fine.
  const mobileOnly = score({ ...fine, isResponsive: false, mobileScrollWidth: 1200 });
  // Only slow, everything else fine.
  const slowOnly = score({ ...fine, lcpMs: 9000, lighthousePerf: 18, pageWeightBytes: 9e6, usesModernImages: false });

  assert.ok(
    mobileOnly.score > slowOnly.score,
    `one embarrassment signal (${mobileOnly.score}) must beat every performance signal combined (${slowOnly.score})`
  );
});

test("findings are ordered by weight, so the email leads with the strongest", () => {
  const r = score(awful);
  const points = r.hits.map(h => h.points);
  assert.deepEqual(points, [...points].sort((a, b) => b - a));
  assert.equal(r.hits[0].id, "not_responsive");
});

test("checks that could not run are excluded from the maximum", () => {
  // No performance data at all: score must still use the full 0-100 range.
  const r = score({ isResponsive: false, mobileScrollWidth: 980 });
  assert.equal(r.possible, 25, "only the one check that ran counts");
  assert.equal(r.score, 100);
});

test("a fresh copyright year is not a finding", () => {
  assert.equal(score({ ...fine, copyrightYear: YEAR - 1 }).hits.length, 0);
  assert.equal(score({ ...fine, copyrightYear: YEAR - 3 }).hits.length, 1);
});

test("evidence quotes the real measurement, never a guess", () => {
  const hit = score(awful).hits.find(h => h.id === "not_responsive");
  assert.match(hit.evidence, /980px/);
  assert.match(hit.evidence, /390px/);
});

test("tier boundaries", () => {
  assert.equal(tierFor(100), "A");
  assert.equal(tierFor(70), "A");
  assert.equal(tierFor(69), "B");
  assert.equal(tierFor(50), "B");
  assert.equal(tierFor(49), "C");
  assert.equal(tierFor(25), "C");
  assert.equal(tierFor(24), "D");
});

test("leads are dropped before any money is spent auditing them", () => {
  assert.equal(disqualify({ website: null }), "no_website");
  assert.equal(disqualify({ website: "https://facebook.com/acehvac" }), "social_only");
  assert.equal(disqualify({ website: "https://a.com", status: "CLOSED_PERMANENTLY" }), "closed");
  assert.equal(disqualify({ website: "https://a.com", suppressed: true }), "suppressed");
  assert.equal(disqualify({ website: "https://a.com", status: "OPERATIONAL" }), null);
});

test("qualification uses reviews as the can-they-pay proxy", () => {
  assert.equal(qualifies({ reviewCount: 180, rating: 4.6, phone: "555" }).ok, true);
  assert.equal(qualifies({ reviewCount: 4, rating: 5.0, phone: "555" }).ok, false);
  assert.equal(qualifies({ reviewCount: 200, rating: 2.9, phone: "555" }).ok, false);
  assert.equal(qualifies({ reviewCount: 200, rating: 4.6, phone: null }).ok, false);

  const r = qualifies({ reviewCount: 4, rating: 4.6, phone: "555" });
  assert.match(r.reasons[0], /only 4 reviews/);
});

test("copyright years are read from real footer shapes", () => {
  assert.equal(findCopyrightYear("Copyright © 2018 Ace Heating"), 2018);
  assert.equal(findCopyrightYear("&copy; 2009-2021 Some Co"), 2021);
  assert.equal(findCopyrightYear("(c) 2016 Foo Ltd"), 2016);
  assert.equal(findCopyrightYear("call us on 2018 555 1234"), null, "a bare number is not a copyright");
  assert.equal(findCopyrightYear("no notice here"), null);
});

test("obsolete platforms are recognised and named", () => {
  assert.equal(detectPlatform('<meta name="generator" content="Microsoft FrontPage 6.0">').obsolete, true);
  assert.equal(detectPlatform('<object type="application/x-shockwave-flash">').obsolete, true);
  assert.equal(detectPlatform('<meta name="generator" content="WordPress 4.9.8">').obsolete, true);
  assert.equal(detectPlatform('<meta name="generator" content="WordPress 6.4">').obsolete, false);
  assert.equal(detectPlatform('<link href="/wp-content/x.css">').platform, "WordPress");
  assert.equal(detectPlatform("<main>hello</main>").platform, "custom or unknown");
});

/*
  Regression: the responsive check once compared scrollWidth against
  window.innerWidth. Both grow to fit overflowing content, so a 940px-wide page
  on a 390px phone reported 940 vs 940 and passed as "responsive". The screen
  width must come from visualViewport. These assert the scoring side of that —
  the browser side is covered by test/audit.e2e.test.js.
*/
test("a page wider than the phone screen is not responsive", () => {
  const r = score({ ...fine, isResponsive: false, mobileScrollWidth: 940, mobileScreenWidth: 390 });
  const hit = r.hits.find(h => h.id === "not_responsive");
  assert.ok(hit, "overflowing page must be flagged");
  assert.match(hit.evidence, /940px/);
});
