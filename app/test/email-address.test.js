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

test("a Gmail address on their own site is theirs", () => {
  /*
    This used to be refused - "no way to tell theirs from the designer's" -
    and it was the single biggest reason half the drafts said "no email" for
    businesses whose address was the first thing on their homepage. A free
    address printed on a business's own contact line is the business's.
    What identifies a designer is the words around it, tested below.
  */
  const r = pickBusinessEmail(["bucknershvac@gmail.com", "mate@yahoo.com"], SITE);
  assert.equal(r.email, "bucknershvac@gmail.com", "the one that matches their name wins");
  assert.equal(r.confident, true);
  assert.match(r.why, /gmail\.com address/);
});

test("a designer's credit line is never taken for the business", () => {
  const credit = { address: "pixelco.design@gmail.com", source: "text", context: "© 2025 Buckner's. Website by Pixel Co — pixelco.design@gmail.com" };
  // Alone, it is refused outright and not even offered as a maybe.
  const alone = pickBusinessEmail([credit], SITE);
  assert.equal(alone.email, null);
  assert.deepEqual(alone.candidates, []);

  // And a context-free sighting of the same address - from the page's joined
  // text - must not launder it. That is exactly how it slipped through.
  const laundered = pickBusinessEmail([credit, { address: "pixelco.design@gmail.com", source: "text" }], SITE);
  assert.equal(laundered.email, null);

  // Next to the owner's own address, the owner's is chosen.
  const both = pickBusinessEmail([credit, { address: "bucknershvac@gmail.com", source: "mailto", context: "Email us: bucknershvac@gmail.com" }], SITE);
  assert.equal(both.email, "bucknershvac@gmail.com");

  for (const words of ["Designed by Pixel Co", "Site by Pixel", "Powered by Pixel Co", "Web design by Pixel Co", "SEO by Pixel"]) {
    assert.equal(pickBusinessEmail([{ address: "p@gmail.com", context: `${words} p@gmail.com` }], SITE).email, null, words);
  }
});

test("a template's placeholder Gmail is not anyone's address", () => {
  for (const addr of ["yourname@gmail.com", "email@gmail.com", "you@yahoo.com", "john.doe@gmail.com", "name@outlook.com"]) {
    assert.equal(pickBusinessEmail([addr], SITE).email, null, addr);
  }
});

test("a domain that shares their business name counts as theirs", () => {
  // bucknersheating.com, with the office on bucknershvac.com.
  const r = pickBusinessEmail(["hello@unrelated-supplier.com", "office@bucknershvac.com"], SITE);
  assert.equal(r.email, "office@bucknershvac.com");
  assert.match(r.why, /matching their business name/);
});

test("an unrelated company's address is offered, never used on its own", () => {
  // As likely a supplier, a parent company or a booking platform as them.
  const r = pickBusinessEmail(["orders@acmesupply.com"], SITE);
  assert.equal(r.email, null);
  assert.deepEqual(r.candidates, ["orders@acmesupply.com"]);
});

test("own domain beats a Gmail address, which beats nothing", () => {
  const r = pickBusinessEmail(["bucknershvac@gmail.com", "office@bucknersheating.com"], SITE);
  assert.equal(r.email, "office@bucknersheating.com");
});

test("Cloudflare's hidden addresses decode", async () => {
  const { decodeCfEmail } = await import("../src/emails.js");
  // Key 0x5a, then each character XORed with it - how the page ships it.
  const hex = "5a" + [..."info@bucknersheating.com"].map(c => (c.charCodeAt(0) ^ 0x5a).toString(16).padStart(2, "0")).join("");
  assert.equal(decodeCfEmail(hex), "info@bucknersheating.com");
  assert.equal(decodeCfEmail("zz"), null);
  assert.equal(decodeCfEmail(""), null);
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
