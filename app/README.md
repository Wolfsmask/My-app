# MBOnyx Lead Checker

Finds local businesses whose websites genuinely need rebuilding, measures what's wrong, and
scores them 0–100.

**It audits. It does not email anyone.** There is no sending code in here at all — that is
deliberate, and it is Phase 3 work gated behind the setup in `docs/SETUP-CHECKLIST.md`.

## Quick start — no terminal

Install Node once from [nodejs.org](https://nodejs.org) (the big green **LTS** button), then
double-click:

| Windows | Mac |
| --- | --- |
| `Start MBOnyx.bat` | `Start MBOnyx.command` |

The first run installs what's missing and downloads the browser it audits with — about 150 MB,
a few minutes, once. After that it opens straight to a window in your browser.

## A day of it

**Start** runs the whole thing on a loop and does not stop until you tell it to:

    find 100 websites  ->  check them  ->  save every A and B  ->  find the next 100  ->  ...

Every kind of business it knows, in every town it knows. Leave it running while you are at
school. When you come back, press **Write the emails** for a draft per Tier A and B lead.

A round hands over after 100 sites **or five minutes**, whichever comes first — otherwise,
once the easy finds are used up, a batch that never fills would mean sweeping every town
before checking a single site.

The two buttons under the box still work on their own if you want to check a list you pasted,
or search one trade in one town.

**Closing the tab stops it.** Both the search and the check watch for the tab going away, so
nothing keeps running against other people's servers once nobody is watching. Leave the tab
open while you are at school; close it and it stops.

**Save now** keeps every A and B, plus any low-ranked ones you ticked, and closes the book on
everything else — those are never checked again, so a later night is not spent re-doing sites
you already passed over. Results are loaded back from disk every time you open the page, so
they survive Stop, Start, a reload and a restart.

**Best first.** Results are ordered by score as they arrive — highest at the top, sites that
could not be reached at the bottom — and the report and spreadsheet come out the same way.

**Any lead can be dropped.** Tier A and B carry a *Not interested, drop it* button; the card
goes, its screenshot goes, and no email is drafted for it. A decision you make by hand is
never undone by **Save now** — that only decides the ones nobody has looked at.

**A low score is provisional.** Tier C and D leads get *Agreed, drop it* / *Actually worth it*
buttons. Until you press one, that site stays in the queue and gets checked again next time —
the app will not write a business off forever on a guess nobody looked at. Tier A and B are
never re-checked; they are leads waiting to be emailed.

**It remembers.** Closing the window, restarting, or a dead battery costs nothing: every
search it completes, every town it locates, every business it finds and every site it checks
is written to disk as it happens. Press Start again and it picks up where it stopped instead
of repeating two thousand queries against free volunteer servers.

Progress is shown under the Start button, so you can see where it got to. To wipe it and
begin again, delete `app/out/ui/`.

## Where your saved leads live

Everything you have kept is four JSON files in **`app/out/ui/`**, right next to the app:

| | |
| --- | --- |
| `leads.json` | every business checked and scored — this is the one that matters |
| `found.json` | every business found, with its website |
| `progress.json` | which searches have already been run |
| `places.json` | where each town is |

The path is relative to the app, not to your computer, and that has one consequence worth
knowing: **a second copy of the app unzipped somewhere else starts empty.** It is not reading
your old folder and it has not lost anything — it is a different folder. The page prints which
folder it is reading under the Start button, so compare that against where your old copy is.

To move your work to a new copy, drag the whole `out` folder from the old `app` folder into
the new one. To update the app without touching your work, copy the new files *over* the old
`app` folder and answer "replace" — `out/` is not in the download, so it is left alone.

`leads.backup.json` is written once each time the app opens: a copy of your leads as they were
before that session touched anything. If a run goes wrong, rename it to `leads.json`.

If one of these files is ever unreadable, the app renames it to `leads.json.unreadable-<date>`
and says so on the page rather than starting empty and writing over it.

## Searching one trade or one town

Open **Search one trade or one town instead**. You can either **paste a list in yourself**, or
pick a type of business and a town and click **Find them for me**. That does two things:

1. Asks OpenStreetMap who is there (free, no account, no key).
2. **Goes and finds each one's website.** OpenStreetMap almost never records a website for a
   US small business, so the search guesses the addresses a business is likely to be at and
   loads them. A guess is only accepted when the page proves it belongs to that business.

Pick an **area** and it works through every town in it — 61 towns across four groups, nearest
to Liberty first — moving to the next when one runs out and **saving as it goes**. Stopping
never loses anything, and starting again adds to what you have rather than repeating it.

It searches the **area**, not just the city limits. The first pass covers whatever you typed
at its real size — "Kansas City MO" starts at about 35km, "Liberty MO" at about 8km — and each
pass after that reaches further out. Fills the box as it goes; press **Stop** when you have
enough, then **Check these websites**.

### Writing the emails

The **Emails** tab drafts one letter for every website you have kept. No API key needed —
the drafts are built from the findings the audit measured, so every number in an email is a
number taken off that business's own page. A draft citing a figure nobody measured is flagged
and never presented as ready.

Before sending anything, fill in **your details**. US law (CAN-SPAM) requires a real postal
address in commercial email — a PO box counts, and costs a few dollars a month. Until one is
set, every draft carries a warning and is for practice only. Each draft also carries an
opt-out line and names who is writing.

They are written in the words an owner uses, not the words the report uses — no pixels, no
milliseconds, no "viewport". A number only appears where a person would use one themselves:
the year in the footer, how many links are broken. And every part is drawn from several
phrasings, so a town's worth of these do not read as the same letter with the name swapped.

**Open in Gmail** opens a compose tab with the business's address, the subject and the whole
letter already filled in. You read it, change anything you want, and press Send. Nothing is
ever sent for you.

The address comes off their own website, and only when it is on their own domain. A page
usually carries the web designer's address too, and a `noreply@`, and whatever the template
shipped with — writing to one of those is worse than writing to none. When nothing on their
domain is found, the button still opens the draft with the To field empty and the page shows
what it did find, for you to check.

### What it will not do

It would rather find nothing than find the wrong company — a wrong match means emailing a
stranger about a website that isn't theirs. So it refuses a page that only shares a family
name (`wilson.com` is Wilson Sporting Goods, not Wilson Mechanical), refuses parked
"this domain is for sale" pages, and never guesses a bare one-word domain at all. Expect
misses; that's the trade being made deliberately.

OpenStreetMap holds no ratings, so the "can they afford you" filter can't run on these leads.
Google Places has far better data and review counts — see
[`docs/SETUP-CHECKLIST.md`](../docs/SETUP-CHECKLIST.md); it needs a billing account.

> On a Mac the first double-click may say the file is from an unidentified developer.
> Right-click it → **Open** → **Open**. That only happens once.

Everything runs on your own computer. Nothing is sent anywhere and nothing is emailed.

## Quick start — terminal

Same tool, if you prefer the command line:

```bash
cd app
npm install
npx playwright install chromium

npm run doctor    # checks the setup and names the fix for anything missing
npm run demo      # audits 9 bundled example sites — no internet, no keys
npm start         # the same window the double-click opens
```

Then on real businesses:

```bash
npm run find -- --source file --input my-list.txt --shots
```

Open `app/out/report.html` when it finishes.

**New to the terminal?** [`docs/TESTING.md`](../docs/TESTING.md) is the same
thing written click-by-click, starting from installing Node.

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
--allow-local  permit localhost / private addresses (testing only)
```

## The full pipeline

```bash
# Everything: find, audit, look at it, score, notify, draft an email
export ANTHROPIC_API_KEY=...
node src/cli.js --source places --category "HVAC contractor" --city "Kansas City, MO" \
  --vision --draft --notify --audit-base https://mbonyx.com/audit --sender Micah
```

| Stage | What happens |
|---|---|
| **Find** | Google Places / OpenStreetMap / your own list |
| **Load** | Real Chromium at 390×844, the way a customer sees it |
| **Examine the code** | SSL, viewport, platform fingerprint, broken links, page weight |
| **Examine the structure** | Semantic tags, heading hierarchy, inline-style ratio, layout tables, tap targets, text size |
| **Examine the visuals** | `--vision` sends the screenshot to Claude: what decade it reads as, first impression, visible problems |
| **Rank** | 0–100, tiers A–D |
| **Notify** | Terminal + `out/inbox.jsonl`; `--notify-email` also mails you the batch |
| **Draft** | `--draft` writes a per-lead email to `out/drafts/<slug>.txt` |

**Nothing here ever emails a prospect.** There is no send path in the codebase.
Drafts land in a folder for you to read, edit and send yourself — see
`docs/SETUP-CHECKLIST.md` for why that gate stays.

## How the email writing works

`src/email.js` gives Claude **only the verified findings** — not the raw audit,
not the review count, not anything that was measured but did not score. The
system prompt (cached, since it is identical for every lead) carries the rules
from `docs/OUTREACH.md` and one hard instruction: every factual claim must come
from the findings.

Then `verifyDraft()` checks the output mechanically:

- **Every number in the email must appear in the findings.** An invented load
  time or review count fails the draft.
- **Banned phrases** — "hope this email finds you well", "I came across your",
  "quick 15-minute call", "guarantee", "first page of Google".
- **Shape** — 4–6 sentences, subject under six words, no markdown, one link.

A draft that fails is written to disk marked `FAILED verification — DO NOT SEND`
rather than discarded, so a prompt regression is visible instead of silent.

This matters more than the prose quality. One fabricated measurement turns you
from *someone who looked at my site* into *a bot that also lies*, and there is
no recovering from that with a business owner.

## How the score works

Three groups, deliberately unequal. The weighting is the argument of the whole
project: a slow site does not make an owner reply, an embarrassing one does.

**Embarrassment — 70 points**

| Signal | Points |
|---|---|
| Not readable on a phone | 25 |
| Security warning / broken SSL | 15 |
| Footer copyright 3+ years stale | 10 |
| Obsolete platform (Flash, FrontPage, old WordPress) | 10 |
| Broken links or missing images | 5 |
| No contact method above the fold | 5 |

**Design & structure — 30 points**

| Signal | Points |
|---|---|
| Looks a decade out of date | 12 |
| Poor first impression (`--vision`, ≤4/10) | 8 |
| Body text under 14px | 4 |
| Buttons too small to tap | 3 |
| Heading/semantic structure problems | 3 |

**Performance — 25 points**

| Signal | Points |
|---|---|
| Slow to show content (LCP > 4s) | 10 |
| Low mobile performance score | 8 |
| Page over 5MB | 4 |
| Images not compressed | 3 |

Only checks that actually ran count toward the maximum, so a run without
`--vision` or without performance data still produces a meaningful 0–100
rather than capping everything below tier A.

**Tiers:** A ≥ 70 (contact now) · B 50–69 (contact) · C 25–49 (hold, recheck in
6 months) · D < 25 (drop, the site is fine).

Leads are dropped before auditing if they have no website, are a Facebook page
only, are permanently closed, or are on the suppression list.

## Costs

Auditing is free. The optional Claude passes, at Opus 5 rates:

| Per lead | Roughly |
|---|---|
| `--vision` (one screenshot, low effort) | ~$0.01 |
| `--draft` (one email, cached system prompt) | ~$0.02 |

40 leads a day with both on is well under $1/day. The cached system prompt is
what keeps the draft cost down — it is byte-identical across every lead.

## Tests

```bash
npm run serve &                   # from the repo root; the e2e tests need it
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

## Safety

**It will not audit a local or private address.** URLs from Google Places and
OpenStreetMap are user-editable, so a listing whose "website" is
`http://169.254.169.254/` (cloud metadata) or `http://192.168.1.1/` would
otherwise be fetched, screenshotted and written into a report. Loopback,
RFC1918, link-local, carrier-grade NAT and multicast ranges are all refused,
hostname *and* resolved IP, including on redirects from the link checker.

`--allow-local` opts out. The demo and the end-to-end tests use it because they
serve fixtures from this machine; nothing else should.

**CSV output is formula-safe.** A cell beginning `=`, `+`, `-` or `@` is
prefixed with an apostrophe, because Excel and Sheets execute those and a
business name like `=HYPERLINK(...)` comes straight from Google Places.

## Politeness

- ~1 request/second per host, max 12 link checks per site
- Honest User-Agent identifying the crawler with a contact URL
- Homepage only — no crawling, no login walls, no scraping of personal data

You are measuring someone's public homepage, not stress-testing their server.
