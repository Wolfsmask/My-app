/**
 * Keyboard and screen-reader checks the visual audits do not cover:
 * skip link, focus visibility, tab order, the mobile menu's focus handling,
 * form labelling, landmarks, and reduced-motion support.
 */
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8899';
const PAGES = ['/', '/privacy.html', '/work/lumen-dental.html', '/work/northpoint-hvac.html',
               '/work/ember-oak.html', '/work/meridian-law.html', '/work/forge-athletics.html'];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const found = [];

for (const path of PAGES) {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const m = await page.evaluate(() => {
    const out = {};
    // Skip link: the first focusable thing should let you jump past the nav.
    const firstFocusable = document.querySelector('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
    out.firstFocusable = firstFocusable ? `${firstFocusable.tagName}.${(firstFocusable.className||'').toString().slice(0,26)}` : null;
    out.hasSkipLink = !!document.querySelector('a[href^="#"][class*="skip"], a[href="#main"], a[href="#content"]');

    out.landmarks = ['main','nav','header','footer'].filter(t => document.querySelector(t));
    out.mainCount = document.querySelectorAll('main').length;

    // Inputs must have a programmatic name.
    out.unlabelled = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')]
      .filter(i => !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby')
                && !(i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`))
                && !i.closest('label'))
      .map(i => i.name || i.id || i.tagName);

    // Buttons/links with no accessible name.
    out.namelessControls = [...document.querySelectorAll('a[href],button')]
      .filter(e => !(e.textContent||'').trim() && !e.getAttribute('aria-label')
                && !e.querySelector('img[alt]:not([alt=""]),svg[role=img]'))
      .map(e => `${e.tagName}.${(e.className||'').toString().slice(0,22)}`);

    // positive tabindex breaks natural order
    out.positiveTabindex = [...document.querySelectorAll('[tabindex]')]
      .filter(e => parseInt(e.getAttribute('tabindex'),10) > 0).length;

    out.langOk = !!document.documentElement.lang;
    return out;
  });

  if (!m.hasSkipLink) found.push([path, 'no skip link — keyboard users tab through the whole nav on every page']);
  if (m.mainCount !== 1) found.push([path, `${m.mainCount} <main> landmarks (want exactly 1)`]);
  if (m.unlabelled.length) found.push([path, `form controls with no label: ${m.unlabelled.join(', ')}`]);
  if (m.namelessControls.length) found.push([path, `controls with no accessible name: ${m.namelessControls.join(', ')}`]);
  if (m.positiveTabindex) found.push([path, `${m.positiveTabindex} element(s) with positive tabindex`]);
  if (!m.langOk) found.push([path, 'no lang attribute']);

  // Is focus actually visible? Tab through the first 12 stops and check for an outline.
  const noRing = await page.evaluate(async () => {
    const stops = [...document.querySelectorAll('a[href],button,input,select,textarea')]
      .filter(e => e.offsetParent !== null).slice(0, 12);
    const bad = [];
    for (const el of stops) {
      el.focus();
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)
        || cs.boxShadow !== 'none';
      if (!ring) bad.push(`${el.tagName}.${(el.className||'').toString().slice(0,22)}`);
    }
    return bad;
  });
  if (noRing.length) found.push([path, `no visible focus ring on: ${[...new Set(noRing)].slice(0,4).join(', ')}`]);

  await page.close();
}

// Reduced motion: does anything keep animating?
const rm = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const rp = await rm.newPage();
await rp.goto(BASE + '/', { waitUntil: 'load' });
await rp.waitForTimeout(1600);
const moving = await rp.evaluate(() => document.getAnimations()
  .filter(a => {
    if (a.playState !== 'running') return false;
    const t = a.effect?.getComputedTiming?.() ?? {};
    // An animation still waiting out its delay reports "running" but is not
    // moving anything, and one clamped to 0.01ms has already finished by the
    // time it starts. Neither is what this check is looking for.
    if ((a.currentTime ?? 0) < (t.delay ?? 0)) return false;
    return (t.duration ?? 0) > 1;
  })
  .map(a => (a.effect?.target?.className || a.effect?.target?.tagName || '?').toString().slice(0, 30)));
if (moving.length) found.push(['/', `prefers-reduced-motion: ${moving.length} animation(s) still running: ${[...new Set(moving)].slice(0,4).join(', ')}`]);
await rm.close();

await b.close();
if (!found.length) console.log('\n  ACCESSIBILITY: nothing found\n');
else {
  console.log(`\n  ${found.length} accessibility finding(s):\n`);
  for (const [p, d] of found) console.log(`   ${p.padEnd(32)} ${d}`);
  console.log('');
}
process.exit(found.length ? 1 : 0);
