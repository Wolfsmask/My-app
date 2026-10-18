/**
 * End-to-end: drives a real browser against the fixture sites in this folder.
 * Needs a local server on 8899 serving the repo root, so it skips itself when
 * one is not running rather than failing the whole suite.
 *
 *   python3 -m http.server 8899 &
 *   CHROMIUM_PATH=/path/to/chrome node --test app/test/*.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { auditSite, launchBrowser } from "../src/audit.js";
import { score } from "../src/score.js";

const BASE = "http://127.0.0.1:8899";
const up = await fetch(BASE, { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false);

let browser;
before(async () => { if (up) browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const audit = f => auditSite(`${BASE}/app/test/fixtures/${f}.html`, { browser, allowLocal: true });

test("a 2011 table-layout site is caught on every major signal", { skip: !up && "no server on :8899" }, async () => {
  const a = await audit("bad-2011");
  assert.equal(a.fetchFailed, false);
  assert.equal(a.isResponsive, false, "980px layout on a 390px phone");
  assert.equal(a.hasViewportMeta, false);
  assert.equal(a.copyrightYear, 2018);
  assert.equal(a.platformIsObsolete, true);
  assert.match(a.platform, /FrontPage/);

  const s = score(a);
  // Two core checks cannot run against a fixture: it is served over plain
  // HTTP so there is no certificate, and the test server reports no transfer
  // size. Both are measured on any real site. The audit is scored as it
  // stands, and again with those two filled in the way a real HTTPS site
  // would supply them, because the tier a real site of this quality lands in
  // is the thing worth pinning down.
  assert.ok(s.confidence < 100, "the fixture cannot supply everything");
  assert.equal(s.tier, "A", `as measured over http: ${s.score}`);

  const asLive = score({ ...a, sslValid: false, sslExpiredAt: "2024-03-03", pageWeightBytes: 4.2e6 });
  assert.equal(asLive.confidence, 100);
  assert.ok(asLive.score >= 45, `a real site this bad must be tier A, got ${asLive.score}`);
  assert.equal(asLive.tier, "A");
});

test("a site with a viewport tag but a 900px table is still not responsive", { skip: !up && "no server on :8899" }, async () => {
  // This is the case the innerWidth bug silently passed.
  const a = await audit("half-fixed");
  assert.equal(a.hasViewportMeta, true, "it does declare a viewport");
  assert.ok(a.mobileScreenWidth <= 400, `screen width must be the phone's, got ${a.mobileScreenWidth}`);
  assert.ok(a.mobileScrollWidth > 900, `content really is wider, got ${a.mobileScrollWidth}`);
  assert.equal(a.isResponsive, false, "declaring a viewport is not the same as fitting in one");
  assert.ok(score(a).score > 0);
});

test("a genuinely good site produces no findings", { skip: !up && "no server on :8899" }, async () => {
  const a = await audit("modern");
  assert.equal(a.isResponsive, true);
  assert.equal(a.hasContactAboveFold, true, "the Call button is in the first screen");
  assert.equal(a.platformIsObsolete, false);
  assert.equal(a.copyrightYear, new Date().getFullYear());

  const s = score(a);
  assert.equal(s.score, 0, `a healthy site must score 0, got ${s.score}: ${s.hits.map(h => h.id)}`);
  assert.equal(s.tier, "D");
});

test("a hero CTA counts as contact, whatever the trade calls it", { skip: !up && "no server on :8899" }, async () => {
  /*
    Regression: the href list only knew "contact", "book", "appointment",
    "quote" and "booking", so a restaurant whose hero CTA is Reserve and a gym
    whose hero CTA is Free Week were both reported as having no way to make
    contact above the fold. Both plainly do.
  */
  for (const slug of ["ember-oak", "forge-athletics"]) {
    const a = await auditSite(`${BASE}/work/${slug}.html`, { browser, allowLocal: true });
    assert.equal(a.hasContactAboveFold, true, `${slug} has a conversion CTA in the first screen`);
  }
});

test("a site with no way to make contact above the fold is still caught", { skip: !up && "no server on :8899" }, async () => {
  // The guard on the widened list: it must not become impossible to fail.
  const a = await auditSite(`${BASE}/app/test/fixtures/no-contact.html`, { browser, allowLocal: true });
  assert.equal(a.fetchFailed, false);
  assert.equal(a.hasContactAboveFold, false);
});

