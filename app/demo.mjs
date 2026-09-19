#!/usr/bin/env node
/**
 * `npm run demo`
 *
 * The 60-second proof that everything works. Serves the bundled example sites
 * from a local web server, audits them, and opens the report.
 *
 * No internet. No API keys. No accounts. Nothing is contacted, nothing is sent.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));   // app/
const repo = path.resolve(here, "..");

const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
                ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png",
                ".svg": "image/svg+xml", ".woff2": "font/woff2" };

/** Tiny static server. Only serves files inside the repo — nothing above it. */
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
  let file = path.resolve(repo, rel);

  // Serve index.html for a directory, the way any real web server does. Without
  // this the concept builds' "/" links 404 and the audit reports broken links
  // that only exist because of the demo server.
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, "index.html");
  }

  if (!file.startsWith(repo) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

console.log(`
  ┌──────────────────────────────────────────────────────────────┐
  │  MBOnyx lead checker — demo                                  │
  │                                                              │
  │  Auditing 9 example websites served from your own computer.  │
  │  Three are deliberately bad. Five are the concept builds.    │
  │  Nothing leaves this machine.                                │
  └──────────────────────────────────────────────────────────────┘
`);

// The demo list. Format is: Name, website, phone, rating, reviewCount
const list = [
  ["Ace Heating and Cooling", "app/test/fixtures/bad-2011.html",  "(555) 212-9000", 4.4, 130],
  ["Riverside Plumbing",      "app/test/fixtures/half-fixed.html","(555) 331-7788", 4.1, 62],
  ["Copperline Electric",     "app/test/fixtures/modern.html",    "(555) 664-2100", 4.8, 210],
  ["Tiny New Shop",           "app/test/fixtures/modern.html",    "(555) 000-1111", 5.0, 3],
  ["Lumen Dental Studio",     "work/lumen-dental.html",           "(555) 123-4567", 4.9, 412],
  ["Northpoint Heating",      "work/northpoint-hvac.html",        "(555) 930-0000", 4.8, 318],
  ["Ember and Oak",           "work/ember-oak.html",              "(555) 204-7781", 4.7, 96],
  ["Meridian Law Group",      "work/meridian-law.html",           "(555) 882-0140", 4.9, 41],
  ["Forge Athletics",         "work/forge-athletics.html",        "(555) 447-3300", 4.9, 260],
];

const outDir = path.join(here, "out", "demo");
fs.mkdirSync(outDir, { recursive: true });
const listPath = path.join(outDir, "demo-list.txt");
fs.writeFileSync(listPath, list.map(([n, p, ph, r, c]) => `${n}, ${base}/${p}, ${ph}, ${r}, ${c}`).join("\n"));

// The demo serves its fixtures from this machine, so it opts in to local
// targets. Real runs do not, and the guard in audit.js refuses them.
const args = ["src/cli.js", "--source", "file", "--input", listPath,
              "--out", outDir, "--concurrency", "2", "--allow-local",
              ...process.argv.slice(2)];

const child = spawn(process.execPath, args, { cwd: here, stdio: "inherit" });

child.on("exit", code => {
  server.close();
  const report = path.join(outDir, "report.html");
  if (code === 0 && fs.existsSync(report)) {
    console.log(`  Open this file in your browser:\n\n     ${report}\n`);
  } else if (code !== 0) {
    console.error(`
  The demo did not finish.

  The usual cause is the browser not being installed yet. Run:

     npx playwright install chromium

  Then try again. If it still fails, run "npm run doctor".
`);
  }
  process.exit(code ?? 0);
});
