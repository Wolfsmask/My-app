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

/*
  Strip the whole [build] block from the shipped config.

  dist/ is already built, so there is nothing left to run. Rewriting only the
  publish path and leaving `command = "node tools/build-site.mjs"` behind broke
  a drag-and-drop deploy outright: Netlify read the config, tried to run the
  build script, and could not find it — tools/ is deliberately not shipped.

  When the repository is connected instead, Netlify reads the netlify.toml at
  the repo root, not this one, so nothing is lost by removing it here.
*/
const toml = path.join(dist, 'netlify.toml');
fs.writeFileSync(toml,
  fs.readFileSync(toml, 'utf8')
    .replace(/\[build\][\s\S]*?(?=\n\[|\n# ---|$)/, '')
    .replace(/^# The site is static HTML[\s\S]*?baseline\.$/m,
             '# This copy ships inside dist/, which is already built. What remains is\n' +
             '# headers and redirects: caching for stable assets, and a security baseline.')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart());

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

// Guard: the shipped config must not ask Netlify to run anything, and must not
// reference a file that is not in the folder.
const shipped = fs.readFileSync(toml, 'utf8');
const configProblems = [];
if (/^\s*command\s*=/m.test(shipped)) configProblems.push('a build command survived into dist/netlify.toml');
if (/\[build\]/.test(shipped)) configProblems.push('a [build] section survived into dist/netlify.toml');
for (const m of shipped.matchAll(/"((?:tools|app|docs)\/[^"]+)"/g)) {
  configProblems.push(`dist/netlify.toml references ${m[1]}, which is not shipped`);
}
if (configProblems.length) {
  console.error(`\n  ${configProblems.length} config problem(s):\n   ${configProblems.join('\n   ')}\n`);
  process.exit(1);
}

console.log(`\n  dist/  ${files} files, ${(bytes / 1024 / 1024).toFixed(2)}MB`);
console.log(`  Drag this folder onto app.netlify.com/drop, or let Netlify build from the repo.\n`);
