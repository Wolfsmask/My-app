/**
 * The outreach email.
 *
 * What is being protected here is not prose quality - it is that the email
 * cannot state something nobody measured, cannot go out without the things
 * US law requires, and cannot arrive at two businesses word for word.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftEmail, numbersAreReal, claimsAreMeasured } from "../src/draft.js";

const lead = (name, over = {}) => ({
  business: { name, town: "Liberty, MO", category: "HVAC / heating & cooling", website: "https://x.test" },
  findings: [{ id: "not_responsive", points: 25, evidence: "Page is 980px wide on a 390px phone screen." }],
  audit: { mobileScrollWidth: 980 },
  ...over,
});

const SENDER = { name: "Brennen", email: "mbonyxstudios@gmail.com", address: "PO Box 1, Liberty, MO 64068" };

test("says what is wrong without a single measurement in it", () => {
  // "about 980 pixels wide" is what the report says. An owner does not think
  // in pixels and has no idea whether 980 is bad - they know they have to
  // pinch and zoom to read their own site.
  //
  // Every phrasing has to pass, not just the one a single business happens to
  // draw: there are several per fault, and one of them carrying jargon is one
  // owner in three getting an email they cannot read.
  const jargon = /\bpixels?\b|\bpx\b|milliseconds|viewport|responsive\b|\bLCP\b|\bDOM\b|semantic/i;
  const faults = [
    ["not_responsive", { mobileScrollWidth: 980 }],
    ["looks_dated", { datedSignals: 5 }],
    ["stale_copyright", { copyrightYear: 2018 }],
    ["dead_platform", { platform: "Microsoft FrontPage" }],
    ["broken_assets", { brokenLinks: 4, brokenImages: 2 }],
    ["no_contact", {}],
    ["text_too_small", { bodyFontSize: 11 }],
    ["tiny_tap_targets", { tinyTapTargets: 8 }],
    ["ssl_broken", {}],
    ["weak_structure", {}],
  ];
  // Enough different names to exhaust every phrasing in every pool.
  const names = Array.from({ length: 40 }, (_, i) => `Business ${i} Heating`);

  for (const [id, audit] of faults) {
    for (const name of names) {
      const d = draftEmail({
        business: { name, town: "Liberty, MO", category: "HVAC / heating & cooling" },
        hits: [{ id, points: 30, evidence: "report wording with 980px in it" }],
        audit,
      }, SENDER);
      assert.doesNotMatch(d.claims, jargon, `${id} for ${name} reads: ${d.claims}`);
    }
  }
});

test("any number it does use is one that was measured", () => {
  const d = draftEmail(lead("Buckner's Heating"), SENDER);
  const check = numbersAreReal(d, d.facts);
  // A figure nobody took off their page is the one thing an owner will
  // notice and disbelieve.
  assert.ok(check.ok, `invented numbers: ${check.invented.join(", ")}`);
});

test("keeps the numbers a person would use themselves", () => {
  // A year in the footer and a count of broken links are plain facts an owner
  // can check in ten seconds. Those earn their place; pixels do not.
  const year = draftEmail(lead("Buckner's Heating", {
    hits: [{ id: "stale_copyright", points: 8, evidence: "Footer still says 2018." }],
    audit: { copyrightYear: 2018 },
  }), SENDER);
  assert.match(year.claims, /2018/);
});

test("refuses to call a draft ready with no postal address", () => {
  const without = draftEmail(lead("Buckner's Heating"), { ...SENDER, address: "" });
  assert.ok(without.warnings.some(w => /postal address/i.test(w)),
    "US commercial email must carry a real postal address");

  const with_ = draftEmail(lead("Buckner's Heating"), SENDER);
  assert.equal(with_.warnings.length, 0);
  assert.match(with_.body, /PO Box 1, Liberty, MO 64068/);
});

test("always offers a way out", () => {
  const d = draftEmail(lead("Buckner's Heating"), SENDER);
  assert.match(d.body, /no thanks/i, "an opt-out, in words a person would use");
});

test("says who is writing and how to reach them", () => {
  const d = draftEmail(lead("Buckner's Heating"), SENDER);
  assert.match(d.body, /Brennen/);
  assert.match(d.body, /mbonyxstudios@gmail\.com/);
});

test("two businesses do not get the same email", () => {
  const names = ["Buckner's Heating", "Arctic Air", "Shanks Heating", "ECS Geothermal", "Metro Comfort", "Wilson Mechanical"];
  const openings = names.map(n => draftEmail(lead(n), SENDER).body.split("\n")[2]);
  // Not all unique - there are three openers - but a town where every owner
  // got the identical first line would be obvious the moment two of them talk.
  assert.ok(new Set(openings).size >= 3, "the opening varies between businesses");
});

test("the same business always gets the same email", () => {
  // Otherwise a second run produces a different letter to someone who may
  // already have had the first.
  assert.equal(draftEmail(lead("Arctic Air"), SENDER).body, draftEmail(lead("Arctic Air"), SENDER).body);
});

test("leads with the most costly problem, not the first one found", () => {
  const d = draftEmail(lead("Buckner's Heating", {
    findings: [
      { id: "stale_copyright", points: 10, evidence: "Footer still says 2018." },
      { id: "not_responsive", points: 25, evidence: "Page is 980px wide." },
    ],
    audit: { mobileScrollWidth: 980, copyrightYear: 2018 },
  }), SENDER);
  assert.match(d.body, /phone/i, "the 25-point problem leads");
});

test("reads the findings where the scorer actually puts them", () => {
  // score() returns them as `hits`. Looking only for `findings` produced an
  // email with no measurement in it for every real lead, while still looking
  // perfectly well-formed.
  const scored = {
    business: { name: "Buckner's Heating", city: "Liberty, MO", category: "HVAC" },
    audit: { mobileScrollWidth: 980 },
    tier: "A", score: 81,
    hits: [{ id: "not_responsive", points: 25, label: "x", evidence: "Page is 980px wide." }],
  };
  const d = draftEmail(scored, SENDER);
  // Not the number - the fact. If the finding never reached the drafter, the
  // email would talk about nothing in particular, which is how it read before.
  assert.match(d.claims, /phone/i, "the finding reached the email");
  assert.equal(d.warnings.length, 0);
});

test("leaves no hole when the business has no town", () => {
  const noTown = lead("Buckner's Heating");
  delete noTown.business.town;
  const d = draftEmail(noTown, SENDER);
  // "going through  and I had a look" is worse than never naming the place.
  assert.ok(!/  /.test(d.claims), "no gap where the town should be");
  assert.ok(!/around\s+and|through\s+and/.test(d.body));
});

test("says nothing specific when nothing specific was measured", () => {
  const d = draftEmail(lead("Buckner's Heating", { findings: [], audit: {} }), SENDER);
  // Better an admission than an invented observation.
  assert.ok(d.warnings.some(w => /no concrete observation|No findings/i.test(w)));
});

test("does not insult the business", () => {
  for (const name of ["Buckner's Heating", "Arctic Air", "Shanks Heating"]) {
    const body = draftEmail(lead(name), SENDER).body.toLowerCase();
    for (const word of ["outdated", "terrible", "awful", "embarrassing", "ancient", "struggling", "unprofessional"]) {
      assert.ok(!body.includes(word), `"${word}" has no place in a first email`);
    }
  }
});

test("promises nothing it cannot deliver", () => {
  const body = draftEmail(lead("Buckner's Heating"), SENDER).body.toLowerCase();
  for (const claim of ["guarantee", "rank #1", "first page of google", "double your", "triple your"]) {
    assert.ok(!body.includes(claim), `"${claim}" is a promise nobody can keep`);
  }
});

test("catches a number that was never measured", () => {
  const fake = { body: "Your site takes 9.4 seconds to load and 47% of people leave." };
  const check = numbersAreReal(fake, ["Page is 980px wide on a 390px phone screen."]);
  assert.equal(check.ok, false);
  assert.deepEqual(check.invented.sort(), ["47", "9.4"]);
});

test("reads like a person, not a form", () => {
  const body = draftEmail(lead("Buckner's Heating"), SENDER).body;
  assert.ok(!/\{|\}|\[|\]|<%|%>/.test(body), "no template leftovers");
  assert.ok(!/hope this (email )?finds you well/i.test(body), "no filler opening");
  assert.ok(!/undefined|null|NaN/.test(body), "no unfilled values");
  // Short enough that a busy owner reads all of it.
  assert.ok(body.split(/\s+/).length < 170, "under 170 words");
});

test("a very small business is offered the work free, not a $900 proposal", () => {
  /*
    The whole point of measuring how big a business is. A one-person shop with
    a genuinely bad website gets an offer to build it for nothing; the same
    bad website behind a company with staff and trucks gets the normal letter.
  */
  const site = {
    business: { name: "Tony's Pizza", town: "Liberty, MO", category: "restaurant" },
    score: 48,
    hits: [{ id: "looks_dated", points: 29, label: "The design looks dated", evidence: "The design reads as the early 2010s." }],
    audit: { business: { size: "micro", offerFree: true } },
  };
  const free = draftEmail(site, { address: "PO Box 1, Liberty MO" });
  assert.equal(free.offerFree, true);
  assert.match(free.body, /free/i);
  assert.doesNotMatch(free.body, /\$\s?\d/, "no price is quoted at somebody who is being offered it free");
  // And nothing in it says or implies they look poor.
  assert.doesNotMatch(free.body, /struggl|afford|cheap|small business|tight/i);

  const paid = draftEmail({ ...site, audit: { business: { size: "established", offerFree: false } } },
    { address: "PO Box 1, Liberty MO" });
  assert.equal(paid.offerFree, false);
  assert.notEqual(paid.body, free.body);
});

