/**
 * Measures one website and returns the raw facts. No judgement here — scoring
 * lives in score.js. This file's only job is to be accurate, because every
 * number it produces may end up quoted in an email to a stranger.
 */

import { chromium } from "playwright";
import tls from "node:tls";
import dns from "node:dns/promises";
import net from "node:net";
import { structure, interpretStructure, detectOldLibraries, visualAge } from "./visual.js";
import { vitality, sizeOf, latestYearIn } from "./business.js";
import { findBusinessEmail, collectEmailsInPage } from "./emails.js";

const UA =
  "Mozilla/5.0 (compatible; MBOnyxAudit/1.0; +https://mbonyx.netlify.app/) " +
  "Chrome/120.0.0.0 Safari/537.36";

/*
  Who the checker says it is, per device.

  It used to announce itself the same way on the phone pass as everywhere
  else - without the words "Mobile", "Android" or "iPhone". Sites that choose
  their layout by asking what device they are talking to (Duda, GoDaddy's
  builder, WordPress mobile plugins, plenty of hand-rolled scripts) handed it
  their desktop layout, it measured that on a phone-sized screen, and it told
  owners their site broke on phones when every real phone got the mobile
  version. One of them wrote back to say so.

  Each still ends with MBOnyxAudit and the contact address, so nobody is
  misled about who is visiting; the front of it says which device is being
  imitated, because that is what decides which page a site sends.
*/
const TAG = " MBOnyxAudit/1.0 (+https://mbonyx.netlify.app/)";
export const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36" + TAG;
export const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" + TAG;
export const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" + TAG;

/**
 * Refuses to fetch anything on the local machine or a private network.
 *
 * The URLs audited here come from Google Places and OpenStreetMap — data
 * anybody can edit. A listing whose "website" is http://169.254.169.254/ or
 * http://192.168.1.1/ would otherwise have this tool fetch it, screenshot it,
 * and put the result in a report. Harmless on a laptop, not harmless once this
 * runs on a server, which is where the plan takes it.
 *
 * Local targets are allowed only when explicitly opted in, which is what the
 * fixtures and the demo do.
 */
export async function assertPublicTarget(hostname, { allowLocal = false } = {}) {
  if (allowLocal) return;

  const isPrivate = ip => {
    if (net.isIPv4(ip)) {
      const [a, b] = ip.split(".").map(Number);
      return a === 10 || a === 127 || a === 0 ||
             (a === 172 && b >= 16 && b <= 31) ||
             (a === 192 && b === 168) ||
             (a === 169 && b === 254) ||
             (a === 100 && b >= 64 && b <= 127) ||
             a >= 224;
    }
    const v = ip.toLowerCase();
    return v === "::1" || v === "::" || v.startsWith("fe80") ||
           v.startsWith("fc") || v.startsWith("fd") ||
           v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") ||
           v.startsWith("::ffff:192.168.");
  };

  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(hostname)) {
    throw new Error(`refusing to audit a local address: ${hostname}`);
  }
  if (net.isIP(hostname) && isPrivate(hostname)) {
    throw new Error(`refusing to audit a private address: ${hostname}`);
  }

  let addrs;
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    return; // let the page load fail with its own, clearer error
  }
  const bad = addrs.find(a => isPrivate(a.address));
  if (bad) throw new Error(`refusing to audit ${hostname}: resolves to a private address (${bad.address})`);
}

