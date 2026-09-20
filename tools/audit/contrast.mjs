/**
 * Accurate text-contrast audit.
 *
 * The naive version of this walks up the DOM for the first non-transparent
 * background and compares. That is wrong twice over:
 *   - it ignores alpha, so text on rgba(...,0.12) of its own colour reports 1:1
 *   - it ignores gradients, so a gold button reports its page's dark background
 *
 * This version composites the alpha chain properly, and for anything sitting on
 * a background-image (gradient) it samples the real rendered pixels instead of
 * guessing.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const BASE = 'http://127.0.0.1:8899';
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) :
  ['/', '/privacy.html', '/terms.html', '/success.html', '/404.html',
   '/work/lumen-dental.html', '/work/northpoint-hvac.html', '/work/ember-oak.html',
   '/work/meridian-law.html', '/work/forge-athletics.html'];

const srgb = c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, z) => { const [x, y] = [lum(a), lum(z)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const all = [];

for (const p of PAGES) {
  const page = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(BASE + p, { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  const items = await page.evaluate(() => {
    const parse = s => { const n = (s.match(/[\d.]+/g) || []).map(Number); return { r: n[0] ?? 0, g: n[1] ?? 0, b: n[2] ?? 0, a: n[3] ?? 1 }; };
    const over = (fg, bg) => ({            // composite fg (with alpha) onto bg
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });

    const out = [];
    const SEL = 'p,li,span,a,h1,h2,h3,h4,h5,button,label,td,th,cite,small,summary,strong,em,div';
    for (const el of document.querySelectorAll(SEL)) {
      if (el.childElementCount > 0) continue;
      const text = (el.textContent || '').trim();
      if (text.length < 4) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.top > 4000) continue;

      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.5) continue;

      // Walk ancestors compositing backgrounds; bail if a gradient is involved.
      let stack = [], node = el, gradient = false;
      while (node && node !== document.documentElement) {
        const s = getComputedStyle(node);
        if (s.backgroundImage && s.backgroundImage !== 'none') { gradient = true; break; }
        const bg = parse(s.backgroundColor);
        if (bg.a > 0) { stack.push(bg); if (bg.a === 1) break; }
        node = node.parentElement;
      }
      if (!gradient && node === document.documentElement) {
        const s = getComputedStyle(document.documentElement);
        if (s.backgroundImage && s.backgroundImage !== 'none') gradient = true;
        else stack.push(parse(s.backgroundColor));
      }

      let bg = null;
      if (!gradient) {
        bg = { r: 255, g: 255, b: 255, a: 1 };
        for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
      }

      const fgRaw = parse(cs.color);
      out.push({
        text: text.slice(0, 44),
        fg: fgRaw, bg, gradient,
        size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400,
        // Where to sample pixels if we need to.
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        sel: (el.className || el.tagName).toString().slice(0, 44),
      });
    }
    return out;
  });

  /*
    For gradient-backed text we need the pixels *behind* the glyphs, not the
    glyphs. Sampling the element's box on a normal screenshot returns the text
    itself, which reports a perfect 1.00:1 every time.

    So: hide every glyph, screenshot again, and read the background from that.
    Whatever is in the element's box in that image is, by construction, only
    background.
  */
  const needShot = items.some(i => i.gradient);
  let png = null;
  if (needShot) {
    await page.addStyleTag({
      content: `*, *::before, *::after {
        color: transparent !important;
        text-shadow: none !important;
        -webkit-text-fill-color: transparent !important;
      }`,
    });
    await page.waitForTimeout(250);
    png = PNG.sync.read(await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1440, height: 1000 } }));
  }

  for (const it of items) {
    let bg = it.bg, note = "";
    if (it.gradient) {
      if (!png || it.box.y < 0 || it.box.y + it.box.h > 1000) continue;
      /*
        Inset well away from the edges. Sampling at dx=1 lands on the element's
        own border, so a white-bordered ghost button reported white-on-white
        and a gold button reported the page behind its shadow.
      */
      const px = [];
      const insetX = Math.max(2, Math.floor(it.box.w * 0.25));
      const insetY = Math.max(2, Math.floor(it.box.h * 0.25));
      if (it.box.w - insetX * 2 < 1 || it.box.h - insetY * 2 < 1) continue;
      const stepY = Math.max(1, Math.floor((it.box.h - insetY * 2) / 4));
      const stepX = Math.max(1, Math.floor((it.box.w - insetX * 2) / 6));
      for (let dy = insetY; dy <= it.box.h - insetY; dy += stepY) {
        for (let dx = insetX; dx <= it.box.w - insetX; dx += stepX) {
          const x = it.box.x + dx, y = it.box.y + dy;
          if (x < 0 || y < 0 || x >= 1440 || y >= 1000) continue;
          const i = (1440 * y + x) << 2;
          px.push([png.data[i], png.data[i + 1], png.data[i + 2]]);
        }
      }
      if (!px.length) continue;
      // Conservative: the background pixel that contrasts *least* with the text.
      const fgArr = [it.fg.r, it.fg.g, it.fg.b];
      px.sort((a, z) => ratio(fgArr, a) - ratio(fgArr, z));
      bg = { r: px[0][0], g: px[0][1], b: px[0][2] };
      note = " (sampled)";
    }
    if (!bg) continue;

    const fg = it.fg.a < 1
      ? { r: it.fg.r * it.fg.a + bg.r * (1 - it.fg.a), g: it.fg.g * it.fg.a + bg.g * (1 - it.fg.a), b: it.fg.b * it.fg.a + bg.b * (1 - it.fg.a) }
      : it.fg;

    const cr = ratio([fg.r, fg.g, fg.b], [bg.r, bg.g, bg.b]);
    const large = it.size >= 24 || (it.size >= 18.66 && it.weight >= 700);
    const need = large ? 3 : 4.5;
    if (cr < need) {
      all.push({ page: p, ratio: cr, need, size: it.size, weight: it.weight,
                 text: it.text, sel: it.sel, note,
                 fg: `rgb(${Math.round(fg.r)},${Math.round(fg.g)},${Math.round(fg.b)})`,
                 bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})` });
    }
  }

  await page.close();
}
await b.close();

// De-dupe by selector+ratio so one repeated component reports once.
const seen = new Set();
const uniq = all.filter(f => {
  const k = `${f.page}|${f.sel}|${f.ratio.toFixed(2)}`;
  if (seen.has(k)) return false; seen.add(k); return true;
}).sort((a, z) => a.ratio - z.ratio);

if (!uniq.length) console.log('\nCONTRAST: all passing\n');
else {
  console.log(`\n${uniq.length} real contrast failure(s), worst first:\n`);
  let last = '';
  for (const f of uniq) {
    if (f.page !== last) { console.log(`\n  ${f.page}`); last = f.page; }
    console.log(`   ${f.ratio.toFixed(2)}:1 (need ${f.need})  ${String(Math.round(f.size)) + 'px'} ${f.weight}  .${f.sel}${f.note}`);
    console.log(`        ${f.fg} on ${f.bg}   "${f.text}"`);
  }
  console.log('');
}
