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
  const miss = await find("Wilson Mechanical, INC");
  assert.equal(miss.website, null);
  // The reason has to survive. "No website found" and "the lookup is broken"
  // are indistinguishable without it, which is exactly how a total failure
  // passed for an empty town.
  assert.ok(miss.tried.some(t => /wilsonmechanical\.com/.test(t)), "says it tried the real guess");
  assert.ok(miss.tried.some(t => /nothing else about this business/.test(t)), "says why it refused");
});

test("returns nothing when no guess answers at all", async () => {
  const miss = await find("Nonexistent Heating and Cooling");
  assert.equal(miss.website, null);
  assert.ok(miss.tried.length, "still says what it tried");
});

test("a broken lookup is raised, not filed as no website", async () => {
  // The whole bug: AbortSignal.any is missing on Node before 20.3, the
  // TypeError landed in the catch, and every business in town came back
  // empty with nothing said.
  const real = AbortSignal.any;
  AbortSignal.any = undefined;
  try {
    const hit = await resolveWebsite(
      { name: "Buckner's Heating & Cooling", city: "Liberty, MO", website: null },
      {
        allowLocal: true,
        signal: new AbortController().signal,
        fetchImpl: () => Promise.resolve(new Response(page("<p>Buckner's Heating of Liberty.</p>"), { status: 200 })),
      },
    );
    assert.ok(hit.website, "a working lookup must not depend on AbortSignal.any");
  } finally {
    AbortSignal.any = real;
  }
});

test("a domain that does not exist is a miss, not a failed search", async () => {
  // Node reports every network failure as "TypeError: fetch failed", so a
  // guessed domain that simply does not resolve looks exactly like a bug in
  // this file. Treating it as one ended the whole search on the first dead
  // guess - which is the ordinary case, since most guesses are wrong.
  const dead = () => {
    const e = new TypeError("fetch failed");
    e.cause = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    throw e;
  };
  const miss = await resolveWebsite(
    { name: "Buckner's Heating & Cooling", city: "Liberty, MO", website: null },
    { allowLocal: true, fetchImpl: dead },
  );
  assert.equal(miss.website, null);
  assert.ok(miss.tried.every(t => /no such domain/.test(t)), "reported in words, per guess");
});

test("a bug in the lookup is thrown rather than swallowed", async () => {
  await assert.rejects(
    () => resolveWebsite(
      { name: "Buckner's Heating & Cooling", city: "Liberty, MO", website: null },
      { allowLocal: true, fetchImpl: () => { throw new TypeError("undefined is not a function"); } },
    ),
    TypeError,
    "a programming error must not look like a business with no website",
  );
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
