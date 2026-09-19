# Outreach Engine — Build Plan

Working name for the app. Finds local businesses with genuinely bad websites, proves it
with real measurements, generates a personalised demo, and queues an email for a human to
send.

Written in plain English on purpose. Nothing here assumes you already know the tools.

---

## 1. What it actually does

Five stages. Each one is a separate, testable piece — build them in order, and each is
useful on its own even if you never build the next one.

```
 1. FIND          2. MEASURE        3. SCORE         4. BUILD PROOF     5. SEND
 ────────         ──────────        ────────         ─────────────      ────────
 Google Places    Load the site     Weighted         Screenshot +       Draft email
 by category      Run Lighthouse    checklist ->     rebuilt demo       -> your queue
 + city           Check SSL, meta   0-100 "remake    at /audit/<slug>   -> you approve
                  Detect platform   score"                              -> it sends
                  Find contact
```

**The human approval gate in stage 5 is not a temporary measure.** It stays. See §7.

---

## 2. The scoring system (this is the important part)

Slow load time alone is a weak buying trigger. Plenty of slow sites belong to businesses
that do fine and don't care. What moves someone to reply is **embarrassment** plus
**evidence they're losing money right now**.

So the score has three groups, weighted very differently.

### Group A — Disqualifiers (checked first, cheap, stop immediately)

If any of these are true, **drop the lead and spend nothing further on it**:

| Check | Why |
|---|---|
| No website at all | Different pitch entirely; park these in a separate list |
| Site is a Facebook/Instagram page | Same — different conversation |
| Already excellent (score < 25) | Nothing to sell; don't waste a send |
| Domain registered < 6 months ago | Probably just built; you'd be insulting someone's new site |
| On the suppression list | Legally required. Never re-contact |
| Business permanently closed on Google | Obvious |
| Outside your service area | Keeps the pitch credible |

### Group B — Embarrassment signals (70% of the score)

These are what you actually put in the email. Each is a fact you can show them.

| Signal | Points | How to detect |
|---|---|---|
| Not mobile responsive | **25** | No `<meta name="viewport">`, or page width > 420px at a 390px viewport |
| SSL missing / expired / mixed content | **15** | HTTPS fails, cert expired, or HTTP assets on an HTTPS page |
| Copyright year ≥ 3 years stale | **10** | Regex the footer for `©\s*(\d{4})`, compare to now |
| Dead or obsolete platform | **10** | Flash embeds, WordPress < 5.0, free-tier Wix/Weebly with host ads, `<table>` layout, FrontPage meta tags |
| Broken links or missing images | **5** | Crawl homepage links, count non-2xx; count `naturalWidth === 0` images |
| No contact method above the fold | **5** | No `tel:`, `mailto:` or form in the first viewport |

Max 70.

### Group C — Performance (30% of the score)

Real, but supporting evidence — never the headline.

| Signal | Points | Source |
|---|---|---|
| LCP > 4.0s | 12 | PageSpeed Insights API (field or lab data) |
| Mobile Lighthouse performance < 50 | 10 | PageSpeed Insights API |
| Total page weight > 5MB | 5 | Sum of transferred bytes |
| No image compression (no WebP/AVIF) | 3 | Content-Type of image requests |

Max 30.

### Qualification filter — can they pay you?

Score tells you the site is bad. This tells you it's worth fixing. **Both must pass.**

| Check | Threshold | Source |
|---|---|---|
| Google review count | ≥ 25 | Places API |
| Google rating | ≥ 3.8 | Places API |
| Business status | `OPERATIONAL` | Places API |
| Has a phone number listed | yes | Places API |

Review count is your revenue proxy. You cannot buy real traffic data for a business this
size at any sane price — don't try. A plumber with 180 reviews is busy and has money. A
plumber with 4 reviews probably cannot pay you $1,800.

### Final tiering

| Score | Tier | Action |
|---|---|---|
| 70–100 | **A** | Full treatment — rebuilt demo page, personally reviewed email |
| 50–69 | **B** | Audit PDF only, templated email |
| 25–49 | **C** | Hold. Revisit in 6 months |
| < 25 | — | Drop |

Only A and B ever get contacted. Start with A only.

