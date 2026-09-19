/**
 * Every asset path must be relative.
 *
 * Absolute paths ("/assets/...") mean "the server root". Opened from a folder
 * — which is what happens when someone unzips the site and double-clicks
 * index.html — they mean the drive root instead, so every font, image and link
 * breaks. The site shipped that way once; this stops it happening again.
 */
import fs from 'node:fs';
import path from 'node:path';

const PAGES = ['index.html', 'privacy.html', 'terms.html', 'success.html', '404.html',
  ...fs.readdirSync('work').filter(f => f.endsWith('.html')).map(f => `work/${f}`)];

const problems = [];

for (const page of PAGES) {
  const src = fs.readFileSync(page, 'utf8');
  const depth = page.includes('/') ? '../' : '';

  // Site-root paths. Protocol-relative and absolute URLs are fine.
  for (const m of src.matchAll(/(?:href|src|action)="\/(?!\/)([^"]*)"/g)) {
    problems.push(`${page}: absolute path "/${m[1]}" — should be "${depth}${m[1] || 'index.html'}"`);
  }
  for (const m of src.matchAll(/url\("\/(?!\/)([^"]*)"\)/g)) {
    problems.push(`${page}: absolute url("/${m[1]}") in CSS`);
  }

  // Do the relative targets exist?
  for (const m of src.matchAll(/(?:href|src)="((?!https?:|mailto:|tel:|data:|#|\/\/)[^"#?]+)["#?]/g)) {
    const target = path.resolve(path.dirname(page), m[1]);
    if (!fs.existsSync(target)) problems.push(`${page}: "${m[1]}" does not exist`);
  }
}

// A stylesheet's url() resolves against the stylesheet, not the page.
const css = fs.readFileSync('assets/doc.css', 'utf8');
for (const m of css.matchAll(/url\("([^"]+)"\)/g)) {
  if (m[1].startsWith('/') || m[1].startsWith('http')) { problems.push(`assets/doc.css: "${m[1]}" is not relative`); continue; }
  const target = path.resolve('assets', m[1]);
  if (!fs.existsSync(target)) problems.push(`assets/doc.css: "${m[1]}" resolves to ${path.relative('.', target)}, which does not exist`);
}

console.log(problems.length
  ? `\n  ${problems.length} path problem(s):\n` + problems.map(p => '   ' + p).join('\n') + '\n'
  : '\n  PATHS: all relative and all targets exist\n');
process.exit(problems.length ? 1 : 0);
