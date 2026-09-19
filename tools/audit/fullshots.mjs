import { chromium } from 'playwright';
import sharp from 'sharp';
const SITES = ['lumen-dental','northpoint-hvac','ember-oak','meridian-law','forge-athletics'];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const strips = [];
for (const s of SITES) {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await p.goto(`http://127.0.0.1:8899/work/${s}.html`, { waitUntil: 'load' });
  await p.addStyleTag({ content: '.concept-bar{display:none!important} *{animation:none!important;transition:none!important}' });
  await p.waitForTimeout(700);
  const buf = await p.screenshot({ fullPage: true, type: 'png' });
  const resized = await sharp(buf).resize({ width: 330 }).png().toBuffer();
  strips.push(resized);
  await p.close();
}
await b.close();
// Tile the five full pages side by side so the rhythm is comparable at a glance.
const metas = await Promise.all(strips.map(s => sharp(s).metadata()));
const H = Math.max(...metas.map(m => m.height));
const W = 330 * 5 + 40;
await sharp({ create: { width: W, height: H, channels: 3, background: '#111' } })
  .composite(strips.map((s, i) => ({ input: s, left: i * 338, top: 0 })))
  .jpeg({ quality: 72 }).toFile('/tmp/claude-0/compare-all.jpg');
console.log('tiled', W, 'x', H);
