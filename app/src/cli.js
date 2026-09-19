#!/usr/bin/env node
/**
 * Phase 1: find businesses, measure their websites, score them. Sends nothing.
 *
 *   node app/src/cli.js --source file --input my-list.txt
 *   node app/src/cli.js --source osm --category hvac --city "Kansas City, MO"
 *   node app/src/cli.js --source places --category "HVAC contractor" --city "Kansas City, MO"
 */

import fs from "node:fs";
import path from "node:path";
import { discoverPlaces, discoverOsm, discoverFile } from "./discover.js";
import { auditSite, launchBrowser } from "./audit.js";
import { score, disqualify, qualifies } from "./score.js";
import { toCsv, toHtml } from "./report.js";

const args = parseArgs(process.argv.slice(2));

if (args.help || (!args.source && !args.input)) {
  console.log(`
  MBOnyx lead checker — finds businesses whose websites need rebuilding.
  Audits only. Sends nothing, contacts nobody.

  Usage
    node app/src/cli.js --source <file|osm|places> [options]

  Options
    --source     file | osm | places            (default: file)
    --input      path to your list              (--source file)
    --category   hvac, plumber, dentist...      (--source osm|places)
    --city       "Kansas City, MO"              (--source osm|places)
    --limit      how many businesses            (default 25)
    --out        output folder                  (default app/out)
    --shots      save a screenshot of each site
    --concurrency how many at once              (default 3)

  Places needs GOOGLE_PLACES_KEY in the environment. osm and file need nothing.
`);
  process.exit(0);
}

const source = args.source ?? "file";
const limit = parseInt(args.limit ?? "25", 10);
const outDir = args.out ?? "app/out";
const concurrency = Math.max(1, parseInt(args.concurrency ?? "3", 10));

const run = async () => {
  // ---------------------------------------------------------------- Discover
  console.log(`\n  Finding businesses (${source})…`);
  let businesses;

  if (source === "file") {
    if (!args.input) throw new Error("--input is required with --source file");
    businesses = discoverFile(fs.readFileSync(args.input, "utf8"), {
      category: args.category ?? "manual",
      city: args.city ?? "manual",
    }).slice(0, limit);
  } else if (source === "osm") {
    businesses = await discoverOsm({ category: args.category, city: args.city, limit });
  } else if (source === "places") {
    businesses = await discoverPlaces({
      category: args.category, city: args.city, limit,
      apiKey: process.env.GOOGLE_PLACES_KEY,
    });
  } else {
    throw new Error(`Unknown source "${source}"`);
  }

  console.log(`  Found ${businesses.length}.\n`);
  if (!businesses.length) return;

  fs.mkdirSync(outDir, { recursive: true });
  if (args.shots) fs.mkdirSync(path.join(outDir, "shots"), { recursive: true });

  // ------------------------------------------------------------- Drop early
  const leads = [];
  const toAudit = [];
  for (const business of businesses) {
    const reason = disqualify(business);
    if (reason) {
      leads.push({ business, dropReason: reason, tier: "-", score: null });
      console.log(`  ✗ ${pad(business.name)} ${reason}`);
    } else {
      toAudit.push(business);
    }
  }

  // ------------------------------------------------------------------ Audit
  console.log(`\n  Auditing ${toAudit.length} site(s)…\n`);
  const browser = await launchBrowser();
  let done = 0;

  const worker = async queue => {
    while (queue.length) {
      const business = queue.shift();
      const slug = slugify(business.name);
      const audit = await auditSite(business.website, {
        browser,
        screenshotPath: args.shots ? path.join(outDir, "shots", `${slug}.jpg`) : null,
      });

      if (audit.fetchFailed) {
        leads.push({ business, audit, dropReason: `unreachable: ${audit.error}`, tier: "-", score: null });
        console.log(`  ✗ ${pad(business.name)} unreachable`);
      } else {
        const s = score(audit);
        const q = business.reviewCount == null ? null : qualifies(business);
        leads.push({
          business, audit, ...s,
          qualified: q === null ? null : q.ok,
          qualifyReasons: q?.reasons ?? [],
        });
        console.log(`  ${s.tier === "A" ? "★" : "·"} ${pad(business.name)} ${String(s.score).padStart(3)}  Tier ${s.tier}  ${s.hits.slice(0, 2).map(h => h.label).join(", ")}`);
      }
      done++;
    }
  };

  const queue = [...toAudit];
  await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));
  await browser.close();

  // ----------------------------------------------------------------- Report
  leads.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const meta = { category: args.category ?? "manual list", city: args.city ?? "-", source };

  const csvPath = path.join(outDir, "leads.csv");
  const htmlPath = path.join(outDir, "report.html");
  fs.writeFileSync(csvPath, toCsv(leads));
  fs.writeFileSync(htmlPath, toHtml(leads, meta));

  const tiers = leads.reduce((m, l) => ({ ...m, [l.tier]: (m[l.tier] ?? 0) + 1 }), {});
  console.log(`\n  Done. A:${tiers.A ?? 0}  B:${tiers.B ?? 0}  C:${tiers.C ?? 0}  D:${tiers.D ?? 0}  dropped:${tiers["-"] ?? 0}`);
  console.log(`  ${htmlPath}  ← open this one`);
  console.log(`  ${csvPath}\n`);
};

run().catch(e => { console.error(`\n  Error: ${e.message}\n`); process.exit(1); });

/* --------------------------------------------------------------- helpers */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const pad = s => String(s).slice(0, 34).padEnd(35);
