/**
 * Measures one website and returns the raw facts. No judgement here — scoring
 * lives in score.js. This file's only job is to be accurate, because every
 * number it produces may end up quoted in an email to a stranger.
 */

import { chromium } from "playwright";
import tls from "node:tls";
import dns from "node:dns/promises";
import net from "node:net";
import { structure, interpretStructure } from "./visual.js";

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

    // A page is responsive if it fits the phone's screen. 20px of slack absorbs
    // sub-pixel rounding without letting a genuinely broken layout through.
    out.mobileScrollWidth = measured.scrollWidth;
    out.mobileScreenWidth = measured.clientWidth;
    out.isResponsive = measured.hasViewportMeta && measured.scrollWidth <= measured.clientWidth + 20;
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