test("the five concept builds all pass their own audit", { skip: !up && "no server on :8899" }, async () => {
  for (const slug of ["lumen-dental", "northpoint-hvac", "ember-oak", "meridian-law", "forge-athletics"]) {
    const a = await auditSite(`${BASE}/work/${slug}.html`, { browser, allowLocal: true });
    assert.equal(a.isResponsive, true, `${slug} must be responsive`);
    assert.equal(a.platformIsObsolete, false, `${slug} must not look obsolete`);
    assert.ok(score(a).score < 25, `${slug} must not be a rebuild candidate`);
  }
});

/* ------------------------------------------------- pages that are not leads */

test("an error page is not a lead", { skip: !up && "no server on :8899" }, async () => {
  /*
    Regression: httpStatus was recorded and never acted on, so a 404 scored 52
    and landed in tier B — an error page has no viewport meta and no semantic
    markup, which to the scorer looks exactly like a neglected site.
  */
  const a = await auditSite(`${BASE}/app/test/fixtures/definitely-not-here.html`, { browser, allowLocal: true });
  assert.equal(a.fetchFailed, true);
  assert.match(a.error, /404/);
  assert.equal(a.httpStatus, 404);
});

test("a parked or empty page is not a lead", { skip: !up && "no server on :8899" }, async () => {
  const a = await audit("edge-empty");
  assert.equal(a.fetchFailed, true);
  assert.match(a.error, /empty or parked/);
});

test("small but real pages survive the empty-page guard", { skip: !up && "no server on :8899" }, async () => {
  // Both are close to the threshold and both are real businesses.
  for (const f of ["edge-noviewport-narrow", "edge-noscript-shell"]) {
    const a = await audit(f);
    assert.equal(a.fetchFailed, false, `${f} must not be discarded`);
    assert.ok(a.visibleTextLength >= 60 || a.contentElements >= 2, `${f} has real content`);
  }
});

test("content rendered by JavaScript is seen", { skip: !up && "no server on :8899" }, async () => {
  // The page is an empty shell until a script fills it 700ms in.
  const a = await audit("edge-noscript-shell");
  assert.equal(a.hasContactAboveFold, true, "the phone link is added by script");
  assert.equal(a.copyrightYear, new Date().getFullYear());
});

test("a large catalogue page does not stall the audit", { skip: !up && "no server on :8899" }, async () => {
  const t0 = Date.now();
  const a = await audit("edge-huge-dom");
  const took = Date.now() - t0;
  assert.equal(a.fetchFailed, false);
  assert.ok(took < 25000, `6,000 nodes took ${took}ms — the per-element style loop is too slow`);
});

test("phone-sized things are measured on a phone, not on the desktop it resized to", { skip: !up && "no server on :8899" }, async () => {
  /*
    The layout checks need a desktop-sized window - a narrow column marooned in
    white space is invisible at 390px. Everything else is about phones.

    When the audit resized for the layout pass and did not resize back, font
    sizes and tap targets were read off a 1280px window: this project's own
    site came out at 13.9px body text and was flagged for text too small to
    read on a phone, on a page that is 16px on a phone.

    This fixture is 12px on a desktop and 16px on a phone, so the number it
    reports says which window it was measured in.
  */
  const a = await audit("mobile-sized");
  assert.equal(a.bodyFontSize, 16, `measured at the wrong width: got ${a.bodyFontSize}px`);
  assert.equal(a.textTooSmall, false);
  assert.equal(score(a).hits.find(h => h.id === "text_too_small"), undefined);

  // And the layout pass still got its desktop look in.
  assert.ok(a.contentWidthPct != null, "layout was measured");
});

/* ------------------------------------------------------- how it reads today */

test("no responsive code is not a fault if the page still works on a phone",
  { skip: !up && "no server on :8899" }, async () => {
  /*
    The rule this exists to enforce, in his words: if there is no code to make
    it adjust, but you put it on a phone and it still looks fine and you can
    still use it, do not count it.

    The old check failed any page without a viewport meta tag and gave it the
    heaviest penalty in the scorer - forty points - which is how sites that
    work perfectly well ended up being written to about a problem they do not
    have. This page has no viewport tag, no media query, no flexbox and no
    grid. The browser lays it out at 980px and shrinks it to fit, and because
    the type and the tap targets are large enough to survive that, everything
    is still readable and still tappable.
  */
  const a = await audit("fits-phone-no-viewport");
  assert.equal(a.hasViewportMeta, false, "it really has no responsive code");
  assert.ok(a.mobileZoom < 0.5, `the browser really did shrink it, got ${a.mobileZoom}`);
  assert.ok(a.effectiveBodyPx >= 9, `text still arrives readable, got ${a.effectiveBodyPx}px`);
  assert.equal(a.isResponsive, true, "and so it is not a phone problem");
  assert.equal(score(a).hits.some(h => h.id === "not_responsive"), false);
});

