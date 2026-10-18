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
 * And a second round, after he found addresses on sites still marked "no
 * email":
 *
 *   - Local internet providers' addresses (everestkc.net, kc.rr.com,
 *     swbell.net...) were treated as some unrelated company's, so they were
 *     only ever offered as a maybe - and a draft with only maybes said "no
 *     email address anywhere". Those drafts are now their own group.
 *   - Footers that load as you scroll, and contact pages built by script,
 *     were read before they had arrived.
 *   - Only links saying "contact" or "about" were followed. "Get a quote",
 *     "Book", "Schedule", "Request an estimate" and the privacy page - which
 *     very often has the address - were not.
 *   - Addresses kept in attributes, broken up by invisible characters, or
 *     written "info at example dot com" were missed.
 *   - A site whose menu is built by script has no links to follow; the
 *     usual contact page addresses are now tried.
 *   - A page that blocked the check (a "checking your browser" screen) was
 *     reported as having no address. It is now reported as blocked.
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
  // Internet providers - plenty of long-running small businesses still use
  // the address that came with their connection. Kansas City and Missouri
  // ones first, then the big national ones.
  "everestkc.net", "swbell.net", "centurytel.net", "mchsi.com", "grm.net", "socket.net",
  "fidnet.com", "iland.net", "mediacombb.net", "sbcglobal.com", "kc.surewest.net", "surewest.net",
  "prodigy.net", "pacbell.net", "ameritech.net", "flash.net", "nvbell.net", "wans.net",
  "juno.com", "netzero.net", "netzero.com", "aim.com", "optonline.net", "optimum.net",
  "suddenlink.net", "cableone.net", "sparklight.net", "tds.net", "wowway.com", "rcn.com",
  "knology.net", "bresnan.net", "hughes.net", "peoplepc.com", "frontiernet.net", "roadrunner.com",
  "twc.com", "spectrum.net", "xfinity.com", "mindspring.com", "excite.com", "lycos.com",
  "fastmail.com", "hey.com", "pm.me", "tutanota.com", "zohomail.com", "yahoo.co.uk", "hotmail.co.uk",
]);

/** Providers that hand out an address per region: someone@kc.rr.com. */
const FREEMAIL_SUFFIX = /\.(rr\.com|res\.rr\.com|centurytel\.net|tds\.net|frontier\.com)$/i;
const isFreemail = domain => FREEMAIL.has(domain) || FREEMAIL_SUFFIX.test("." + domain);

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
    const free = isFreemail(domain);
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
  // "info at riversidedental dot com" - no brackets, so it must end in a
  // real ending spelled out, or "meet us at noon" would count.
  const WORDY = /\b([a-z0-9._%+-]{2,})\s+at\s+([a-z0-9-]{2,}(?:\s+dot\s+[a-z0-9-]{2,})*\s+dot\s+(?:com|net|org|us|biz|info|co))\b/gi;
  // Invisible characters dropped into an address to throw off scrapers.
  const INVISIBLE = /[­​-‍⁠﻿]/g;
  const found = [];
  const add = (address, source, el) => {
    if (!address) return;
    const block = el && el.closest ? (el.closest("p,li,td,address,dd,section,footer,header,div") || el) : null;
    const context = block ? String(block.innerText || block.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240) : "";
    found.push({ address: String(address).replace(INVISIBLE, "").trim(), source, context });
  };
  const decodeCf = hex => {
    if (!/^[0-9a-f]{4,}$/i.test(hex || "") || hex.length % 2) return null;
    const key = parseInt(hex.slice(0, 2), 16);
    let s = "";
    for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    return s;
  };
  const scanText = (raw, el, source) => {
    const t = String(raw || "").replace(INVISIBLE, "");
    for (const m of t.matchAll(RE)) add(m[0], source, el);
    for (const m of t.matchAll(SPELLED)) {
      add(m[1] + "@" + m[2].replace(/\s*(?:[\[\(\{]\s*dot\s*[\]\)\}]|\.)\s*/gi, "."), "spelled out", el);
    }
    for (const m of t.matchAll(WORDY)) add(m[1] + "@" + m[2].replace(/\s+dot\s+/gi, "."), "spelled out", el);
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
  while ((node = walker.nextNode()) && visited++ < 8000) {
    const t = node.nodeValue || "";
    if (!t.includes("@") && !/\bat\b/i.test(t)) continue;
    const parent = node.parentElement;
    const tag = parent && parent.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;
    scanText(t, parent, "text");
    // Written backwards in the source and flipped back by CSS, so a person
    // reads it the right way round and a scraper reads "moc.elpmaxe@ofni".
    if (parent && t.includes("@")) {
      const cs = getComputedStyle(parent);
      if (cs.unicodeBidi === "bidi-override" && cs.direction === "rtl") scanText([...t].reverse().join(""), parent, "text");
    }
  }
  // An address split across elements - <span>info</span>@<span>site.com</span>
  // - is only whole in the joined text.
  scanText((document.body && document.body.innerText) || "", null, "text");
  // Kept in an attribute and put on screen by a script, or shown on hover.
  let looked = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (looked++ > 6000) break;
    for (const at of el.attributes) {
      if (!at.value || !at.value.includes("@") || at.value.length > 300) continue;
      if (/^(data-|title$|aria-label$|alt$|content$)/i.test(at.name)) scanText(at.value, el, "attribute");
    }
  }
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) scanText(s.textContent, null, "structured data");
  for (const m of String((document.head && document.head.innerHTML) || "").matchAll(RE)) add(m[0], "page header", null);

  /*
    Pages on the same site worth opening if this one has nothing. Contact
    first, then the pages people use to get in touch without calling them
    "contact" - quotes, estimates, bookings - then about and location pages,
    and last the privacy and legal pages, which very often carry the address
    because the law expects one there.
  */
  const here = location.hostname.replace(/^www\./, "");
  const current = location.href.split("#")[0];
  const ranked = [];
  for (const a of document.querySelectorAll("a[href]")) {
    let u;
    try { u = new URL(a.getAttribute("href"), location.href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== here) continue;
    if (/\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?|mp4|mp3)$/i.test(u.pathname)) continue;
    u.hash = "";
    if (u.href === current) continue;
    const label = ((a.innerText || a.textContent || a.getAttribute("aria-label") || a.getAttribute("title") || "") + " " + u.pathname).toLowerCase();
    const rank = /contact|get in touch|reach us|email us|write to us|message us|send us/.test(label) ? 0
      : /quote|estimate|inquir|enquir|request|book|schedul|appointment|reserv|connect|reach out/.test(label) ? 1
      : /about|our story|who we are|location|find us|visit us|direction|hours|our team|meet|staff|service area|support|help|faq/.test(label) ? 2
      : /privacy|terms|legal|imprint|impressum|disclaimer/.test(label) ? 3 : -1;
    if (rank >= 0) ranked.push({ url: u.href, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  const contactLinks = [...new Set(ranked.map(r => r.url))].slice(0, 10);

  /*
    A "checking your browser" screen, or a firewall's refusal, is not a site
    with no address - it is a site that would not let the check in. Only the
    unmistakable ones: a contact form that merely uses a captcha is a normal
    page.
  */
  const title = String(document.title || "").trim();
  const opening = String((document.body && document.body.innerText) || "").slice(0, 1500);
  const blocked = /^(just a moment|attention required|access denied|security check|one more step|please wait|ddos protection|request rejected|forbidden)\b/i.test(title)
    || Boolean(document.querySelector("#challenge-form, #challenge-running, #cf-challenge-running, .cf-browser-verification, #cf-error-details, #sucuri_challenge"))
    || (opening.length < 1500 && /(checking your browser|verify(ing)? you are (a )?human|enable javascript and cookies to continue|sucuri website firewall|access to this page has been denied)/i.test(opening));

  return { candidates: found.slice(0, 160), contactLinks, blocked };
}

/** Gives a page the chance to finish: lazy footers, script-built contact blocks. */
async function settle(page, { waitMs = 1500 } = {}) {
  // Short waits throughout: plenty of sites never go quiet (analytics, chat
  // widgets), and a long wait on each of six pages adds up across a night.
  await page.waitForLoadState("networkidle", { timeout: waitMs }).catch(() => {});
  await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const step = Math.max(400, innerHeight);
    for (let i = 0, y = 0; i < 16 && y < document.documentElement.scrollHeight; i++, y += step) {
      scrollTo(0, y);
      await wait(60);
    }
    scrollTo(0, document.documentElement.scrollHeight);
    await wait(400);
  }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 1000 }).catch(() => {});
}