/** Signatures for platforms that cannot be made fast or secure. */
const OBSOLETE = [
  { re: /<object[^>]+application\/x-shockwave-flash|\.swf["']/i, name: "Adobe Flash (discontinued 2020)" },
  { re: /content=["']Microsoft FrontPage/i,                      name: "Microsoft FrontPage" },
  { re: /generator["'][^>]*WordPress\s*([1-4]\.\d+)/i,           name: "an unsupported WordPress version" },
  { re: /<table[^>]*>[\s\S]{0,4000}<table[^>]*>[\s\S]{0,4000}<table/i, name: "a table-based layout (pre-2010 technique)" },
  { re: /wix\.com\/free-website|weebly\.com\/free|"freeSiteBanner"/i,  name: "a free website-builder tier (with their ads on your page)" },
  { re: /generator["'][^>]*Joomla!?\s*[12]\./i,                  name: "an unsupported Joomla version" },
];

/** Friendlier names, used only to say what a site is built on. */
const PLATFORMS = [
  { re: /wp-content|wp-includes/i, name: "WordPress" },
  { re: /cdn\.shopify\.com/i,      name: "Shopify" },
  { re: /static\.wixstatic\.com/i, name: "Wix" },
  { re: /squarespace/i,            name: "Squarespace" },
  { re: /weebly/i,                 name: "Weebly" },
  { re: /godaddysites\.com/i,      name: "GoDaddy Website Builder" },
];

/**
 * TLS certificate check. A browser will happily render a page whose cert is
 * about to expire, so this asks the socket directly.
 */
export async function checkCertificate(hostname, timeoutMs = 10000) {
  return new Promise(resolve => {
    let settled = false;
    const done = v => { if (!settled) { settled = true; resolve(v); } };

    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, timeout: timeoutMs },
      () => {
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        const expiresAt = cert?.valid_to ? new Date(cert.valid_to) : null;
        socket.end();
        done({
          valid: authorized && (!expiresAt || expiresAt > new Date()),
          expiresAt,
          daysLeft: expiresAt ? Math.round((expiresAt - Date.now()) / 86400000) : null,
          error: authorized ? null : socket.authorizationError?.toString() ?? "not authorized",
        });
      }
    );

    socket.on("error", e => done({ valid: false, expiresAt: null, daysLeft: null, error: e.message }));
    socket.on("timeout", () => { socket.destroy(); done({ valid: false, expiresAt: null, daysLeft: null, error: "timeout" }); });
  });
}

/** Pulls the most recent 4-digit year out of any copyright notice on the page. */
export function findCopyrightYear(text) {
  const years = [];
  const patterns = [
    /(?:©|&copy;|\(c\)|copyright)\s*(?:20\d{2}\s*[-–—]\s*)?(20\d{2})/gi,
    /(20\d{2})\s*(?:©|&copy;)/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const y = parseInt(m[1], 10);
      if (y >= 1995 && y <= new Date().getFullYear() + 1) years.push(y);
    }
  }
  return years.length ? Math.max(...years) : null;
}

export function detectPlatform(html, headers = {}) {
  const hay = html + "\n" + JSON.stringify(headers);
  for (const p of OBSOLETE) {
    if (p.re.test(hay)) return { platform: p.name, obsolete: true };
  }
  for (const p of PLATFORMS) {
    if (p.re.test(hay)) return { platform: p.name, obsolete: false };
  }
  return { platform: "custom or unknown", obsolete: false };
}

/**
 * Audits one site. Shares a browser across calls so a run of 50 sites does not
 * pay browser startup 50 times.
 */
// The address picker lives with the rest of the email finding; re-exported
// here because this is where callers have always imported it from.
export { pickBusinessEmail } from "./emails.js";

/**
 * What a phone visitor actually gets. Runs inside the page, on both phone
 * passes, so the second look measures exactly what the first did.
 *
 * Every number here is something a person holding the phone would notice:
 *
 *   maxScrollX  How far the page can actually be dragged sideways. Asked by
 *               trying to scroll, not worked out from widths: a page's width
 *               counts content that overflow-x: hidden has clipped away, and
 *               reading the width reported "drag sideways to read" on pages
 *               that cannot be dragged an inch - every template that slides
 *               content in from the side on scroll.
 *   textPx      The size of the text people read, after the phone's own
 *               enlarging. Phones blow up the main text on old desktop pages
 *               so it stays legible; the body's base font size ignores that,
 *               and reading it claimed 5px text on pages showing 10px. Also
 *               immune to html { font-size: 62.5% }, which makes the body
 *               10px on sites whose paragraphs are all 17px.
 *   tapPx       How tall the links and buttons are.
 *   zoom        How far the browser shrank the page to fit the screen.
 */
function measurePhone() {
  const vv = window.visualViewport;
  const zoom = vv ? vv.scale : 1;
  const screenWidth = Math.round(vv ? vv.width : window.innerWidth);

  const visible = el => {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // Text people read: leaf elements with a sentence's worth in them,
  // weighted by how much text each holds.
  const samples = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.childElementCount || /^(SCRIPT|STYLE|NOSCRIPT|SVG)$/.test(el.tagName)) continue;
    const t = (el.textContent || "").trim();
    if (t.length < 25 || !visible(el)) continue;
    samples.push({ px: parseFloat(getComputedStyle(el).fontSize), n: t.length });
  }
  samples.sort((a, b) => a.px - b.px);
  let textPx = null;
  const total = samples.reduce((a, s) => a + s.n, 0);
  for (let i = 0, acc = 0; i < samples.length; i++) {
    acc += samples[i].n;
    if (acc >= total / 2) { textPx = Math.round(samples[i].px * 10) / 10; break; }
  }

  const taps = [...document.querySelectorAll("a[href],button,input,select")]
    .filter(visible).map(el => el.getBoundingClientRect().height).sort((a, b) => a - b);
  const tapPx = taps.length ? Math.round(taps[Math.floor(taps.length / 2)]) : null;

  /*
    Words and buttons that sit past the right-hand edge of the screen and can
    only be reached by dragging the page sideways. That is the claim the
    letter makes, so it is the thing measured - element by element - rather
    than the page's width.

    The page's width was the old measure, and it is wrong both ways. It
    counts content that overflow-x: hidden has clipped away, which no visitor
    can drag into view; and the browser reports a page that genuinely runs
    off the screen and a page that is safely clipped with exactly the same
    widths. So:
      - only text and things you press count, not decoration;
      - anything inside a clipped or scrolling box is excluded: a carousel's
        next slide or a scrollable table is meant to be there, and something
        clipped cannot be dragged into view anyway;
      - anything fixed to the screen is excluded: slide-out menus, chat
        bubbles and cookie bars park themselves off the edge on purpose;
      - anything hidden from screen readers is excluded, likewise;
      - anything sitting wholly past the edge inside a menu, or moved there
        by a transform, is excluded: that is a menu drawer or a slide-in
        waiting to be opened, not page content cut off. On a page with no
        clipping it does let the page wobble sideways, but everything a
        visitor reads still fits, and the letter would say otherwise.
  */
  const clipped = el => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const st = getComputedStyle(p);
      if (/^(auto|scroll|hidden|clip)$/.test(st.overflowX) || /paint|strict|content/.test(st.contain || "")) return true;
    }
    return false;
  };
  const parked = el => {
    for (let p = el; p; p = p.parentElement) {
      const st = getComputedStyle(p);
      if (st.position === "fixed" || st.position === "sticky") return true;
      if (p.getAttribute && (p.getAttribute("aria-hidden") === "true" || p.hasAttribute("inert"))) return true;
    }
    return false;
  };
  const MENU = 'nav, [role="navigation"], [role="dialog"], [class*="menu" i], [id*="menu" i], [class*="drawer" i], '
    + '[class*="canvas" i], [class*="sidebar" i], [class*="slideout" i], [class*="mobile-nav" i], [class*="flyout" i]';
  const offStage = (el, r) => {
    if (r.left < screenWidth - 4) return false;
    if (el.closest(MENU)) return true;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const tf = getComputedStyle(p).transform;
      if (tf && tf !== "none") return true;
    }
    return false;
  };
  const off = [];
  let reachRight = screenWidth;
  for (const el of document.querySelectorAll("body *")) {
    const isControl = /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
    const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim().length > 1);
    if (!isControl && !ownText) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.right <= screenWidth + 8) continue;
    if (!visible(el) || clipped(el) || parked(el) || offStage(el, r)) continue;
    off.push({ tag: el.tagName.toLowerCase(), over: Math.round(r.right - screenWidth) });
    reachRight = Math.max(reachRight, Math.round(r.right));
  }
  off.sort((a, b) => b.over - a.over);

  return {
    zoom: Math.round(zoom * 1000) / 1000,
    screenWidth,
    maxScrollX: reachRight - screenWidth,
    textPx,
    tapPx,
    cutOffCount: Math.min(off.length, 40),
    cutOffWorstPx: off.length ? off[0].over : 0,
    cutOffSample: off.slice(0, 4).map(o => o.tag),
    hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
  };
}

