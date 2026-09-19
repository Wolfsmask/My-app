/**
 * Finds the website a business actually has.
 *
 * OpenStreetMap records a website for very few US small businesses, so a
 * search that only reports what OSM holds reports "no website" for companies
 * that plainly have one. That is the difference between a lead list and a
 * blank page, so this goes and looks.
 *
 * There is no free web-search API without a billing account, so the approach
 * is to guess the addresses a small business is likely to be at and then
 * actually load them. Guessing is cheap; the part that matters is refusing to
 * believe a guess. A wrong match here does not produce a bad row in a report -
 * it produces an email to the wrong company - so a candidate is only accepted
 * when the page it serves proves it belongs to this business.
 */

import { assertPublicTarget } from "./audit.js";

/** Words that are part of a company's legal name but never part of its domain. */
const LEGAL = new Set(["inc", "llc", "ltd", "lc", "co", "corp", "corporation", "company", "pllc", "lp", "plc"]);

/** Words too common to identify anyone. "Heating" does not prove a match. */
const GENERIC = new Set([
  "heating", "cooling", "air", "conditioning", "hvac", "plumbing", "plumber", "electric",
  "electrical", "roofing", "roof", "services", "service", "solutions", "systems", "mechanical",
  "contractors", "contracting", "the", "and", "of", "dental", "dentistry", "law", "legal",
  "restaurant", "gym", "fitness", "geothermal", "refrigeration", "sheet", "metal", "supply",
]);

/** Phrases that mean "this domain is not a business, it is for sale". */
const PARKED = [
  "domain is for sale", "buy this domain", "this domain may be for sale", "domain for sale",
  "parked free", "parking page", "sedoparking", "godaddy.com/forsale", "hugedomains",
  "namecheap parking", "future home of something quite cool", "coming soon", "under construction",
  "default web page", "welcome to nginx", "apache2 ubuntu default page", "it works!",
];

/** Strips a business name down to the words that might appear in a domain. */
export function nameTokens(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")            // O'Brien -> obrien, Buckner's -> buckners
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(w => w && !LEGAL.has(w));
}

/**
 * The word that makes this business identifiable - usually the family or place
 * name. Used as the proof a page must carry, so it deliberately skips the
 * trade words that every competitor also uses.
 */
export function distinctiveToken(name) {
  const own = nameTokens(name).filter(w => !GENERIC.has(w));
  // Prefer a word long enough to be a name, but a short one is better than
  // none: "ECS Geothermal" is identified by "ecs" and nothing else.
  return own.find(w => w.length >= 4) ?? own[0] ?? null;
}

/** The rest of the business's own words, used as corroboration. */
export function supportingTokens(name) {
  const distinctive = distinctiveToken(name);
  return nameTokens(name).filter(w => w !== distinctive && w !== "and" && w.length >= 3);
}

/**
 * Addresses a small business is plausibly at, best guess first.
 *
 * Deliberately bounded. Each candidate is a real request to someone else's
 * server, and the difference between 8 guesses and 40 is a great many requests
 * for a handful more matches.
 */
export function candidateDomains(name, { limit = 8, tlds = ["com", "net"] } = {}) {
  const tokens = nameTokens(name);
  if (!tokens.length) return [];

  const [first] = tokens;
  const trade = tokens.find(t => GENERIC.has(t));
  const singular = first.endsWith("s") ? first.slice(0, -1) : null;

  // No bare single-word stems. "wilson.com" is Wilson Sporting Goods and its
  // pages do say "wilson", so a one-word guess is the one shape that can both
  // answer and wrongly prove itself. The cost of dropping it is a few real
  // matches; the cost of keeping it is emailing the wrong company.
  const stems = [
    tokens.join(""),                                   // bucknersheatingandcooling
    tokens.filter(t => t !== "and").join(""),          // bucknersheatingcooling
    trade ? first + trade : null,                      // bucknersheating
    first + "hvac",
    singular && trade ? singular + trade : null,       // bucknerheating
    tokens.length > 1 ? tokens.slice(0, 2).join("") : null,
  ].filter(Boolean);

  const out = [];
  for (const tld of tlds) {
    for (const stem of stems) {
      if (stem.length < 3) continue;
      const domain = `${stem}.${tld}`;
      if (!out.includes(domain)) out.push(domain);
    }
  }
  return out.slice(0, limit);
}

