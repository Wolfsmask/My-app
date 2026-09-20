/**
 * The site with JavaScript disabled — script blockers, locked-down corporate
 * networks, and the moment before a slow script parses.
 *
 * The hero's entrance is CSS with `both` fill, so it ends at the final state
 * with no JS. But `intro-complete` never fires, so anything gated behind it
 * must not be load-bearing.
 */
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8899';
const PAGES = ['/', '/privacy.html', '/work/lumen-dental.html', '/work/northpoint-hvac.html',
               '/work/ember-oak.html', '/work/meridian-law.html', '/work/forge-athletics.html'];

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
const found = [];

for (const path of PAGES) {
  const p = await ctx.newPage();
  await p.goto(BASE + path, { waitUntil: 'load' });
  await p.waitForTimeout(900);

  const m = await p.evaluate(() => {
    const vis = el => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
    };
    const h1 = document.querySelector('h1');
    const cta = document.querySelector('a[href^="#"],a[href^="tel:"],a[href^="mailto:"],button');
    // Anything with an animation that never completes leaves content invisible.
    const invisibleText = [...document.querySelectorAll('h1,h2,p,li,a')]
      .filter(el => (el.textContent || '').trim().length > 12 && el.getBoundingClientRect().top < 2000)
      // Content inside a [hidden] container is deliberately not shown — the
      // conditional "who referred you" field is revealed by JS on demand, so
      // being invisible without JS is the correct behaviour, not a failure.
      .filter(el => !el.closest('[hidden],[aria-hidden="true"]'))
      .filter(el => !vis(el))
      .slice(0, 6)
      .map(el => `${el.tagName}.${(el.className || '').toString().slice(0, 24)}`);
    return {
      h1Visible: vis(h1),
      h1Text: (h1?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44),
      ctaVisible: vis(cta),
      bodyText: (document.body.innerText || '').trim().length,
      invisibleText,
    };
  });

  if (!m.h1Visible) found.push([path, 'the main heading is not visible without JS']);
  if (!m.ctaVisible) found.push([path, 'no visible call to action without JS']);
  if (m.bodyText < 400) found.push([path, `only ${m.bodyText} characters of text render without JS`]);
  if (m.invisibleText.length) found.push([path, `invisible content: ${m.invisibleText.join(', ')}`]);

  console.log(`  ${path.padEnd(32)} h1=${m.h1Visible ? '✓' : '✗'} cta=${m.ctaVisible ? '✓' : '✗'} text=${String(m.bodyText).padStart(5)}  "${m.h1Text}"`);
  await p.close();
}
await b.close();

console.log(found.length ? `\n  ${found.length} problem(s) without JavaScript:\n` + found.map(([p, d]) => `   ${p}  ${d}`).join('\n') + '\n'
                         : '\n  NO-JS: every page still shows its content\n');
process.exit(found.length ? 1 : 0);
