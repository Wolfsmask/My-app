# MBOnyx Studio

Static marketing site for MBOnyx Studio, plus five concept builds used as the portfolio.
No build step — Netlify publishes the repo root as-is.

## Structure

```
index.html              Main site (all CSS/JS inline — one request, no waterfall)
privacy.html            Privacy policy (covers outreach data collection)
terms.html              Terms of service
success.html            Netlify form redirect target
404.html                Not-found page
work/*.html             Five standalone concept builds
assets/fonts/           Self-hosted Inter + Playfair (96KB total, latin subset)
assets/work/            Portfolio screenshots (desktop + mobile, WebP)
assets/doc.css          Shared styles for the text pages
assets/og.png           Social share card
tools/                  Screenshot + image-optimisation scripts
netlify.toml            Headers, caching, redirects
```

## Before this goes live

Contact details are real: `mbonyxstudios@gmail.com`, based in Liberty, Missouri, no phone
listed (email and video call only — stated on the site).

**Still outstanding — see [`docs/SETUP-CHECKLIST.md`](docs/SETUP-CHECKLIST.md):**

| Item | Status | Blocks |
|---|---|---|
| Way to accept payment | ❌ Not set up | Every paid project |
| Postal address (PO Box) | ❌ Not set up | Any cold-email outreach — legally required |
| Referral agreement in writing | ❌ Not written | First referral payout |
| Parent co-signature on client contracts | ❌ Not set up | Enforceable client agreements |

There is a `TODO` comment in `index.html` at the footer marking where the postal address
goes once it exists. **Do not publish a home address there.**

Also: **have a lawyer read `privacy.html` and `terms.html`.** They are solid templates,
not legal advice.

## Regenerating portfolio screenshots

After editing any file in `work/`:

```bash
npm install
npm run serve &     # static server on :8899, which the tools load from
npm run shots       # re-screenshot desktop + mobile, then optimise to WebP
```

`tools/og.mjs` regenerates the social share card the same way.

## Checking the site

```bash
npm run serve &
npm run audit       # every check, one command
```

Covers console errors, broken links, mobile overflow, WCAG AA contrast, phone
reading sizes, keyboard accessibility, how different the concept builds
actually are, load performance, and the Netlify form wiring. Each check also
runs on its own from `tools/audit/`.

## Local preview

```bash
npm run serve
# then open http://127.0.0.1:8899
```

Use a real server rather than opening `index.html` directly — the absolute
`/assets/...` paths will not resolve over `file://`.

## Notes on decisions

- **Fonts are self-hosted.** Google Fonts added a third-party DNS lookup plus a
  render-blocking stylesheet. The whole set is now 96KB served from our own origin.
- **The intro animation runs 1.4s, not 3.3s.** Hard to sell "fast" from a hero that
  takes three seconds to assemble.
- **Text selection is enabled.** Visitors need to copy prices and the email address.
- **The concept builds are labelled as concept builds** on every page and in the
  portfolio section. They demonstrate range; they are not claimed as client work.

## Offline preview file

`mbonyx-preview.html` is a single self-contained copy of the whole site — fonts,
screenshots and all nine sub-pages embedded. Double-click it to open in a browser; no
server needed. Clicking a concept build opens it in an overlay with a Desktop/Phone
toggle.

Rebuild it after changing any page:

```bash
npm run preview
```

It is a build artifact and is not committed — regenerate it with
`npm run preview` whenever you want a copy to send. Netlify serves the real
files, not this.