/**
 * Scrolls down the page and back, the way a visitor would, so slide-in
 * animations and lazily-built sections finish before anything is measured.
 *
 * At most two dozen stops, spread over the whole height. A stop per
 * screenful took 32 seconds on a 360,000px catalogue page, and ran twice.
 */
async function scrollThrough() {
  const h = document.body ? document.body.scrollHeight : 0;
  const stops = Math.min(24, Math.max(1, Math.ceil(h / Math.max(300, innerHeight * 0.8))));
  for (let i = 1; i <= stops; i++) {
    window.scrollTo(0, Math.round((h * i) / stops));
    await new Promise(r => setTimeout(r, 50));
  }
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 300));
}

/**
 * Turns a phone measurement into a verdict. Pure, so it can be tested
 * without a browser.
 *
 * Two different failures, graded separately and never added together:
 *
 *   It overflows: the visitor can drag the page sideways by at least a tenth
 *   of the screen. Below that it is a stray margin nobody notices.
 *
 *   It is shrunk: the browser shrank a desktop layout to fit (zoom under
 *   0.9), and the result is genuinely hard to use - the text people read
 *   lands under 9px, or the links under 20px tall. A page that is shrunk but
 *   still readable and tappable is not called broken: the owner looks at it
 *   on their phone, it works, and the letter would be wrong.
 */
export function phoneVerdict(m) {
  if (!m) return {};
  const ramp = (v, from, to) => Math.max(0, Math.min(1, (v - from) / (to - from)));
  const overflowPct = m.screenWidth ? Math.round((m.maxScrollX / m.screenWidth) * 100) : 0;
  const shrunkPage = m.zoom < 0.9;
  const effText = m.textPx == null ? null : Math.round(m.textPx * m.zoom * 10) / 10;
  const effTap = m.tapPx == null ? null : Math.round(m.tapPx * m.zoom);

  /*
    Overflowing means at least two separate bits of text or buttons out past
    the edge, reaching at least a tenth of a screen further. One stray word
    or a button 20px over is not "drag the page around to read it".
  */
  const cutOff = m.cutOffCount;
  let broken = 0;
  const overflows = overflowPct >= 10 && cutOff >= 2;
  if (overflows) broken = 0.5 + 0.5 * Math.max(ramp(overflowPct, 10, 100), ramp(cutOff, 2, 12));

  let shrunk = 0;
  const unreadable = shrunkPage && effText != null && effText < 9;
  const untappable = shrunkPage && effTap != null && effTap < 20;
  if (unreadable) shrunk = 0.5 + 0.5 * ramp(9 - effText, 0, 4);
  if (untappable) shrunk = Math.max(shrunk, 0.4 + 0.3 * ramp(20 - effTap, 0, 12));

  const severity = Math.round(Math.max(broken, shrunk) * 100) / 100;
  return {
    mobileScreenWidth: m.screenWidth,
    mobileScrollWidth: m.screenWidth + m.maxScrollX,
    mobileOverflowPct: overflows ? overflowPct : 0,
    mobileCutOff: overflows ? cutOff : 0,
    mobileCutOffWorstPx: overflows ? m.cutOffWorstPx : 0,
    mobileCutOffSample: overflows ? m.cutOffSample : [],
    mobileZoom: m.zoom,
    mainTextPx: m.textPx,
    effectiveBodyPx: effText,
    effectiveTapPx: effTap,
    phoneUnreadable: unreadable,
    phoneUntappable: untappable,
    notResponsiveSeverity: severity,
    notResponsiveSignals: [overflows, overflows && cutOff >= 3, unreadable, untappable].filter(Boolean).length,
    isResponsive: severity === 0,
    hasViewportMeta: m.hasViewportMeta,
  };
}

