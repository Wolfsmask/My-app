import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errs = [];
const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
p.on('requestfailed', r => errs.push('failed: ' + r.url().slice(0, 80)));

// file:// — exactly how the user will open it.
await p.goto('file:///home/user/My-app/mbonyx-preview.html', { waitUntil: 'load' });
await p.waitForTimeout(1600);

console.log('images ok:', await p.evaluate(() =>
  [...document.images].every(i => i.complete && i.naturalWidth > 0) + ' / ' + document.images.length));
console.log('font loaded:', await p.evaluate(() => document.fonts.check('600 16px "Playfair Display"')));

// Click through to a concept build.
await p.evaluate(() => document.querySelector('#work').scrollIntoView());
await p.waitForTimeout(800);
await p.click('[data-preview="northpoint-hvac"]');
await p.waitForTimeout(1400);

const fr = p.frames().find(f => f !== p.mainFrame());
console.log('overlay open:', await p.evaluate(() => document.getElementById('pv').classList.contains('is-open')));
console.log('iframe heading:', fr ? (await fr.locator('h1').first().innerText()).replace(/\n/g, ' ') : 'NONE');
console.log('iframe fonts:', fr ? await fr.evaluate(() => document.fonts.check('900 16px Inter')) : '-');
await p.screenshot({ path: '/tmp/claude-0/pv-desktop.jpg', type: 'jpeg', quality: 74 });

// Phone toggle
await p.click('#pvMobile');
await p.waitForTimeout(900);
await p.screenshot({ path: '/tmp/claude-0/pv-phone.jpg', type: 'jpeg', quality: 74 });

// Close, then check a legal page opens too
await p.click('#pvClose');
await p.waitForTimeout(400);
await p.evaluate(() => document.querySelector('[data-preview="privacy"]').click());
await p.waitForTimeout(1000);
const fr2 = p.frames().find(f => f !== p.mainFrame());
console.log('privacy heading:', fr2 ? await fr2.locator('h1').first().innerText() : 'NONE');

await b.close();
console.log(errs.length ? '\nPROBLEMS:\n' + errs.join('\n') : '\nclean: no errors, no failed loads');