test("a small business with a decent website is not offered a free rebuild", () => {
  // The offer is for businesses that need the work, not for every small one.
  const barelyAnything = {
    business: { name: "Quiet Cafe", town: "Liberty, MO" },
    score: 11,
    hits: [{ id: "stale_copyright", points: 8, label: "Footer looks abandoned", evidence: "Footer still says 2021." }],
    audit: { business: { size: "micro", offerFree: true } },
  };
  assert.equal(draftEmail(barelyAnything, { address: "PO Box 1" }).offerFree, false);
});

/* ------------------------------------- saying only what was actually found */

test("a page that overflows is described as overflowing, never as too small", () => {
  /*
    "Not responsive" covers two opposite symptoms, and the wording used to be
    picked by a hash of the business name - so about half the time the email
    described the wrong one. An owner who opens their phone and cannot find
    what the email said is gone for good, and rightly.
  */
  const overflowing = {
    business: { name: "Wide Load Haulage", town: "Liberty, MO" },
    score: 55,
    hits: [{ id: "not_responsive", points: 40, label: "Breaks on a phone", evidence: "On a phone: the page lays out 980px wide." }],
    audit: {
      mobileOverflowPct: 151, mobileCutOff: 8, mobileScrollWidth: 980,
      effectiveBodyPx: 16, mobileZoom: 1,
    },
  };
  const a = draftEmail(overflowing, { address: "PO Box 1" });
  assert.match(a.claims, /runs off the side|wider than the screen|off the edge/);
  assert.doesNotMatch(a.claims, /shrunk down|everything ends up tiny|too small to read/);
  assert.equal(claimsAreMeasured(a, overflowing.audit).ok, true);
});

