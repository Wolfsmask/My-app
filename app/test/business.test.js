/**
 * Who should not get an email, and who should get a different one.
 *
 * Both of these decide whether a stranger hears from a fourteen-year-old
 * asking for nine hundred dollars, so both are worth being careful about.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { vitality, sizeOf, latestYearIn } from "../src/business.js";

const YEAR = new Date().getFullYear();

/* ------------------------------------------------------------ still trading */

test("a business that says it has closed is not a lead", () => {
  const v = vitality({ text: "Thank you for 30 wonderful years. Watson's Hardware is permanently closed." });
  assert.equal(v.state, "closed");
  assert.equal(v.contactable, false);
});

test("a site that was never finished is not a rebuild", () => {
  const v = vitality({ text: "Our new website is coming soon. Check back soon!" });
  assert.equal(v.state, "unbuilt");
  assert.equal(v.contactable, false);
});

test("a busy trade with a stale footer is still a lead", () => {
  /*
    The case this has to get right. Plenty of contractors are booked solid and
    have not touched their website since 2019. A checker that reads a stale
    footer as "closed" throws away the best leads there are.
  */
  const v = vitality({
    text: "Call us today for a free estimate. Open Monday to Friday. Emergency service available.",
    copyrightYear: YEAR - 6,
    latestYearOnPage: YEAR - 6,
  });
  assert.equal(v.state, "active");
  assert.equal(v.contactable, true);
});

test("a site with no sign of life is flagged quiet, not written off", () => {
  const v = vitality({ text: "Smith and Sons. Quality since 1974.", copyrightYear: YEAR - 7, latestYearOnPage: YEAR - 7 });
  assert.equal(v.state, "quiet");
  // Quiet is a reason to look before writing, never a reason to discard: the
  // only thing treated as proof is the business saying so itself.
  assert.equal(v.contactable, true);
  assert.match(v.reasons.join(" "), new RegExp(String(YEAR - 7)));
});

test("the newest year on the page is what counts, and the future does not", () => {
  assert.equal(latestYearIn("Serving since 1987. Updated 2019. Copyright 2016.", YEAR), 2019);
  assert.equal(latestYearIn("Booking for 2099 now", YEAR), null, "a typo must not read as fresh content");
  assert.equal(latestYearIn("no years here at all"), null);
});

/* -------------------------------------------------------------- can they pay */

test("a contractor with staff, trucks and a careers page is established", () => {
  const b = sizeOf({
    text: "Licensed, bonded and insured. Now hiring journeyman electricians. " +
          "Commercial and industrial service across the greater Kansas City metro. " +
          "Our team of eighteen electricians and a fleet of twelve trucks.",
    ownPageCount: 12,
  });
  assert.equal(b.size, "established");
  assert.equal(b.offerFree, false, "a company this size can pay for the work");
});

test("a one-page family shop is micro, and gets the free offer instead", () => {
  const b = sizeOf({ text: "Perkins Upholstery. Family run since 1987.", ownPageCount: 1 });
  assert.equal(b.size, "micro");
  assert.equal(b.offerFree, true);
  assert.match(b.reasons.join("; "), /family run/);
});

test("a free website-builder plan is never called established", () => {
  /*
    A business on a free plan with somebody else's advert across its page is
    not one to send a nine-hundred-dollar proposal to, however much its copy
    talks about commercial work and being licensed.
  */
  const text = "Licensed and insured. Now hiring. Commercial and industrial. Since 1994.";
  assert.equal(sizeOf({ text, ownPageCount: 9 }).size, "established");
  const onFree = sizeOf({ text, ownPageCount: 9, freeTier: true });
  assert.equal(onFree.size, "micro");
  assert.equal(onFree.offerFree, true);
});

test("reviews can only ever move a business up, never down", () => {
  const quiet = { text: "Tony's Pizza.", ownPageCount: 1 };
  assert.equal(sizeOf(quiet).size, "micro");
  assert.equal(sizeOf({ ...quiet, reviewCount: 0 }).size, "micro", "no reviews proves nothing");
  assert.equal(sizeOf({ ...quiet, reviewCount: 240 }).size, "small", "240 reviews proves somebody is busy");

  // And a big count cannot promote a business past what its own page shows.
  const big = sizeOf({ text: "Licensed and insured. Now hiring. Commercial work.", ownPageCount: 9, reviewCount: 500 });
  assert.equal(big.size, "established");
});
