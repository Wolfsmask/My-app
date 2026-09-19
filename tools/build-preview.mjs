#!/usr/bin/env node
/**
 * Builds mbonyx-preview.html: one self-contained file that opens by
 * double-click. Fonts, screenshots and every sub-page are embedded.
 *
 *   node tools/build-preview.mjs
 *
 * The output is a build artifact and is not committed — it was 90% of the
 * repository by size, because every rebuild rewrites a megabyte of base64 and
 * git stores each one whole. Regenerate it whenever you want a copy to send.
 *
 * Ported from Python so it needs nothing beyond Node, which the project
 * already requires.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const b64 = (p, mime) => `data:${mime};base64,` + fs.readFileSync(path.join(root, p)).toString('base64');

/*
  Every font any page references. A family missing here is stripped from the
  sub-pages by FONT_MARKER and never re-injected, so the preview silently falls
  back to a system face — which is exactly the difference the concept builds
  exist to demonstrate. The guard at the end of this file catches that.
*/
const FONT_FACES = [
  ['Inter',            'normal', '100 900', 'inter-var.woff2'],
  ['Playfair Display', 'normal', '600',     'playfair-600.woff2'],
  ['Playfair Display', 'italic', '600',     'playfair-600-italic.woff2'],
  ['Fraunces',         'normal', '400 700', 'fraunces-var.woff2'],
  ['Oswald',           'normal', '400 700', 'oswald-var.woff2'],
];

const FONT_MARKER = '/*__FONTS__*/';
const fontData = Object.fromEntries(
  FONT_FACES.map(([, , , f]) => [`/assets/fonts/${f}`, b64(`assets/fonts/${f}`, 'font/woff2')])
);

let html = read('index.html');

// ---- 1. Inline the fonts --------------------------------------------------
for (const [p, data] of Object.entries(fontData)) html = html.split(`url("${p}")`).join(`url("${data}")`);
html = html.replace(/\s*<link rel="preload" href="\/assets\/fonts\/[^>]+>/g, '');

// ---- 2. Inline the screenshots -------------------------------------------
for (const f of fs.readdirSync(path.join(root, 'assets/work')).filter(f => f.endsWith('.webp')).sort()) {
  html = html.split(`/assets/work/${f}`).join(b64(`assets/work/${f}`, 'image/webp'));
}

// ---- 3. Favicon in, server-dependent tags out ----------------------------
html = html.split('href="/favicon.svg"').join(`href="${b64('favicon.svg', 'image/svg+xml')}"`);
html = html.replace(/\s*<link rel="apple-touch-icon"[^>]+>/g, '')
           .replace(/\s*<link rel="canonical"[^>]+>/g, '')
           .replace(/\s*<meta property="og:[^>]+>/g, '')
           .replace(/\s*<meta name="twitter:[^>]+>/g, '');

// ---- 4. Collect every sub-page, minus its own @font-face block -----------
const prep = file => {
  let src = read(file);
  src = src.replace(/@font-face\{[^}]*\}/g, '')
           .replace(/  @font-face \{[\s\S]*?\n  \}\n/g, '');
  src = src.replace('<style>', '<style>' + FONT_MARKER);
  if (src.includes('assets/doc.css')) {
    const docCss = read('assets/doc.css').replace(/@font-face\{[^}]*\}/g, '');
    src = src.replace('<link rel="stylesheet" href="/assets/doc.css">', `<style>${FONT_MARKER}${docCss}</style>`);
  }
  src = src.replace(/<link rel="(icon|apple-touch-icon|preload)"[^>]*>/g, '');
  // No server inside the preview, so internal links return to the shell.
  return src.split('href="/#work"').join('href="#" onclick="parent.closePreview();return false"')
            .split('href="/"').join('href="#" onclick="parent.closePreview();return false"');
};

const SLUGS = ['lumen-dental', 'northpoint-hvac', 'ember-oak', 'meridian-law', 'forge-athletics'];
const pages = {};
for (const s of SLUGS) pages[s] = prep(`work/${s}.html`);
for (const s of ['privacy', 'terms', 'success', '404']) pages[s] = prep(`${s}.html`);

const TITLES = {
  'lumen-dental': 'Lumen Dental Studio', 'northpoint-hvac': 'Northpoint Heating & Air',
  'ember-oak': 'Ember & Oak', 'meridian-law': 'Meridian Law Group',
  'forge-athletics': 'Forge Athletics', privacy: 'Privacy Policy',
  terms: 'Terms of Service', success: 'Form success page', '404': '404 page',
};

const fontCss = FONT_FACES.map(([fam, style, wt, f]) =>
  `@font-face{font-family:"${fam}";font-style:${style};font-weight:${wt};font-display:swap;` +
  `src:url("${fontData['/assets/fonts/' + f]}") format("woff2")}`).join('');

// ---- 5. Portfolio links become preview triggers --------------------------
html = html.replace(/href="\/work\/([a-z-]+)\.html"\s*\n\s*target="_blank"\s*\n\s*rel="noopener"/g,
                    'href="#" data-preview="$1"')
           .split('href="/privacy.html"').join('href="#" data-preview="privacy"')
           .split('href="/terms.html"').join('href="#" data-preview="terms"');

// ---- 6. The overlay -------------------------------------------------------
const overlay = read('tools/preview-shell.html')
  .replace('__PAGES__', JSON.stringify(pages).split('</').join('<\\/'))
  .replace('__TITLES__', JSON.stringify(TITLES));

html = html.replace('</body>', `<script type="text/css" id="pvFonts">${fontCss}</script>\n${overlay}\n</body>`);

const banner = `<div style="position:relative;z-index:1000;background:#c9ad72;color:#0a0c10;
  font-family:Inter,Arial,sans-serif;font-size:.79rem;font-weight:600;text-align:center;
  padding:8px 16px;line-height:1.5">
  Offline preview — everything is embedded in this one file. Click any
  <strong>View live build</strong> to open that site.
</div>`;
html = html.replace('<body>', '<body>\n' + banner).replace('<title>', '<title>PREVIEW · ');

const leaked = [...new Set(html.match(/\/assets\/fonts\/[\w.-]+\.woff2/g) ?? [])];
if (leaked.length) {
  console.error(`\n  ${leaked.length} font file(s) referenced but not inlined:\n   ${leaked.join('\n   ')}\n  Add them to FONT_FACES.\n`);
  process.exit(1);
}

const out = path.join(root, 'mbonyx-preview.html');
fs.writeFileSync(out, html);
console.log(`  mbonyx-preview.html  ${(fs.statSync(out).size / 1024).toFixed(0)}KB  (${Object.keys(pages).length} sub-pages embedded)`);
