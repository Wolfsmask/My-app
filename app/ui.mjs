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
import { createStore } from './src/store.js';
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
const store = createStore(OUT);

/**
 * Searches everything, and remembers what it already searched.
 *
 * The sweep is category by category within each town, so the first hour
 * produces plumbers and dentists and roofers rather than sixty towns of
 * nothing but HVAC. Each town then widens over successive passes, picking up
 * what sits between them.
 *
 * Every (category, town, pass) that completes is written down. Starting again
 * skips all of it, which is the difference between leaving this running for a
 * school day and having to babysit it.
 */
/**
 * A failed lookup in words rather than Node's.
 *
 * Node reports every network failure as "fetch failed", which says nothing
 * about what to do - and there is exactly one thing to do when the map
 * servers cannot be reached.
 */
function plainly(message) {
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network/i.test(message)) {
    return "could not reach the map servers - check the internet connection";
  }
  if (/timed out|TimeoutError|abort/i.test(message)) return "the map servers did not answer in time";
  return message;
}

async function runFind(categories, where, res, signal, { harvest = Infinity, maxMs = Infinity } = {}) {
  // How many sites to gather before handing back. In the continuous mode the
  // search pauses every so often so the checker can work through what has
  // piled up, rather than finding thousands and checking none.
  //
  // Also on time, not only on count. Once the easy finds are used up a batch
  // may never fill, and waiting for it would mean sweeping every town and
  // trade before checking a single site - an hour of watching a counter and
  // no results. Whichever comes first.
  let harvested = 0;
  // Consecutive towns that could not even be located. Reset by any success.
  let unreachable = 0;
  const until = Date.now() + maxMs;
  const enough = () => harvested >= harvest || Date.now() >= until;
  const chosen = where.region ? citiesFor(where.region) : [where.city].filter(Boolean);
  // What was asked for first, then everywhere else, so it never runs out of
  // somewhere to look. Stop is the thing that ends a search.
  const towns = [...new Set([...(chosen.length ? chosen : ALL_CITIES), ...ALL_CITIES])];
  const cats = categories.length ? categories : OSM_CATEGORIES.map(c => c.key);
  const PASSES = [1, 1.6, 2.6, 4];

  let withSite = store.found.filter(b => b.website).length;
  let noSite = store.found.length - withSite;

  send(res, {
    type: 'plan', towns, passes: PASSES.length, categories: cats.length,
    already: store.found.length, searches: store.summary().searches,
  });

  for (const [passIndex, spread] of PASSES.entries()) {
    if (signal.aborted || enough()) break;
    const foundBeforePass = store.found.length;

    for (const [townIndex, town] of towns.entries()) {
      if (signal.aborted || enough()) break;

      // Towns do not move, so a town is geocoded once ever rather than once
      // per pass per category - 244 requests became 61, against a service
      // that asks for one a second.
      let place = store.place(town);
      if (!place) {
        try {
          place = await locate(town, signal);
          unreachable = 0;
        } catch (e) {
          if (signal.aborted) break;
          // Sixty-one towns failing one after another is not sixty-one
          // problems, it is one - and grinding through the whole list saying
          // so each time wastes a night.
          if (++unreachable >= 5) {
            // Thrown rather than reported and carried on: the run is over,
            // and saying "searched every town it knows" after giving up on
            // the fifth is worse than saying nothing.
            throw new Error(`${plainly(e.message.split('\n')[0])}. Nothing was lost - press Start again once you are back online.`);
          }
          send(res, { type: 'note', message: `${town}: ${plainly(e.message.split('\n')[0])}` });
          continue;
        }
        if (!place) {
          // Remembered as unfindable too, so it is not looked up again on
          // every pass for the rest of the day.
          store.rememberPlace(town, { missing: true });
          send(res, { type: 'note', message: `${town}: not on the map` });
          continue;
        }
        store.rememberPlace(town, place);
      }
      if (place.missing) continue;

      const radiusKm = Math.min(Math.round(place.radiusKm * spread), 160);

      for (const category of cats) {
        if (signal.aborted || enough()) break;

        const key = `${category}|${town}|${passIndex}`;
        if (store.isDone(key)) continue;

        send(res, {
          type: 'town', name: town, label: place.label, index: townIndex, of: towns.length,
          radiusKm, pass: passIndex + 1, passes: PASSES.length, category,
        });

        let batch;
        try {
          batch = await discoverOsm({ category, city: town, radiusKm, limit: 200, signal, at: place });
        } catch (e) {
          if (signal.aborted) break;
          // Not marked done: a search that failed should be tried again on a
          // later run rather than written off.
          send(res, { type: 'note', message: `${town} ${category}: ${plainly(e.message.split('\n')[0])}` });
          continue;
        }

        const fresh = batch.filter(b => b.name && !store.hasBusiness(b.name, town));

        // A rolling pool rather than fixed batches. In batches of four, three
        // businesses that resolved instantly sat waiting on a fourth that was
        // timing out before the next four could start; here a worker that
        // finishes takes the next name immediately.
        let next = 0;
        const worker = async () => {
          while (!signal.aborted && !enough()) {
            const i = next++;
            if (i >= fresh.length) return;
            const b = fresh[i];
            send(res, { type: 'looking', names: [b.name], done: i, total: fresh.length, town, category });

            let hit = null;
            try {
              hit = await resolveWebsite({ ...b, town }, { allowLocal: ALLOW_LOCAL, signal });
            } catch (e) {
              if (!signal.aborted) send(res, { type: 'error', message: `The website lookup failed: ${e.message}` });
              throw e;
            }
            if (signal.aborted) return;

            if (hit?.website) { withSite++; harvested++; } else noSite++;

            const found = {
              name: b.name, phone: b.phone, town, category,
              website: hit?.website ?? null,
              why: hit?.why ?? null,
              tried: hit?.website ? null : (hit?.tried ?? null),
            };
            // Written per business, so Stop, a crash or a closed laptop never
            // costs the work already done.
            store.addBusiness(found);
            send(res, { type: 'business', ...found, withSite, noSite, saved: store.found.length });
          }
        };
        await Promise.all(Array.from({ length: Math.min(6, fresh.length) }, worker));

        if (!signal.aborted) store.markDone(key);
      }
    }

    // A whole pass over every town and every trade that turned up nobody new
    // means the area is worked out at this spread. Going round again would be
    // the same queries to the same free servers for the same nothing.
    if (passIndex > 0 && store.found.length === foundBeforePass) {
      // Named apart from the cycle's own "exhausted": one means this sweep
      // found nobody new, the other means there is nothing left anywhere.
      send(res, { type: 'sweep-exhausted', pass: passIndex + 1 });
      break;
    }
  }

  if (!signal.aborted && harvest === Infinity) {
    send(res, { type: 'done', withSite, noSite, saved: store.found.length });
  }
  return harvested;
}


