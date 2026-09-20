#!/usr/bin/env node
/**
 * The lead checker with a window instead of a terminal.
 *
 *   node ui.mjs
 *
 * Starts a small server on this machine only, opens the page in your browser,
 * and streams progress back as it audits. Nothing here is reachable from the
 * internet and nothing is sent anywhere.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { discoverFile, discoverOsm, locate, OSM_CATEGORIES } from './src/discover.js';
import { resolveWebsite } from './src/resolve.js';
import { auditSite, launchBrowser } from './src/audit.js';
import { score, disqualify, qualifies } from './src/score.js';
import { toCsv, toHtml } from './src/report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out', 'ui');
const PORT = Number(process.env.PORT ?? 8123);

/** Only one audit at a time — each run owns the browser. */
let running = false;

/** Only one search at a time, so Stop always refers to something definite. */
let finding = false;

/**
 * Auditing or probing this machine is only ever wanted by the test suite,
 * never by a real run, so it is an env var rather than anything on the page.
 */
const ALLOW_LOCAL = process.env.MBONYX_ALLOW_LOCAL === '1';

const send = (res, event) => res.write(JSON.stringify(event) + '\n');

/**
 * Searches outward from a town until it runs out of places to look, or until
 * Stop is pressed.
 *
 * Two things happen per business. OpenStreetMap says who is there; it very
 * rarely says where their website is, so each one without a website recorded
 * gets looked up (src/resolve.js). That lookup is the slow part, so a few run
 * at once - but only a few, since every one of them is a request to a small
 * business's server.
 */