---

## 3. Architecture

```
┌──────────────┐
│  Dashboard   │  Next.js on Netlify. Lead pipeline, audit preview,
│  (you)       │  and the Approve & Send button.
└──────┬───────┘
       │
┌──────▼───────────────────────────────────────────┐
│  Supabase (Postgres)                             │
│  businesses · audits · contacts · outreach       │
│  suppression · events                            │
└──────┬───────────────────────────────────────────┘
       │
┌──────▼───────┐   ┌─────────────┐   ┌────────────┐
│   Worker     │──▶│  Playwright │   │  Postmark  │
│  (Fly.io)    │   │  screenshot │   │   sending  │
│  job queue   │   └─────────────┘   └────────────┘
└──────┬───────┘
       │
   ┌───▼──────────────┬──────────────────┐
   │ Google Places    │ PageSpeed API    │
   │ (discovery)      │ (performance)    │
   └──────────────────┴──────────────────┘
```

**Do not run the worker on Netlify Functions.** They time out at 10 seconds (26s for
background functions). A single Lighthouse run plus screenshots takes 30–60 seconds. A
$5/month Fly.io machine or a Railway container handles this without fighting the platform.

### Stack

| Piece | Choice | Cost | Why |
|---|---|---|---|
| Discovery | Google Places API | ~$17/1k, $200 free monthly | Only source with reliable SMB coverage + review counts |
| Performance | PageSpeed Insights API | Free, 25k/day with key | Same engine Google ranks with |
| Screenshots | Playwright | Free | Already proven in this repo — `tools/shot.mjs` |
| Database | Supabase | Free tier fine to start | Postgres + storage + auth in one |
| Worker | Fly.io + BullMQ | ~$5/mo | Long-running jobs, no timeout ceiling |
| Email | Postmark | ~$15/mo | Strictest sender rules = best inbox placement |
| Dashboard | Next.js on Netlify | Free | You already know this deployment |

Roughly **$25–40/month** all in at low volume.

---

## 4. Data model

```sql
-- Every business we've ever discovered.
create table businesses (
  id            uuid primary key default gen_random_uuid(),
  place_id      text unique not null,      -- Google's ID, our dedupe key
  name          text not null,
  category      text not null,             -- 'dentist', 'hvac_contractor'
  city          text not null,
  state         text not null,
  website       text,
  phone         text,
  rating        numeric(2,1),
  review_count  int,
  status        text,                      -- OPERATIONAL / CLOSED_*
  discovered_at timestamptz default now()
);

-- One row per time we measure a site. Keep history: re-auditing in 6
-- months and showing "it got worse" is a genuinely strong follow-up.
create table audits (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid references businesses(id) on delete cascade,
  audited_at        timestamptz default now(),

  -- Group B: embarrassment
  is_responsive     boolean,
  ssl_valid         boolean,
  ssl_expires_at    timestamptz,
  copyright_year    int,
  platform          text,                  -- 'wordpress-4.9', 'wix-free'
  broken_links      int,
  broken_images     int,
  has_contact_above_fold boolean,

  -- Group C: performance
  lcp_ms            int,
  lighthouse_perf   int,
  page_weight_bytes bigint,
  uses_modern_images boolean,

  -- Output
  score             int not null,
  tier              char(1) not null,      -- A / B / C
  signals           jsonb not null,        -- the exact findings, for the email
  screenshot_url    text,
  error             text                   -- if the audit failed, why
);

-- Contact details, only ever scraped from the business's own public site.
create table contacts (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  email       text not null,
  source_url  text not null,               -- where we found it. Always record this
  is_generic  boolean,                     -- info@ / contact@ — prefer these
  found_at    timestamptz default now(),
  unique (business_id, email)
);

-- One row per email. Nothing sends without a row here first.
create table outreach (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references businesses(id),
  contact_id    uuid references contacts(id),
  audit_id      uuid references audits(id),
  audit_slug    text unique,               -- /audit/<slug>
  subject       text not null,
  body          text not null,
  status        text not null default 'draft',
                -- draft -> approved -> sent -> opened -> replied
                -- or: rejected / bounced / complained / unsubscribed
  approved_by   text,
  approved_at   timestamptz,
  sent_at       timestamptz,
  replied_at    timestamptz,
  provider_id   text                       -- Postmark message ID
);

-- Permanent. Never delete from this table.
create table suppression (
  email      text primary key,
  domain     text,
  reason     text not null,   -- 'unsubscribed' | 'complained' | 'manual' | 'bounced'
  created_at timestamptz default now()
);

create index on businesses (category, city);
create index on audits (business_id, audited_at desc);
create index on outreach (status);
create index on suppression (domain);
```