/** A fresh load, settled the way a person's visit settles, then measured. */
async function loadAndMeasure(browser, target, contextOptions, { timeoutMs = 30000, measure = measurePhone, settleMs = 2000, extra = null } = {}) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, ...contextOptions });
  try {
    const page = await context.newPage();
    const resp = await page.goto(target, { waitUntil: "load", timeout: timeoutMs });
    if (resp && resp.status() >= 400) return null;
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
    // Scroll to the bottom and back: plenty of pages finish laying out, and
    // load their footers, only once they are scrolled.
    await page.evaluate(scrollThrough).catch(() => {});
    await page.waitForTimeout(settleMs);
    const m = await page.evaluate(measure);
    return extra ? { ...m, ...(await extra(page)) } : m;
  } catch {
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * The second look, before anyone is told their site breaks on a phone.
 *
 * A fresh load in a new browser context, as an iPhone this time, given
 * longer to settle and scrolled through first. The phone problem stands only
 * if this look agrees. If it does not, or the page will not load a second
 * time, nothing is claimed: telling an owner something about their own site
 * that they can disprove by picking up their phone is the worst thing this
 * tool can do.
 */
export async function confirmPhone(browser, target, { timeoutMs = 30000 } = {}) {
  const m = await loadAndMeasure(browser, target, {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA,
  }, { timeoutMs, settleMs: 1500 });
  return m ? phoneVerdict(m) : null;
}

/**
 * How the page is laid out, as opposed to how old its code is.
 *
 * Run inside the page, and run twice: once with everything else at phone
 * width, then again on a desktop-sized screen, because that is where a
 * badly arranged page shows. A site built this year on a modern builder can
 * still be a near-empty first screen with a narrow column of text and a
 * stock-photo carousel, and none of that shows up in fonts or flexbox.
 */
function measureLayout() {
  const doc = document.documentElement;
  const fold = window.innerHeight;

  return {
    // Coverage of the first screen, sampled rather than computed from boxes:
    // overlapping elements make area arithmetic wrong, and asking "is there
    // anything at this point" is exactly the question.
    emptyFirstScreen: (() => {
      const cols = 12, rows = 8;
      let empty = 0, total = 0;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const x = ((c + 0.5) / cols) * window.innerWidth;
          const y = ((r + 0.5) / rows) * fold;
          total++;
          const el = document.elementFromPoint(x, y);
          if (!el || el === document.body || el === doc) { empty++; continue; }
          // An element with no text, no background and no picture is a
          // spacer, not content.
          const st = getComputedStyle(el);
          const hasInk = (el.innerText || "").trim().length > 0
            || (st.backgroundImage && st.backgroundImage !== "none")
            || /IMG|SVG|VIDEO|CANVAS/.test(el.tagName)
            || (st.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(st.backgroundColor)
                && el !== document.body);
          if (!hasInk) empty++;
        }
      }
      return total ? Math.round((empty / total) * 100) : null;
    })(),

    // How much of the width the content actually uses. A column taking a
    // third of a wide page is the "marooned in white" look.
    contentWidthPct: (() => {
      const w = window.innerWidth;
      if (!w) return null;
      let left = Infinity, right = -Infinity;
      for (const el of document.querySelectorAll("p,h1,h2,h3,li,img,table,section,article")) {
        const t = (el.innerText || "").trim();
        if (!t && el.tagName !== "IMG") continue;
        const r = el.getBoundingClientRect();
        if (r.width < 12 || r.height < 8 || r.width > w * 1.5) continue;
        if (r.top > fold * 3) continue;
        left = Math.min(left, r.left);
        right = Math.max(right, r.right);
      }
      if (!isFinite(left) || right <= left) return null;
      return Math.round(Math.min(100, ((right - left) / w) * 100));
    })(),

    // A rotating banner of pictures. Fashionable around 2012, and every study
    // since says people ignore them.
    hasCarousel: !!document.querySelector(
      '.carousel,.slider,.slideshow,.swiper,.slick-slider,.owl-carousel,.flexslider,' +
      '[class*="carousel" i],[class*="slideshow" i],[data-slick],[data-swiper]'),

    // "Home | Menu | Our Story | Contact Us" - a text row with pipes between
    // it, which is how navigation was written before menus.
    pipeNav: [...document.querySelectorAll("nav,header,#nav,.nav,.menu")]
      .some(n => /\S\s*\|\s*\S/.test((n.innerText || "").slice(0, 400))),

    /*
      Markers of when the design was fashionable, as opposed to when the code
      was written.

      The old dated-design test only looked at construction: system fonts, no
      flexbox, table layout. That catches a site built in 2005 and says nothing
      at all about the far more common case - a template bought in 2014, on
      current software, with web fonts and a grid, that still looks 2014. Those
      came out at zero findings and sat in the bottom tier forever.

      Measured on the desktop pass, because that is the screen a design is
      composed for.
    */
    // Display type got much bigger around 2016. A headline under 34px on a
    // 1280px screen is a small-type era layout.
    biggestHeadingPx: (() => {
      let biggest = 0;
      for (const h of document.querySelectorAll("h1,h2,.hero h1,.hero h2,[class*='title' i],[class*='headline' i]")) {
        const r = h.getBoundingClientRect();
        if (r.top > window.innerHeight * 1.2 || !(h.innerText || "").trim()) continue;
        biggest = Math.max(biggest, parseFloat(getComputedStyle(h).fontSize) || 0);
      }
      return biggest ? Math.round(biggest) : null;
    })(),

    // Glossy gradients, bevels and text shadows: the house style of roughly
    // 2008-2014, and almost never used deliberately since.
    chromeStyling: (() => {
      let glossy = 0, looked = 0;
      const candidates = [...document.querySelectorAll("a.button,button,.btn,[class*='button' i],nav a,header a,h1,h2")].slice(0, 60);
      for (const el of candidates) {
        const st = getComputedStyle(el);
        looked++;
        if (/linear-gradient/.test(st.backgroundImage)) glossy++;
        else if (st.textShadow && st.textShadow !== "none") glossy++;
        else if (/inset/.test(st.boxShadow || "")) glossy++;
      }
      return looked >= 6 ? Math.round((glossy / looked) * 100) : null;
    })(),

    // Whitespace between sections roughly doubled over the 2010s. Under 40px
    // of breathing room reads as a cramped, older page.
    sectionRhythmPx: (() => {
      const pads = [];
      for (const el of document.querySelectorAll("section,.section,main > div,[class*='row' i]")) {
        const r = el.getBoundingClientRect();
        if (r.width < window.innerWidth * 0.6 || r.height < 80) continue;
        const st = getComputedStyle(el);
        pads.push((parseFloat(st.paddingTop) || 0) + (parseFloat(st.paddingBottom) || 0));
        if (pads.length >= 12) break;
      }
      if (pads.length < 3) return null;
      pads.sort((a, b) => a - b);
      return Math.round(pads[Math.floor(pads.length / 2)]);
    })(),

    // The body font, which dates a design more reliably than almost anything
    // else: Open Sans and Lato were everywhere from 2011 to 2015.
    bodyFontName: (() => {
      const f = document.body ? getComputedStyle(document.body).fontFamily : "";
      return (f || "").split(",")[0].replace(/["']/g, "").trim().slice(0, 40);
    })(),
  };
}

export async function auditSite(url, { browser, timeoutMs = 30000, screenshotPath = null, allowLocal = false } = {}) {
  const out = {
    url,
    auditedAt: new Date().toISOString(),
    fetchFailed: false,
    error: null,
  };

  const owned = !browser;
  browser = browser || (await launchBrowser());

  let context;
  try {
    const target = url.startsWith("http") ? url : `https://${url}`;
    const hostname = new URL(target).hostname;
    await assertPublicTarget(hostname, { allowLocal });

    // --- Certificate, asked of the socket rather than the browser ----------
    // Local fixtures are served over plain HTTP and have no certificate. That
    // is a property of the test harness, not of the site, so the check is
    // recorded as "did not run" instead of handing every fixture 15 points.
    const isLocal = allowLocal || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname) || hostname.endsWith(".local");
    if (isLocal) {
      out.sslValid = null;
      out.sslDaysLeft = null;
      out.sslExpiredAt = null;
    } else {
      const cert = await checkCertificate(hostname);
      out.sslValid = cert.valid;
      out.sslDaysLeft = cert.daysLeft;
      out.sslExpiredAt = cert.expiresAt && cert.expiresAt < new Date()
        ? cert.expiresAt.toISOString().slice(0, 10)
        : null;
    }

    // --- Render on a phone. This is where "not responsive" is proven. ------
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: PHONE_UA,
      ignoreHTTPSErrors: true, // we already recorded the cert state above
    });
    const page = await context.newPage();

    /*
      How long before anything worth looking at is on the screen.

      This used to need a PageSpeed API key, so on a normal run it never ran
      at all and load time counted for nothing. The browser already knows:
      Largest Contentful Paint is the moment the biggest thing on the first
      screen finishes drawing, which is as close as a number gets to "the
      page looks ready". It has to be observed before the paint happens -
      reading performance.getEntriesByType afterwards returns an empty list
      and silently reports zero - so it is installed before navigation.

      Also collected: layout shift, which is the measure of things jumping
      around under your thumb while it loads.
    */
    await context.addInitScript(() => {
      window.__lcpMs = null;
      window.__cls = 0;
      try {
        new PerformanceObserver(list => {
          for (const e of list.getEntries()) window.__lcpMs = Math.round(e.startTime);
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver(list => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
        }).observe({ type: "layout-shift", buffered: true });
      } catch { /* an older engine; left unmeasured rather than guessed at */ }
    });

    let bytes = 0;
    const imageTypes = new Set();
    // Plain-HTTP files pulled into a secure page. Chrome blocks scripts and
    // stylesheets loaded this way outright and strips the padlock, so a site
    // can be on HTTPS with a valid certificate and still look unsafe.
    const insecure = new Set();
    page.on("response", async res => {
      const len = parseInt(res.headers()["content-length"] || "0", 10);
      if (len) bytes += len;
      const ct = res.headers()["content-type"] || "";
      if (ct.startsWith("image/")) imageTypes.add(ct.split(";")[0].trim());
      const url = res.url();
      if (url.startsWith("http://") && insecure.size < 25) insecure.add(url);
    });

    const resp = await page.goto(target, { waitUntil: "load", timeout: timeoutMs });
    out.httpStatus = resp?.status() ?? null;
    out.finalUrl = page.url();

    /*
      An error page is not a website that needs rebuilding.
      The status was recorded here but never acted on, so a 404 scored 52 and
      landed in tier B — an error page has no viewport meta and no semantic
      markup, which reads to the scorer exactly like a neglected site. Emailing
      someone about a page that does not exist proves you never looked.
    */
    if (out.httpStatus >= 400) {
      out.fetchFailed = true;
      out.error = `server returned ${out.httpStatus}`;
      return out;
    }

    /*
      Wait for the page to stop painting, rather than for a fixed moment.

      A flat 1200ms wait under-reported the exact sites worth knowing about:
      anything whose hero image or slider lands at two and a half seconds had
      already been measured and written down as fast. Waiting 4s on every site
      instead would add over an hour to a two-thousand-site night for no gain,
      since most pages are done in well under one.

      A "has it been quiet for a moment" test on its own does not work, and
      it is worth saying why: a page whose text paints instantly and whose
      hero arrives at 2.5s is quiet at 900ms, so the check passes and records
      28ms for a page that is visibly blank for two and a half seconds. There
      is no signal that distinguishes "finished" from "about to paint again".

      So the floor is 2.6s, which covers the sliders and hero images that
      cause this, and after that it waits for 600ms of quiet up to a 4s
      ceiling. The cost is about 1.4s a site over the old fixed wait - call it
      half an hour across a two-thousand-site night, on two workers - to stop
      recording the slowest sites as the fastest.
    */
    await page.waitForTimeout(2600);
    await page.waitForFunction(() => {
      const now = performance.now();
      // Nothing has painted at all yet: give it until the ceiling.
      if (window.__lcpMs == null) return now > 3800;
      return now - window.__lcpMs > 600;
    }, null, { timeout: 1400 }).catch(() => { /* still busy at the ceiling */ });

    /*
      Read before anything else touches the page.

      Everything after this resizes the window twice, and a resize repaints,
      which Chrome records as a fresh Largest Contentful Paint. Read late, the
      number would be "how long until the page settled after we poked it"
      rather than how long a visitor waited.
    */
    const timing = await page.evaluate(() => ({
      lcpMs: window.__lcpMs,
      cls: window.__cls == null ? null : Math.round(window.__cls * 1000) / 1000,
      domContentLoaded: Math.round(performance.timing
        ? performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart
        : 0) || null,
    })).catch(() => ({}));
    out.lcpMs = timing.lcpMs ?? null;
    out.layoutShift = timing.cls ?? null;

    const html = await page.content();
    const headers = resp?.headers() ?? {};

    const measured = await page.evaluate(() => {
      const doc = document.documentElement;

      /*
        The screen width must come from visualViewport, not innerWidth or
        clientWidth. Both of those are the *layout* viewport, which stretches
        to fit overflowing content — on a page 940px wide they both report 940,
        so the comparison always passes and no broken layout is ever detected.
        visualViewport.width is the physical screen, which is what the visitor
        is actually looking at.
      */
      const screenWidth = Math.round(window.visualViewport?.width ?? window.innerWidth);

      /*
        How far the browser had to zoom out to fit the page on the screen.

        A page with no viewport meta tag is laid out at 980px and then scaled
        down to the phone's width - here, 0.4. Nothing overflows, because the
        layout viewport grew to match; the page is simply rendered at 40% size,
        so 17px text arrives as 7px. Measuring only overflow missed that
        entirely, and it is the commonest way an old site fails on a phone.
      */
      const zoom = window.visualViewport?.scale ?? 1;
      const physicalWidth = window.screen?.width || screenWidth;

      // "Above the fold" = the first screen a visitor sees without scrolling.
      const fold = window.innerHeight;
      /*
        "Can a visitor reach you from the first screen." The href list has to
        cover how each trade actually words its conversion action — a
        restaurant says Reserve, a gym says Free Trial, a contractor says Get a
        Quote. The narrow version of this list flagged two well-built sites
        whose whole hero is a booking CTA, purely because neither used the word
        "contact".
      */
      const contactHrefs = ['tel:', 'mailto:', 'contact', 'book', 'appointment',
        'quote', 'booking', 'reserve', 'reservation', 'trial', 'schedule',
        'estimate', 'consult', 'enquir', 'inquir', 'visit', 'find-us', 'order'];
      const contactSelectors = ['form', 'input[type="tel"]', 'input[type="email"]']
        .concat(contactHrefs.map(h => `a[href*="${h}" i]`)).join(",");
      const contactWords = /\b(call|contact|book|quote|appointment|schedule|get in touch|reserve|enquire|inquire|free trial|free week|get started|order)\b/i;

      const contactable = [...document.querySelectorAll(contactSelectors + ",button")]
        .some(el => {
          const r = el.getBoundingClientRect();
          const visible = r.top < fold && r.bottom > 0 && r.width > 0 && r.height > 0;
          if (!visible) return false;
          // A bare <button> only counts if its wording is actually about contact.
          if (el.tagName === "BUTTON") return contactWords.test(el.innerText || "");
          return true;
        });

      return {
        hasContactAboveFold: contactable,
        brokenImages: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
        imageCount: document.images.length,
        linkCount: document.querySelectorAll("a[href]").length,
        headings: document.querySelectorAll("h1,h2,h3").length,
        text: (document.body ? document.body.innerText : "").slice(0, 20000),
        links: [...document.querySelectorAll("a[href]")]
          .map(a => a.href)
          .filter(h => h.startsWith("http"))
          .slice(0, 25),
        title: document.title,

      };
    });

    /*
      Does the page work on a phone - measured, then confirmed.

      The first look is this load. If it says the page breaks on a phone, a
      second, independent look must agree before anything is claimed: a fresh
      load as an iPhone, given longer and scrolled through. See confirmPhone
      for why the bar is that high.
    */
    // Scrolled through first, as a visitor would: slide-in animations and
    // lazy layouts finish only once their part of the page has been seen.
    await page.evaluate(scrollThrough).catch(() => {});
    const firstLook = phoneVerdict(await page.evaluate(measurePhone));
    Object.assign(out, firstLook);
    out.phoneCheckVersion = 2;
    if (!firstLook.isResponsive) {
      const second = await confirmPhone(browser, out.finalUrl || target, { timeoutMs });
      if (second && !second.isResponsive) {
        // Both looks agree. Report the milder of the two, so every number in
        // the letter is one both looks would stand behind.
        Object.assign(out, second.notResponsiveSeverity < firstLook.notResponsiveSeverity ? second : firstLook);
        out.phoneConfirmed = true;
      } else {
        // Overruled, or could not be checked a second time: nothing claimed.
        Object.assign(out, second ?? {}, { isResponsive: true, notResponsiveSeverity: 0, notResponsiveSignals: 0 });
        out.phoneConfirmed = false;
        out.phoneOverruled = { firstLook, secondLook: second ?? "could not load a second time" };
      }
    }
    out.hasContactAboveFold = measured.hasContactAboveFold;
    out.brokenImages = measured.brokenImages;
    out.title = measured.title;

    /*
      A parked domain, a holding page or an empty shell is not a lead either.
      An empty <body> has no viewport tag and no semantic markup, so it scored
      56 — higher than a real business whose site is merely dated.

      The threshold is set from measurement, not instinct. Across the fixtures,
      a parked page has 0 characters and 0 headings/links/images; the smallest
      genuinely real page has 90 characters and 2. The line sits between them
      with room to spare, and deliberately errs towards keeping a lead: a small
      real business wrongly discarded is invisible, whereas a parked domain
      reaching the report is something a human notices and skips.
    */
    out.visibleTextLength = (measured.text || "").trim().length;
    out.contentElements = (measured.headings ?? 0) + measured.imageCount + (measured.linkCount ?? 0);
    if (out.visibleTextLength < 60 && out.contentElements < 2) {
      out.fetchFailed = true;
      out.error = "page is empty or parked — nothing to rebuild";
      return out;
    }


    /*
      Layout is judged on a desktop screen, not the phone one everything else
      is measured on.

      The whole page is audited at 390px wide, which is right for "can you
      read this on a phone" and wrong for "is this well laid out". A column of
      text 300px wide fills a phone and looks fine; on a 1280px monitor the
      same column is marooned in white space with the page two-thirds empty
      either side. Measured at phone width the content-width signal came back
      100% on a page that was plainly badly laid out, so it never fired at all.
    */
    /*
      Measured from a separate load as a desktop browser, not by stretching
      the phone page to 1280px.

      Stretching the phone page meant a site that sends phones a different
      layout was judged on its phone layout at desktop width - a narrow
      column marooned in white, "badly laid out" - and it needed the window
      put back afterwards, which once went wrong and measured every phone
      number on a desktop. A desktop's own load gets the desktop's own page.
    */
    // The same load also reads the desktop page's email addresses: some
    // sites leave the address out of their phone version, and this saves
    // loading the desktop page a second time just to look.
    const layout = await loadAndMeasure(browser, out.finalUrl || target, {
      viewport: { width: 1280, height: 900 }, userAgent: DESKTOP_UA,
    }, {
      timeoutMs, measure: measureLayout, settleMs: 600,
      extra: async p => ({ desktopEmails: await p.evaluate(collectEmailsInPage).catch(() => null), desktopUrl: p.url() }),
    }) ?? {};

    out.emptyFirstScreen = layout.emptyFirstScreen;
    out.contentWidthPct = layout.contentWidthPct;
    out.hasCarousel = layout.hasCarousel;
    out.pipeNav = layout.pipeNav;
    out.poorLayoutSignals = [
      layout.emptyFirstScreen != null && layout.emptyFirstScreen >= 60,
      layout.contentWidthPct != null && layout.contentWidthPct <= 55,
      layout.hasCarousel === true,
      layout.pipeNav === true,
    ].filter(Boolean).length;
    out.poorLayout = out.poorLayoutSignals >= 2;

    out.copyrightYear = findCopyrightYear(measured.text + " " + html);

    /*
      Is anybody still running this business, and could they pay for a rebuild?

      Both are read off the homepage text that was already fetched, so they
      cost nothing. They are kept out of the score on purpose: a dead business
      and a struggling one are not "worse websites", they are different
      answers to "should this person get an email at all", and that decision
      belongs to a person looking at the card.
    */
    out.latestYearOnPage = latestYearIn(measured.text || "");
    out.vitality = vitality({
      text: measured.text || "",
      copyrightYear: out.copyrightYear,
      latestYearOnPage: out.latestYearOnPage,
    });

    // Pages of their own they link to, as a rough measure of how much site
    // there is. Off-site links are already filtered out of measured.links.
    const ownHost = (() => { try { return new URL(out.finalUrl || target).hostname; } catch { return hostname; } })();
    const ownPages = new Set();
    for (const href of measured.links || []) {
      try {
        const u = new URL(href);
        if (u.hostname !== ownHost) continue;
        const path = u.pathname.replace(/\/+$/, "");
        if (path && path !== "/index.html") ownPages.add(path);
      } catch { /* not a URL we can read */ }
    }
    out.ownPageCount = ownPages.size;

    const plat = detectPlatform(html, headers);
    out.platform = plat.platform;
    out.platformIsObsolete = plat.obsolete;

    out.business = sizeOf({
      text: measured.text || "",
      ownPageCount: out.ownPageCount,
      freeTier: /free website-builder tier/i.test(plat.platform || ""),
    });

    out.pageWeightBytes = bytes || null;
    // Only counts on a page that is itself secure; an http:// site loading
    // http:// files is consistent, just old, and the certificate check
    // already has plenty to say about it.
    out.mixedContent = /^https:/i.test(out.finalUrl || target) ? insecure.size : null;
    out.usesModernImages = measured.imageCount === 0
      ? null
      : [...imageTypes].some(t => t === "image/webp" || t === "image/avif");

    // --- How it is built and how it looks -------------------------------
    // Runs in the page that is already open, so it costs nothing extra.
    const struct = await structure(page);
    const interpreted = interpretStructure(struct);
    // On a page the browser shrank to fit, small text is the phone check's
    // finding, measured after the phone's own text enlarging. Claiming it a
    // second time here, from the un-enlarged size, was how "too small to
    // read" got said about pages showing perfectly readable text.
    if (out.mobileZoom != null && out.mobileZoom < 0.9) interpreted.textTooSmall = false;
    Object.assign(out, struct, interpreted);

    /*
      How old the design looks, which is a different question from how old the
      code is and was the one nobody was asking.

      The construction markers come from structure(), the composition markers
      from the desktop layout pass, and the library fingerprints from the raw
      HTML - version numbers survive in the source and not in the DOM.
    */
    out.oldLibraries = detectOldLibraries(html);
    Object.assign(out, visualAge({
      oldLibraries: out.oldLibraries,
      bodyFontName: layout.bodyFontName,
      biggestHeadingPx: layout.biggestHeadingPx,
      chromeStyling: layout.chromeStyling,
      sectionRhythmPx: layout.sectionRhythmPx,
      usesWebFonts: interpreted.usesWebFonts,
      usesFlexOrGrid: struct.usesFlexOrGrid,
      layoutTables: struct.layoutTables,
      semanticTagCount: struct.semanticTagCount,
      inlineStyleRatio: interpreted.inlineStyleRatio,
      elementCount: struct.elementCount,
      contentWidthPct: layout.contentWidthPct,
    }));
    out.biggestHeadingPx = layout.biggestHeadingPx;
    out.chromeStyling = layout.chromeStyling;
    out.sectionRhythmPx = layout.sectionRhythmPx;
    out.bodyFontName = layout.bodyFontName;

    out.brokenLinks = await countBrokenLinks(measured.links, hostname, { allowLocal });

    if (screenshotPath) {
      await page.screenshot({ path: screenshotPath, type: "jpeg", quality: 72 });
      out.screenshotPath = screenshotPath;
    }

    /*
      The email address, looked for last because it may leave the homepage.

      Everything above measures the homepage as a visitor sees it. Finding
      the address can mean opening the contact page, so it runs once the
      homepage is finished with - including the screenshot, which would
      otherwise be of the contact page.
    */
    /*
      Sites that pick a layout by device can leave the address out of the
      phone version - a slimmed footer, a contact page without the email.
      What the desktop version of the homepage showed is read alongside, and
      its contact links are followed too, before anything is called "none".
    */
    Object.assign(out, emailFields(await findBusinessEmail(page, out.finalUrl || target, {
      also: layout.desktopEmails ? { ...layout.desktopEmails, url: layout.desktopUrl } : null,
    })));
  } catch (e) {
    out.fetchFailed = true;
    out.error = e.message.split("\n")[0].slice(0, 200);
  } finally {
    await context?.close().catch(() => {});
    if (owned) await browser.close().catch(() => {});
  }

  return out;
}

