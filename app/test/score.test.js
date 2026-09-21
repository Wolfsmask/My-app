import { test } from "node:test";
import assert from "node:assert/strict";
import { score, disqualify, qualifies, tierFor } from "../src/score.js";
import { findCopyrightYear, detectPlatform } from "../src/audit.js";

const YEAR = new Date().getFullYear();

/**
 * A site with everything wrong - every core check measured, every one failing.
 * It has to set all of them: a score is now a fraction of what a normal page
 * load can examine, not of whatever happened to be measurable.
 */
const awful = {
  isResponsive: false, mobileScrollWidth: 980,
  sslValid: false, sslExpiredAt: "2024-03-03",
  copyrightYear: YEAR - 8,
  platformIsObsolete: true, platform: "Microsoft FrontPage",
  brokenLinks: 2, brokenImages: 1,
  hasContactAboveFold: false,
  pageWeightBytes: 9e6,
  usesModernImages: false,
  looksDated: true, datedSignals: 5,
  textTooSmall: true, bodyFontSize: 11,
  tapTargetsTooSmall: true, tinyTapTargets: 9,
  hasStructureProblems: true, structureProblems: ["no h1"],
  poorLayout: true, poorLayoutSignals: 4, emptyFirstScreen: 78, contentWidthPct: 40,
  hasCarousel: true, pipeNav: true,
};

/** A site with nothing wrong. */
const fine = {
  isResponsive: true, mobileScrollWidth: 390,
  sslValid: true,
  copyrightYear: YEAR,
  platformIsObsolete: false, platform: "custom or unknown",
  brokenLinks: 0, brokenImages: 0,
  hasContactAboveFold: true,
  pageWeightBytes: 400000,
  usesModernImages: true,
  looksDated: false,
  textTooSmall: false,
  tapTargetsTooSmall: false,
  hasStructureProblems: false,
  poorLayout: false, poorLayoutSignals: 0, emptyFirstScreen: 10, contentWidthPct: 92,
  hasCarousel: false, pipeNav: false,
};

