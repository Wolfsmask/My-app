#!/usr/bin/env node
/**
 * Photographs a live site for the portfolio grid.
 *
 *   npm run shot:live
 *   npm run shot:live -- https://example.com my-slug
 *
 * Writes assets/work/<slug>.webp (desktop) and <slug>-mobile.webp (phone),
 * the same two files and the same sizes tools/shot.mjs produces for the
 * concept builds, so the new card matches the rest of the grid exactly.
 *
 * This exists as a separate script because shot.mjs photographs local files
 * served on 127.0.0.1, and the machine that built this project cannot reach
 * the public internet at all. Run this one from a normal computer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'work');

const [urlArg, slugArg] = process.argv.slice(2);
const url = urlArg || 'https://untamedevents.netlify.app';
const slug = slugArg || 'untamed-events';

if (!/^https?:\/\//i.test(url)) {
  console.error(`\n  "${url}" is not a web address. Try:\n    npm run shot:live -- https://untamedevents.netlify.app untamed-events\n`);
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error(`\n  "${slug}" is not a usable file name. Use lowercase letters, numbers and dashes.\n`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

/*
  Straight to WebP. shot.mjs writes JPEGs and lets opt-img.mjs sweep the
  folder afterwards; doing both steps here keeps this to one command, which
  is the whole point of the script.
*/
const save = async (buffer, name, width) => {
  const file = path.join(outDir, name);
  await sharp(buffer).resize({ width, withoutEnlargement: true }).webp({ quality: 76 }).toFile(file);
  console.log(`  assets/work/${name}  ${(fs.statSync(file).size / 1024).toFixed(0)}KB`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

try {
  console.log(`\n  Photographing ${url}\n`);

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  /*
    `networkidle` hangs forever on sites that hold a socket open — analytics,
    chat widgets, a video poster still streaming. Waiting for the DOM and then
    settling for a beat gets the same picture without the gamble.
  */
  await desktop.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await desktop.waitForTimeout(2500);
  await save(await desktop.screenshot({ type: 'png' }), `${slug}.webp`, 1000);
  await desktop.close();

  const phone = await browser.newPage({
    viewport: { width: 390, height: 780 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await phone.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await phone.waitForTimeout(2500);
  await save(await phone.screenshot({ type: 'png' }), `${slug}-mobile.webp`, 480);
  await phone.close();

  console.log(`\n  Done. Reload the site and the ${slug} card shows the real screenshot.\n`);
} catch (error) {
  // A wall of Playwright stack trace helps nobody. Say what went wrong.
  const why = /timeout/i.test(error?.message || '')
    ? 'the site took too long to answer'
    : /ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(error?.message || '')
      ? 'that address does not resolve — check the spelling'
      : /ERR_CONNECTION|ECONNREFUSED|net::/i.test(error?.message || '')
        ? 'the connection was refused — check you are online'
        : error?.message || String(error);
  console.error(`\n  Could not photograph ${url}: ${why}\n`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
