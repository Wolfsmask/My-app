import { chromium } from 'playwright';
import sharp from 'sharp';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('file:///tmp/claude-0/og.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(500);
await p.screenshot({ path: '/tmp/claude-0/og-raw.png' });
await b.close();
await sharp('/tmp/claude-0/og-raw.png').png({ quality: 88, compressionLevel: 9 }).toFile('assets/og.png');
// Apple touch icon, rendered from the same brand mark.
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
  <rect width="180" height="180" rx="40" fill="#080b10"/>
  <circle cx="90" cy="90" r="59" fill="none" stroke="#c9ad72" stroke-width="7"/>
  <circle cx="90" cy="90" r="59" fill="none" stroke="#e6d3a5" stroke-width="7"
    stroke-dasharray="93 278" stroke-linecap="round" transform="rotate(-42 90 90)"/>
  <circle cx="90" cy="31" r="9.5" fill="#e6d3a5"/></svg>`)).png().toFile('assets/apple-touch-icon.png');
console.log('og + icon done');
