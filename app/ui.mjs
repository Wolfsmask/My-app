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
import { REGIONS, citiesFor, ALL_CITIES } from './src/places.js';
import { draftEmail, numbersAreReal } from './src/draft.js';
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
/** Where found businesses are kept, so stopping never loses the work. */
const FOUND = path.join(OUT, 'found.json');

function loadFound() {
  try { return JSON.parse(fs.readFileSync(FOUND, 'utf8')); } catch { return []; }
}

function saveFound(list) {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(FOUND, JSON.stringify(list, null, 2));
  } catch { /* a failed save must not end a search that is working */ }
}

/**
 * Searches one town, then the next.
 *
 * Given a region it works through every town in it and saves as it goes, so
 * stopping halfway keeps everything found so far and starting again adds to
 * it rather than replacing it.
 *
 * One town on its own is searched in widening rings, since that is a request
 * to look around that place. A whole region is searched one ring per town,
 * because the towns already overlap - widening each of sixty would search the
 * same metro sixty times over.
 */
async function runFind(category, where, res, signal) {
  const chosen = where.region ? citiesFor(where.region) : [where.city].filter(Boolean);
  if (!chosen.length) throw new Error('That area has no towns listed.');

  // What was asked for first, then everywhere else, so it never runs out of
  // somewhere to look. Stop is the thing that ends a search.
  const towns = [...new Set([...chosen, ...ALL_CITIES])];

  // Each pass goes over every town again at a wider radius, picking up what
  // sat between them. Four passes is the point at which the circles overlap so
  // heavily that another one is all re-reading.
  const PASSES = [1, 1.6, 2.6, 4];

  const kept = loadFound();
  // Businesses already found, by name, so re-running adds rather than repeats.
  const seen = new Set(kept.map(b => (b.name ?? '').toLowerCase()));
  let withSite = kept.filter(b => b.website).length;
  let noSite = kept.length - withSite;

  send(res, { type: 'plan', towns, already: kept.length, passes: PASSES.length });

  for (const [passIndex, spread] of PASSES.entries()) {
    if (signal.aborted) break;
    const foundBeforePass = kept.length;

  for (const [townIndex, town] of towns.entries()) {
    if (signal.aborted) break;

    let place;
    try {
      place = await locate(town, signal);
    } catch (e) {
      if (signal.aborted) break;
      send(res, { type: 'note', message: `${town}: ${e.message.split('\n')[0]}` });
      continue;
    }
    if (!place) {
      // One unfindable town must not end a run through sixty of them.
      send(res, { type: 'note', message: `${town}: not on the map` });
      continue;
    }

    // One ring per town per pass. Widening each town fully before moving on
    // would search the same metro sixty times over; widening across passes
    // covers the same ground once each time round.
    const rings = [Math.min(Math.round(place.radiusKm * spread), 160)];

    send(res, { type: 'town', name: town, label: place.label, index: townIndex, of: towns.length,
      radiusKm: rings[0], pass: passIndex + 1, passes: PASSES.length });

    for (const radiusKm of rings) {
      if (signal.aborted) break;
      send(res, { type: 'stage', town, radiusKm, of: rings[rings.length - 1] });

      let batch;
      try {
        batch = await discoverOsm({ category, city: town, radiusKm, limit: 200, signal, at: place });
      } catch (e) {
        if (signal.aborted) break;
        send(res, { type: 'note', message: `${town} ${radiusKm}km: ${e.message.split('\n')[0]}` });
        continue;
      }

      const fresh = batch.filter(b => {
        const key = (b.name ?? '').toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // A rolling pool rather than fixed batches. In batches of four, three
      // businesses that resolved instantly sat waiting on a fourth that was
      // timing out before the next four could start; here a worker that
      // finishes takes the next name immediately.
      let next = 0;
      let done = 0;
      const worker = async () => {
        while (!signal.aborted) {
          const i = next++;
          if (i >= fresh.length) return;
          const b = fresh[i];
          send(res, { type: 'looking', names: [b.name], done: done, total: fresh.length, town });

          let hit = null;
          try {
            hit = await resolveWebsite(b, { allowLocal: ALLOW_LOCAL, signal });
          } catch (e) {
            if (!signal.aborted) send(res, { type: 'error', message: `The website lookup failed: ${e.message}` });
            throw e;
          }
          if (signal.aborted) return;

          done++;
          if (hit?.website) withSite++; else noSite++;

          const found = {
            name: b.name, phone: b.phone, town,
            website: hit?.website ?? null,
            why: hit?.why ?? null,
            tried: hit?.website ? null : (hit?.tried ?? null),
          };
          kept.push(found);
          // Written per business rather than at the end: Stop, a crash or a
          // closed window must not cost the work already done.
          saveFound(kept);

          send(res, { type: 'business', ...found, withSite, noSite, saved: kept.length });
        }
      };

      await Promise.all(Array.from({ length: Math.min(6, fresh.length) }, worker));
    }
  }

    // A whole pass over every town that turned up nobody new means the area is
    // worked out at this spread. Going round again would be the same queries
    // to the same free servers for the same nothing, so it says so instead of
    // pretending to still be working.
    if (passIndex > 0 && kept.length === foundBeforePass) {
      send(res, { type: 'exhausted', pass: passIndex + 1 });
      break;
    }
  }

  if (!signal.aborted) send(res, { type: 'done', withSite, noSite, saved: kept.length });
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
              tier: s.tier, score: s.score, confidence: s.confidence,
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
  // Kept as data as well as as a report, so the email drafts can be built
  // from the findings themselves rather than from anything typed back in.
  fs.writeFileSync(path.join(OUT, 'leads.json'), JSON.stringify(leads, null, 2));
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

  if (req.method === 'POST' && url.pathname === '/api/emails') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4e6) req.destroy(); });
    await new Promise(r => req.on('end', r));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      const { sender } = JSON.parse(body || '{}');
      // Drafts are written from the last run's leads, not from anything the
      // page sends back, so an email can only ever cite a real measurement.
      const leads = JSON.parse(fs.readFileSync(path.join(OUT, 'leads.json'), 'utf8'));
      const worth = leads.filter(l => l.tier === 'A' || l.tier === 'B');

      const drafts = worth.map(lead => {
        const draft = draftEmail(lead, sender ?? {});
        const check = numbersAreReal(draft, draft.facts);
        return {
          name: lead.business?.name, website: lead.business?.website,
          tier: lead.tier, score: lead.score,
          subject: draft.subject, body: draft.body,
          // A draft that cites a number nobody measured is never presentable
          // as ready, whatever else is right about it.
          warnings: check.ok ? draft.warnings : [...draft.warnings, `Contains a number that was not measured: ${check.invented.join(', ')}`],
        };
      });

      res.end(JSON.stringify({ drafts, total: leads.length }));
    } catch (e) {
      res.end(JSON.stringify({ error: /ENOENT/.test(e.message) ? 'Check some websites first — there is nothing scored yet.' : e.message }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/regions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(REGIONS.map(r => ({ key: r.key, name: r.name, note: r.note, count: r.cities.length }))));
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
      const { category, city, region } = JSON.parse(body || '{}');
      if (!category) throw new Error('Pick a type of business first.');
      if (!region && !String(city ?? '').trim()) throw new Error('Pick an area, or type a town like "Liberty, MO".');
      await runFind(category, region ? { region } : { city: String(city).trim() }, res, stop.signal);
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
