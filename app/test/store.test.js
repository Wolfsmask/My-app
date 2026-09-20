/**
 * What survives being closed and reopened.
 *
 * The tool is meant to be started in the morning and left alone. That only
 * holds if a restart is free: if closing the window means re-running two
 * thousand queries against free volunteer servers to rediscover businesses
 * already on disk, nobody would leave it running, and the servers would not
 * deserve it.
 */
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../src/store.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbonyx-store-")); });
after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

test("a restart remembers the searches already run", () => {
  const first = createStore(dir);
  first.markDone("hvac|Liberty, MO|0");
  first.rememberPlace("Liberty, MO", { lat: 39.2, lon: -94.4, radiusKm: 8 });

  const afterRestart = createStore(dir);
  assert.equal(afterRestart.isDone("hvac|Liberty, MO|0"), true, "does not search it again");
  assert.equal(afterRestart.isDone("plumber|Liberty, MO|0"), false, "and knows what it has not done");
  assert.ok(afterRestart.place("Liberty, MO"), "a town is geocoded once, ever");
});

test("the same name in a different town is a different business", () => {
  const s = createStore(dir);
  s.addBusiness({ name: "Arctic Air", town: "Liberty, MO", website: "https://a.test" });
  s.addBusiness({ name: "Arctic Air", town: "Kearney, MO", website: "https://b.test" });
  // Keyed on name alone, the second would be silently dropped as a repeat.
  assert.equal(s.found.length, 2);
  assert.equal(s.hasBusiness("Arctic Air", "Liberty, MO"), true);
  assert.equal(s.hasBusiness("Arctic Air", "Smithville, MO"), false);
});

test("one website is one business, however many trades it is listed under", () => {
  const s = createStore(dir);
  // "Smith Heating & Plumbing" is found under hvac and again under plumber,
  // and resolves to the same site both times. Two audits of one page is
  // wasteful; two emails to one owner about the same site is embarrassing.
  s.addBusiness({ name: "Smith Heating", town: "Liberty, MO", category: "hvac", website: "https://smith.test" });
  s.addBusiness({ name: "Smith Plumbing", town: "Liberty, MO", category: "plumber", website: "https://smith.test" });

  assert.equal(s.found.length, 2, "both listings are kept");
  assert.deepEqual(s.pendingAudit().map(b => b.website), ["https://smith.test"], "but the site is checked once");
  assert.equal(s.summary().withSite, 1);
});

test("a site already checked is not checked again", () => {
  const s = createStore(dir);
  s.addBusiness({ name: "Arctic Air", town: "Liberty, MO", website: "https://a.test" });
  assert.equal(s.pendingAudit().length, 1);

  s.addLead({ business: { name: "Arctic Air", website: "https://a.test" }, tier: "B", score: 60 });
  assert.equal(s.pendingAudit().length, 0, "checking two hundred sites twice is an afternoon wasted");

  const afterRestart = createStore(dir);
  assert.equal(afterRestart.pendingAudit().length, 0, "and it still knows after a restart");
});

test("work in progress is on disk, not only in memory", () => {
  const s = createStore(dir);
  s.addBusiness({ name: "Arctic Air", town: "Liberty, MO", website: "https://a.test" });
  // Written as each one is found, so a closed laptop costs the next one and
  // not the whole morning.
  assert.ok(fs.existsSync(path.join(dir, "found.json")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "found.json"), "utf8")).length, 1);
});

test("a half-written file does not destroy the day's work", () => {
  const s = createStore(dir);
  s.addBusiness({ name: "Arctic Air", town: "Liberty, MO", website: "https://a.test" });
  // Saves go to a temporary file and are moved into place, so an interrupted
  // write cannot leave a truncated one where the results used to be.
  assert.ok(!fs.existsSync(path.join(dir, "found.json.tmp")), "no leftover temporary file");
  assert.equal(createStore(dir).found.length, 1);
});

test("a low score is provisional until somebody looks at it", () => {
  const s = createStore(dir);
  s.addBusiness({ name: "Low Co", town: "Liberty, MO", website: "https://low.test" });
  s.addLead({ business: { name: "Low Co", website: "https://low.test" }, tier: "D", score: 8 });

  // The machine's opinion is not a decision. Writing a business off forever on
  // an unreviewed guess is how a real lead disappears with nobody ever seeing
  // it, so it stays in the queue until it has been looked at.
  assert.deepEqual(s.pendingAudit().map(b => b.name), ["Low Co"], "still checkable");
  assert.equal(s.summary().awaitingReview, 1);

  s.review("https://low.test", "confirmed");
  assert.deepEqual(s.pendingAudit(), [], "settled once confirmed");
  assert.equal(s.summary().awaitingReview, 0);
  assert.equal(createStore(dir).pendingAudit().length, 0, "and it stays settled after a restart");
});

test("keeping a low-scored business also settles it", () => {
  const s = createStore(dir);
  s.addBusiness({ name: "Low Co", town: "Liberty, MO", website: "https://low.test" });
  s.addLead({ business: { name: "Low Co", website: "https://low.test" }, tier: "C", score: 30 });
  // "Actually worth it" is a decision too - it should not keep coming back.
  s.review("https://low.test", "keep");
  assert.deepEqual(s.pendingAudit(), []);
});