test("a site with every problem scores 100 and lands in tier A", () => {
  const r = score(awful);
  assert.equal(r.score, 100);
  assert.equal(r.tier, "A");
  assert.equal(r.confidence, 100, "every core check was measured");
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

test("an optional measurement only counts against a site when it was taken", () => {
  // Page-speed timings need a measurement a plain load does not produce.
  // Counting them regardless would mark every site down for a test never run.
  const withoutTimings = score(fine);
  const withTimings = score({ ...fine, lcpMs: 900, lighthousePerf: 95 });
  assert.ok(withTimings.possible > withoutTimings.possible, "taking the measurement adds it to the total");
  assert.equal(withoutTimings.score, 0);
  assert.equal(withTimings.score, 0);
});

test("a check that could not run never raises the score", () => {
  // The bug this replaces: the maximum shrank to whatever happened to be
  // measurable, so a page where one check ran and failed scored 100 out of
  // 100 and came out Tier A - the same single fault on a fully measured page
  // scored 25. An unexaminable page must rank low, not high.
  const thin = score({ isResponsive: false, mobileScrollWidth: 980 });
  const full = score({ ...fine, isResponsive: false, mobileScrollWidth: 980 });

  assert.equal(thin.score, full.score, "the same fault scores the same either way");
  assert.ok(thin.tier !== "A", `a page examined once must not be tier A (was ${thin.score})`);
  // And the thinness is reported rather than hidden.
  assert.ok(thin.confidence < 20, `confidence should be low, was ${thin.confidence}%`);
  assert.equal(full.confidence, 100);
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

test("a fault that is a matter of degree scores in proportion", () => {
  // A site with three dated markers and one built entirely like 2005 are both
  // "dated". Scoring them the same buried the second among the first.
  const mild = score({ ...fine, looksDated: true, datedSignals: 3 });
  const total = score({ ...fine, looksDated: true, datedSignals: 5 });

  assert.ok(total.score > mild.score, `5 markers (${total.score}) must beat 3 (${mild.score})`);
  assert.ok(total.tier === "A" || total.tier === "B", "a thoroughly dated site is worth contacting");
  assert.equal(mild.tier, "C", "a mildly dated one is not, yet");
  // And the email has to be able to say how dated, in words an owner reads.
  assert.match(total.hits.find(h => h.id === "looks_dated").evidence, /100%/);
});

test("how it looks and whether it works on a phone outweigh the plumbing", () => {
  // People judge a business on its website's appearance long before anything
  // technical, and most local searches happen on a phone. A site whose only
  // faults are compression and page weight is not one to rebuild.
  const plumbingOnly = score({
    ...fine, pageWeightBytes: 9e6, usesModernImages: false, hasStructureProblems: true,
  });
  assert.equal(plumbingOnly.tier, "D", `technical nits alone scored ${plumbingOnly.score}`);

  const phone = score({ ...fine, isResponsive: false, mobileScrollWidth: 980 });
  const looks = score({ ...fine, looksDated: true, datedSignals: 5 });
  assert.ok(phone.score > plumbingOnly.score * 3, "the phone test dominates");
  assert.ok(looks.score > plumbingOnly.score * 3, "so does how it looks");
});

test("a site with modern code can still be badly laid out", () => {
  // The case that prompted this: a real Liberty restaurant, built on current
  // software with web fonts and a responsive layout, scored 8 out of 100 -
  // while being, at a glance, plainly bad. Nothing in the checker was looking
  // at how the page was arranged, only at how old its code was.
  const laCosta = score({
    ...fine,
    poorLayout: true, poorLayoutSignals: 3,
    emptyFirstScreen: 75, contentWidthPct: 38, hasCarousel: true, pipeNav: true,
  });
  assert.ok(laCosta.tier === "A" || laCosta.tier === "B",
    `a badly laid out site scored ${laCosta.score} (${laCosta.tier})`);
  assert.match(laCosta.hits.find(h => h.id === "poor_layout").evidence, /empty space|page width|banner|pipes/);
});

test("a well laid out site is never called badly laid out", () => {
  // The cost of getting this wrong is telling somebody their good website is
  // bad, so it has to stay silent on every site that does not deserve it.
  assert.equal(score(fine).hits.find(h => h.id === "poor_layout"), undefined);
  // One signal on its own is not evidence - plenty of good pages have a
  // carousel, or a quiet first screen.
  const oneSignal = score({ ...fine, poorLayout: false, poorLayoutSignals: 1, hasCarousel: true });
  assert.equal(oneSignal.tier, "D");
});

test("adding a check does not quietly lower every other score", () => {
  // Scores used to be a share of every check there was, so the same site
  // scored lower today than yesterday purely because the checker had learnt
  // to look at one more thing. They are measured against a fixed bar now.
  const phoneOnly = score({ ...fine, isResponsive: false, mobileScrollWidth: 980 });
  assert.equal(phoneOnly.score, 40, "the phone test is worth 40 points, whatever else exists");

  const withNewCheck = score({ ...fine, isResponsive: false, mobileScrollWidth: 980, poorLayout: false, poorLayoutSignals: 0 });
  assert.equal(withNewCheck.score, phoneOnly.score, "a check that passes changes nothing");
});

test("tier boundaries", () => {
  assert.equal(tierFor(100), "A");
  assert.equal(tierFor(45), "A");
  assert.equal(tierFor(44), "B");
  assert.equal(tierFor(25), "B");
  assert.equal(tierFor(24), "C");
  assert.equal(tierFor(12), "C");
  assert.equal(tierFor(11), "D");
});

test("the sites a person would actually rebuild come out worth contacting", () => {
  // Calibrated against real businesses, not round numbers. Each of these was
  // Tier C under the first guess at the boundaries - "hold, re-check in six
  // months" - when they plainly needed rebuilding.
  const base = { ...fine };
  const worthDoing = [
    ["unreadable on a phone", { isResponsive: false, mobileScrollWidth: 980 }],
    ["old software, still mobile-friendly", { looksDated: true, datedSignals: 5, copyrightYear: YEAR - 9, platformIsObsolete: true }],
    ["unreadable on a phone and a decade old", { isResponsive: false, mobileScrollWidth: 980, looksDated: true, datedSignals: 4, copyrightYear: YEAR - 8 }],
  ];
  for (const [label, over] of worthDoing) {
    const r = score({ ...base, ...over });
    assert.ok(r.tier === "A" || r.tier === "B", `${label} scored ${r.score} (${r.tier}) - should be worth contacting`);
  }

  // And a site that is genuinely fine still must not be.
  assert.equal(score(base).tier, "D");
  assert.equal(score({ ...base, copyrightYear: YEAR - 4 }).tier, "D", "a stale footer alone is not a rebuild");
});

test("a domain that only forwards to a Facebook page is not a website", () => {
  // Common for a small business: the domain exists but points at their
  // Facebook page, or a Yelp listing. It was being audited as though the page
  // were theirs - and then written to about a website they do not control and
  // could not have rebuilt.
  const business = { website: "https://bucknersheating.com" };
  assert.equal(disqualify(business, { finalUrl: "https://www.facebook.com/buckners" }), "social_only");
  assert.equal(disqualify(business, { finalUrl: "https://www.yelp.com/biz/buckners" }), "social_only");
  assert.equal(disqualify(business, { finalUrl: "https://www.yellowpages.com/x" }), "social_only");

  // An ordinary redirect is not that. Nearly every site forwards to www or to
  // https, and dropping those would drop nearly every lead.
  assert.equal(disqualify(business, { finalUrl: "https://www.bucknersheating.com/" }), null);
  assert.equal(disqualify(business, { finalUrl: "https://bucknersheating.com/home" }), null);
  assert.equal(disqualify(business, {}), null);
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

/* ------------------------------------------------------ list parsing */

test("a comma inside a business name does not become the website", async () => {
  /*
    Regression: fields were read by position, so "Bob's Heating, Inc, site.com"
    produced website "https://Inc". That URL failed to load and the business was
    reported unreachable — a real lead silently discarded, which is the worst
    outcome this file can produce.
  */
  const { discoverFile } = await import("../src/discover.js");
  const [r] = discoverFile("Bob's Heating, Inc, bobsheating.com, (555) 111-2222, 4.5, 87");
  assert.equal(r.name, "Bob's Heating, Inc");
  assert.equal(r.website, "https://bobsheating.com");
  assert.equal(r.phone, "(555) 111-2222");
  assert.equal(r.rating, 4.5);
  assert.equal(r.reviewCount, 87);
});

test("a bare URL still gets a readable business name", async () => {
  const { discoverFile } = await import("../src/discover.js");
  const [a] = discoverFile("https://www.riverside-plumbing.co.uk/services");
  assert.equal(a.name, "Riverside Plumbing Co");
  const [b] = discoverFile("acehvac.com");
  assert.equal(b.website, "https://acehvac.com");
  assert.equal(b.name, "Acehvac");
});

test("a line with no website is kept, so it can be dropped with a reason", async () => {
  const { discoverFile } = await import("../src/discover.js");
  const [r] = discoverFile("A business with no website at all");
  assert.equal(r.website, null);
  assert.equal(disqualify(r), "no_website");
});

/* --------------------------------------------------------- csv safety */

test("spreadsheet formula injection is neutralised", async () => {
  const { toCsv } = await import("../src/report.js");
  const mk = name => ({ tier: "A", score: 80, business: { name, website: "x.com" }, hits: [], audit: {} });
  for (const evil of ['=HYPERLINK("http://evil","go")', "+1 Heating", "-Cold Air", "@handle"]) {
    const line = toCsv([mk(evil)]).split("\n")[1];
    assert.ok(/,'?["']?[=+\-@]/.test(line) === false || line.includes("'" + evil[0]),
      `formula prefix must be escaped: ${line}`);
    assert.ok(!/(^|,)[=+\-@]/.test(line), `no cell may start with a formula character: ${line}`);
  }
});

/* -------------------------------------------------------- ssrf guard */

test("local and private addresses are refused unless opted in", async () => {
  const { assertPublicTarget } = await import("../src/audit.js");
  for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "172.16.9.9", "::1"]) {
    await assert.rejects(() => assertPublicTarget(host), /refusing to audit/, `${host} must be refused`);
    await assertPublicTarget(host, { allowLocal: true });   // opt-in must work
  }
});

test("a public hostname is allowed", async () => {
  const { assertPublicTarget } = await import("../src/audit.js");
  await assertPublicTarget("93.184.216.34");   // public IP, no DNS needed
  await assertPublicTarget("8.8.8.8");
});

/* ------------------------------------------------------ report link safety */

test("only http(s) links survive into the report", async () => {
  /*
    Escaping is not enough for an href: `javascript:alert(1)` escapes to
    itself and stays clickable. Website URLs come from Google Places and
    OpenStreetMap, which anyone can edit, and the report is opened locally.
  */
  const { toHtml } = await import("../src/report.js");
  const render = website => toHtml(
    [{ tier: "A", score: 1, slug: "x", hits: [], business: { name: "n", website }, audit: {}, qualified: true, qualifyReasons: [] }],
    { category: "c", city: "y", source: "f" });

  for (const bad of ["javascript:alert(1)", "data:text/html,<script>x</script>", "vbscript:msgbox", "ftp://x.com"]) {
    const html = render(bad);
    assert.ok(!/href="javascript:|href="data:|href="vbscript:|href="ftp:/i.test(html), `${bad} must not become an href`);
  }
  assert.match(render("https://ok.example.com"), /<a href="https:\/\/ok\.example\.com/);
});

test("the report escapes names that came from an editable source", async () => {
  const { toHtml } = await import("../src/report.js");
  const html = toHtml(
    [{ tier: "A", score: 1, slug: "x", hits: [], business: { name: '<img src=x onerror=alert(1)>', website: "https://a.com" }, audit: {}, qualified: true, qualifyReasons: [] }],
    { category: "c", city: "y", source: "f" });
  assert.ok(!/<img src=x/.test(html), "raw markup must not reach the document");
  assert.match(html, /&lt;img src=x/);
});

test("a failed inbox write returns null instead of throwing", async () => {
  const { toInbox } = await import("../src/notify.js");
  const lead = { tier: "A", score: 80, business: { name: "n", website: "https://a.com" }, hits: [] };
  // A directory that does not exist and cannot be created implicitly.
  const r = toInbox(lead, "/proc/definitely/not/writable");
  assert.equal(r, null, "a disk error must not propagate into the audit worker");
});

test("a business with no website does not crash the run", async () => {
  /*
    Regression: run() was invoked above the const helpers. With --source file
    there is no await before the first drop is printed, so it reached pad()
    inside its temporal dead zone and the process died with
    "Cannot access 'pad' before initialization". A business with no website is
    completely ordinary, so any hand-made list containing one crashed outright.
  */
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbonyx-"));
  const list = path.join(dir, "list.txt");
  fs.writeFileSync(list, "A Business With No Website\n");

  const { stdout } = await promisify(execFile)(process.execPath,
    [path.join(import.meta.dirname, "..", "src", "cli.js"),
     "--source", "file", "--input", list, "--out", path.join(dir, "out")],
    { timeout: 60000 });

  assert.match(stdout, /no_website/);
  assert.match(stdout, /dropped:1/);
  assert.doesNotMatch(stdout, /before initialization/);
});