/**
 * Checks only same-site links, and only a handful. We are measuring their
 * homepage, not crawling their server.
 */
async function countBrokenLinks(links, hostname, { allowLocal = false, max = 10 } = {}) {
  const sameSite = [...new Set(links.filter(h => {
    try { return new URL(h).hostname === hostname; } catch { return false; }
  }))].slice(0, max);

  let broken = 0;
  for (const link of sameSite) {
    try {
      // Same-host only, but a redirect can still leave the public internet.
      await assertPublicTarget(new URL(link).hostname, { allowLocal });
      const r = await fetch(link, {
        method: "HEAD",
        redirect: "follow",
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(8000),
      });
      if (r.status >= 400) broken++;
    } catch {
      broken++;
    }
    /*
      Be a polite guest - but in proportion.

      This used to sleep 900ms between each of twelve links, which made it
      about eleven seconds of the fourteen an average audit took. It was, by
      a wide margin, the most expensive thing this tool did, and across a
      two-thousand-site night it cost hours.

      The courtesy was also inconsistent: loading their homepage a moment
      earlier fired off dozens of requests for images, fonts and scripts with
      no delay at all, and then this crawled through ten HEAD requests - the
      cheapest kind there is, no body returned - as though they were the
      burden. A person clicking around the site makes more requests, faster.

      300ms keeps it well under what any visitor does and takes this from
      eleven seconds to three.
    */
    await new Promise(r => setTimeout(r, 300));
  }
  return broken;
}

