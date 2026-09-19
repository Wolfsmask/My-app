/**
 * Given a foreground/background pair that fails contrast, find the nearest
 * colour that passes — by darkening or lightening one side while holding hue.
 * Prints the hex to paste in, so the fixes are computed rather than guessed.
 */
const hex = h => { h = h.replace('#',''); if (h.length===3) h = [...h].map(c=>c+c).join(''); return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)); };
const toHex = ([r,g,b]) => '#' + [r,g,b].map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
const srgb = c => { const v=c/255; return v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; };
const lum = ([r,g,b]) => 0.2126*srgb(r)+0.7152*srgb(g)+0.0722*srgb(b);
const ratio = (a,z) => { const [x,y]=[lum(a),lum(z)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
const mix = (c, t, f) => c.map((v,i) => v + (t[i]-v)*f);   // f=0 keeps c, f=1 becomes t

function solve(fg, bg, target, { move = 'fg', toward = 'auto' } = {}) {
  const base = move === 'fg' ? fg : bg;
  const other = move === 'fg' ? bg : fg;
  const dir = toward === 'auto' ? (lum(base) > lum(other) ? [255,255,255] : [0,0,0]) : hex(toward);
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const c = mix(base, dir, mid);
    const r = move === 'fg' ? ratio(c, other) : ratio(other, c);
    if (r >= target) hi = mid; else lo = mid;
  }
  const out = mix(base, dir, hi);
  return { hex: toHex(out), ratio: move === 'fg' ? ratio(out, other) : ratio(fg, out), shift: hi };
}

// Target a little above the 4.5 line: solving to exactly 4.5 lands on the
// boundary and sub-pixel rounding drops it back to 4.48 in the browser.
const CASES = [
  ['lumen --muted on --shell #f6f3ec',   '#8a9995', '#f6f3ec', 4.7, 'fg'],
  ['lumen --muted on --card #fffdf9',    '#8a9995', '#fffdf9', 4.7, 'fg'],
  ['lumen slot small on --brand',        '#cdeae8', '#0d7c7c', 4.7, 'fg'],
  ['lumen --brand on --shell-2 #efeae0', '#0d7c7c', '#efeae0', 4.7, 'fg'],
];

console.log('\n  pair                                        now     ->  fix       new\n  ' + '─'.repeat(74));
for (const [label, fg, bg, target, move] of CASES) {
  const before = ratio(hex(fg), hex(bg));
  const s = solve(hex(fg), hex(bg), target, { move });
  console.log(`  ${label.padEnd(42)} ${before.toFixed(2)}  ->  ${s.hex}  ${s.ratio.toFixed(2)}:1  (${move})`);
}
console.log('');
