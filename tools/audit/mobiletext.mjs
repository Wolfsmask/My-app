/**
 * Guards against the finding this project's own checker raised about this
 * site: desktop-tuned type landing at 13-14px on a phone.
 */
import { chromium } from 'playwright';
const PAGES = ['/', '/privacy.html', '/terms.html', '/success.html', '/404.html',
  '/work/lumen-dental.html', '/work/northpoint-hvac.html', '/work/ember-oak.html',
  '/work/meridian-law.html', '/work/forge-athletics.html'];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let bad = 0;
for (const path of PAGES) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.goto('http://127.0.0.1:8899' + path, { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  const m = await p.evaluate(() => {
    const sizes = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.childElementCount !== 0) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if ((el.textContent || '').trim().length <= 25) continue;
      sizes.push(parseFloat(getComputedStyle(el).fontSize));
    }
    sizes.sort((a, z) => a - z);
    return {
      n: sizes.length,
      median: sizes[Math.floor(sizes.length / 2)] ?? 16,
      under14: sizes.filter(s => s < 14).length,
      smallInputs: [...document.querySelectorAll('input,select,textarea')]
        .filter(i => parseFloat(getComputedStyle(i).fontSize) < 16).length,
    };
  });
  // The ratio needs a real sample — 1-of-3 on a near-empty page is noise.
  const ratio = m.n >= 8 ? m.under14 / m.n : 0;
  const fail = m.median < 15 || ratio > 0.25 || m.smallInputs > 0;
  if (fail) bad++;
  console.log(`  ${fail ? '✗' : '✓'} ${path.padEnd(32)} median ${String(m.median).padStart(6)}px  ${String(m.under14).padStart(2)}/${m.n} under 14px${m.smallInputs ? `  ${m.smallInputs} input(s) <16px` : ''}`);
  await p.close();
}
await b.close();
console.log(bad ? `\n  ${bad} page(s) need attention\n` : '\n  All pages readable on a phone\n');
process.exit(bad ? 1 : 0);
