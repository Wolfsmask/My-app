/**
 * Validates the Netlify form wiring. None of this can be tested by loading the
 * page — it only takes effect on Netlify's side — so the attributes have to be
 * checked directly, and they are easy to get subtly wrong.
 */
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const problems = [];

const form = html.match(/<form[^>]*class="contact-form"[^>]*>/s)?.[0]
          ?? html.match(/<form[\s\S]{0,400}?>/)?.[0];
if (!form) problems.push('no contact form found');
else {
  const attr = n => new RegExp(`${n}\\s*=\\s*"([^"]*)"`).exec(form)?.[1];
  const name = attr('name');

  if (!name) problems.push('form has no name attribute — Netlify keys submissions on it');
  if (!/data-netlify\s*=\s*"true"|(\s|")netlify(\s|>|")/.test(form))
    problems.push('form is missing data-netlify="true" — Netlify will not capture it at all');

  const honeypot = attr('data-netlify-honeypot');
  const hasBotField = /name="bot-field"/.test(html);
  if (hasBotField && !honeypot)
    problems.push('a bot-field input exists but data-netlify-honeypot is not set — the trap does nothing and the field is submitted as data');
  if (honeypot && !new RegExp(`name="${honeypot}"`).test(html))
    problems.push(`data-netlify-honeypot="${honeypot}" but no input is named that`);

  const hidden = /<input[^>]*type="hidden"[^>]*name="form-name"[^>]*value="([^"]*)"/.exec(html)?.[1];
  if (hidden && name && hidden !== name)
    problems.push(`hidden form-name is "${hidden}" but the form is named "${name}" — submissions are filed under the wrong form`);

  const action = attr('action');
  if (action && action.startsWith('/') && !fs.existsSync('.' + action))
    problems.push(`action points at ${action}, which does not exist in the repo`);

  // Every visible control needs a name, or its value is never submitted.
  const controls = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map(m => m[0]);
  const unnamed = controls.filter(c => !/\bname=/.test(c) && !/type="submit"/.test(c));
  if (unnamed.length) problems.push(`${unnamed.length} form control(s) with no name attribute — their values are never sent`);
}

if (!problems.length) console.log('\n  NETLIFY FORM: correctly wired\n');
else {
  console.log(`\n  ${problems.length} form problem(s):\n`);
  for (const p of problems) console.log(`   • ${p}`);
  console.log('');
}
process.exit(problems.length ? 1 : 0);
