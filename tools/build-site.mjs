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

/*
  Bake the live-client screenshot into the shipped page.

  index.html marks that one card's frame with data-shot attributes and shows a
  placeholder panel, because the machine that wrote the file cannot reach the
  public internet to photograph the site. In the browser a small script probes
  for the image and swaps it in — which costs a 404 on every page load when the
  file is not there yet, and a site that sells "I will find what is broken on
  yours" should not be shipping a 404 of its own.

  So the decision is made here instead, once, at build time: if the screenshot
  exists it becomes a plain <img> like every other card, and if it does not the
  data-shot attributes are stripped so the browser never goes looking. Either
  way dist/ ships no request that is expected to fail. The source file is
  untouched; only the copy in dist/ is rewritten.
*/
const bakeShots = html => {
  const openTag = /<div\s+class="work-card__frame"((?:[^>]*?)\sdata-shot="[^"]*"(?:[^>]*?))>/g;
  const img = (src, cls, alt, w, h) =>
    `<img\n                  class="${cls}"\n                  src="${src}"\n` +
    `                  alt="${alt}"\n                  width="${w}"\n                  height="${h}"\n` +
    `                  loading="lazy"\n                  decoding="async"\n                >`;

  let out = html, baked = 0, stripped = 0;
  for (const match of [...html.matchAll(openTag)]) {
    const attrs = match[1];
    const read = name => (attrs.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];
    const desktop = read('data-shot');
    const mobile = read('data-shot-mobile');
    const alt = read('data-shot-alt') || '';
    const have = file => file && fs.existsSync(path.join(dist, file));

    // The placeholder is the only thing between this tag and the shots.
    const from = out.indexOf('<div class="work-card__pending">', out.indexOf(match[0]));
    const to = from === -1 ? -1 : out.indexOf('</div>', from);
    if (from === -1 || to === -1) {
      console.error('  a work-card__frame carries data-shot but has no placeholder panel');
      process.exit(1);
    }
    const panel = out.slice(from, to + 6);
    if (panel.includes('<div', 4)) {
      console.error('  the placeholder panel has nested elements this rewrite cannot survive');
      process.exit(1);
    }

    if (have(desktop)) {
      const shots = [img(desktop, 'work-card__shot', alt, 1000, 625)];
      if (have(mobile)) shots.push(img(mobile, 'work-card__mobile', 'The same page on a phone', 480, 960));
      out = out.slice(0, from) + shots.join('\n                ') + out.slice(to + 6);
      baked++;
    } else {
      stripped++;
    }
    out = out.replace(match[0], '<div class="work-card__frame">');
  }

  if (baked) console.log(`  baked ${baked} live screenshot(s) into the page`);
  if (stripped) console.log(`  ${stripped} live card(s) shipping the placeholder — run: npm run shot:live`);
  return out;
};

const indexPath = path.join(dist, 'index.html');
fs.writeFileSync(indexPath, bakeShots(fs.readFileSync(indexPath, 'utf8')));

// Guard: no shipped page may ask the browser for a file that is not here.
const missing = [];
for (const page of fs.readdirSync(dist).filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(dist, page), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="((?:assets|work)\/[^"#?]+)"/g)) {
    if (!fs.existsSync(path.join(dist, m[1]))) missing.push(`${page} -> ${m[1]}`);
  }
  if (/data-shot=/.test(html)) missing.push(`${page} still carries a data-shot probe`);
}
if (missing.length) {
  console.error(`\n  ${missing.length} dead reference(s) in dist/:\n   ${missing.join('\n   ')}\n`);
  process.exit(1);
}

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