**Check `suppression` on both the exact email and the domain before every single send.**
Make it a database constraint or a trigger, not something you remember to do.

---

## 5. The audit page — the thing that actually earns replies

Everyone gets twenty "I can improve your website" emails a week. They all get deleted. The
one thing that doesn't get deleted is **you already did the work**.

For each Tier A lead, auto-generate `mbonyx.com/audit/joes-plumbing`:

1. **Side by side** — screenshot of their current homepage next to a rebuilt version
2. **Three specific findings**, with their real numbers:
   - "Your site isn't readable on a phone — here's what it looks like on an iPhone 14"
   - "Your security certificate expired on March 3rd. Chrome shows visitors a warning."
   - "Your homepage takes 6.8 seconds to load. Google's threshold is 2.5."
3. **A soft close** — "This mock took me 20 minutes. The real thing takes a week."

The rebuild is templated per vertical — which is exactly why §8 says pick **one** vertical.
You build the dental template once, then swap in their logo, colours, name, address, hours
and services pulled from Places. Twenty minutes of setup per vertical, seconds per lead.

The five concept builds in `work/` are the starting templates. That work is already done.

---

## 6. Email infrastructure

This is where the business lives or dies. Get it wrong and every email you send —
including invoices to real clients — lands in spam permanently.

### Setup (before a single send)

- [ ] Buy a **separate domain** for outreach. Never send cold email from the domain that
      carries your client correspondence. If it burns, your real business survives.
- [ ] Configure **SPF**, **DKIM** and **DMARC** DNS records. These prove the email really
      came from you. Gmail rejects bulk senders without all three.
- [ ] Set DMARC to `p=none` initially, move to `p=quarantine` after two weeks of clean reports.
- [ ] Register with **Google Postmaster Tools** to see your actual spam rate.
- [ ] Set up a real mailbox on the domain that a human reads. An unmonitored address is a spam signal.
- [ ] Add a **List-Unsubscribe** header plus a working unsubscribe link in every message.
- [ ] Put your physical postal address in every footer. Legally required.

### Warmup schedule — do not skip this

| Week | Sends/day | Notes |
|---|---|---|
| 1 | 5–10 | Mostly to people who will reply. Ask friends to reply |
| 2 | 15–20 | Start real prospects, Tier A only |
| 3 | 25–35 | Watch the bounce rate |
| 4 | 40–50 | This is your steady-state ceiling per mailbox |

Beyond ~50/day per mailbox, add another mailbox — never raise one mailbox's volume.

### Automatic circuit breakers

Build these into the sender. They should stop the pipeline without asking you:

```
hard bounce rate  > 3%    -> pause, review the list
spam complaints   > 0.1%  -> pause immediately, do not resume same-day
open rate         < 15%   -> deliverability problem, stop and diagnose
reply rate        < 2%    -> targeting or copy problem, stop and fix
```

Google's public threshold is 0.3% complaints. Treat 0.1% as your ceiling — by the time you
hit 0.3% the damage is done.

---

## 7. Legal and ethical rules

Not optional, and not just about avoiding fines — these are the same rules that keep
deliverability alive.

### Hard rules

1. **US businesses only, at first.** CAN-SPAM permits B2B cold email with proper headers, a
   real postal address, a truthful subject line and a working opt-out honoured within 10
   days. **Canada (CASL) and most of the EU require consent first** and carry real
   penalties. Geo-filter and enforce it in code.
2. **Only publicly published business addresses.** `info@`, `contact@`, `hello@` found on
   the company's own website. Record `source_url` for every one.
3. **Never guess or generate addresses.** No `firstname.lastname@` pattern tools, no
   purchased lists, no scraping LinkedIn.
