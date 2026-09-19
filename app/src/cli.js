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
import { vision } from "./visual.js";
import { writeEmail } from "./email.js";
import { toInbox, toConsole, toEmail } from "./notify.js";

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

  The full pipeline
    --vision     have Claude judge each screenshot (implies --shots)
    --draft      write a draft email for every tier A/B lead
    --notify     print and log leads worth contacting as they are found
    --notify-email  also email the drafts to you (needs RESEND_KEY + NOTIFY_TO)
    --min-tier   which tier to notify and draft for   (default A)
    --audit-base base URL for audit pages, e.g. https://mbonyx.com/audit
    --sender     your first name, used to sign drafts (default Micah)

  Drafts are written to app/out/drafts/ for you to read, edit and send
  yourself. Nothing in this tool ever emails a prospect.

  Keys: GOOGLE_PLACES_KEY (places source), ANTHROPIC_API_KEY (--vision,
  --draft), RESEND_KEY + NOTIFY_TO (--notify-email). osm and file need nothing.
`);
  process.exit(0);
}

const source = args.source ?? "file";
const limit = parseInt(args.limit ?? "25", 10);
const outDir = args.out ?? "app/out";
const concurrency = Math.max(1, parseInt(args.concurrency ?? "3", 10));
const wantShots = Boolean(args.shots || args.vision);
const minTier = String(args["min-tier"] ?? "A").toUpperCase();
const TIER_ORDER = { A: 3, B: 2, C: 1, D: 0 };
const meetsBar = t => (TIER_ORDER[t] ?? 0) >= (TIER_ORDER[minTier] ?? 3);

/**
 * One Anthropic client, created only if a key exists and something needs it.
 * Missing key is a clear error rather than a silent skip — a run that quietly
 * produced no drafts would be worse than one that refused to start.
 */
let anthropic = null;
if (args.vision || args.draft) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("\n  --vision and --draft need ANTHROPIC_API_KEY set.\n");
    process.exit(1);
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  anthropic = new Anthropic();
}

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
  if (wantShots) fs.mkdirSync(path.join(outDir, "shots"), { recursive: true });
  if (args.draft) fs.mkdirSync(path.join(outDir, "drafts"), { recursive: true });

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
      const shotPath = wantShots ? path.join(outDir, "shots", `${slug}.jpg`) : null;
      const audit = await auditSite(business.website, { browser, screenshotPath: shotPath });

      if (audit.fetchFailed) {
        leads.push({ business, audit, dropReason: `unreachable: ${audit.error}`, tier: "-", score: null });
        console.log(`  ✗ ${pad(business.name)} unreachable`);
      } else {
        // Ask Claude what the screenshot looks like, then re-score with that
        // in hand so the visual judgement actually affects the tier.
        let visualJudgement = null;
        if (args.vision && shotPath) {
          visualJudgement = await vision(shotPath, { client: anthropic });
          if (visualJudgement && !visualJudgement.error) {
            audit.visualDesignScore = visualJudgement.design_score;
            audit.visualDecade = visualJudgement.looks_like_decade;
            audit.visualFirstImpression = visualJudgement.first_impression;
            audit.visualProblems = visualJudgement.visible_problems;
          }
        }

        const s = score(audit);
        const q = business.reviewCount == null ? null : qualifies(business);
        const lead = {
          business, audit, ...s, visualJudgement, slug,
          qualified: q === null ? null : q.ok,
          qualifyReasons: q?.reasons ?? [],
        };

        if (args.draft && meetsBar(s.tier)) {
          try {
            lead.email = await writeEmail(lead, {
              client: anthropic,
              auditUrl: args["audit-base"] ? `${String(args["audit-base"]).replace(/\/$/, "")}/${slug}` : null,
              senderName: args.sender ?? "Micah",
            });
            fs.writeFileSync(
              path.join(outDir, "drafts", `${slug}.txt`),
              draftToText(lead)
            );
          } catch (e) {
            lead.emailError = e.message.slice(0, 160);
          }
        }

        leads.push(lead);

        if (args.notify && meetsBar(s.tier)) {
          toConsole(lead);
          toInbox(lead, outDir);
        } else {
          console.log(`  ${s.tier === "A" ? "★" : "·"} ${pad(business.name)} ${String(s.score).padStart(3)}  Tier ${s.tier}  ${s.hits.slice(0, 2).map(h => h.label).join(", ")}`);
        }
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

  if (args["notify-email"]) {
    const worth = leads.filter(l => !l.dropReason && meetsBar(l.tier));
    const r = await toEmail(worth, {
      apiKey: process.env.RESEND_KEY,
      to: process.env.NOTIFY_TO,
      from: process.env.NOTIFY_FROM,
    });
    console.log(r.skipped ? "\n  (notify-email skipped: set RESEND_KEY and NOTIFY_TO)"
              : r.ok ? `\n  Emailed ${worth.length} lead(s) to ${process.env.NOTIFY_TO}`
                     : `\n  Notification email failed: ${r.error ?? r.status}`);
  }

  const tiers = leads.reduce((m, l) => ({ ...m, [l.tier]: (m[l.tier] ?? 0) + 1 }), {});
  console.log(`\n  Done. A:${tiers.A ?? 0}  B:${tiers.B ?? 0}  C:${tiers.C ?? 0}  D:${tiers.D ?? 0}  dropped:${tiers["-"] ?? 0}`);
  console.log(`  ${htmlPath}  ← open this one`);
  console.log(`  ${csvPath}`);
  if (args.draft) console.log(`  ${path.join(outDir, "drafts")}/  ← review before sending`);
  console.log("");
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

/** What gets written to app/out/drafts/<slug>.txt for you to read. */
function draftToText(lead) {
  const e = lead.email;
  const v = e.verification;
  return [
    `To:      ${lead.business.name}  <${lead.business.website}>`,
    `Tier:    ${lead.tier}  (${lead.score}/100)`,
    `Status:  ${e.sendable ? "PASSED verification — safe to review and send" : "FAILED verification — DO NOT SEND"}`,
    v.problems.length ? `Problems:\n  - ${v.problems.join("\n  - ")}` : "",
    "",
    `Subject: ${e.subject}`,
    "",
    e.body,
    "",
    "---",
    `Findings this was built from (${v.numbersChecked} number(s) checked against them):`,
    ...(lead.hits ?? []).map(h => `  [${h.id}] ${h.evidence}`),
    "",
    "Read it once out loud before sending. If you would not say it to someone's",
    "face, rewrite it.",
  ].filter(x => x !== "").join("\n");
}

const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const pad = s => String(s).slice(0, 34).padEnd(35);
