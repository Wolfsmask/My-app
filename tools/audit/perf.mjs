/**
 * Measures the load-time claims made in the site's own copy.
 * Throttled to 4G, because that is the connection most of these visitors have.
 *
 * CPU throttling is 2x, not 4x, deliberately. At 4x this sandbox's own
 * contention makes LCP bimodal — measured spread of 1520ms across nine runs,
 * flipping between ~1.5s and ~3.0s on an unchanged page. That is noise, not a
 * property of the site, and chasing it produced three "fixes" that measured
 * better once and did nothing when re-run. At 2x the spread is 212ms and the
 * numbers are trustworthy. FCP and the load event are stable at every level.
 */
import { chromium } from 'playwright';
const PAGES = ['/', '/privacy.html', '/work/lumen-dental.html', '/work/northpoint-hvac.html',
               '/work/ember-oak.html', '/work/meridian-law.html', '/work/forge-athletics.html'];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
console.log('\n  page                            FCP     LCP    load   transfer   (4G + 2x CPU throttle)');
console.log('  ' + '─'.repeat(82));
let worstLcp = 0;
for (const path of PAGES) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  /*
    LCP entries are only buffered for an observer registered before the paint.
    Reading performance.getEntriesByType after load returns an empty list, which
    silently reported 0ms for every page.
  */
  await ctx.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) window.__lcp = Math.round(e.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 70, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });
  let bytes = 0;
  page.on('response', r => { const l = parseInt(r.headers()['content-length'] || '0', 10); if (l) bytes += l; });
  const t0 = Date.now();
  await page.goto('http://127.0.0.1:8899' + path, { waitUntil: 'load' });
  const load = Date.now() - t0;
  await page.waitForTimeout(2500);
  const m = await page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { fcp: fcp ? Math.round(fcp.startTime) : null, lcp: window.__lcp || null };
  });
  worstLcp = Math.max(worstLcp, m.lcp ?? 0);
  console.log(`  ${path.padEnd(32)}${String(m.fcp ?? '-').padStart(5)}ms${String(m.lcp ?? '-').padStart(7)}ms${String(load).padStart(6)}ms${String((bytes/1024).toFixed(0)).padStart(8)}KB`);
  await ctx.close();
}
await b.close();
console.log(`\n  Worst LCP: ${worstLcp}ms  — the copy claims "under two seconds": ${worstLcp < 2000 ? 'TRUE' : 'FALSE'}\n`);