test("a page that is shrunk is described as shrunk, never as overflowing", () => {
  const shrunk = {
    business: { name: "Perkins Upholstery", town: "Liberty, MO" },
    score: 55,
    hits: [{ id: "not_responsive", points: 40, label: "Breaks on a phone", evidence: "On a phone: the whole page is shrunk to fit." }],
    // Nothing overflows here. The browser laid it out at 980 and scaled it.
    audit: { mobileOverflowPct: 0, mobileCutOff: 0, mobileZoom: 0.4, bodyFontSize: 12, effectiveBodyPx: 4.8 },
  };
  const b = draftEmail(shrunk, { address: "PO Box 1" });
  assert.match(b.claims, /shrunk down|squeezes the desktop|too small to read|everything ends up tiny/);
  assert.doesNotMatch(b.claims, /runs off the side|wider than the screen|drag/);
  assert.equal(claimsAreMeasured(b, shrunk.audit).ok, true);
});

test("a symptom nobody measured is caught before the email is called ready", () => {
  /*
    The backstop. The phrasings above are already gated on the audit; this
    re-reads the finished letter, so a phrasing added later without a gate
    still cannot reach a stranger unflagged.
  */
  const draft = {
    claims: "Pulled up on a phone, the page runs off the side of the screen and has to be dragged around to read. " +
            "Browsers now put a \"not secure\" warning in front of the page. Some of the photos come out blurry.",
  };
  // A site where none of that is true.
  const clean = { mobileOverflowPct: 0, mobileCutOff: 0, sslValid: true, stretchedImages: 0 };
  const bad = claimsAreMeasured(draft, clean);
  assert.equal(bad.ok, false);
  assert.equal(bad.unsupported.length, 3, JSON.stringify(bad.unsupported));
  assert.match(bad.unsupported.join("; "), /dragged sideways/);
  assert.match(bad.unsupported.join("; "), /security warning/);
  assert.match(bad.unsupported.join("; "), /blurry/);

  // And the same sentences against a site where all three are true.
  const real = { mobileOverflowPct: 60, mobileCutOff: 5, sslValid: false, stretchedImages: 2 };
  assert.equal(claimsAreMeasured(draft, real).ok, true);
});

