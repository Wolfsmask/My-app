import { chromium } from 'playwright';
import fs from 'fs';

const shots = [
  ['lumen-dental',     'Lumen Dental Studio'],
  ['northpoint-hvac',  'Northpoint Heating & Air'],
  ['ember-oak',        'Ember & Oak'],
  ['meridian-law',     'Meridian Law Group'],
  ['forge-athletics',  'Forge Athletics'],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

for (const [slug] of shots) {
  // Desktop thumbnail — hide the concept bar so the shot reads as a real site.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:8899/work/${slug}.html`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '.concept-bar{display:none!important}' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `assets/work/${slug}.jpg`, type: 'jpeg', quality: 78 });
  await page.close();

  // Mobile thumbnail — proof the responsive work is real.
  const m = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.goto(`http://127.0.0.1:8899/work/${slug}.html`, { waitUntil: 'networkidle' });
  await m.addStyleTag({ content: '.concept-bar{display:none!important}' });
  await m.waitForTimeout(600);
  await m.screenshot({ path: `assets/work/${slug}-mobile.jpg`, type: 'jpeg', quality: 78 });
  await m.close();
  console.log('shot', slug);
}
await browser.close();