/**
 * Find some, check them, repeat, until told to stop.
 *
 * Searching is cheap and checking is not: a site is loaded in a real browser
 * and measured. Doing all the finding first would mean thousands of sites
 * discovered and none of them ranked, so the two alternate - gather a batch,
 * work through it, gather the next.
 *
 * Nothing new is needed to make this survive being interrupted. The ledger
 * already records which searches are finished and which sites are checked, so
 * a round that stops half way simply resumes where it was.
 */
async function runCycle(res, signal, batchSize, gatherMs = 5 * 60_000) {
  let round = 0;

  while (!signal.aborted) {
    round++;

    send(res, { type: 'cycle', round, phase: 'finding', batchSize });
    let gathered;
    try {
      gathered = await runFind([], {}, res, signal, { harvest: batchSize, maxMs: gatherMs });
    } catch (e) {
      if (signal.aborted) break;
      // Whatever was found and checked before this is already saved, so the
      // round ends here rather than the whole thing pretending to finish.
      send(res, { type: 'error', message: e.message });
      return;
    }
    if (signal.aborted) break;

    const waiting = store.pendingAudit().length;
    if (waiting) {
      send(res, { type: 'cycle', round, phase: 'checking', waiting });
      await runAudit('', {}, res, signal, { quiet: true });
      if (signal.aborted) break;
    }

    // Nothing new found and nothing left to check means every town and trade
    // it knows has been worked through. Going round again would be the same
    // queries to the same free servers for the same nothing.
    // Nothing new found and nothing left to check. Rounds that end on the
    // timer with something still to do carry on; this is the real end.
    if (gathered === 0 && !waiting) {
      // The totals off the ledger, not this round's tally. A later round
      // finding nothing new would otherwise report "0 Tier A saved" when
      // dozens are sitting on disk from earlier ones.
      const worth = store.leads.filter(l => l.tier === 'A' || l.tier === 'B');
      send(res, {
        type: 'exhausted', round,
        totalA: worth.filter(l => l.tier === 'A').length,
        totalB: worth.filter(l => l.tier === 'B').length,
      });
      break;
    }
  }

  if (!signal.aborted) {
    const s = store.summary();
    send(res, { type: 'done', withSite: s.withSite, noSite: s.found - s.withSite, saved: s.found, rounds: round });
  }
}

