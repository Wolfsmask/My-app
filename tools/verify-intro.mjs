import { chromium } from 'playwright';

/*
  Samples the hero heading's opacity every animation frame from the very first
  paint. A flash shows up as an early 1 followed by a drop to ~0.
*/
const sampler = () => {
  window.__samples = [];
  const t0 = performance.now();
  const tick = () => {
    const el = document.querySelector('.hero-word');
    if (el) {
      window.__samples.push([
        +(performance.now() - t0).toFixed(1),
        +getComputedStyle(el).opacity,
      ]);
    }
    if (performance.now() - t0 < 1800) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

for (const [label, url] of [['LIVE SITE', 'http://127.0.0.1:8899/'],
                            ['PREVIEW FILE', 'file:///home/user/My-app/mbonyx-preview.html']]) {
  const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
  await p.addInitScript(sampler);
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForTimeout(2100);

  const s = await p.evaluate(() => window.__samples || []);
  const first = s.slice(0, 8);
  const peakBeforeSettle = Math.max(...s.filter(([t]) => t < 120).map(([, o]) => o), 0);
  const flashed = s.some(([t, o], i) => o > 0.9 && s.slice(i + 1, i + 12).some(([, o2]) => o2 < 0.3));

  console.log(`\n--- ${label} ---`);
  console.log('first frames [ms, opacity]:', JSON.stringify(first));
  console.log('max opacity in first 120ms:', peakBeforeSettle.toFixed(3));
  console.log('visible-then-hidden flash: ', flashed ? '❌ YES' : '✅ none');
  console.log('final opacity:             ', s.length ? s[s.length - 1][1] : 'n/a');
  await p.close();
}
await b.close();
