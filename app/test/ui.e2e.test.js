/**
 * Drives the page in a real browser against a throwaway store.
 *
 * The buttons here decide what happens to a night's work, and the failure
 * this file exists for could not be caught anywhere else: the store's delete
 * worked perfectly, the route worked perfectly, and the button was still
 * missing from every card that had been saved - because the code that wrote
 * "Kept." into the row replaced the button along with it.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8231;
const BASE = `http://127.0.0.1:${PORT}`;

const lead = (name, tier, score, review) => ({
  business: { name, town: "Liberty, MO", website: `https://${name.toLowerCase().replace(/\s/g, "")}.test` },
  tier, score, confidence: 85, review,
  slug: name.toLowerCase().replace(/\s/g, ""),
  hits: [{ id: "looks_dated", points: 29, label: "The design looks dated", evidence: "The design reads as the early 2010s." }],
  audit: { business: { size: "small", offerFree: false, reasons: ["years in business"] } },
});

let dir, server, browser, page;
/** Every confirm() the page has put up, in order. */
const asked = [];

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbonyx-ui-"));
  fs.writeFileSync(path.join(dir, "leads.json"), JSON.stringify([
    lead("Saved A", "A", 62, "keep"),        // saved on a previous night
    lead("Saved B", "B", 31, "keep"),
    lead("Fresh C", "C", 17, null),          // never looked at
    // Closed for good: still on disk, deliberately not shown on the page.
    ...[0, 1, 2, 3, 4].map(i => lead(`Closed D${i}`, "D", 5, "confirmed")),
  ]));

  server = spawn(process.execPath, [path.join(here, "..", "ui.mjs")], {
    env: { ...process.env, PORT: String(PORT), MBONYX_OUT: dir },
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    if (await fetch(BASE, { signal: AbortSignal.timeout(500) }).then(r => r.ok).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  page = await browser.newPage({ viewport: { width: 1180, height: 1200 } });
  // One handler, not one per test: two listeners both calling accept() race,
  // and the loser throws after the test has already finished.
  page.on("dialog", d => { asked.push(d.message()); d.accept(); });
});

after(async () => {
  await browser?.close();
  server?.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
});

const cards = () => page.evaluate(() => [...document.querySelectorAll(".lead")].map(c => ({
  name: c.querySelector(".lead__name").textContent,
  canDelete: !!c.querySelector("[data-forget]"),
})));

test("a site saved on a previous night can still be deleted", async () => {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const before = await cards();
  assert.deepEqual(before.map(c => c.name), ["Saved A", "Saved B", "Fresh C"],
    "closed leads stay off the page, saved ones stay on it");
  // The regression. Every one of these had already been through Save now,
  // which is exactly the pile worth clearing out.
  for (const c of before) assert.equal(c.canDelete, true, `${c.name} must offer Delete`);

  await page.click('.lead:has-text("Saved A") [data-forget]');
  await page.waitForTimeout(600);
  assert.deepEqual((await cards()).map(c => c.name), ["Saved B", "Fresh C"], "the card goes");

  const state = await (await fetch(`${BASE}/api/state`)).json();
  assert.equal(state.tiers.A, undefined, "and the row goes with it, not just the card");
  assert.equal(state.forgotten, 1, "and the address is remembered so it cannot come back");
});

test("a bulk delete warns with the number that will actually go", async () => {
  /*
    The page lists only leads that have not been closed, and the bulk delete
    takes the whole tier including the closed ones. Counting the cards made
    the button say "nothing in Tier D to delete" while five sat on disk.
  */
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  assert.equal((await cards()).some(c => c.name.startsWith("Closed")), false, "none of them are on the page");

  asked.length = 0;
  await page.click("#delD");
  await page.waitForTimeout(800);
  assert.match(asked.join(" "), /Delete all 5 Tier D/, "the warning has to name the real number");
  const state = await (await fetch(`${BASE}/api/state`)).json();
  assert.equal(state.tiers.D, undefined, "all five are gone");
});
