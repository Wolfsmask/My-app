/**
 * Finding the business's email address, and only the business's.
 *
 * Half the drafts came back "no email" for businesses whose address was the
 * first thing on their homepage, or one click away on their contact page.
 * Four reasons, all fixed here:
 *
 *   - Anything not on the business's own domain was refused. The thinking
 *     was that a Gmail address might be the web designer's - but a Gmail
 *     address printed on a plumber's own contact page is the plumber's,
 *     overwhelmingly, and refusing it threw away the commonest real case.
 *     What actually identifies the designer is the wording around it -
 *     "website by", "designed by" - so that is what is checked now.
 *   - Only the homepage was read. Plenty of sites keep the address on the
 *     contact page and nowhere else.
 *   - Cloudflare hides addresses from scrapers on a large share of WordPress
 *     sites: the page shows "[email protected]" and the real address sits
 *     in an attribute, lightly encoded. Visitors see it; the old reader saw
 *     the placeholder.
 *   - Some owners write it out - "info [at] example [dot] com" - to dodge
 *     spam bots, and the old reader only knew the @ form.
 *
 * Still refused: noreply and postmaster addresses, website builders' own
 * support addresses, template placeholders, and anything in a designer's
 * credit line. Writing to the wrong person is still worse than writing to
 * nobody.
 */

/** Free email providers. On a business's own page, these are the business's. */
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "protonmail.com", "proton.me",
  "comcast.net", "att.net", "sbcglobal.net", "bellsouth.net", "verizon.net",
  "charter.net", "cox.net", "earthlink.net", "frontier.com", "windstream.net",
  "centurylink.net", "embarqmail.com", "q.com", "gmx.com", "mail.com", "zoho.com",
]);

/** Addresses nobody reads, and builders' own support desks. */
const NEVER = /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|abuse|webmaster@wordpress|sentry|support@(wix|squarespace|godaddy|weebly|shopify|duda))/i;

/**
 * Domains that are never a small business. Matched against the domain on its
 * own - run against the whole address it never fired, because every domain
 * sits behind an "@" rather than at the start.
 */
const JUNK_DOMAIN = /^(example|test|localhost|sentry|wixpress|wix|squarespace|shopify|godaddy|weebly|duda|w3|schema|googleapis|gstatic|jquery|bootstrapcdn|sentry-cdn|domain|yourdomain|yoursite|email|mysite)\./i;

/** What a template ships with on a free provider: "yourname@gmail.com". */
const PLACEHOLDER_LOCAL = /^(you|your|yourname|your\.name|youremail|your\.email|name|email|e-mail|user|username|someone|somebody|john|jane|johndoe|john\.doe|janedoe|jane\.doe|test|example|sample|demo|info|contact|hello|admin|me)$/i;

/** The wording around a web designer's address. */
const CREDIT = /\b(designed|developed|built|created|powered|hosted|maintained|managed|optimi[sz]ed)\s+(and\s+\w+\s+)?by\b|\b(website|site|web\s*site|web\s*design|seo|marketing)\s+by\b|\bweb\s*design(er|ers)?\b.*\bby\b/i;

/** Words in a domain that say nothing about whose it is. */
const GENERIC_TOKENS = new Set(["services", "service", "company", "group", "solutions", "online",
  "home", "homes", "the", "and", "inc", "llc", "corp", "official", "website", "web", "site", "mail", "email"]);

const tokens = domainLabel => domainLabel.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 5 && !GENERIC_TOKENS.has(t));

/** Builders whose subdomain is the business's name: joes.wixsite.com. */
const BUILDER_LABELS = new Set(["wixsite", "squarespace", "weebly", "godaddysites", "wordpress", "business", "site123", "webflow", "carrd", "netlify", "vercel", "github"]);