async function runFind(category, city, res, signal) {
  // Located once, not once per ring: Nominatim asks for at most a request a
  // second, and the answer does not change between rings.
  const place = await locate(city, signal);
  if (!place) throw new Error(`Could not find "${city}" on the map. Try adding the state, like "Liberty, MO".`);

  // The first ring covers the place asked for, whatever size it is, and the
  // rest reach into the surrounding area. A fixed 10km first ring searched
  // "Kansas City" as a circle around downtown.
  const RINGS = [1, 1.6, 2.6, 4, 6]
    .map(factor => Math.min(Math.round(place.radiusKm * factor), 160))
    .filter((km, i, all) => all.indexOf(km) === i);

  send(res, { type: 'place', label: place.label, radiusKm: place.radiusKm, rings: RINGS });

  const seen = new Set();
  let withSite = 0, noSite = 0;

  for (const radiusKm of RINGS) {
    if (signal.aborted) break;
    send(res, { type: 'stage', radiusKm, of: RINGS[RINGS.length - 1] });

    let batch;
    try {
      batch = await discoverOsm({ category, city, radiusKm, limit: 200, signal, at: place });
    } catch (e) {
      // A ring failing is worth saying, but the rings already searched still
      // count - reporting nothing would throw away real results.
      send(res, { type: 'note', message: `${radiusKm}km: ${e.message.split('\n')[0]}` });
      continue;
    }

    const fresh = batch.filter(b => {
      const key = (b.name ?? '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    for (let i = 0; i < fresh.length; i += 4) {
      if (signal.aborted) break;
      const slice = fresh.slice(i, i + 4);
      send(res, { type: 'looking', names: slice.map(b => b.name), done: i, total: fresh.length });

      const hits = await Promise.all(slice.map(async b => {
        try {
          return await resolveWebsite(b, { allowLocal: ALLOW_LOCAL, signal });
        } catch (e) {
          // A miss is already a null from resolveWebsite. Reaching here means
          // the lookup itself is broken, and reporting that as "no website"
          // is how every business in town came back empty with nothing said.
          if (!signal.aborted) send(res, { type: 'error', message: `The website lookup failed: ${e.message}` });
          throw e;
        }
      }));

      for (const [n, b] of slice.entries()) {
        if (signal.aborted) break;
        const hit = hits[n];
        if (hit?.website) withSite++; else noSite++;
        send(res, {
          type: 'business',
          name: b.name,
          phone: b.phone,
          website: hit?.website ?? null,
          via: hit?.via ?? null,
          why: hit?.why ?? null,
          // What was tried and what each one said, so "found nothing" can be
          // read rather than guessed at.
          tried: hit?.website ? null : (hit?.tried ?? null),
          withSite, noSite,
        });
      }
    }
  }

  if (!signal.aborted) send(res, { type: 'done', withSite, noSite });
}

async function runAudit(listText, opts, res) {
  const businesses = discoverFile(listText, { category: opts.category || 'manual', city: opts.city || '' });
  send(res, { type: 'found', count: businesses.length });

  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

  const leads = [];
  const toAudit = [];
  for (const business of businesses) {
    const reason = disqualify(business);
    if (reason) {
      leads.push({ business, dropReason: reason, tier: '-', score: null });
      send(res, { type: 'lead', name: business.name, tier: '-', score: null, note: reason });
    } else {
      toAudit.push(business);
    }
  }

  const browser = await launchBrowser();
  const usedSlugs = new Map();
  const slugFor = name => {
    let base = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'business';
    const seen = usedSlugs.get(base) ?? 0;
    usedSlugs.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  };

  try {
    const queue = [...toAudit];
    let done = 0;
    const worker = async () => {
      while (queue.length) {
        const business = queue.shift();
        const slug = slugFor(business.name);
        send(res, { type: 'progress', name: business.name, done, total: toAudit.length });
        try {
          const audit = await auditSite(business.website, {
            browser,
            screenshotPath: path.join(OUT, 'shots', `${slug}.jpg`),
            allowLocal: Boolean(opts.allowLocal) || ALLOW_LOCAL,
          });
          if (audit.fetchFailed) {
            leads.push({ business, audit, dropReason: `unreachable: ${audit.error}`, tier: '-', score: null });
            send(res, { type: 'lead', name: business.name, tier: '-', score: null, note: audit.error });
          } else {
            const s = score(audit);
            const q = business.reviewCount == null ? null : qualifies(business);
            leads.push({ business, audit, ...s, slug, qualified: q === null ? null : q.ok, qualifyReasons: q?.reasons ?? [] });
            send(res, {
              type: 'lead', name: business.name, website: business.website,
              tier: s.tier, score: s.score,
              findings: s.hits.map(h => ({ label: h.label, points: h.points, evidence: h.evidence })),
            });
          }
        } catch (e) {
          leads.push({ business, dropReason: `error: ${e.message.slice(0, 120)}`, tier: '-', score: null });
          send(res, { type: 'lead', name: business.name, tier: '-', score: null, note: e.message.slice(0, 120) });
        }
        done++;
      }
    };
    await Promise.all([worker(), worker()]);
  } finally {
    await browser.close().catch(() => {});
  }

  leads.sort((a, z) => (z.score ?? -1) - (a.score ?? -1));
  const meta = { category: opts.category || 'your list', city: opts.city || '', source: 'the app' };
  fs.writeFileSync(path.join(OUT, 'leads.csv'), toCsv(leads));
  fs.writeFileSync(path.join(OUT, 'report.html'), toHtml(leads, meta));
  send(res, { type: 'done', reportPath: path.join(OUT, 'report.html'), csvPath: path.join(OUT, 'leads.csv') });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Browsers ask for this unprompted; without it every page load logs a 404.
  if (req.method === 'GET' && url.pathname === '/favicon.ico') {
    const svg = path.join(here, '..', 'favicon.svg');
    if (fs.existsSync(svg)) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      fs.createReadStream(svg).pipe(res);
    } else {
      res.writeHead(204).end();
    }
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(here, 'ui', 'index.html')).pipe(res);
    return;
  }

  // The finished report, and the screenshots it links to.
  if (req.method === 'GET' && url.pathname.startsWith('/out/')) {
    const file = path.resolve(OUT, url.pathname.slice('/out/'.length));
    if (!file.startsWith(OUT) || !fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
    const type = { '.html': 'text/html; charset=utf-8', '.csv': 'text/csv', '.jpg': 'image/jpeg' }[path.extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(file).pipe(res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/categories') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(OSM_CATEGORIES));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/find') {
    if (finding) { res.writeHead(409, { 'Content-Type': 'application/json' }).end('{"error":"already searching"}'); return; }
    finding = true;

    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    await new Promise(r => req.on('end', r));

    // Pressing Stop closes the connection. Nothing else tells the search to
    // give up, so without this it would keep hitting other people's servers
    // for a search nobody is watching any more.
    const stop = new AbortController();
    res.on('close', () => {
      stop.abort();
      // Released here as well as in the finally below. The finally cannot run
      // until runFind returns, and runFind can still be inside a request that
      // has seconds to go - during which a new search was refused as "already
      // running in another tab". Stop must free the tool immediately.
      finding = false;
    });

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    try {
      const { category, city } = JSON.parse(body || '{}');
      if (!category) throw new Error('Pick a type of business first.');
      if (!String(city ?? '').trim()) throw new Error('Type a town or city first, like "Liberty, MO".');
      await runFind(category, String(city).trim(), res, stop.signal);
    } catch (e) {
      if (!stop.signal.aborted) send(res, { type: 'error', message: e.message });
    } finally {
      finding = false;
      res.end();
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/audit') {
    if (running) { res.writeHead(409, { 'Content-Type': 'application/json' }).end('{"error":"already running"}'); return; }
    running = true;

    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    await new Promise(r => req.on('end', r));

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    try {
      const { list, ...opts } = JSON.parse(body || '{}');
      await runAudit(String(list ?? ''), opts, res);
    } catch (e) {
      send(res, { type: 'error', message: e.message });
    } finally {
      running = false;
      res.end();
    }
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`\n  MBOnyx lead checker\n  ${url}\n\n  Leave this window open while you use it.\n  Close it, or press Ctrl+C, when you are finished.\n`);
  open(url);
});

/**
 * Open the default browser, on whichever platform this is.
 *
 * spawn reports a missing command through an 'error' event rather than by
 * throwing, so a try/catch around it never fires — without the listener below,
 * a machine with no xdg-open (or a locked-down PATH) crashed the whole tool
 * with an unhandled error, purely because it could not open a browser. That
 * should be a shrug, not a failure: the server is already listening and the
 * URL is printed above.
 */
function open(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
                    : process.platform === 'darwin' ? ['open', [url]]
                    : ['xdg-open', [url]];
  let child;
  try {
    child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  } catch {
    console.log(`  (open ${url} in your browser)`);
    return;
  }
  child.on('error', () => console.log(`  (open ${url} in your browser)`));
  child.unref();
}
