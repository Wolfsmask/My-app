# MBOnyx Lead Checker

Finds local businesses whose websites genuinely need rebuilding, measures what's wrong, and
scores them 0–100.

**It audits. It does not email anyone.** There is no sending code in here at all — that is
deliberate, and it is Phase 3 work gated behind the setup in `docs/SETUP-CHECKLIST.md`.

## Quick start

```bash
cd app
npm install            # installs playwright (uses the repo root's copy if present)
npx playwright install chromium

# The zero-setup path: audit a list you made by hand
node src/cli.js --source file --input my-list.txt
```

Open `app/out/report.html` when it finishes.

### Your list file

One business per line. Either just a website, or the full form:

```
# Name, website, phone, rating, reviewCount
Ace Heating and Cooling, acehvac.com, (555) 212-9000, 4.4, 130
riversideplumbing.com
```

Rating and review count are optional, but without them the "can they afford you" filter
can't run.

## The three sources

| Source | Setup | Review data | Notes |
|---|---|---|---|
| `file` | None | Whatever you type | Best for testing the scoring on sites you already know |
| `osm` | None | **None** | OpenStreetMap. Free and keyless, but US coverage of small trades is patchy |
| `places` | Google API key + billing | Yes | The real one. Only source with review counts |

```bash
node src/cli.js --source osm --category hvac --city "Kansas City, MO" --limit 40

export GOOGLE_PLACES_KEY=...
node src/cli.js --source places --category "HVAC contractor" --city "Kansas City, MO"
```

Google Places needs a billing account (a credit card), which is one of the things blocked
until the setup checklist is done. Start with `file` and `osm`.

## Options

```
--source       file | osm | places          default: file
--input        path to your list            with --source file
--category     hvac, plumber, dentist…      with --source osm|places
--city         "Kansas City, MO"
--limit        how many businesses          default 25
--out          output folder                default app/out
--shots        save a screenshot of each site
--concurrency  how many at once             default 3
```

## How the score works

Embarrassment signals carry **70%**, raw speed carries **30%**. That split is the core
argument of the project: a slow site does not make an owner reply, an embarrassing one does.

| Signal | Points |
|---|---|
| Not readable on a phone | 25 |
| Security warning / broken SSL | 15 |
| Footer copyright 3+ years stale | 10 |
| Obsolete platform (Flash, FrontPage, old WordPress) | 10 |
| Broken links or missing images | 5 |
| No contact method above the fold | 5 |
| Slow to show content (LCP > 4s) | 12 |
| Low mobile performance score | 10 |
| Page over 5MB | 5 |
| Images not compressed | 3 |

Only checks that actually ran count toward the maximum, so a run without performance data
still produces a meaningful 0–100 rather than capping everything at 70.

**Tiers:** A ≥ 70 (contact now) · B 50–69 (contact) · C 25–49 (hold, recheck in 6 months) ·
D < 25 (drop, the site is fine).

Leads are dropped before auditing if they have no website, are a Facebook page only, are
permanently closed, or are on the suppression list. The cheapest audit is the one that
never runs.

## Tests

```bash
python3 -m http.server 8899 &     # from the repo root; the e2e tests need it
cd app && npm test
```

17 tests. The unit tests cover scoring, tier boundaries, copyright parsing and platform
detection. The end-to-end tests drive a real browser against three fixture sites in
`test/fixtures/` — a 2011 table-layout site, a half-modernised one, and a genuinely good
one — and assert the scoring separates them. They skip themselves if no server is running.

### A bug these tests caught

The responsive check originally compared the page's `scrollWidth` against
`window.innerWidth`. Both of those are the *layout* viewport, which **stretches to fit
overflowing content** — so a 940px-wide page on a 390px phone reported 940 vs 940 and
passed as "responsive". Every mobile-broken site scored zero on the strongest signal in
the whole system.

The fix is `window.visualViewport.width`, which is the physical screen. There is a
regression test for it in both suites.

## Politeness

- ~1 request/second per host, max 12 link checks per site
- Honest User-Agent identifying the crawler with a contact URL
- Homepage only — no crawling, no login walls, no scraping of personal data

You are measuring someone's public homepage, not stress-testing their server.
