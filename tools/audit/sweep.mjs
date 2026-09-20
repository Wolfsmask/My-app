/**
 * Full-site sweep: every page, desktop and mobile.
 * Console errors, failed requests, broken links, overflow, contrast, a11y basics.
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8899';
const PAGES = ['/', '/privacy.html', '/terms.html', '/success.html', '/404.html',
  '/work/lumen-dental.html', '/work/northpoint-hvac.html', '/work/ember-oak.html',
  '/work/meridian-law.html', '/work/forge-athletics.html'];

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const findings = [];
const seenLinks = new Map();

// Contrast lives in contrast.mjs. The version that used to be here walked the
// DOM for the first opaque background, which ignores alpha and gradients and
// produced ~40 false positives against 0 real ones. Two checkers where one is
// wrong is worse than one that is right.

for (const p of PAGES) {
  for (const [label, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await b.newPage({ viewport: vp, isMobile: label === 'mobile', hasTouch: label === 'mobile', deviceScaleFactor: 1 });
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });
    page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
    page.on('requestfailed', r => errs.push('failed: ' + r.url().replace(BASE, '').slice(0, 100)));

    const res = await page.goto(BASE + p, { waitUntil: 'load' });
    if (res.status() >= 400) findings.push({ page: p, label, kind: 'status', detail: res.status() });
    await page.waitForTimeout(1700);

    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const screenW = Math.round(window.visualViewport?.width ?? window.innerWidth);
      const over = [...document.querySelectorAll('body *')].filter(el => {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.position === 'absolute') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > screenW + 2;
      }).slice(0, 5).map(el => (el.className || el.tagName).toString().slice(0, 50));

      return {
        scrollW: doc.scrollWidth, screenW, over,
        title: document.title, titleLen: document.title.length,
        desc: document.querySelector('meta[name=description]')?.content?.length ?? 0,
        h1: document.querySelectorAll('h1').length,
        lang: doc.lang,
        imgsNoAlt: [...document.images].filter(i => !i.hasAttribute('alt')).length,
        emptyLinks: [...document.querySelectorAll('a')].filter(a => !a.textContent.trim() && !a.getAttribute('aria-label') && !a.querySelector('img[alt]:not([alt=""])')).length,
        links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
      };
    });

    if (errs.length) findings.push({ page: p, label, kind: 'js/net', detail: [...new Set(errs)].join(' | ') });
    if (m.scrollW > m.screenW + 2) findings.push({ page: p, label, kind: 'overflow', detail: `${m.scrollW}px content on ${m.screenW}px screen: ${m.over.join(', ')}` });
    if (m.h1 !== 1) findings.push({ page: p, label, kind: 'h1', detail: `${m.h1} h1 tags` });
    if (m.imgsNoAlt) findings.push({ page: p, label, kind: 'alt', detail: `${m.imgsNoAlt} images missing alt` });
    if (m.emptyLinks) findings.push({ page: p, label, kind: 'empty-link', detail: `${m.emptyLinks} links with no accessible name` });
    if (!m.lang) findings.push({ page: p, label, kind: 'lang', detail: 'no lang attribute' });
    if (label === 'desktop') {
      if (m.titleLen > 62) findings.push({ page: p, label, kind: 'seo', detail: `title ${m.titleLen} chars (Google truncates ~60)` });
      if (m.desc === 0) findings.push({ page: p, label, kind: 'seo', detail: 'no meta description' });
      else if (m.desc > 160) findings.push({ page: p, label, kind: 'seo', detail: `description ${m.desc} chars (>160)` });


      for (const href of m.links) {
        if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#') || href.startsWith('http')) continue;
        seenLinks.set(href, (seenLinks.get(href) || []).concat(p));
      }
      // in-page anchors
      const anchors = m.links.filter(h => h && h.startsWith('#') && h.length > 1);
      const missing = await page.evaluate(as => as.filter(a => !document.querySelector(a)), anchors);
      if (missing.length) findings.push({ page: p, label, kind: 'anchor', detail: `dead anchors: ${[...new Set(missing)].join(', ')}` });
    }
    await page.close();
  }
}

// Internal links resolve?
for (const [href, pages] of seenLinks) {
  const url = href.startsWith('/') ? BASE + href : BASE + '/' + href;
  const r = await fetch(url.split('#')[0]).catch(() => null);
  if (!r || r.status >= 400) findings.push({ page: [...new Set(pages)].join(','), label: '-', kind: 'link', detail: `${href} -> ${r ? r.status : 'failed'}` });
}

await b.close();

if (!findings.length) console.log('\nCLEAN — nothing found.\n');
else {
  console.log(`\n${findings.length} finding(s):\n`);
  const byKind = {};
  for (const f of findings) (byKind[f.kind] ??= []).push(f);
  for (const [kind, list] of Object.entries(byKind)) {
    console.log(`── ${kind.toUpperCase()} (${list.length})`);
    for (const f of list) console.log(`   ${f.page} [${f.label}]  ${f.detail}`);
    console.log('');
  }
}
