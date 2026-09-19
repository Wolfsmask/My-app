#!/usr/bin/env node
/**
 * The double-click entry point.
 *
 * "Start MBOnyx.bat" (Windows) and "Start MBOnyx.command" (Mac) both end up
 * here. Everything those two files do is find Node and run this; all of the
 * actual thinking lives in this file so there is one copy of it to fix, and so
 * it can be tested on any platform.
 *
 * First run installs what is missing (a few minutes, mostly the browser).
 * Every run after that goes straight to the window.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const say = (msg = '') => console.log(msg);
const step = msg => console.log(`  ${msg}`);

/** Stop with a message a person can act on, rather than a stack trace. */
function stop(problem, fix) {
  say();
  say(`  Could not start: ${problem}`);
  if (fix) { say(); for (const line of fix) say(`  ${line}`); }
  say();
  process.exitCode = 1;
}

/**
 * Run a command and let its output through, so a five-minute browser download
 * shows a progress bar instead of a frozen window.
 *
 * npm and npx are .cmd shims on Windows, which cmd.exe will only run through a
 * shell — so shell:true is required there, and harmless here since nothing in
 * the command line comes from user input.
 */
function run(cmd, args) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd: here, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', () => resolve(false));
    child.on('close', code => resolve(code === 0));
  });
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) {
  stop(`this computer has Node ${process.versions.node}, and the checker needs Node 20 or newer.`, [
    'Install the current "LTS" version from https://nodejs.org,',
    'then double-click this file again.',
  ]);
  process.exit();
}

/**
 * ui.mjs prints its own banner once the window is ready, so this one exists
 * only to explain a wait. Printed at most once, and not at all on a normal
 * run, where the window appears within a second or two.
 */
let headed = false;
function header() {
  if (headed) return;
  headed = true;
  say();
  say('  MBOnyx lead checker — first-time setup');
  say();
}

// --- 1. The libraries the checker is built on -------------------------------
if (!fs.existsSync(path.join(here, 'node_modules', 'playwright'))) {
  header();
  step('Installing the parts the checker needs.');
  step('This takes a few minutes. Leave the window open.');
  say();
  if (!await run('npm', ['install'])) {
    stop('the "npm install" step did not finish.', [
      'The usual cause is no internet connection, or a network that blocks npm.',
      'Connect and double-click this file again.',
    ]);
    process.exit();
  }
  say();
}

// --- 2. The browser the checker looks at websites with ----------------------
// Playwright reports where Chromium *should* be whether or not it was ever
// downloaded, so the path existing is the only honest check. CHROMIUM_PATH is
// the same escape hatch src/audit.js honours, for a machine that already has a
// suitable browser and should not download a second copy.
let chromiumPath = process.env.CHROMIUM_PATH || '';
try {
  if (!chromiumPath) {
    const { chromium } = await import('playwright');
    chromiumPath = chromium.executablePath();
  }
} catch {
  stop('the Playwright library did not load, even though it is installed.', [
    'Delete the "node_modules" folder and double-click this file again.',
  ]);
  process.exit();
}

if (!fs.existsSync(chromiumPath)) {
  header();
  step('Downloading the browser the checker uses to look at websites.');
  step('This is about 150 MB and only happens once.');
  say();
  if (!await run('npx', ['playwright', 'install', 'chromium'])) {
    stop('the browser download did not finish.', [
      'Check your internet connection and double-click this file again.',
    ]);
    process.exit();
  }
  say();
}

// --- 3. Go ------------------------------------------------------------------
await import('./ui.mjs');