test("the sign-off is not held to the website's measurements", () => {
  // "Liberty" in a postal address is not a claim about anyone's website, and
  // the check must not read the signature as one.
  const lead = {
    business: { name: "Quiet Co", town: "Liberty, MO" },
    score: 30,
    hits: [{ id: "stale_copyright", points: 8, label: "Footer looks abandoned", evidence: "Footer still says 2019." }],
    audit: { copyrightYear: 2019 },
  };
  const d = draftEmail(lead, { address: "PO Box 42, Liberty MO 64068" });
  assert.equal(claimsAreMeasured(d, lead.audit).ok, true);
  assert.match(d.body, /PO Box 42/, "the address really is in the letter");
});

/* ---------------------------------------- a slow site leads with being slow */

test("a site that takes 4 seconds or more leads with that, and the phone is an also", () => {
  /*
    What he asked for: if it is true that the site takes about five seconds,
    that is the headline - the visitor has gone to a competitor before it
    loads - and not fitting a phone becomes the add-on.
  */
  const slowAndBroken = {
    business: { name: "Halstead Plumbing", town: "Liberty, MO" },
    score: 70,
    hits: [
      { id: "not_responsive", points: 40, label: "Breaks on a phone", evidence: "On a phone: the page lays out 980px wide." },
      { id: "slow_lcp", points: 21, label: "Slow to show anything", evidence: "The main content takes 5.2 seconds to appear. Google counts anything over 2.5s as slow." },
    ],
    audit: { lcpMs: 5200, mobileOverflowPct: 151, mobileCutOff: 8, mobileScrollWidth: 980, effectiveBodyPx: 16 },
  };
  const d = draftEmail(slowAndBroken, { address: "PO Box 84, Liberty, MO 64069" });
  const first = d.claims.split("\n")[0];
  assert.match(first, /5\.2 seconds/, "the measured time, said plainly");
  assert.match(first, /more than half of people leave/i, "and what it costs them");
  assert.match(first, /On top of that, on a phone the page runs off the side/, "the phone problem follows as the also");
  assert.ok(first.indexOf("5.2 seconds") < first.indexOf("On top of that"), "slow first, phone second");
  assert.match(d.subject, /load/i);
  assert.equal(numbersAreReal(d, d.facts).ok, true, JSON.stringify(numbersAreReal(d, d.facts)));
  assert.equal(claimsAreMeasured(d, slowAndBroken.audit).ok, true);
});

test("a site that loads quickly is never told it is slow", () => {
  // Only if it is true. 2.1 seconds is not the five-second story.
  const quickButBroken = {
    business: { name: "Wide Load Haulage", town: "Liberty, MO" },
    score: 55,
    hits: [
      { id: "not_responsive", points: 40, label: "Breaks on a phone", evidence: "On a phone: the page lays out 980px wide." },
      { id: "slow_lcp", points: 4, label: "Slow to show anything", evidence: "The main content takes 2.1 seconds to appear." },
    ],
    audit: { lcpMs: 2100, mobileOverflowPct: 151, mobileCutOff: 8, mobileScrollWidth: 980, effectiveBodyPx: 16 },
  };
  const d = draftEmail(quickButBroken, { address: "PO Box 84" });
  assert.match(d.claims.split("\n")[0], /runs off the side|wider than the screen|off the edge/, "the phone leads");
  assert.doesNotMatch(d.claims, /more than half of people leave|three seconds/);
});

test("the slow sentence is caught if the page was not actually slow", () => {
  const draft = { claims: "When I loaded your site, it took about 5.2 seconds before anything showed up on the screen." };
  assert.equal(claimsAreMeasured(draft, { lcpMs: 700 }).ok, false);
  assert.equal(claimsAreMeasured(draft, { lcpMs: 5200 }).ok, true);
});
