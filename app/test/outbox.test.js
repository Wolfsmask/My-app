/**
 * Which drafts can be sent, and which saved leads are looked at again first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDrafts, needsEmailSearch, needsPhoneCheck } from "../src/outbox.js";

const ADDRESS = { address: "PO Box 84, Liberty, MO 64069" };
const storeOf = leads => ({ leads, isSuppressed: () => false, alreadyMailed: () => false });
const lead = (name, audit, extra = {}) => ({
  business: { name, town: "Liberty, MO", website: `https://${name.toLowerCase().replace(/\W+/g, "")}.test` },
  tier: "A", score: 60,
  hits: [{ id: "looks_dated", points: 29, label: "Looks dated", evidence: "The design reads as the early 2010s." }],
  audit: { visualAgeSignals: 4, emailSearchVersion: 3, phoneCheckVersion: 2, ...audit },
  ...extra,
});

test("an address on some other company's domain is its own group, not 'no email'", () => {
  /*
    Addresses turned up by hand on sites the app said had none. Some were
    exactly this: an address it would not use on its own, listed as a maybe,
    under a heading that said there was no email anywhere.
  */
  const drafts = buildDrafts(storeOf([
    lead("Johnson Plumbing", { contactEmail: null, emailCandidates: ["office@johnsonfamilyservices.com"] }),
    lead("Nothing Co", { contactEmail: null, emailCandidates: [] }),
  ]), ADDRESS);
  const by = n => drafts.find(d => d.name === n);
  assert.equal(by("Johnson Plumbing").group, "pick");
  assert.deepEqual(by("Johnson Plumbing").maybe, ["office@johnsonfamilyservices.com"]);
  assert.equal(by("Johnson Plumbing").sendable, false, "never sent until it is checked and picked");
  assert.equal(by("Nothing Co").group, "noEmail");
  assert.equal(by("Nothing Co").sendable, false);
});

test("a site that blocked the check, or would not load, says so", () => {
  const drafts = buildDrafts(storeOf([
    lead("Walled Garden", { contactEmail: null, emailSearchBlocked: true }),
    lead("Down Today", { contactEmail: null, emailSearchError: "net::ERR_NAME_NOT_RESOLVED" }),
  ]), ADDRESS);
  assert.equal(drafts.find(d => d.name === "Walled Garden").searchBlocked, true);
  assert.match(drafts.find(d => d.name === "Down Today").searchError, /NAME_NOT_RESOLVED/);
  assert.ok(drafts.every(d => !d.sendable));
});

test("picking an address by hand makes the letter ready", () => {
  const drafts = buildDrafts(storeOf([
    lead("Johnson Plumbing", { contactEmail: null, emailCandidates: ["office@johnsonfamilyservices.com"] },
      { emailOverride: "office@johnsonfamilyservices.com" }),
  ]), ADDRESS);
  assert.equal(drafts[0].group, "ready");
  assert.equal(drafts[0].to, "office@johnsonfamilyservices.com");
});

test("which saved leads have their address looked for again", () => {
  assert.equal(needsEmailSearch({ audit: {} }), true, "saved before any of this");
  assert.equal(needsEmailSearch({ audit: { emailSearchVersion: 1, contactEmail: "a@b.com" } }), true);
  assert.equal(needsEmailSearch({ audit: { emailSearchVersion: 2, contactEmail: null } }), true,
    "came back empty before the search learned to scroll, follow quote links and read provider addresses");
  assert.equal(needsEmailSearch({ audit: { emailSearchVersion: 2, contactEmail: "a@b.com" } }), false, "already has one");
  assert.equal(needsEmailSearch({ audit: { emailSearchVersion: 3, contactEmail: null } }), false, "searched the new way");
  assert.equal(needsEmailSearch({ audit: { emailSearchVersion: 1 }, emailOverride: "a@b.com" }), false, "picked by hand");
});

test("which saved leads have their phone verdict checked again", () => {
  const hits = ids => ids.map(id => ({ id }));
  assert.equal(needsPhoneCheck({ audit: {}, hits: hits(["not_responsive"]) }), true);
  assert.equal(needsPhoneCheck({ audit: {}, hits: hits(["text_too_small"]) }), true);
  assert.equal(needsPhoneCheck({ audit: {}, hits: hits(["tiny_tap_targets"]) }), true);
  assert.equal(needsPhoneCheck({ audit: {}, hits: hits(["slow_lcp"]) }), false, "no phone claim to check");
  assert.equal(needsPhoneCheck({ audit: { phoneCheckVersion: 2 }, hits: hits(["not_responsive"]) }), false, "already checked twice");
});

test("a letter built on an unchecked phone verdict is held back", () => {
  const old = lead("Old Save", { contactEmail: "office@oldsave.test", phoneCheckVersion: undefined, isResponsive: false });
  old.hits.push({ id: "not_responsive", points: 40, label: "Breaks on a phone", evidence: "On a phone: 1000px wide." });
  const [d] = buildDrafts(storeOf([old]), ADDRESS);
  assert.equal(d.sendable, false);
  assert.ok(d.warnings.some(w => /has not been looked at again yet/.test(w)));
});
