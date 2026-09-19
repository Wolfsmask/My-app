#!/usr/bin/env node
/**
 * `npm run doctor`
 *
 * Checks the setup and says, in plain words, what is missing and how to fix it.
 * Run this first whenever something does not work.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rows = [];
const add = (name, ok, detail, fix) => rows.push({ name, ok, detail, fix });

// --- Node -------------------------------------------------------------------
const major = parseInt(process.versions.node.split(".")[0], 10);
add("Node.js", major >= 20, `v${process.versions.node}`,
    "Install Node 20 or newer from nodejs.org, then reopen your terminal.");

// --- Packages ---------------------------------------------------------------
for (const pkg of ["playwright", "@anthropic-ai/sdk", "zod"]) {
  let version = null;
  try {
    version = JSON.parse(
      fs.readFileSync(path.join(here, "node_modules", pkg, "package.json"), "utf8")
    ).version;
  } catch { /* not installed */ }
  add(`package ${pkg}`, Boolean(version), version ? `v${version}` : "not installed",
      "Run: npm install");
}

// --- Browser ----------------------------------------------------------------
let browserOk = false, browserDetail = "not found";
try {
  const { chromium } = await import("playwright");
  const exe = process.env.CHROMIUM_PATH || chromium.executablePath();
  browserOk = fs.existsSync(exe);
  browserDetail = browserOk ? exe : `expected at ${exe}`;
} catch (e) {
  browserDetail = e.message.split("\n")[0].slice(0, 90);
}
add("Chromium browser", browserOk, browserDetail, "Run: npx playwright install chromium");

// --- Optional keys ----------------------------------------------------------
const optional = [
  ["ANTHROPIC_API_KEY", "needed for --vision and --draft (AI email writing)"],
  ["GOOGLE_PLACES_KEY", "needed for --source places (auto-finding businesses)"],
  ["RESEND_KEY",        "needed for --notify-email"],
  ["NOTIFY_TO",         "needed for --notify-email"],
];

// --- Print ------------------------------------------------------------------
const pad = s => String(s).padEnd(22);
console.log("\n  Setup check\n  " + "─".repeat(58));
for (const r of rows) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${pad(r.name)} ${r.detail}`);
  if (!r.ok) console.log(`      → ${r.fix}`);
}

console.log("\n  Optional — only needed for the AI parts\n  " + "─".repeat(58));
for (const [key, why] of optional) {
  console.log(`  ${process.env[key] ? "✓" : "·"} ${pad(key)} ${process.env[key] ? "set" : why}`);
}

const required = rows.every(r => r.ok);
console.log(
  required
    ? "\n  Everything required is ready. Run:  npm run demo\n"
    : "\n  Fix the ✗ lines above, then run this again.\n"
);
process.exit(required ? 0 : 1);