test("an old desktop page on a phone is judged by what a phone really shows",
  { skip: !up && "no server on :8899" }, async () => {
  /*
    No viewport tag, so the phone shrinks a 980px layout to 40%. This used to
    be described as "text arrives at about 5px, too small to read" - worked
    out from the body's base font size. But phones enlarge the main text of
    old desktop pages to keep it legible, and on this page the paragraphs
    really show at about 10px. Small, readable. Saying otherwise is the kind
    of claim an owner disproves by picking up their phone.

    What is true is that the links come out about 6px tall, too small to tap
    without zooming in - so that is what is said, and only that.
  */
  const a = await audit("bad-2011");
  assert.ok(a.effectiveBodyPx >= 9, `the main text, as a phone shows it, is readable: ${a.effectiveBodyPx}px`);
  assert.equal(a.phoneUnreadable, false);
  assert.equal(a.phoneUntappable, true);
  assert.equal(a.phoneConfirmed, true, "and a second, independent look agreed");
  const hit = score(a).hits.find(h => h.id === "not_responsive");
  assert.ok(hit);
  assert.match(hit.evidence, /too small to tap/);
  assert.doesNotMatch(hit.evidence, /main text/, "no claim about the text");
});

test("a desktop page whose text really is unreadable on a phone says so",
  { skip: !up && "no server on :8899" }, async () => {
  // Small type in narrow columns, which phones do not enlarge.
  const a = await audit("phone-tiny-text");
  assert.ok(a.effectiveBodyPx < 6, `got ${a.effectiveBodyPx}px`);
  assert.equal(a.phoneUnreadable, true);
  assert.equal(a.phoneConfirmed, true);
  assert.match(score(a).hits.find(h => h.id === "not_responsive").evidence, /main text shows at about/);
});

/* ------------------------------ sites that work on phones, wrongly accused */

for (const [fixture, why] of [
  ["phone-hidden-overflow", "content that slides in from the side, under overflow-x: hidden - nothing can be dragged into view"],
  ["phone-ua-sniff", "a site that sends phones their own layout - the checker was not saying it was a phone"],
  ["phone-rem-trick", "html { font-size: 62.5% } makes the body 10px while every paragraph is 17px"],
  ["phone-offcanvas-menu", "a menu drawer and a slide-in offer parked past the edge, unclipped - everything a visitor reads still fits"],
]) {
  test(`works on a phone and is not accused of breaking: ${fixture}`, { skip: !up && "no server on :8899" }, async () => {
    /*
      Each of these was reported as broken on phones, and one owner wrote
      back to say their site works fine and to check my device settings.
      They were right. ${why}.
    */
    const a = await audit(fixture);
    assert.equal(a.isResponsive, true, why);
    assert.equal(score(a).hits.some(h => h.id === "not_responsive"), false);
    assert.equal(score(a).hits.some(h => h.id === "text_too_small"), false, "and no small-text claim either");
  });
}

test("one look is never enough: a phone problem the second look cannot see is not claimed",
  { skip: !up && "no server on :8899" }, async () => {
  // Broken as an Android phone, fine as an iPhone. The first look alone would
  // have accused it; the second look overrules.
  const a = await audit("phone-android-only");
  assert.equal(a.phoneConfirmed, false);
  assert.ok(a.phoneOverruled, "and the overruled first look is kept, so it can be checked by hand");
  assert.equal(a.phoneOverruled.firstLook.isResponsive, false);
  assert.equal(a.isResponsive, true);
  assert.equal(score(a).hits.some(h => h.id === "not_responsive"), false);
});

test("a page that genuinely runs off the screen is still caught, and confirmed",
  { skip: !up && "no server on :8899" }, async () => {
  const a = await audit("half-fixed");
  assert.equal(a.isResponsive, false);
  assert.equal(a.phoneConfirmed, true);
  assert.ok(a.mobileCutOff >= 2);
});

