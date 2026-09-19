#!/usr/bin/env node
/**
 * Every check, in one command. Run from the repo root with a server on 8899:
 *   python3 -m http.server 8899 &
 *   node tools/audit/all.mjs
 */
import { spawn } from 'node:child_process';

const CHECKS = [
  ['sweep',       'tools/audit/sweep.mjs',      'console errors, links, overflow, a11y, SEO'],
  ['contrast',    'tools/audit/contrast.mjs',   'WCAG AA text contrast, alpha and gradients resolved'],
  ['mobile text', 'tools/audit/mobiletext.mjs', 'phone reading sizes'],
  ['a11y',        'tools/audit/a11y.mjs',       'skip links, focus, labels, landmarks, reduced motion'],
  ['similarity',  'tools/audit/similarity.mjs', 'are the concept builds actually different'],
  ['performance', 'tools/audit/perf.mjs',       'FCP / LCP on a throttled 4G phone'],
  ['netlify form','tools/audit/form.mjs',       'form wiring that only takes effect once deployed'],
];

const run = (file) => new Promise(res => {
  const out = [];
  const c = spawn(process.execPath, [file], { env: process.env });
  c.stdout.on('data', d => out.push(d));
  c.stderr.on('data', d => out.push(d));
  c.on('exit', code => res({ code, text: Buffer.concat(out).toString() }));
});

let failed = 0;
for (const [name, file, what] of CHECKS) {
  process.stdout.write(`\n\x1b[1m▸ ${name}\x1b[0m — ${what}\n`);
  const { code, text } = await run(file);
  const clean = /CLEAN|all passing|All pages readable|nothing found|correctly wired/.test(text);
  if (code !== 0 && !clean) failed++;
  process.stdout.write(text.split('\n').filter(Boolean).slice(-14).map(l => '  ' + l).join('\n') + '\n');
}
console.log(failed ? `\n\x1b[31m${failed} check(s) failed\x1b[0m\n` : '\n\x1b[32mAll checks passed\x1b[0m\n');
process.exit(failed ? 1 : 0);