/**
 * Does this page belong to this business?
 *
 * The bar is the distinctive word appearing in the page's own text. That is
 * what separates "bucknersheating.com is Buckner's" from "we guessed a domain
 * and someone answered".
 */
export function pageProvesBusiness(html, name, { city = "" } = {}) {
  const token = distinctiveToken(name);
  if (!token) return { ok: false, why: "the name has no distinctive word to check for" };

  const text = String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|#38);/gi, " and ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&(?:#39|#8217|apos|rsquo);/gi, "")
    // The page must be read the same way the name was. Names are stripped of
    // apostrophes to match domains ("Buckner's" -> "buckners"), so a page
    // saying "Buckner's" has to be stripped too or it never matches - and
    // apostrophes are everywhere in small business names.
    .replace(/['\u2019]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

  const parked = PARKED.find(p => text.includes(p));
  if (parked) return { ok: false, why: `looks like a parked domain ("${parked}")` };
  if (text.length < 200) return { ok: false, why: "almost no text on the page" };
  if (!text.includes(token)) return { ok: false, why: `the page never says "${token}"` };

  // One matching word is not proof. A big unrelated company can share a
  // family name, so the page must also carry something else from this
  // business - one of its other words, or the town it works in.
  const town = String(city).split(",")[0].trim().toLowerCase();
  const support = supportingTokens(name).filter(w => text.includes(w));
  const saysTown = town.length >= 4 && text.includes(town);
  if (!support.length && !saysTown) {
    return { ok: false, why: `says "${token}" but nothing else about this business` };
  }

  return { ok: true, why: `the page says "${token}"${support.length ? ` and "${support[0]}"` : ` and "${town}"`}` };
}

/**
 * Where a guessed domain is actually fetched from. Overridable so the search
 * can be driven against a local stand-in; nothing but tests should set it.
 */
const defaultUrlFor = domain => {
  const base = process.env.MBONYX_RESOLVE_BASE;
  return base ? `${base.replace(/\/$/, "")}/${encodeURIComponent(domain)}` : `https://${domain}`;
};

/**
 * Tries the candidates for one business and returns the first that proves
 * itself, or null. Never throws for an ordinary miss - a business with no
 * findable site is a normal outcome, not an error.
 */
export async function resolveWebsite(business, {
  allowLocal = false,
  timeoutMs = 8000,
  limit = 8,
  urlFor = defaultUrlFor,
  fetchImpl = fetch,
  signal,
} = {}) {
  if (business.website) return { website: business.website, via: "listed", why: "OpenStreetMap had it" };

  const tried = [];
  for (const domain of candidateDomains(business.name, { limit })) {
    if (signal?.aborted) break;
    const url = urlFor(domain);

    try {
      await assertPublicTarget(new URL(url).hostname, { allowLocal });
    } catch {
      tried.push(`${domain}: refused as a local address`);
      continue;
    }

    let res;
    try {
      res = await fetchImpl(url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MBOnyx lead checker)" },
        // Both, not either: the caller's signal says "the user pressed Stop",
        // the timeout says "this server is not answering". Using the caller's
        // signal alone leaves a hung request with nothing to end it.
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
    } catch {
      tried.push(`${domain}: did not answer`);
      continue;
    }

    if (!res.ok) { tried.push(`${domain}: ${res.status}`); continue; }

    const html = await res.text().catch(() => "");
    const proof = pageProvesBusiness(html, business.name, { city: business.city });
    if (!proof.ok) { tried.push(`${domain}: ${proof.why}`); continue; }

    // res.url follows redirects, so a business at a different final address is
    // recorded where it actually lives rather than where it was guessed.
    return { website: res.url || url, via: "found", why: proof.why, tried };
  }

  return null;
}
