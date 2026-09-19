/**
 * Are the concept builds five designs, or one design in five colours?
 *
 * Fingerprints each page's *structure* — the things a visitor reads as
 * "layout" rather than "palette" — and reports how much they overlap.
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8899/work';
const SITES = ['lumen-dental', 'northpoint-hvac', 'ember-oak', 'meridian-law', 'forge-athletics'];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const prints = {};

for (const slug of SITES) {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/${slug}.html`, { waitUntil: 'load' });
  await page.waitForTimeout(900);

  prints[slug] = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('main > section, body > section, main section')]
      .filter(s => s.getBoundingClientRect().height > 60);

    const describe = el => {
      const cs = getComputedStyle(el);
      const kids = [...el.children];
      const grids = kids.flatMap(k => [...k.querySelectorAll('*')].concat(k))
        .filter(n => ['grid', 'flex'].includes(getComputedStyle(n).display));
      const cols = grids.map(g => getComputedStyle(g).gridTemplateColumns)
        .filter(v => v && v !== 'none')
        .map(v => v.split(' ').length);
      return {
        h: Math.round(el.getBoundingClientRect().height),
        bg: cs.backgroundColor,
        textAlign: cs.textAlign,
        maxCols: cols.length ? Math.max(...cols) : 1,
        hasTable: !!el.querySelector('table'),
        hasForm: !!el.querySelector('form, input'),
        hasImgBlock: !!el.querySelector('.photo,.plate,.portrait,[role=img]'),
        headingTag: el.querySelector('h1,h2')?.tagName ?? '-',
      };
    };

    const hero = document.querySelector('.hero, section:first-of-type');
    const heroCs = hero ? getComputedStyle(hero) : null;
    const heroGrid = hero?.querySelector('[class*=grid],[class*=inner],[class*=top]');

    const fonts = new Set();
    const sizes = new Set();
    for (const el of document.querySelectorAll('h1,h2,h3,p,a,span,li')) {
      const cs = getComputedStyle(el);
      fonts.add(cs.fontFamily.split(',')[0].replace(/["']/g, ''));
      if ((el.textContent || '').trim().length > 3) sizes.add(Math.round(parseFloat(cs.fontSize)));
    }

    return {
      sections: secs.map(describe),
      sectionCount: secs.length,
      pageHeight: document.body.scrollHeight,
      heroAlign: heroCs?.textAlign ?? '-',
      heroCols: heroGrid ? getComputedStyle(heroGrid).gridTemplateColumns.split(' ').length : 1,
      heroH: hero ? Math.round(hero.getBoundingClientRect().height) : 0,
      fonts: [...fonts],
      typeScale: [...sizes].sort((a, z) => z - a).slice(0, 8),
      borderRadius: getComputedStyle(document.querySelector('a[class*=btn],a[class*=button],button') ?? document.body).borderRadius,
      uniqueComponents: [...new Set([...document.querySelectorAll('[class]')]
        .flatMap(e => e.className.toString().split(/\s+/))
        .filter(c => c && !/^(wrap|btn|logo|nav|ft|kick|shead|hero)/.test(c)))].length,
    };
  });
  await page.close();
}
await b.close();

const pad = (s, n) => String(s).padEnd(n);
console.log('\n  STRUCTURE\n  ' + '─'.repeat(92));
console.log('  ' + pad('site', 18) + pad('sections', 10) + pad('hero cols', 11) + pad('hero align', 12) +
            pad('hero h', 9) + pad('page h', 9) + pad('radius', 10) + 'section shapes (cols)');
for (const s of SITES) {
  const p = prints[s];
  console.log('  ' + pad(s, 18) + pad(p.sectionCount, 10) + pad(p.heroCols, 11) + pad(p.heroAlign, 12) +
    pad(p.heroH, 9) + pad(p.pageHeight, 9) + pad(p.borderRadius, 10) +
    p.sections.map(x => x.maxCols).join(','));
}

console.log('\n  TYPOGRAPHY\n  ' + '─'.repeat(92));
for (const s of SITES) {
  const p = prints[s];
  console.log('  ' + pad(s, 18) + pad(p.fonts.join(' + '), 34) + 'scale: ' + p.typeScale.join(', '));
}

console.log('\n  DISTINCTIVE CONTENT BLOCKS\n  ' + '─'.repeat(92));
for (const s of SITES) {
  const p = prints[s];
  const feats = [];
  if (p.sections.some(x => x.hasTable)) feats.push('data table');
  if (p.sections.some(x => x.hasForm)) feats.push('inline form');
  if (p.sections.some(x => x.hasImgBlock)) feats.push('image panel');
  const aligns = [...new Set(p.sections.map(x => x.textAlign))];
  console.log('  ' + pad(s, 18) + pad(feats.join(', ') || '—', 34) +
    `align variety: ${aligns.join('/')}  · ${p.uniqueComponents} distinct classes`);
}

// Overlap: how many section "shapes" two sites share in the same order.
console.log('\n  SHAPE OVERLAP (identical column pattern in sequence)\n  ' + '─'.repeat(92));
for (let i = 0; i < SITES.length; i++) {
  for (let j = i + 1; j < SITES.length; j++) {
    const a = prints[SITES[i]].sections.map(x => `${x.maxCols}${x.hasImgBlock ? 'i' : ''}${x.hasForm ? 'f' : ''}${x.hasTable ? 't' : ''}`);
    const z = prints[SITES[j]].sections.map(x => `${x.maxCols}${x.hasImgBlock ? 'i' : ''}${x.hasForm ? 'f' : ''}${x.hasTable ? 't' : ''}`);
    let same = 0;
    for (let k = 0; k < Math.min(a.length, z.length); k++) if (a[k] === z[k]) same++;
    const pct = Math.round((same / Math.max(a.length, z.length)) * 100);
    const flag = pct >= 70 ? '  ⚠ too similar' : pct >= 50 ? '  · some overlap' : '';
    console.log(`  ${pad(SITES[i], 18)}vs ${pad(SITES[j], 18)}${String(pct).padStart(3)}%${flag}`);
  }
}
console.log('');
