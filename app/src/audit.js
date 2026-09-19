/**
 * Measures one website and returns the raw facts. No judgement here — scoring
 * lives in score.js. This file's only job is to be accurate, because every
 * number it produces may end up quoted in an email to a stranger.
 */

import { chromium } from "playwright";
import tls from "node:tls";
import { structure, interpretStructure } from "./visual.js";

const UA =
  "Mozilla/5.0 (compatible; MBOnyxAudit/1.0; +https://mbonyx.netlify.app/) " +
  "Chrome/120.0.0.0 Safari/537.36";

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
export async function auditSite(url, { browser, timeoutMs = 30000, screenshotPath = null } = {}) {
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

    // --- Certificate, asked of the socket rather than the browser ----------
    // Local fixtures are served over plain HTTP and have no certificate. That
    // is a property of the test harness, not of the site, so the check is
    // recorded as "did not run" instead of handing every fixture 15 points.
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname) || hostname.endsWith(".local");
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
        scrollWidth: Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0),
        clientWidth: screenWidth,
        hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
        hasContactAboveFold: contactable,
        brokenImages: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
        imageCount: document.images.length,
        text: (document.body ? document.body.innerText : "").slice(0, 20000),
        links: [...document.querySelectorAll("a[href]")]
          .map(a => a.href)
          .filter(h => h.startsWith("http"))
          .slice(0, 25),
        title: document.title,
      };
    });

    // A page is responsive if it fits the phone's screen. 20px of slack absorbs
    // sub-pixel rounding without letting a genuinely broken layout through.
    out.mobileScrollWidth = measured.scrollWidth;
    out.mobileScreenWidth = measured.clientWidth;
    out.isResponsive = measured.hasViewportMeta && measured.scrollWidth <= measured.clientWidth + 20;
    out.hasViewportMeta = measured.hasViewportMeta;
    out.hasContactAboveFold = measured.hasContactAboveFold;
    out.brokenImages = measured.brokenImages;
    out.title = measured.title;

    out.copyrightYear = findCopyrightYear(measured.text + " " + html);

    const plat = detectPlatform(html, headers);
    out.platform = plat.platform;
    out.platformIsObsolete = plat.obsolete;

    out.pageWeightBytes = bytes || null;
    out.usesModernImages = measured.imageCount === 0
      ? null
      : [...imageTypes].some(t => t === "image/webp" || t === "image/avif");

    // --- How it is built and how it looks -------------------------------
    // Runs in the page that is already open, so it costs nothing extra.
    const struct = await structure(page);
    Object.assign(out, struct, interpretStructure(struct));

    out.brokenLinks = await countBrokenLinks(measured.links, hostname);

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
async function countBrokenLinks(links, hostname, max = 12) {
  const sameSite = [...new Set(links.filter(h => {
    try { return new URL(h).hostname === hostname; } catch { return false; }
  }))].slice(0, max);

  let broken = 0;
  for (const link of sameSite) {
    try {
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
