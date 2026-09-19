import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const failed = [];
p.on('requestfailed', r => failed.push(r.url().slice(0, 90)));
await p.goto('file:///tmp/claude-0/unzipped/index.html', { waitUntil: 'load' });
await p.waitForTimeout(2000);
const m = await p.evaluate(() => ({
  fontLoaded: document.fonts.check('600 24px "Playfair Display"'),
  brokenImgs: [...document.images].filter(i => !i.complete || i.naturalWidth === 0).length,
  totalImgs: document.images.length,
  firstWorkLink: document.querySelector('.work-card__link')?.getAttribute('href'),
  cssApplied: getComputedStyle(document.body).backgroundColor,
}));
console.log('  fonts loaded:      ', m.fontLoaded);
console.log('  broken images:     ', m.brokenImgs + '/' + m.totalImgs);
console.log('  work link href:    ', m.firstWorkLink);
console.log('  body background:   ', m.cssApplied);
console.log('  failed requests:   ', failed.length);
for (const f of [...new Set(failed)].slice(0, 6)) console.log('     ' + f);
await p.screenshot({ path: '/tmp/claude-0/file-open.jpg', type: 'jpeg', quality: 70 });
await b.close();