4. **One follow-up maximum.** Then stop, forever. Two emails from a stranger is outreach;
   five is harassment and gets you reported.
5. **Honour removals within 24 hours**, not the 10 days the law allows.
6. **Never contact a sole trader's personal address** — that is personal data, not business
   contact data, and the rules are stricter.
7. **Respect `robots.txt`** when fetching pages, and set a real User-Agent identifying
   yourself with a contact URL.
8. **Rate limit yourself** to ~1 request/second per domain. You are measuring their site,
   not stress-testing it.

### The tone rule

Never write an email that makes someone feel stupid. "Your website is bad" loses. "I
noticed your site isn't readable on phones — here's what it looks like, and here's a
version that is" wins. You are pointing at a fixable problem, not grading their taste.

---

## 8. Build phases

### Phase 0 — Fix your own site ✅ Done
Portfolio, pricing, legal pages, contact details, performance. You cannot email someone
about their website from a site with no proof on it.

### Phase 1 — The checker. No email.
A CLI you run yourself.

```bash
npm run find -- --category dentist --city "Phoenix, AZ" --limit 50
```

Outputs a scored CSV. No database needed yet, no sending, zero legal surface.

**Success = you open the top 10 results and agree they genuinely need a rebuild.** If the
scoring is wrong, this is the cheap moment to find out.

### Phase 2 — Audit page generator
Add screenshots and the `/audit/<slug>` page. Generate 20 by hand-picking businesses.

**Success = you would reply to this if you received it.** Be honest with yourself here.

### Phase 3 — Send 20/day manually
New domain, warmed up, Tier A only. Track replies in a spreadsheet if you like — this
phase is about copy, not infrastructure.

**Success = ≥ 3% reply rate.** Below that, automating just breaks things faster. Fix the
copy or the targeting and try again.

### Phase 4 — Automate the pipeline
Supabase, the worker, the dashboard, the approval queue, circuit breakers.

### Phase 5 — Scale carefully
Second mailbox, second vertical, follow-up sequencing, re-audit of Tier C leads after six
months.

**Most people build Phase 4 first, burn their domain in month one, and quit.**

---

## 9. Pick one vertical and one city

"All companies" is unbuildable. You cannot write a good email to "a company."

Good first verticals — high ticket, visual businesses, old websites:

| Vertical | Why it works |
|---|---|
| Dentists / orthodontists | High customer value, care about looking professional, many 2015-era sites |
| HVAC / plumbing / roofing | Emergency searches, mobile-heavy, terrible sites are everywhere |
| Law firms (small) | Budget exists, appearance = credibility |
| Restaurants | Most visual, but lower budget — good for volume, not for $3,200 |
| Med spas / salons | Appearance-obsessed, booking integration sells the upgrade |

Pick one. Build its demo template once, reuse it 200 times, learn what that industry
actually cares about. Narrow always beats broad at the start.

---

## 10. Metrics and kill criteria

Track from day one:

| Metric | Healthy | Kill/fix threshold |
|---|---|---|
| Leads found per city+vertical | 150+ | < 50 — vertical too small |
| Tier A rate | 15–30% | < 5% — scoring too strict |
| Deliverability (inbox, not spam) | > 90% | < 80% — stop sending, fix DNS |
| Open rate | > 40% | < 15% — deliverability problem |
| Reply rate | 3–8% | < 2% — copy or targeting problem |
| Reply → call | > 30% | — |
| Call → sale | > 25% | — |
| Cost per lead | < $0.50 | > $2 — API usage is out of control |

**At 20 sends/day, 5% reply, 30% call, 25% close = roughly 2 clients/month.** At an average
of $1,800 that's $3,600/month plus Care Plan recurring. That is the realistic target — not
500 emails a day.

---

## 11. Open questions

1. **Which vertical and city?** Blocks the demo template and the scoring thresholds.
2. **Outreach domain name?** Needs buying now — warmup takes a month.
3. **Real postal address for email footers?** A PO box is fine. Legally required.
4. **Do you want the audit pages on the main domain or a subdomain?** Main domain gets you
   SEO credit; subdomain isolates risk if something goes wrong.
