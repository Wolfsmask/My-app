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

const UA =
  "Mozilla/5.0 (compatible; MBOnyxAudit/1.0; +https://mbonyx.netlify.app/) " +
  "Chrome/120.0.0.0 Safari/537.36";

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
/**
 * Which address on the page belongs to the business.
 *
 * A page carries more than one. There is the owner's, and then there is the
 * web designer's in the footer, the theme vendor's in a comment, an image
 * library's, a "noreply@" from a form service, and whatever placeholder the
 * template shipped with. Writing to any of those is worse than writing to
 * none: it is a stranger receiving a letter about a website that is not
 * theirs.
 *
 * So the address is only accepted when it sits on the business's own domain.
 * An owner on gmail.com or a webmail account is common and real, but there is
 * no way to tell theirs from their designer's, so those are offered as a
 * maybe rather than used.
 */
export function pickBusinessEmail(candidates, siteUrl) {
  const NEVER = /^(noreply|no-reply|donotreply|do-not-reply|postmaster|abuse|webmaster@wordpress|sentry|support@(wix|squarespace|godaddy|weebly|shopify|duda))/i;
  // Matched against the domain on its own. Run against the whole address it
  // never fired, because every domain sits behind an "@" rather than at the
  // start or after a dot - so "info@example.com" came through as a candidate.
  const JUNK_DOMAIN = /^(example|test|localhost|sentry|wixpress|wix|squarespace|shopify|godaddy|weebly|duda|w3|schema|googleapis|gstatic|jquery|bootstrapcdn|sentry-cdn)\./i;

  const seen = new Set();
  const clean = [];
  for (const raw of candidates ?? []) {
    const addr = String(raw).trim().toLowerCase().replace(/[.,;:)\]]+$/, "");
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(addr)) continue;
    const domain = addr.split("@")[1] ?? "";
    if (NEVER.test(addr) || JUNK_DOMAIN.test(domain)) continue;
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(addr)) continue;
    if (seen.has(addr)) continue;
    seen.add(addr);
    clean.push(addr);
  }
  if (!clean.length) return { email: null, confident: false, candidates: [] };

  let host = "";
  try { host = new URL(siteUrl).hostname.replace(/^www\./i, "").toLowerCase(); } catch { /* not a URL */ }
  const root = host.split(".").slice(-2).join(".");

  // On their own domain: as good as it gets without asking them.
  const onDomain = clean.find(a => root && a.endsWith("@" + root)) ??
                   clean.find(a => root && a.split("@")[1]?.endsWith("." + root));
  if (onDomain) return { email: onDomain, confident: true, candidates: clean };

  return { email: null, confident: false, candidates: clean };
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
      userAgent: UA,
      ignoreHTTPSErrors: true, // we already recorded the cert state above
    });
    const page = await context.newPage();

    let bytes = 0;
    const imageTypes = new Set();
    page.on("response", async res => {
      const len = parseInt(res.headers()["content-length"] || "0", 10);
      if (len) bytes += len;
      const ct = res.headers()["content-type"] || "";
      if (ct.startsWith("image/")) imageTypes.add(ct.split(";")[0].trim());
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

    // Give lazy content a moment, but never hang the run on a slow site.
    await page.waitForTimeout(1200);

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

      /*
        What is actually cut off at the right edge of the phone screen.

        Whether a page has a viewport meta tag says what the author intended,
        not what the visitor gets. Plenty of sites written before responsive
        design was standard still fit a phone perfectly and work fine; plenty
        of sites with the tag still push their header half off the screen.
        Only the second kind is worth telling someone about, so this counts
        the things a thumb cannot reach rather than reading the markup.

        Three kinds of false positive have to be excluded or this counts every
        site on the internet:
          - anything inside a deliberately scrollable strip (a carousel, a
            wide table in a scroll box) is meant to extend past the edge;
          - a hidden slide-in menu parked off to the right is not visible;
          - an element that starts past the right edge entirely is off-stage,
            not cut in half.
      */
      const cutOff = (() => {
        const clipped = el => {
          for (let p = el.parentElement; p; p = p.parentElement) {
            const st = getComputedStyle(p);
            if (st.overflowX === "auto" || st.overflowX === "scroll" || st.overflowX === "hidden") return true;
          }
          return false;
        };
        const items = [];
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width < 24 || r.height < 12) continue;
          // Starts off-screen: a parked drawer, not a broken layout.
          if (r.left >= screenWidth - 4) continue;
          if (r.right <= screenWidth + 8) continue;
          const st = getComputedStyle(el);
          if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) continue;
          const ink = (el.innerText || "").trim().length > 0
            || /^(IMG|SVG|VIDEO|CANVAS|INPUT|BUTTON|SELECT|TEXTAREA)$/.test(el.tagName)
            || (st.backgroundImage && st.backgroundImage !== "none");
          if (!ink) continue;
          if (clipped(el)) continue;
          items.push({ tag: el.tagName.toLowerCase(), over: Math.round(r.right - screenWidth) });
        }
        /*
          A cut-off parent drags all of its children into the list, so twenty
          "elements off screen" can be one broken header. Only the outermost
          offender at each overhang is interesting, and the count is capped so
          one runaway table cannot outweigh everything else.
        */
        items.sort((a, b) => b.over - a.over);
        return {
          count: Math.min(items.length, 40),
          worstPx: items.length ? items[0].over : 0,
          sample: items.slice(0, 4).map(i => i.tag),
        };
      })();

      return {
        mobileZoom: Math.round(zoom * 1000) / 1000,
        physicalWidth,
        bodyFontPx: document.body ? parseFloat(getComputedStyle(document.body).fontSize) || null : null,
        // The typical tappable thing, after the browser's zoom is applied.
        medianTapPx: (() => {
          const hs = [...document.querySelectorAll("a[href],button,input,select")]
            .map(el => el.getBoundingClientRect().height).filter(h => h > 0).sort((a, b) => a - b);
          return hs.length ? Math.round(hs[Math.floor(hs.length / 2)]) : null;
        })(),
        cutOffCount: cutOff.count,
        cutOffWorstPx: cutOff.worstPx,
        cutOffSample: cutOff.sample,
        scrollWidth: Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0),
        clientWidth: screenWidth,
        hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
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

        // Every address on the page, in the order found, plus the ones written
        // as mailto: links first. Sorting out which one is the business's is
        // done outside the page, where it can be tested.
        mailtos: [...document.querySelectorAll('a[href^="mailto:" i]')]
          .map(a => (a.getAttribute("href") || "").replace(/^mailto:/i, "").split("?")[0].trim())
          .filter(Boolean)
          .slice(0, 20),
        emailText: ((document.body ? document.body.innerText : "") + " " + (document.head ? document.head.innerHTML : ""))
          .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)?.slice(0, 30) ?? [],
      };
    });

    /*
      Does the page work on a phone, judged on what the visitor gets.

      This used to require a viewport meta tag: no tag meant "not responsive"
      however well the page actually behaved. That is the wrong question. A
      site written in 2009 with a fixed 960px layout that happens to scale
      down cleanly is usable — you can read it, you can tap the phone number,
      it is simply not fashionable. A site whose header runs 300px off the
      side of the screen is not, tag or no tag.

      So it is measured two ways, both of them things a visitor feels:
      how far you have to drag the page sideways, and how much is hanging
      off the edge while you do.
    */
    out.mobileScrollWidth = measured.scrollWidth;
    out.mobileScreenWidth = measured.clientWidth;
    out.mobileOverflowPct = measured.clientWidth
      ? Math.max(0, Math.round(((measured.scrollWidth - measured.clientWidth) / measured.clientWidth) * 100))
      : null;
    out.mobileCutOff = measured.cutOffCount;
    out.mobileCutOffWorstPx = measured.cutOffWorstPx;
    out.mobileCutOffSample = measured.cutOffSample;
    /*
      10% is the line because it is roughly where dragging starts: below that
      you are looking at rounding, a stray margin or one wide image, and the
      page still reads in one column. Three cut-off elements rather than one
      for the same reason — a single overhanging banner is untidy, a header, a
      nav and a hero all hanging off is a broken page.
    */
    out.mobileZoom = measured.mobileZoom;
    // What the visitor's eye actually receives, after the browser shrank the
    // page to fit. 17px text on a page zoomed to 0.4 arrives as 7px.
    out.effectiveBodyPx = measured.bodyFontPx == null ? null
      : Math.round(measured.bodyFontPx * measured.mobileZoom * 10) / 10;
    out.effectiveTapPx = measured.medianTapPx == null ? null
      : Math.round(measured.medianTapPx * measured.mobileZoom);

    /*
      Four ways a page fails a phone, in the order a visitor meets them.

      10% of overflow is where dragging starts; below that it is a stray
      margin. Three cut-off elements rather than one, because a single
      overhanging banner is untidy and a header, a nav and a hero all hanging
      off is a broken page. 9px is where text stops being readable without
      pinching, and 24px is where a thumb stops landing on the right link.
    */
    /*
      Two different failures, graded separately and never added together.

      A page fails a phone in one of two ways, and they are mutually
      exclusive. Either it declares a viewport and then overflows it, so the
      visitor drags sideways - or it declares nothing, the browser lays it out
      at 980px and shrinks the result to fit, so nothing overflows and
      everything is too small to read. Counting "how many of four signals"
      capped the worst page on the fixtures at half marks, because no page can
      ever be both. Each track is scored on how bad it is, and the worse of
      the two wins.
    */
    const ramp = (value, from, to) => Math.max(0, Math.min(1, (value - from) / (to - from)));

    let broken = 0;
    if (out.mobileOverflowPct >= 10) broken = 0.5 + 0.5 * ramp(out.mobileOverflowPct, 10, 100);
    if (out.mobileCutOff >= 3) broken = Math.max(broken, 0.5 + 0.5 * ramp(out.mobileCutOff, 3, 12));

    let shrunk = 0;
    if (out.effectiveBodyPx != null && out.effectiveBodyPx < 9) shrunk = 0.5 + 0.5 * ramp(9 - out.effectiveBodyPx, 0, 4);
    /*
      Tap size counts here only when the browser actually shrank the page.

      At zoom 1 the median link height is mostly a property of prose - an
      inline link inside a paragraph is one line tall, about 21px, on every
      well-built site there is, and this flagged one of our own concept builds
      because of it. Whether buttons are comfortable to hit is the small
      tap-target check's job. This track is about what shrink-to-fit did, so
      it only applies where there was shrinking.
    */
    if (out.mobileZoom < 0.95 && out.effectiveTapPx != null && out.effectiveTapPx < 24) {
      shrunk = Math.max(shrunk, 0.4 + 0.4 * ramp(24 - out.effectiveTapPx, 0, 16));
    }

    out.notResponsiveSeverity = Math.round(Math.max(broken, shrunk) * 100) / 100;
    out.notResponsiveSignals = [
      out.mobileOverflowPct >= 10,
      out.mobileCutOff >= 3,
      out.effectiveBodyPx != null && out.effectiveBodyPx < 9,
      out.mobileZoom < 0.95 && out.effectiveTapPx != null && out.effectiveTapPx < 24,
    ].filter(Boolean).length;
    out.isResponsive = out.notResponsiveSeverity === 0;
    out.hasViewportMeta = measured.hasViewportMeta;
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

    const found = pickBusinessEmail([...(measured.mailtos ?? []), ...(measured.emailText ?? [])], out.finalUrl || target);
    out.contactEmail = found.email;
    // Kept separately: an address that is not on their domain might be theirs
    // or might be their web designer's, and the page says which it is rather
    // than quietly picking one.
    out.emailCandidates = found.candidates.slice(0, 5);

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
    // Nothing measured is the honest default: a page that will not resize is
    // one whose layout was not looked at, not one that passed.
    let layout = {};
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      // Re-measuring alone is not enough: a page that lays out on scroll or
      // resize needs a moment to settle before it is looked at.
      await page.waitForTimeout(250);
      layout = await page.evaluate(measureLayout);
    } catch {
      // Left unmeasured rather than guessed at.
    } finally {
      /*
        Back to the phone before anything else is measured.

        Everything after this - font sizes, tap targets, the dated-design
        markers - is about how the site behaves on a phone, and it reads the
        live page. Leaving the window at 1280 measured all of it on a desktop,
        where the mobile stylesheet does not apply: this site's own body text
        came out at 13.9px and it was flagged for text too small to read on a
        phone, on a page that is 16px on a phone. A measurement taken at the
        wrong size is worse than none.
      */
      await page.setViewportSize({ width: 390, height: 844 }).catch(() => {});
      await page.waitForTimeout(150);
    }

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
    out.usesModernImages = measured.imageCount === 0
      ? null
      : [...imageTypes].some(t => t === "image/webp" || t === "image/avif");

    // --- How it is built and how it looks -------------------------------
    // Runs in the page that is already open, so it costs nothing extra.
    const struct = await structure(page);
    const interpreted = interpretStructure(struct);
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
async function countBrokenLinks(links, hostname, { allowLocal = false, max = 12 } = {}) {
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
    // Be a polite guest: roughly one request per second per host.
    await new Promise(r => setTimeout(r, 900));
  }
  return broken;
}

export async function launchBrowser() {
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  return chromium.launch({ executablePath, args: ["--disable-dev-shm-usage"] });
}