/** The parts of a search the rest of the app reads. */
function emailFields(found) {
  return {
    contactEmail: found.email,
    contactEmailWhy: found.why,
    contactEmailFoundOn: found.foundOn,
    // Addresses that might be theirs but were not good enough to use on their
    // own - shown on the draft so they can be chosen by hand.
    emailCandidates: (found.candidates ?? []).filter(a => a !== found.email).slice(0, 5),
    emailPagesSearched: found.searched ?? [],
    // The site showed a "checking your browser" screen or refused the visit:
    // not the same as having no address, and not reported as if it were.
    emailSearchBlocked: Boolean(found.blocked),
    emailSearchError: null,
    emailSearchVersion: found.version ?? 1,
  };
}

/**
 * Looks for a business's email address without re-auditing the whole site.
 *
 * For leads saved before the finder learned to open contact pages and read
 * Gmail and Cloudflare-protected addresses: re-checking the whole site to get
 * one field would cost a dozen seconds each and change scores nobody asked to
 * change.
 */
export async function searchEmails(url, { browser, timeoutMs = 25000, allowLocal = false, maxPages = 5, guessPages = true } = {}) {
  const owned = !browser;
  browser = browser || (await launchBrowser());
  let context;
  try {
    const target = url.startsWith("http") ? url : `https://${url}`;
    await assertPublicTarget(new URL(target).hostname, { allowLocal });
    // An ordinary desktop browser that still says who it is. The old
    // "compatible; MBOnyxAudit" string read as a bot, and some sites answer
    // bots with a challenge screen or a stripped page.
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: DESKTOP_UA, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const resp = await page.goto(target, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (resp && resp.status() >= 400) {
      // 403 and 503 with a challenge page are a refusal, not a missing site.
      const blocked = (resp.status() === 403 || resp.status() === 503)
        && Boolean(await page.evaluate(collectEmailsInPage).then(r => r.blocked).catch(() => false));
      return { ...emailFields({ email: null, candidates: [], searched: [target], blocked, version: 0 }), error: `server returned ${resp.status()}` };
    }
    await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
    return emailFields(await findBusinessEmail(page, page.url(), { maxPages, guessPages }));
  } catch (e) {
    return { ...emailFields({ email: null, candidates: [], searched: [], version: 0 }), error: e.message.split("\n")[0].slice(0, 160) };
  } finally {
    await context?.close().catch(() => {});
    if (owned) await browser.close().catch(() => {});
  }
}

/**
 * The phone check on its own, for leads checked before it looked twice.
 *
 * Their verdicts came from a single look, by a browser that did not say it
 * was a phone, reading widths that count clipped content - the combination
 * behind the letter one owner answered with "it does adjust, check your
 * device settings". Nothing from that check is trusted until it has been
 * redone this way.
 */
export async function recheckPhone(url, { browser, timeoutMs = 30000, allowLocal = false } = {}) {
  const owned = !browser;
  browser = browser || (await launchBrowser());
  try {
    const target = url.startsWith("http") ? url : `https://${url}`;
    await assertPublicTarget(new URL(target).hostname, { allowLocal });
    const first = await loadAndMeasure(browser, target, {
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: PHONE_UA,
    }, { timeoutMs, settleMs: 1500, extra: page => structure(page) });
    if (!first) return { error: "could not load the page" };
    const firstLook = phoneVerdict(first);
    // The text and button sizes were read from the same old load, through a
    // browser that did not say it was a phone and against a 14px line, so
    // they are redone here too.
    const sizes = interpretStructure(first);
    const redone = {
      bodyFontSize: first.bodyFontSize,
      tappableCount: first.tappableCount,
      tinyTapTargets: first.tinyTapTargets,
      textTooSmall: sizes.textTooSmall && !(firstLook.mobileZoom < 0.9),
      tapTargetsTooSmall: sizes.tapTargetsTooSmall,
      phoneCheckVersion: 2,
    };
    if (firstLook.isResponsive) return { ...firstLook, ...redone, phoneConfirmed: null, phoneOverruled: null };
    const second = await confirmPhone(browser, target, { timeoutMs });
    if (second && !second.isResponsive) {
      return { ...(second.notResponsiveSeverity < firstLook.notResponsiveSeverity ? second : firstLook), ...redone, phoneConfirmed: true, phoneOverruled: null };
    }
    return {
      ...(second ?? {}), ...redone, isResponsive: true, notResponsiveSeverity: 0, notResponsiveSignals: 0,
      phoneConfirmed: false,
      phoneOverruled: { firstLook, secondLook: second ?? "could not load a second time" },
    };
  } catch (e) {
    return { error: e.message.split("\n")[0].slice(0, 160) };
  } finally {
    if (owned) await browser.close().catch(() => {});
  }
}

export async function launchBrowser() {
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  return chromium.launch({ executablePath, args: ["--disable-dev-shm-usage"] });
}