/** Where a site whose menu is built by script usually keeps the address. */
const USUAL_PAGES = ["/contact", "/contact-us", "/about"];

/**
 * Looks on the page the browser is already on, then - only if nothing usable
 * turned up - opens up to five contact, quote, about and privacy pages on the
 * same site.
 *
 * Each page is read once straight away and, if that finds nothing, again
 * after scrolling to the bottom and letting it finish, because footers that
 * load as you scroll are where small businesses keep their address.
 *
 * Navigates the page it is given, so the caller must be finished with it.
 */
export async function findBusinessEmail(page, siteUrl, { maxPages = 5, timeoutMs = 15000, guessPages = true, also = null } = {}) {
  const searched = [];
  const all = [];
  let blocked = false;
  // Read elsewhere already - the desktop version of the same homepage.
  for (const c of also?.candidates ?? []) all.push({ ...c, foundOn: also.url ?? siteUrl });
  const read = async url => {
    const r = await page.evaluate(collectEmailsInPage).catch(() => ({ candidates: [], contactLinks: [], blocked: false }));
    for (const c of r.candidates) all.push({ ...c, foundOn: url });
    return r;
  };
  const look = async url => {
    let r = await read(url);
    if (!pickBusinessEmail(all, siteUrl).email && !r.blocked) {
      await settle(page);
      const again = await read(url);
      r = { ...again, contactLinks: [...new Set([...r.contactLinks, ...again.contactLinks])] };
    }
    searched.push(url);
    return r;
  };

  const first = await look(page.url());
  blocked = Boolean(first.blocked);
  let pick = pickBusinessEmail(all, siteUrl);

  const queue = [...new Set([...first.contactLinks, ...(also?.contactLinks ?? [])])];
  if (!queue.length && !blocked && guessPages) {
    try {
      const origin = new URL(page.url()).origin;
      queue.push(...USUAL_PAGES.map(p => origin + p));
    } catch { /* not a URL */ }
  }
  let opened = 0;
  for (const link of queue) {
    if (pick.email || blocked || opened >= maxPages) break;
    if (searched.includes(link)) continue;
    opened++;
    try {
      const resp = await page.goto(link, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      // A guessed page that does not exist is not a page that was searched.
      if (resp && resp.status() >= 400) { if (!USUAL_PAGES.some(p => link.endsWith(p))) searched.push(link); continue; }
      // Contact pages built by script need a moment, and so do Cloudflare's
      // decoders on the ones that are not.
      await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(400);
    } catch {
      continue;
    }
    const r = await look(link);
    // Links found on the contact page itself - "Request a quote" leading to
    // the one form page with the address - go on the end of the list.
    for (const l of r.contactLinks) if (!queue.includes(l)) queue.push(l);
    pick = pickBusinessEmail(all, siteUrl);
  }
  return { ...pick, searched, blocked: blocked && !pick.email, version: 3 };
}
