#!/usr/bin/env node
/**
 * Copies just the public website into dist/.
 *
 *   npm run build
 *
 * netlify.toml used to publish the repository root, which put every file in
 * the project on the live site — including docs/SETUP-CHECKLIST.md, which
 * discusses the owner's age and the money side of the business, and
 * docs/OUTREACH.md, which is the outreach playbook. A prospect poking at the
 * URL, or Google indexing it, would have found both.
 *
 * Listing what ships is safer than listing what does not: a new file is
 * private until someone deliberately adds it here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

/** Everything the public site needs, and nothing else. */
const SHIP = [
  'index.html', 'privacy.html', 'terms.html', 'success.html', '404.html',
  'favicon.svg', 'robots.txt', 'sitemap.xml', 'netlify.toml',
  'work/', 'assets/fonts/', 'assets/work/', 'assets/doc.css',
  'assets/og.png', 'assets/apple-touch-icon.png',
];

/** Never ship these, even if a rule above would otherwise pull them in. */
const NEVER = [/(^|\/)\.[^/]/, /node_modules/, /\.map$/, /(^|\/)app\//, /(^|\/)docs\//, /(^|\/)tools\//];

const copy = (from, to) => {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) copy(path.join(from, entry), path.join(to, entry));
    return 0;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return stat.size;
};

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

let files = 0, bytes = 0;
for (const entry of SHIP) {
  const src = path.join(root, entry);
  if (!fs.existsSync(src)) {
    console.error(`  missing: ${entry}`);
    process.exitCode = 1;
    continue;
  }
  copy(src, path.join(dist, entry));
}

// Walk what landed, so the count is of reality rather than of intentions.
const walk = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    files++; bytes += fs.statSync(p).size;
  }
};
walk(dist);

// The publish directory is its own root once deployed, so netlify.toml must
// not point back at the repository.
const toml = path.join(dist, 'netlify.toml');
fs.writeFileSync(toml, fs.readFileSync(toml, 'utf8').replace(/publish\s*=\s*"[^"]*"/, 'publish = "."'));

// Guard: nothing private may have slipped through.
const leaked = [];
const audit = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(dist, p);
    if (NEVER.some(re => re.test(rel))) leaked.push(rel);
    if (e.isDirectory()) audit(p);
  }
};
audit(dist);
if (leaked.length) {
  console.error(`\n  ${leaked.length} private path(s) reached dist/:\n   ${leaked.join('\n   ')}\n`);
  process.exit(1);
}

console.log(`\n  dist/  ${files} files, ${(bytes / 1024 / 1024).toFixed(2)}MB`);
console.log(`  Drag this folder onto app.netlify.com/drop, or let Netlify build from the repo.\n`);
