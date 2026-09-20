/**
 * The outreach email.
 *
 * What is being protected here is not prose quality - it is that the email
 * cannot state something nobody measured, cannot go out without the things
 * US law requires, and cannot arrive at two businesses word for word.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftEmail, numbersAreReal } from "../src/draft.js";

const lead = (name, over = {}) => ({
  business: { name, town: "Liberty, MO", category: "HVAC / heating & cooling", website: "https://x.test" },
  findings: [{ id: "not_responsive", points: 25, evidence: "Page is 980px wide on a 390px phone screen." }],
  audit: { mobileScrollWidth: 980 },
  ...over,
});

const SENDER = { name: "Brennen", email: "mbonyxstudios@gmail.com", address: "PO Box 1, Liberty, MO 64068" };

test("puts the measured number in the email, and no other", () => {
  const d = draftEmail(lead("Buckner's Heating"), SENDER);
  assert.match(d.body, /980/, "the measurement is there to be checked");
  const check = numbersAreReal(d, ["Page is 980px wide on a 390px phone screen."]);
  // A figure nobody took off their page is the one thing an owner will
  // notice and disbelieve.
  assert.ok(check.ok, `invented numbers: ${check.invented.join(", ")}`);
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
  assert.match(d.body, /980/, "the measurement reached the email");
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
