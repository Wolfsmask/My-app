#!/usr/bin/env node
/**
 * Every check, in one command, against what actually ships:
 *   npm run audit
 *
 * Builds dist/ first and serves that on 8899 for the duration, because the
 * site visitors get is dist/ and not the repository root. The two differ in
 * exactly the ways an audit should care about - the build bakes the live
 * client's screenshot into the page and strips the in-browser check for it -
 * and auditing the source reported a 404 on every load that no visitor would
 * ever see.
 *
 * If something is already listening on 8899 it is used instead, with a
 * warning, so a server you started yourself is never fought over.
 */
// Every tool here launches Chromium through Playwright, which finds the copy
// it downloaded itself. CHROMIUM_PATH overrides that for a machine with one
// already installed elsewhere. These used to name a path that only existed on
// one machine, so `npm run audit` failed for anyone else.

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

const built = spawnSync(process.execPath, ['tools/build-site.mjs'], { encoding: 'utf8' });
if (built.status !== 0) {
  process.stdout.write(built.stdout + built.stderr);
  console.log('\n\x1b[31mThe build failed, so there is nothing to audit.\x1b[0m\n');
  process.exit(1);
}

const portFree = await new Promise(res => {
  const probe = net.createServer().once('error', () => res(false)).once('listening', () => probe.close(() => res(true)));
  probe.listen(8899, '127.0.0.1');
});
let server = null;
if (portFree) {
  server = spawn(process.execPath, ['tools/serve.mjs', '8899', 'dist'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    const up = await fetch('http://127.0.0.1:8899/').then(r => r.ok).catch(() => false);
    if (up) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('\n  auditing dist/ — the site exactly as it will be deployed');
} else {
  console.log('\n  \x1b[33mSomething is already serving on 8899, so that is what gets audited.\x1b[0m' +
              '\n  If it is the repository root rather than dist/, stop it and run this again.');
}

const CHECKS = [
  ['paths',       'tools/audit/paths.mjs',      'relative paths, so the folder works when opened directly'],
  ['sweep',       'tools/audit/sweep.mjs',      'console errors, links, overflow, a11y, SEO'],
  ['contrast',    'tools/audit/contrast.mjs',   'WCAG AA text contrast, alpha and gradients resolved'],
  ['mobile text', 'tools/audit/mobiletext.mjs', 'phone reading sizes'],
  ['a11y',        'tools/audit/a11y.mjs',       'skip links, focus, labels, landmarks, reduced motion'],
  ['similarity',  'tools/audit/similarity.mjs', 'are the concept builds actually different'],
  ['performance', 'tools/audit/perf.mjs',       'FCP / LCP on a throttled 4G phone'],
  ['netlify form','tools/audit/form.mjs',       'form wiring that only takes effect once deployed'],
  ['no-js',       'tools/audit/nojs.mjs',       'does the content still render with scripts blocked'],
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
  const clean = /CLEAN|all passing|All pages readable|nothing found|correctly wired|still shows its content|all relative|Every speed claim on the site holds/.test(text);
  if (code !== 0 && !clean) failed++;
  process.stdout.write(text.split('\n').filter(Boolean).slice(-14).map(l => '  ' + l).join('\n') + '\n');
}
server?.kill();
console.log(failed ? `\n\x1b[31m${failed} check(s) failed\x1b[0m\n` : '\n\x1b[32mAll checks passed\x1b[0m\n');
process.exit(failed ? 1 : 0);