const sharedPrefix = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/** Cloudflare's scraper protection: first byte is the key, the rest XORed with it. */
export function decodeCfEmail(hex) {
  if (!/^[0-9a-f]{4,}$/i.test(hex ?? "") || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/**
 * Which address on the page belongs to the business.
 *
 * Takes plain strings, or the objects collectEmailsInPage returns - those
 * carry the words around each address, which is how a designer's credit is
 * told apart from the owner's contact line.
 *
 * In order of preference:
 *   1. on their own domain, or a subdomain of it;
 *   2. on a domain that shares a real word with theirs
 *      (bucknersheating.com, office@bucknershvac.com);
 *   3. a free-provider address printed on their site, as long as it is not
 *      in a "website by" line and is not a template placeholder.
 * Anything else - an unrelated company domain - is offered as a maybe and
 * never used on its own: it is as likely a supplier or a parent company as
 * the business.
 */
export function pickBusinessEmail(candidates, siteUrl) {
  let host = "";
  try { host = new URL(siteUrl).hostname.replace(/^www\./i, "").toLowerCase(); } catch { /* not a URL */ }
  const root = host.split(".").slice(-2).join(".");
  // Every label but the ending, so a site on a builder's subdomain -
  // joesplumbing.wixsite.com - still contributes the business's name.
  const siteTokens = tokens(host.split(".").slice(0, -1).filter(l => !BUILDER_LABELS.has(l)).join("."));

  const seen = new Map();
  for (const raw of candidates ?? []) {
    const c = typeof raw === "string" ? { address: raw } : { ...raw };
    const addr = String(c.address ?? "").trim().toLowerCase()
      .replace(/^mailto:/, "").replace(/^[<("'\s]+/, "").replace(/[.,;:)\]>"'\s]+$/, "");
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(addr)) continue;
    const [local, domain] = addr.split("@");
    if (NEVER.test(addr) || JUNK_DOMAIN.test(domain)) continue;
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(addr)) continue;

    const ownDomain = Boolean(root) && (domain === root || domain.endsWith("." + root));
    /*
      Related means the name the domain is registered under - the label just
      before the ending - starts the same way as theirs, for at least six
      letters: bucknersheating.com and bucknershvac.com share "buckners".

      Only that label. Matching anywhere in the domain accepted
      bucknersheating.com.evil.net, which is precisely the shape of a
      lookalike.
    */
    const registered = domain.split(".").slice(-2)[0] ?? "";
    const related = !ownDomain && siteTokens.some(t => sharedPrefix(t, registered) >= 6);
    const free = FREEMAIL.has(domain);
    if (free && PLACEHOLDER_LOCAL.test(local)) continue;
    // A designer's line is a reason to refuse anything that is not plainly
    // the business's own domain.
    const credit = !ownDomain && CREDIT.test(c.context ?? "");

    const kind = ownDomain ? "own" : related ? "related" : free ? "free" : "other";
    const entry = seen.get(addr) ?? { address: addr, kind, inCredit: false, inContact: false, sources: new Set(), foundOn: c.foundOn ?? null, local };
    if (c.source) entry.sources.add(c.source);
    /*
      Seen in a credit line and also in a contact block: the contact block
      wins. Seen only in credit lines: refused.

      A sighting with no words around it counts for neither. The same address
      is picked up again from the page's joined text with no context, and
      letting that sighting clear the credit flag is exactly how a designer's
      "Site by Pixel Co - pixelco@gmail.com" became the business's address on
      a page that had none of its own.
    */
    if (c.context) {
      if (credit) entry.inCredit = true;
      else entry.inContact = true;
    }
    if (!entry.foundOn && c.foundOn) entry.foundOn = c.foundOn;
    seen.set(addr, entry);
  }

  const all = [...seen.values()];
  for (const e of all) e.credit = e.inCredit && !e.inContact;
  const usable = all.filter(e => !e.credit && e.kind !== "other");
  // A designer's credit is not even offered as a maybe: it is known not to
  // be theirs, and a list of maybes invites picking one.
  const offered = all.filter(e => !e.credit).map(e => e.address);
  if (!usable.length) {
    return { email: null, confident: false, why: null, foundOn: null, candidates: offered };
  }

  const rank = { own: 0, related: 1, free: 2 };
  const nameLike = e => siteTokens.some(t => e.local.includes(t)) ? 0 : 1;
  const linked = e => e.sources.has("mailto") || e.sources.has("protected") ? 0 : 1;
  usable.sort((a, b) =>
    rank[a.kind] - rank[b.kind] || nameLike(a) - nameLike(b) || linked(a) - linked(b));

  const best = usable[0];
  const where = best.foundOn ? (/contact/i.test(best.foundOn) ? "their contact page" : "their website") : "their website";
  const why = best.kind === "own" ? `on their own domain, listed on ${where}`
    : best.kind === "related" ? `on a domain matching their business name, listed on ${where}`
    : `${/^[aeiou]/i.test(best.address.split("@")[1]) ? "an" : "a"} ${best.address.split("@")[1]} address listed on ${where}`;
  return {
    email: best.address,
    confident: true,
    why,
    foundOn: best.foundOn,
    candidates: offered,
  };
}

/**
 * Runs inside the page. Must stay self-contained: page.evaluate sends the
 * function's source, not its closure, so nothing from this module is visible
 * in here - which is why the Cloudflare decoder is written out twice.
 */
export function collectEmailsInPage() {
  const RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const SPELLED = /([a-z0-9._%+-]+)\s*[\[\(\{]\s*at\s*[\]\)\}]\s*([a-z0-9-]+(?:\s*(?:[\[\(\{]\s*dot\s*[\]\)\}]|\.)\s*[a-z0-9-]+)+)/gi;
  const found = [];
  const add = (address, source, el) => {
    if (!address) return;
    const block = el && el.closest ? (el.closest("p,li,td,address,dd,section,footer,header,div") || el) : null;
    const context = block ? String(block.innerText || block.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240) : "";
    found.push({ address: String(address).trim(), source, context });
  };
  const decodeCf = hex => {
    if (!/^[0-9a-f]{4,}$/i.test(hex || "") || hex.length % 2) return null;
    const key = parseInt(hex.slice(0, 2), 16);
    let s = "";
    for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    return s;
  };

  for (const a of document.querySelectorAll('a[href^="mailto:" i]')) {
    let href = a.getAttribute("href") || "";
    try { href = decodeURIComponent(href); } catch { /* leave it */ }
    for (const part of href.replace(/^mailto:/i, "").split("?")[0].split(/[,;]/)) add(part, "mailto", a);
  }
  for (const el of document.querySelectorAll("[data-cfemail]")) add(decodeCf(el.getAttribute("data-cfemail")), "protected", el);
  for (const a of document.querySelectorAll('a[href*="/cdn-cgi/l/email-protection#"]')) {
    add(decodeCf((a.getAttribute("href") || "").split("#")[1] || ""), "protected", a);
  }

  const root = document.body || document.documentElement;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node, visited = 0;
  while ((node = walker.nextNode()) && visited++ < 6000) {
    const t = node.nodeValue || "";
    if (!t.includes("@") && !/\bat\b/i.test(t)) continue;
    const tag = node.parentElement && node.parentElement.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;
    for (const m of t.matchAll(RE)) add(m[0], "text", node.parentElement);
    for (const m of t.matchAll(SPELLED)) {
      add(m[1] + "@" + m[2].replace(/\s*(?:[\[\(\{]\s*dot\s*[\]\)\}]|\.)\s*/gi, "."), "spelled out", node.parentElement);
    }
  }
  // An address split across elements - <span>info</span>@<span>site.com</span>
  // - is only whole in the joined text.
  for (const m of String((document.body && document.body.innerText) || "").matchAll(RE)) add(m[0], "text", null);
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    for (const m of String(s.textContent || "").matchAll(RE)) add(m[0], "structured data", null);
  }
  for (const m of String((document.head && document.head.innerHTML) || "").matchAll(RE)) add(m[0], "page header", null);

  // Pages on the same site worth opening if this one has nothing: contact
  // first, then about and location pages.
  const here = location.hostname.replace(/^www\./, "");
  const current = location.href.split("#")[0];
  const ranked = [];
  for (const a of document.querySelectorAll("a[href]")) {
    let u;
    try { u = new URL(a.getAttribute("href"), location.href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== here) continue;
    if (/\.(pdf|jpe?g|png|gif|zip|docx?)$/i.test(u.pathname)) continue;
    u.hash = "";
    if (u.href === current) continue;
    const label = ((a.innerText || a.getAttribute("aria-label") || "") + " " + u.pathname).toLowerCase();
    const rank = /contact|get in touch|reach us|email us/.test(label) ? 0
      : /about|our story|who we are|location|find us|visit us|our team|staff/.test(label) ? 1 : -1;
    if (rank >= 0) ranked.push({ url: u.href, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  const contactLinks = [...new Set(ranked.map(r => r.url))].slice(0, 6);

  return { candidates: found.slice(0, 120), contactLinks };
}

/**
 * Looks on the page the browser is already on, then - only if nothing usable
 * turned up - opens up to three contact and about pages on the same site.
 *
 * Navigates the page it is given, so the caller must be finished with it.
 */
export async function findBusinessEmail(page, siteUrl, { maxPages = 3, timeoutMs = 15000 } = {}) {
  const searched = [];
  const all = [];
  const look = async url => {
    const r = await page.evaluate(collectEmailsInPage).catch(() => ({ candidates: [], contactLinks: [] }));
    searched.push(url);
    for (const c of r.candidates) all.push({ ...c, foundOn: url });
    return r;
  };

  const first = await look(page.url());
  let pick = pickBusinessEmail(all, siteUrl);
  for (const link of first.contactLinks) {
    if (pick.email || searched.length > maxPages) break;
    try {
      const resp = await page.goto(link, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      if (resp && resp.status() >= 400) { searched.push(link); continue; }
      // Contact pages built by script need a moment, and so do Cloudflare's
      // decoders on the ones that are not.
      await page.waitForTimeout(1200);
    } catch {
      continue;
    }
    await look(link);
    pick = pickBusinessEmail(all, siteUrl);
  }
  return { ...pick, searched, version: 2 };
}
