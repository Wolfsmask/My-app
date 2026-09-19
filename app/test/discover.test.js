/**
 * The OpenStreetMap search, driven against a stand-in for Nominatim and
 * Overpass that this file starts itself.
 *
 * The real services cannot be reached from CI, and hitting them from a test
 * would be both slow and rude to a free service. What is worth pinning down
 * here is everything between their response and a usable lead: which entries
 * get dropped, how a website with no scheme is repaired, and whether a failure
 * arrives as a sentence someone can act on.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const ELEMENTS = [
  { type: "node", id: 1, tags: { name: "Ace Heating", craft: "hvac", website: "http://ace.test", phone: "(816) 555-0100" } },
  { type: "way",  id: 2, tags: { name: "Bell Air", craft: "hvac", "contact:website": "bell.test", "contact:phone": "(816) 555-0200" } },
  { type: "node", id: 3, tags: { name: "Cold Comfort", craft: "hvac" } },
  { type: "node", id: 4, tags: { name: "ACE HEATING", craft: "hvac", website: "http://dupe.test" } },
  { type: "node", id: 5, tags: { craft: "hvac", website: "http://noname.test" } },
];

let server, port, OVERPASS;
before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/search") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(u.searchParams.get("q") === "Atlantis" ? "[]" : JSON.stringify([{ lat: "39.2", lon: "-94.4" }]));
    }
    // Stands in for an instance that refuses everything, the way the real one
    // was refusing with a bare 406.
    if (u.pathname === "/refuses") {
      return res.writeHead(406, { "Content-Type": "text/html" })
        .end("<html><body>Not Acceptable: your client is not welcome here</body></html>");
    }
    if (u.pathname === "/interpreter") {
      let body = "";
      req.on("data", c => (body += c));
      return req.on("end", () => {
        // Keyed off the tag the gym query actually sends, not the word "gym",
        // which never appears in an Overpass query.
        if (body.includes("fitness_centre")) return res.writeHead(504).end("gateway timeout");
        // The query must arrive as the raw body, not wrapped in "data=".
        if (!body.startsWith("[out:json]")) return res.writeHead(400).end("expected a raw query");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ elements: ELEMENTS }));
      });
    }
    res.writeHead(404).end();
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  process.env.MBONYX_NOMINATIM_URL = `http://127.0.0.1:${port}/search`;
  process.env.MBONYX_OVERPASS_URL = `http://127.0.0.1:${port}/interpreter`;
  OVERPASS = { good: `http://127.0.0.1:${port}/interpreter`, refuses: `http://127.0.0.1:${port}/refuses` };
});
after(() => server?.close());

// Imported after the env vars are set, since the module reads them on load.
const { discoverOsm, OSM_CATEGORIES } = await import("../src/discover.js");

test("keeps the usable entries and drops the rest", async () => {
  const found = await discoverOsm({ category: "hvac", city: "Liberty, MO" });
  const names = found.map(b => b.name);

  assert.deepEqual(names, ["Ace Heating", "Bell Air", "Cold Comfort"]);
  // An entry with no name is useless in an email, and the same business listed
  // twice would be audited twice and pitched twice.
  assert.ok(!names.includes("ACE HEATING"), "a repeat of a name already seen is dropped");
  assert.equal(found.length, 3);
});

test("repairs a website recorded without a scheme", async () => {
  const found = await discoverOsm({ category: "hvac", city: "Liberty, MO" });
  // "bell.test" is not a URL any fetch would accept, and left alone it would be
  // reported as an unreachable business rather than a lead.
  assert.equal(found.find(b => b.name === "Bell Air").website, "https://bell.test");
  assert.equal(found.find(b => b.name === "Ace Heating").website, "http://ace.test");
});

test("a business with no website comes back rather than vanishing", async () => {
  const found = await discoverOsm({ category: "hvac", city: "Liberty, MO" });
  const cold = found.find(b => b.name === "Cold Comfort");
  // Still a lead — a different pitch. The app lists these separately, so the
  // search must not quietly drop them.
  assert.ok(cold, "kept");
  assert.equal(cold.website, null);
});

test("carries the fields the report and the filter need", async () => {
  const [ace] = await discoverOsm({ category: "hvac", city: "Liberty, MO" });
  assert.equal(ace.phone, "(816) 555-0100");
  assert.equal(ace.source, "osm");
  assert.equal(ace.city, "Liberty, MO");
  // OpenStreetMap holds no ratings at all. Reporting a fake one would let the
  // "can they afford you" filter run on a number nobody measured.
  assert.equal(ace.rating, null);
  assert.equal(ace.reviewCount, null);
});

test("every offered category is one the search can actually run", async () => {
  assert.ok(OSM_CATEGORIES.length >= 8);
  for (const { key, label } of OSM_CATEGORIES) {
    assert.ok(label && key, "each has a key and a label");
    await assert.doesNotReject(
      () => discoverOsm({ category: key, city: "Liberty, MO" }).catch(e => {
        // The stub fails "gym" on purpose; a mapping error is the failure that matters.
        if (/No OSM mapping/.test(e.message)) throw e;
      }),
      `${key} is mapped`,
    );
  }
});

test("failures say what to do about them", async () => {
  await assert.rejects(
    () => discoverOsm({ category: "florist", city: "Liberty, MO" }),
    e => /No OSM mapping for "florist"/.test(e.message) && /hvac/.test(e.message),
    "an unmapped category names the ones that work",
  );
  await assert.rejects(
    () => discoverOsm({ category: "hvac", city: "Atlantis" }),
    /Could not find "Atlantis" on the map/,
  );
  await assert.rejects(
    () => discoverOsm({ category: "gym", city: "Liberty, MO" }),
    /504/,
    "a service outage is reported, not swallowed into an empty result",
  );
});

test("moves on to the next server when one refuses", async () => {
  process.env.MBONYX_OVERPASS_URL = `${OVERPASS.refuses},${OVERPASS.good}`;
  try {
    const found = await discoverOsm({ category: "hvac", city: "Liberty, MO" });
    // A single instance refusing is routine; it must not end the search.
    assert.equal(found.length, 3, "the search still returns results");
  } finally {
    process.env.MBONYX_OVERPASS_URL = OVERPASS.good;
  }
});

test("when every server refuses, the error repeats what they said", async () => {
  process.env.MBONYX_OVERPASS_URL = `${OVERPASS.refuses},${OVERPASS.refuses}`;
  try {
    await assert.rejects(
      () => discoverOsm({ category: "hvac", city: "Liberty, MO" }),
      e => {
        // "Overpass 406" on its own is a dead end for whoever has to fix it.
        assert.match(e.message, /406/, "keeps the status");
        assert.match(e.message, /not welcome here/, "keeps what the server actually said");
        assert.match(e.message, /127\.0\.0\.1/, "names which server");
        return true;
      },
    );
  } finally {
    process.env.MBONYX_OVERPASS_URL = OVERPASS.good;
  }
});
