/**
 * Starting this version on a save folder from before it could send email.
 *
 * Everything in that folder was emailed by hand from Gmail. The app has to
 * record all of it as sent the first time it opens - Send all would otherwise
 * write to every one of those businesses again - and keep it out of every
 * list, because it is done with.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8233;
const BASE = `http://127.0.0.1:${PORT}`;
let dir, server, stdout = "";

const old = (name, tier, extra = {}) => ({
  business: { name, town: "Liberty, MO", website: `https://${name.toLowerCase().replace(/\W/g, "")}.test` },
  tier, score: 50,
  hits: [{ id: "looks_dated", points: 29, label: "The design looks dated", evidence: "The design reads as the early 2010s." }],
  audit: { contactEmail: `office@${name.toLowerCase().replace(/\W/g, "")}.test`, visualAgeSignals: 4 },
  ...extra,
});

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbonyx-old-save-"));
  // A save folder exactly as the old version left it: no migrations.json,
  // no sent.json, no mail status on anything.
  fs.writeFileSync(path.join(dir, "leads.json"), JSON.stringify([
    old("Buckner Heating", "A", { review: "keep" }),
    old("Smith Roofing", "B"),
    old("Kept Bakery", "C", { review: "keep" }),
    old("Fine Dental", "D"),
  ]));
  server = spawn(process.execPath, [path.join(here, "..", "ui.mjs")], {
    env: { ...process.env, PORT: String(PORT), MBONYX_OUT: dir },
    stdio: ["ignore", "pipe", "ignore"],
  });
  server.stdout.on("data", d => { stdout += d; });
  for (let i = 0; i < 40; i++) {
    if (await fetch(BASE, { signal: AbortSignal.timeout(500) }).then(r => r.ok).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 250));
  }
});

after(() => {
  server?.kill();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test("everything saved before is recorded as sent, and nothing gets a letter", async () => {
  const emails = await fetch(`${BASE}/api/emails`, { method: "POST", body: "{}" }).then(r => r.json());
  assert.equal(emails.drafts.length, 0, "no letter to anyone already emailed");
  assert.equal(emails.needSearch, 0, "and no time spent looking for their addresses");

  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "leads.json"), "utf8"));
  const status = Object.fromEntries(onDisk.map(l => [l.business.name, l.mail?.status ?? null]));
  assert.deepEqual(status, { "Buckner Heating": "sent", "Smith Roofing": "sent", "Kept Bakery": "sent", "Fine Dental": null });
  assert.match(stdout, /3 businesses saved before this version recorded as already emailed/);
});

test("and they are kept out of every list", async () => {
  const leads = await fetch(`${BASE}/api/leads`).then(r => r.json());
  assert.deepEqual(leads.map(l => l.name), ["Fine Dental"], "not on the Find & check page");
  const sent = await fetch(`${BASE}/api/mail/sent`).then(r => r.json());
  assert.deepEqual(sent, [], "and not in the Sent list either");
});

test("it happens once: restarting does not touch anything found since", async () => {
  const marker = JSON.parse(fs.readFileSync(path.join(dir, "migrations.json"), "utf8"));
  assert.equal(marker.count, 3);
  assert.ok(marker.oldSavesMarkedSent);
});
