import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const BASE = 'file:///tmp/claude-0/unzipped';
let bad = 0;
for (const page of ['index.html','privacy.html','terms.html','success.html','404.html',
                    'work/lumen-dental.html','work/northpoint-hvac.html','work/ember-oak.html',
                    'work/meridian-law.html','work/forge-athletics.html']) {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const fails = [];
  p.on('requestfailed', r => { const f = r.url().split('/').pop(); if (!/woff2$/.test(f)) fails.push(f); });
  await p.goto(`${BASE}/${page}`, { waitUntil: 'load' });
  await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } });
  await p.waitForTimeout(1200);
  const m = await p.evaluate(() => ({
    imgs: [...document.images].filter(i => !i.complete || i.naturalWidth === 0).length + '/' + document.images.length,
    fontsOk: document.fonts.status === 'loaded',
    deadLinks: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))
      .filter(h => h && h.startsWith('#') && h.length > 1 && !document.querySelector(h)),
  }));
  const ok = m.imgs.split('/')[0] === '0' && !m.deadLinks.length && !fails.length;
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${page.padEnd(30)} images ${m.imgs.padEnd(6)} fonts=${m.fontsOk}  ${m.deadLinks.length ? 'dead: ' + m.deadLinks : ''}${fails.length ? ' failed: ' + [...new Set(fails)] : ''}`);
  await p.close();
}
await b.close();
console.log(bad ? `\n  ${bad} page(s) broken when opened directly\n` : '\n  Every page works when opened straight from the folder\n');
process.exit(bad ? 1 : 0);
