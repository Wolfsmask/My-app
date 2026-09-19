import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const page = await b.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('requestfailed', r => errors.push('404/fail: ' + r.url()));

const t0 = Date.now();
await page.goto('http://127.0.0.1:8899/', { waitUntil: 'load' });
const loadMs = Date.now() - t0;
await page.waitForTimeout(1800);

const m = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const lcp = performance.getEntriesByType('largest-contentful-paint').pop();
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  return {
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
    fcp: Math.round(fcp ? fcp.startTime : 0),
    lcp: Math.round(lcp ? lcp.startTime : 0),
    introDone: document.documentElement.classList.contains('intro-complete'),
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    workCards: document.querySelectorAll('.work-card').length,
    brokenImgs: [...document.images].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src),
    h1: document.querySelectorAll('h1').length,
    missingAlt: [...document.images].filter(i => !i.alt).length,
  };
});
console.log('load(ms)', loadMs, JSON.stringify(m, null, 1));

await page.screenshot({ path: '/tmp/claude-0/idx-top.jpg', type: 'jpeg', quality: 72 });
await page.evaluate(() => document.querySelector('#work').scrollIntoView());
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/claude-0/idx-work.jpg', type: 'jpeg', quality: 72 });
await page.evaluate(() => document.querySelector('#pricing').scrollIntoView());
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/claude-0/idx-pricing.jpg', type: 'jpeg', quality: 72 });
await page.close();

// Mobile overflow check across the whole page
const mp = await b.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
await mp.goto('http://127.0.0.1:8899/', { waitUntil: 'load' });
await mp.waitForTimeout(1600);
const mob = await mp.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  overflowing: [...document.querySelectorAll('body *')]
    .filter(el => el.getBoundingClientRect().right > window.innerWidth + 1)
    .slice(0, 6).map(el => el.className || el.tagName),
}));
console.log('mobile', JSON.stringify(mob));
await mp.evaluate(() => document.querySelector('#work').scrollIntoView());
await mp.waitForTimeout(900);
await mp.screenshot({ path: '/tmp/claude-0/idx-mobile-work.jpg', type: 'jpeg', quality: 72 });
await mp.close();

// Every other page loads
for (const p of ['privacy.html','terms.html','success.html','404.html','work/lumen-dental.html','work/forge-athletics.html']) {
  const pg = await b.newPage();
  const res = await pg.goto('http://127.0.0.1:8899/' + p, { waitUntil: 'load' });
  console.log(p, res.status());
  await pg.close();
}
await b.close();
console.log(errors.length ? '\nPROBLEMS:\n' + errors.join('\n') : '\nno console errors, no failed requests');
