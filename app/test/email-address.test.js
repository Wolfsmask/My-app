/**
 * Working out which address on a page belongs to the business.
 *
 * This is the one place in the tool where being wrong sends a real letter to
 * a real stranger. A page carries the owner's address, and usually also the
 * web designer's in the footer, a form service's noreply, and whatever the
 * template shipped with. Writing to the wrong one is worse than writing to
 * none, so almost all of this is about what must be refused.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBusinessEmail } from "../src/audit.js";

const SITE = "https://bucknersheating.com";

test("takes the address on the business's own domain", () => {
  const r = pickBusinessEmail(["office@bucknersheating.com"], SITE);
  assert.equal(r.email, "office@bucknersheating.com");
  assert.equal(r.confident, true);
});

test("prefers the business over whoever built the site", () => {
  // The designer's address in the footer is the single most common wrong
  // answer, and it is a stranger receiving a letter about a site that is not
  // theirs.
  const r = pickBusinessEmail(["hello@webdesignco.com", "info@bucknersheating.com"], SITE);
  assert.equal(r.email, "info@bucknersheating.com");
});

test("will not guess when nothing is on their domain", () => {
  // An owner on gmail is common and real, but there is no way to tell theirs
  // from their nephew's who built the site. Offered as a maybe, never used.
  const r = pickBusinessEmail(["bucknershvac@gmail.com", "mate@yahoo.com"], SITE);
  assert.equal(r.email, null);
  assert.equal(r.confident, false);
  assert.deepEqual(r.candidates, ["bucknershvac@gmail.com", "mate@yahoo.com"]);
});

test("refuses addresses nobody reads", () => {
  for (const addr of ["noreply@bucknersheating.com", "no-reply@bucknersheating.com", "postmaster@bucknersheating.com"]) {
    assert.equal(pickBusinessEmail([addr], SITE).email, null, addr);
  }
});

test("refuses the website builder's own support address", () => {
  for (const addr of ["support@wix.com", "support@squarespace.com", "support@godaddy.com"]) {
    const r = pickBusinessEmail([addr], SITE);
    assert.equal(r.email, null, addr);
    assert.deepEqual(r.candidates, [], `${addr} should not even be offered`);
  }
});

test("refuses placeholders the template shipped with", () => {
  // These sit in unedited templates constantly, and "info@example.com" used
  // to survive because the check ran against the whole address rather than
  // the domain, where every domain sits behind an "@".
  for (const addr of ["info@example.com", "you@example.com", "test@test.com", "a@localhost.com"]) {
    assert.deepEqual(pickBusinessEmail([addr], SITE).candidates, [], addr);
  }
});

test("tidies up what it scrapes off a page", () => {
  const r = pickBusinessEmail(["  INFO@BucknersHeating.COM.", "info@bucknersheating.com"], SITE);
  assert.equal(r.email, "info@bucknersheating.com");
  assert.equal(r.candidates.length, 1, "the same address written twice is one address");
});

test("accepts a subdomain of theirs, and ignores a lookalike", () => {
  assert.equal(pickBusinessEmail(["info@mail.bucknersheating.com"], SITE).email, "info@mail.bucknersheating.com");
  // Not their domain, however much it resembles it.
  assert.equal(pickBusinessEmail(["info@bucknersheating.com.evil.net"], SITE).email, null);
});

test("survives a page with nothing usable on it", () => {
  for (const input of [[], null, undefined, ["not an address", "@", "a@b"]]) {
    const r = pickBusinessEmail(input, SITE);
    assert.equal(r.email, null);
    assert.equal(r.confident, false);
  }
});

test("survives a site address that is not a proper URL", () => {
  // An audit that redirected oddly can leave a non-URL here, and that should
  // cost the match, not throw.
  const r = pickBusinessEmail(["info@bucknersheating.com"], "not a url at all");
  assert.equal(r.email, null);
  assert.deepEqual(r.candidates, ["info@bucknersheating.com"]);
});