test("a good score is not something to review", () => {
  const s = createStore(dir);
  s.addBusiness({ name: "Good Co", town: "Liberty, MO", website: "https://good.test" });
  s.addLead({ business: { name: "Good Co", website: "https://good.test" }, tier: "A", score: 81 });
  // A high rank is a lead waiting to be emailed, not a write-off. Re-checking
  // it would be churn.
  assert.deepEqual(s.pendingAudit(), []);
  assert.equal(s.summary().awaitingReview, 0);
});

test("re-checking replaces the verdict and keeps the decision", () => {
  const s = createStore(dir);
  s.addBusiness({ name: "Low Co", town: "Liberty, MO", website: "https://low.test" });
  s.addLead({ business: { name: "Low Co", website: "https://low.test" }, tier: "D", score: 8 });
  s.addLead({ business: { name: "Low Co", website: "https://low.test" }, tier: "C", score: 30 });

  // One business, one verdict - not two rows in the report for the same site.
  assert.equal(s.leads.length, 1);
  assert.equal(s.leads[0].score, 30, "the newer check wins");

  s.review("https://low.test", "confirmed");
  s.addLead({ business: { name: "Low Co", website: "https://low.test" }, tier: "D", score: 5 });
  // A re-check must not quietly undo something already looked at and settled.
  assert.equal(s.leads[0].review, "confirmed");
});

test("saving keeps the good ones and closes the book on the rest", () => {
  const s = createStore(dir);
  for (const [name, url, tier] of [
    ["Good", "https://a.test", "A"], ["Alright", "https://b.test", "B"],
    ["Meh", "https://c.test", "C"], ["Fine", "https://d.test", "D"],
  ]) {
    s.addBusiness({ name, town: "Liberty, MO", website: url });
    s.addLead({ business: { name, website: url }, tier, score: 50 });
  }

  // Everything A or B, plus the one low-ranked site picked out by hand.
  const { kept, closed } = s.saveNow(["https://c.test"]);
  assert.equal(kept, 3);
  assert.equal(closed, 1);

  // The closed one must never come back round - that is the whole point: a
  // later night is not spent re-checking sites already passed over.
  assert.deepEqual(s.pendingAudit(), []);
  assert.equal(createStore(dir).pendingAudit().length, 0, "still closed after a restart");
  assert.equal(createStore(dir).leads.find(l => l.business.website === "https://d.test").review, "confirmed");
  assert.equal(createStore(dir).leads.find(l => l.business.website === "https://c.test").review, "keep");
});

test("saving hands back the screenshots that can be binned", () => {
  const s = createStore(dir);
  for (const [name, url, tier, slug] of [
    ["Good", "https://a.test", "A", "good"], ["Fine", "https://d.test", "D", "fine"],
  ]) {
    s.addBusiness({ name, town: "Liberty, MO", website: url });
    s.addLead({ business: { name, website: url }, tier, score: 40, slug });
  }
  const { closedSlugs } = s.saveNow([]);
  // A night's checking writes about 180MB of screenshots and nothing was
  // removing the ones belonging to sites already passed over.
  assert.deepEqual(closedSlugs, ["fine"], "only the closed one's");
});

test("what is closed stays on disk but stops counting as kept", () => {
  const s = createStore(dir);
  for (const [name, url, tier] of [["Good", "https://a.test", "A"], ["Fine", "https://d.test", "D"]]) {
    s.addBusiness({ name, town: "Liberty, MO", website: url });
    s.addLead({ business: { name, website: url }, tier, score: 40 });
  }
  s.saveNow([]);

  const after = createStore(dir);
  // Still recorded - that is what stops it being checked a third time - but
  // it is finished with, and should not come back onto the page or into the
  // report every time the app opens.
  assert.equal(after.leads.length, 2, "both are still on disk");
  assert.equal(after.summary().kept, 1);
  assert.equal(after.summary().closed, 1);
  assert.equal(after.leads.filter(l => l.review !== "confirmed").length, 1, "one live lead");
});

test("reset clears everything, and only on an explicit ask", () => {
  const s = createStore(dir);
  s.markDone("hvac|Liberty, MO|0");
  s.addBusiness({ name: "Arctic Air", town: "Liberty, MO", website: "https://a.test" });
  s.addLead({ business: { name: "Arctic Air", website: "https://a.test" }, tier: "B" });

  s.reset();
  assert.deepEqual(s.summary(), { towns: 0, searches: 0, found: 0, withSite: 0, audited: 0, kept: 0, closed: 0, awaitingReview: 0, pending: 0 });
  assert.equal(createStore(dir).found.length, 0, "and it stays cleared after a restart");
});

test("unreadable files are survivable, not fatal", () => {
  fs.writeFileSync(path.join(dir, "found.json"), "{ this is not json");
  // A corrupted file should cost the history, not stop the tool from starting.
  const s = createStore(dir);
  assert.deepEqual(s.found, []);
  s.addBusiness({ name: "Arctic Air", town: "Liberty, MO", website: "https://a.test" });
  assert.equal(s.found.length, 1);
});
