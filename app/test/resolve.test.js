/**
 * Finding the website a business actually has.
 *
 * The risk being tested is not "does it find sites" - it is "does it ever
 * attach the wrong site to a business". A miss costs a lead. A wrong match
 * costs an email to a stranger claiming their website is bad, under his real
 * name, at 14. So most of this file is about what must be refused.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  nameTokens, distinctiveToken, candidateDomains, pageProvesBusiness, resolveWebsite,
} from "../src/resolve.js";

const page = body => `<!DOCTYPE html><html><head><title>x</title></head><body>${body.repeat(8)}</body></html>`;

/** Domain -> what that domain serves. Anything not listed does not answer. */
const WEB = {
  "bucknersheating.com": page("<p>Buckner's Heating and Cooling has served Liberty since 1994. Furnace repair, AC install.</p>"),
  "shanksheatingandcooling.com": page("<p>Shanks Heating &amp; Cooling - Liberty MO. Emergency service.</p>"),
  "arcticairheatingcooling.com": page("<p>Arctic Air: this domain is for sale. Buy this domain today.</p>"),
  "arctichvac.com": page("<p>Welcome to Arctic Air Heating and Cooling of Liberty. Call us.</p>"),
  "wilsonmechanical.com": page("<p>Wilson makes the official game ball of the NFL. Shop tennis rackets.</p>"),
  "ecsgeothermal.com": page("<p>ECS Geothermal installs ground source heat pumps across Missouri.</p>"),
  "tinyco.com": "<html><body>hi</body></html>",
};

let server, port;
before(async () => {
  server = http.createServer((req, res) => {
    const domain = decodeURIComponent(new URL(req.url, "http://x").pathname.slice(1));
    if (!(domain in WEB)) { res.writeHead(404).end("no such site"); return; }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(WEB[domain]);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(() => server?.close());

const find = (name, city = "Liberty, MO") => resolveWebsite(
  { name, city, website: null },
  { allowLocal: true, urlFor: d => `http://127.0.0.1:${port}/${encodeURIComponent(d)}` },
);

/* ------------------------------------------------------------- name -> guess */

test("reads a business name the way a domain would be written", () => {
  assert.deepEqual(nameTokens("Buckner's Heating & Cooling"), ["buckners", "heating", "and", "cooling"]);
  // A legal suffix is part of the name and never part of the domain.
  assert.deepEqual(nameTokens("Wilson Mechanical, INC"), ["wilson", "mechanical"]);
  assert.deepEqual(nameTokens("O'Brien Plumbing LLC"), ["obrien", "plumbing"]);
});

test("picks the word that identifies the business, not the trade", () => {
  assert.equal(distinctiveToken("Buckner's Heating & Cooling"), "buckners");
  // Every competitor in town also says "heating" and "cooling".
  assert.notEqual(distinctiveToken("Arctic Air Heating & Cooling"), "heating");
  assert.equal(distinctiveToken("Arctic Air Heating & Cooling"), "arctic");
  // Short names still need something to check for.
  assert.equal(distinctiveToken("ECS Geothermal"), "ecs");
});

test("never guesses a bare one-word domain", () => {
  // wilson.com is Wilson Sporting Goods; arctic.com and buckners.com are
  // likewise somebody else. These are the guesses that can both answer and
  // wrongly prove themselves, so they are not made at all.
  for (const name of ["Wilson Mechanical, INC", "Arctic Air Heating & Cooling", "Buckner's Heating & Cooling"]) {
    for (const d of candidateDomains(name)) {
      assert.ok(d.split(".")[0].length > 3 || !/^(wilson|arctic|buckners)\./.test(d), `${d} is a bare one-word guess`);
    }
  }
  assert.ok(!candidateDomains("Wilson Mechanical, INC").includes("wilson.com"));
});

test("keeps the number of guesses bounded", () => {
  // Each guess is a real request to someone else's server.
  assert.ok(candidateDomains("A Very Long Heating And Cooling Company Name").length <= 8);
});

/* ------------------------------------------------------------------- proof */

test("refuses a page that only shares a family name", () => {
  const wilson = page("<p>Wilson makes the official game ball of the NFL.</p>");
  const proof = pageProvesBusiness(wilson, "Wilson Mechanical, INC", { city: "Liberty, MO" });
  assert.equal(proof.ok, false, "Wilson Sporting Goods is not Wilson Mechanical");
});

test("refuses a parked domain even when the name matches", () => {
  const parked = page("<p>Arctic Air: this domain is for sale. Buy this domain today.</p>");
  assert.equal(pageProvesBusiness(parked, "Arctic Air Heating & Cooling").ok, false);
});

test("refuses a page with almost nothing on it", () => {
  assert.equal(pageProvesBusiness("<html><body>hi</body></html>", "Tiny Co").ok, false);
});

test("accepts a page that carries the name and the trade", () => {
  const real = page("<p>Wilson Mechanical provides HVAC service in Liberty.</p>");
  assert.equal(pageProvesBusiness(real, "Wilson Mechanical, INC", { city: "Liberty, MO" }).ok, true);
});

/* --------------------------------------------------------------- end to end */

test("finds the site of a business OpenStreetMap had nothing for", async () => {
  const hit = await find("Buckner's Heating & Cooling");
  assert.ok(hit, "found something");
  assert.match(hit.website, /bucknersheating\.com/);
  assert.equal(hit.via, "found");
});

test("walks past a parked domain to the real one", async () => {
  // arcticairheatingcooling.com is parked; arctichvac.com is the business.
  const hit = await find("Arctic Air Heating & Cooling");
  assert.ok(hit);
  assert.match(hit.website, /arctichvac\.com/);
});

test("returns nothing rather than the wrong company", async () => {
  // wilsonmechanical.com answers, but it is Wilson Sporting Goods.
  assert.equal(await find("Wilson Mechanical, INC"), null);
});

test("returns nothing when no guess answers at all", async () => {
  assert.equal(await find("Nonexistent Heating and Cooling"), null);
});

test("keeps a website OpenStreetMap already had, without guessing", async () => {
  const hit = await resolveWebsite(
    { name: "Buckner's Heating & Cooling", city: "Liberty, MO", website: "https://already-known.example" },
    { allowLocal: true, urlFor: () => { throw new Error("should not have guessed"); } },
  );
  assert.equal(hit.website, "https://already-known.example");
  assert.equal(hit.via, "listed");
});

test("records where a redirect actually landed", async () => {
  const hit = await find("Shanks Heating & Cooling");
  assert.ok(hit);
  // res.url, not the guessed address, so a business that moved is recorded
  // where it now lives.
  assert.match(hit.website, /shanksheatingandcooling\.com/);
});