async function runAudit(listText, opts, res, signal, { quiet = false } = {}) {
  // A pasted list is still honoured. With the box empty it works through
  // everything the search found and has not checked yet, which is what makes
  // "come back and press Check" a whole afternoon's work rather than a
  // copy-and-paste job.
  const businesses = String(listText ?? '').trim()
    ? discoverFile(listText, { category: opts.category || 'manual', city: opts.city || '' })
    : store.pendingAudit().map(b => ({
        name: b.name, website: b.website, phone: b.phone,
        rating: null, reviewCount: null, status: 'OPERATIONAL',
        category: b.category ?? 'manual', city: b.town ?? '', source: 'found',
      }));

  if (!businesses.length) {
    if (quiet) return;
    send(res, { type: 'error', message: store.found.length
      ? 'Everything found has already been checked. Press Start to find more.'
      : 'Nothing to check yet. Press Start to find businesses first.' });
    return;
  }
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
      // Checked before each site rather than only at the start: closing the
      // tab used to leave this working through hundreds of sites with a
      // browser open and no way to reach it.
      while (queue.length && !signal?.aborted) {
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
            const lead = { business, audit, ...s, slug, qualified: q === null ? null : q.ok, qualifyReasons: q?.reasons ?? [] };
            leads.push(lead);
            // Kept as each one finishes. Checking two hundred sites takes a
            // long time, and a closed laptop halfway through should cost the
            // remainder, not the lot.
            store.addLead(lead);
            send(res, {
              type: 'lead', name: business.name, website: business.website,
              tier: s.tier, score: s.score, confidence: s.confidence, review: lead.review ?? null,
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

  // The report is still written when the tab was closed part way - those
  // sites were really checked and their results are already on disk - but
  // nothing is announced to a connection that has gone.
  leads.sort((a, z) => (z.score ?? -1) - (a.score ?? -1));
  const meta = { category: opts.category || 'your list', city: opts.city || '', source: 'the app' };
  // Kept as data as well as as a report, so the email drafts can be built
  // from the findings themselves rather than from anything typed back in.
  // Everything checked so far, not just this run's batch, so the report is
  // the whole picture after a day of stopping and starting.
  // Sorted here, not only in the page. The in-run list was ordered but the
  // saved one wins, so the report and the spreadsheet were coming out in
  // whatever order the checks happened to finish - best leads buried.
  // The report is what is still live, for the same reason. Everything ever
  // checked is in leads.json if it is ever wanted.
  const all = (store.leads.length >= leads.length ? store.leads : leads)
    .filter(l => l.review !== 'confirmed')
    .sort((a, z) => (z.score ?? -1) - (a.score ?? -1));
  fs.writeFileSync(path.join(OUT, 'leads.csv'), toCsv(all));
  fs.writeFileSync(path.join(OUT, 'report.html'), toHtml(all, meta));
  // Inside a continuous run this is the end of one round, not the end of the
  // job, and announcing "done" every round would read as finished.
  if (!signal?.aborted && !quiet) {
    send(res, { type: 'done', reportPath: path.join(OUT, 'report.html'), csvPath: path.join(OUT, 'leads.csv') });
  }
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
      const leads = store.leads;
      // A lead kept by hand counts as much as a high-ranked one. Filtering on
      // tier alone meant ticking "actually worth it" on a Tier C put it in
      // the keep list and then never wrote it a letter - the one case where
      // the score was overruled on purpose.
      const worth = leads.filter(l =>
        l.review !== 'confirmed' && (l.tier === 'A' || l.tier === 'B' || l.review === 'keep'));

      const drafts = worth.map(lead => {
        const draft = draftEmail(lead, sender ?? {});
        const check = numbersAreReal(draft, draft.facts);
        return {
          name: lead.business?.name, website: lead.business?.website,
          tier: lead.tier, score: lead.score,
          // The address off their own site, and the ones that might be theirs
          // but might be their web designer's.
          to: lead.audit?.contactEmail ?? null,
          maybe: lead.audit?.emailCandidates ?? [],
          subject: draft.subject, body: draft.body,
          // A draft that cites a number nobody measured is never presentable
          // as ready, whatever else is right about it.
          warnings: check.ok ? draft.warnings : [...draft.warnings, `Contains a number that was not measured: ${check.invented.join(', ')}`],
        };
      });

      res.end(JSON.stringify({ drafts, total: leads.length }));
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/review') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    await new Promise(r => req.on('end', r));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      const { website, decision } = JSON.parse(body || '{}');
      const ok = store.review(website, decision);
      res.end(JSON.stringify({ ok, ...store.summary() }));
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/leads') {
    // So the page can show what is already on disk. Results used to live only
    // in the window, and pressing Start wiped them - a night's work looked
    // lost, though it was saved the whole time.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Closed ones stay on disk - that is what stops them being checked again -
    // but they are done with, and putting two thousand of them back on the
    // page every time it opens is not "saved", it is clutter.
    const rows = store.leads
      .filter(l => l.review !== 'confirmed')
      .sort((a, z) => (z.score ?? -1) - (a.score ?? -1))
      .map(l => ({
        name: l.business?.name, website: l.business?.website,
        tier: l.tier, score: l.score, confidence: l.confidence,
        review: l.review ?? null, note: l.dropReason ?? null,
        findings: (l.hits ?? []).map(h => ({ label: h.label, points: h.points, evidence: h.evidence })),
      }));
    res.end(JSON.stringify(rows));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/save-now') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    await new Promise(r => req.on('end', r));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      const { keep } = JSON.parse(body || '{}');
      const result = store.saveNow(Array.isArray(keep) ? keep : []);

      // The screenshots of closed sites go with them. Left alone they are
      // about 80KB each and nothing ever removed them, so a few nights of
      // running would quietly fill a laptop.
      let freed = 0;
      for (const slug of result.closedSlugs ?? []) {
        const shot = path.join(OUT, 'shots', `${slug}.jpg`);
        try {
          freed += fs.statSync(shot).size;
          fs.rmSync(shot, { force: true });
        } catch { /* already gone, or never taken */ }
      }

      res.end(JSON.stringify({ ...result, freedMb: +(freed / 1048576).toFixed(1), ...store.summary() }));
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store.summary()));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/reset') {
    // Only ever on an explicit ask: this is the whole day's work.
    store.reset();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store.summary()));
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

  if (req.method === 'POST' && url.pathname === '/api/run') {
    if (finding || running) { res.writeHead(409, { 'Content-Type': 'application/json' }).end('{"error":"already running"}'); return; }
    // Both flags: a cycle searches and checks, so neither a search nor a check
    // started from somewhere else may run alongside it. Two checks at once
    // would mean two browsers.
    finding = true;
    running = true;

    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    await new Promise(r => req.on('end', r));

    const stop = new AbortController();
    res.on('close', () => { stop.abort(); finding = false; running = false; });

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    try {
      const { batchSize, gatherMs } = JSON.parse(body || '{}');
      await runCycle(res, stop.signal, Math.max(1, Math.min(Number(batchSize) || 100, 1000)), Math.max(10_000, Math.min(Number(gatherMs) || 5 * 60_000, 30 * 60_000)));
    } catch (e) {
      if (!stop.signal.aborted) send(res, { type: 'error', message: e.message });
    } finally {
      finding = false;
      running = false;
      res.end();
    }
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
      // No category and no area is the Start button: everything, everywhere.
      const cats = category ? [category] : [];
      await runFind(cats, region ? { region } : { city: String(city ?? '').trim() }, res, stop.signal);
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

    // Closing the tab closes this connection, and that is the only signal
    // that nobody is watching any more. Without it, a check kept going
    // through every site it had left, holding a browser open, unreachable.
    const stop = new AbortController();
    res.on('close', () => { stop.abort(); running = false; });

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    try {
      const { list, ...opts } = JSON.parse(body || '{}');
      await runAudit(String(list ?? ''), opts, res, stop.signal);
    } catch (e) {
      if (!stop.signal.aborted) send(res, { type: 'error', message: e.message });
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