test("a modern template that still looks 2014 is worth contacting",
  { skip: !up && "no server on :8899" }, async () => {
  /*
    The case he raised: a real electrical contractor whose site plainly needs
    rebuilding and which the checker scored at nothing.

    Every construction marker the old detector looked for is absent - it is
    responsive, semantic, on current software, with web fonts and flexbox - so
    "looks a decade out of date" never fired and the site fell to the bottom
    tier. What a customer sees is Bootstrap 3, jQuery 1.11, Font Awesome 4,
    Open Sans, 30px headlines and glossy gradient buttons: a 2014 template.
  */
  const a = await audit("template-2014");
  assert.equal(a.isResponsive, true, "it genuinely is fine on a phone");
  assert.equal(a.platformIsObsolete, false, "and genuinely is not obsolete software");
  assert.equal(a.usesWebFonts, true);
  assert.equal(a.usesFlexOrGrid, true);

  assert.ok(a.oldLibraries.length >= 3, `its libraries date it: ${JSON.stringify(a.oldLibraries)}`);
  assert.equal(a.visualDecade, "the early 2010s");

  const s = score(a);
  assert.ok(s.score >= 25, `a site like this must be worth contacting, got ${s.score}`);
  assert.match(s.hits.find(h => h.id === "looks_dated").evidence, /jQuery|Bootstrap|Open Sans/);
});

test("how big the business is, and whether it is still trading, are read off the page",
  { skip: !up && "no server on :8899" }, async () => {
  // A contractor with a careers page, commercial customers and a fleet can pay
  // for a rebuild. A one-page family upholstery shop cannot, and is the one
  // the free offer exists for.
  const big = await audit("template-2014");
  assert.equal(big.business.size, "established");
  assert.equal(big.business.offerFree, false);
  assert.equal(big.vitality.state, "active");

  const tiny = await audit("fits-phone-no-viewport");
  assert.equal(tiny.business.size, "micro");
  assert.equal(tiny.business.offerFree, true);
});

/* ------------------------------------------------------- the smaller faults */

test("a page that keeps you waiting, jumps about and blurs its photos is measured for all three",
  { skip: !up && "no server on :8899" }, async () => {
  /*
    Three faults that only exist in timing, and one that only exists at the
    size the photo is displayed. None of them showed up before: load time
    needed a PageSpeed key so on a normal run it never ran at all, layout
    shift was not looked at, and stretched images were measured by
    structure() and then never scored.
  */
  const a = await audit("slow-and-shifty");

  // The hero lands 2.5s in. A fixed short wait measured this page at 28ms
  // and called the slowest fixture in the set the fastest.
  assert.ok(a.lcpMs > 2000, `the late hero has to be what counts, got ${a.lcpMs}ms`);
  assert.ok(a.layoutShift > 0.25, `the banner shoving the page down, got ${a.layoutShift}`);
  assert.equal(a.stretchedImages, 1, "a 4px image shown at 800px");

  const ids = score(a).hits.map(h => h.id);
  for (const id of ["slow_lcp", "layout_shift", "stretched_images"]) {
    assert.ok(ids.includes(id), `${id} must be among ${JSON.stringify(ids)}`);
  }

  // And none of it is a reason to write on its own: this is an otherwise
  // decent page that is slow, not a rebuild.
  assert.equal(score(a).tier, "C");
});

test("a fast, steady page is not accused of any of it", { skip: !up && "no server on :8899" }, async () => {
  const a = await audit("modern");
  assert.ok(a.lcpMs < 1500, `got ${a.lcpMs}ms`);
  assert.equal(a.layoutShift, 0);
  assert.equal(a.stretchedImages, 0);
  assert.deepEqual(score(a).hits, []);
});

test("the email describes the phone failure this site actually has",
  { skip: !up && "no server on :8899" }, async () => {
  /*
    The rule he set: say they are losing customers who cannot read the text,
    if and only if that is true. "Not responsive" covers two opposite
    symptoms - dragged sideways, or shrunk too small - and the wording used
    to be picked by a hash of the business name, so about half the time the
    letter described the one the owner would not find on their phone.
  */
  const { draftEmail, claimsAreMeasured } = await import("../src/draft.js");

  const shrunk = await audit("bad-2011");
  const a = draftEmail({ business: { name: "Shrunk Co", town: "Liberty, MO" }, ...score(shrunk), audit: shrunk },
    { address: "PO Box 1" });
  assert.match(a.claims, /shrunk|too small|tiny/i);
  assert.doesNotMatch(a.claims, /runs off the side|wider than the screen/i);
  assert.equal(claimsAreMeasured(a, shrunk).ok, true, JSON.stringify(claimsAreMeasured(a, shrunk).unsupported));

  const wide = await audit("half-fixed");
  const b = draftEmail({ business: { name: "Wide Co", town: "Liberty, MO" }, ...score(wide), audit: wide },
    { address: "PO Box 1" });
  assert.match(b.claims, /runs off the side|wider than the screen|off the edge/i);
  assert.equal(claimsAreMeasured(b, wide).ok, true, JSON.stringify(claimsAreMeasured(b, wide).unsupported));
});
