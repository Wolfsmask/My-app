/**
 * Finds businesses to audit. Three sources, in order of how good the data is.
 *
 *   places  Google Places API (New). The only source with review counts, which
 *           is what tells you whether a business can afford you. Needs a key.
 *   osm     OpenStreetMap via Overpass. Free, no key, no signup — but US
 *           coverage of small trade businesses is patchy and there are no
 *           ratings at all, so the "can they pay" filter cannot run.
 *   file    A list of websites you collected yourself. Zero setup, and the
 *           fastest way to sanity-check the scoring on sites you already know.
 */

/**
 * Nominatim requires a contactable User-Agent, so this identifies the tool and
 * where to complain. It deliberately avoids the "Name/1.0 (+https://site/)"
 * shape used by search-engine crawlers, which bot filters match on.
 */
const UA = "MBOnyx lead checker - contact mbonyxstudios@gmail.com";

/**
 * The two OpenStreetMap endpoints, overridable so the search can be driven
 * against a local stand-in in tests. Nothing but tests should set these — the
 * defaults are the real public services.
 *
 * Read when they are used rather than when this file loads: a test that starts
 * its stand-in server has no port to point at until it is listening, which is
 * after the import. Reading at load time made the override silently miss and
 * sent the tests at the real service instead.
 */
const overpassUrls = () => (process.env.MBONYX_OVERPASS_URL || [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
].join(",")).split(",").map(u => u.trim()).filter(Boolean);
const nominatimUrl = () => process.env.MBONYX_NOMINATIM_URL || "https://nominatim.openstreetmap.org/search";

/* ------------------------------------------------------------------ Places */

const PLACES_FIELDS = [
  "places.id",
  "places.displayName",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.formattedAddress",
].join(",");

export async function discoverPlaces({ category, city, limit = 60, apiKey }) {
  if (!apiKey) throw new Error("GOOGLE_PLACES_KEY is not set. Use --source osm or --source file instead.");

  const out = [];
  let pageToken;

  while (out.length < limit) {
    const body = { textQuery: `${category} in ${city}`, maxResultCount: 20 };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACES_FIELDS + ",nextPageToken",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) throw new Error(`Places API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();

    for (const p of data.places ?? []) {
      out.push({
        sourceId: p.id,
        name: p.displayName?.text ?? "(unnamed)",
        website: p.websiteUri ?? null,
        phone: p.nationalPhoneNumber ?? null,
        rating: p.rating ?? null,
        reviewCount: p.userRatingCount ?? null,
        status: p.businessStatus ?? null,
        address: p.formattedAddress ?? null,
        category,
        city,
        source: "places",
      });
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
    // The API needs a moment before a page token becomes valid.
    await sleep(2000);
  }

  return out.slice(0, limit);
}

/* --------------------------------------------------------------------- OSM */

/** OSM tags that map to the verticals worth prospecting. */
const OSM_TAGS = {
  hvac:       ['["craft"="hvac"]', '["shop"="hvac"]', '["craft"="heating_engineer"]'],
  plumber:    ['["craft"="plumber"]'],
  roofer:     ['["craft"="roofer"]'],
  electrician:['["craft"="electrician"]'],
  dentist:    ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
  lawyer:     ['["office"="lawyer"]'],
  restaurant: ['["amenity"="restaurant"]'],
  gym:        ['["leisure"="fitness_centre"]'],
};

/**
 * The same list in a form the app's window can build a dropdown from, so the
 * choices offered can never drift from the tags the search actually knows.
 * A key with no friendly label here still appears, under its own name.
 */
const OSM_LABELS = {
  hvac: "HVAC / heating & cooling",
  plumber: "Plumber",
  roofer: "Roofer",
  electrician: "Electrician",
  dentist: "Dentist",
  lawyer: "Lawyer",
  restaurant: "Restaurant",
  gym: "Gym",
};

export const OSM_CATEGORIES = Object.keys(OSM_TAGS)
  .map(key => ({ key, label: OSM_LABELS[key] ?? key }))
  .sort((a, b) => a.label.localeCompare(b.label));

export async function discoverOsm({ category, city, limit = 60, radiusKm = 25 }) {
  const tags = OSM_TAGS[category];
  if (!tags) {
    throw new Error(`No OSM mapping for "${category}". Known: ${Object.keys(OSM_TAGS).join(", ")}`);
  }

  const geo = await geocode(city);
  if (!geo) throw new Error(`Could not find "${city}" on the map.`);

  const radius = Math.round(radiusKm * 1000);
  const parts = tags
    .flatMap(tag => ["node", "way"].map(kind => `${kind}${tag}(around:${radius},${geo.lat},${geo.lon});`))
    .join("\n  ");

  // Modifier order matters: [ids|skel|body|tags|meta] [geom|bb|center] [number].
  // This read "out center tags N", which is the wrong way round.
  const query = `[out:json][timeout:60];\n(\n  ${parts}\n);\nout tags center ${limit * 3};`;

  const data = await askOverpass(query);
  const seen = new Set();
  const out = [];

  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    // OpenStreetMap has no single agreed tag for a website, so all the ones in
    // real use are checked. Even so, most US small businesses have none of
    // them recorded, which is why the app also goes looking (src/resolve.js).
    const website = t.website || t["contact:website"] || t["website:official"] ||
                    t.url || t["contact:url"] || t["operator:website"] || t["brand:website"] || null;
    const name = t.name;
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    out.push({
      sourceId: `osm-${el.type}-${el.id}`,
      name,
      website: website && website.startsWith("http") ? website : website ? `https://${website}` : null,
      phone: t.phone || t["contact:phone"] || null,
      // OpenStreetMap holds no ratings. The qualification filter is skipped
      // for these leads, and the CLI says so rather than silently passing them.
      rating: null,
      reviewCount: null,
      status: "OPERATIONAL",
      address: [t["addr:housenumber"], t["addr:street"], t["addr:city"]].filter(Boolean).join(" ") || null,
      category,
      city,
      source: "osm",
    });
    if (out.length >= limit) break;
  }

  return out;
}

/**
 * Puts a query to Overpass, trying each public instance in turn.
 *
 * Every instance is a free service run by volunteers, and any of them can be
 * busy, rate-limiting, or refusing a request outright. One refusing is normal
 * and should not end the search, so a refusal moves on to the next.
 *
 * The query goes in as the raw body, which is the form every instance accepts;
 * the form-encoded "data=" wrapper is also documented but is the one that was
 * being refused with a bare 406 in the field.
 *
 * Whatever the server said is carried into the error. Reporting only the status
 * code, as this used to, turned an explanation the server had already written
 * into an unactionable number.
 */
async function askOverpass(query) {
  const tried = [];

  for (const url of overpassUrls()) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8", "Accept": "application/json", "User-Agent": UA },
        body: query,
        signal: AbortSignal.timeout(90000),
      });
    } catch (e) {
      tried.push(`${host(url)}: ${e.name === "TimeoutError" ? "timed out" : e.message}`);
      continue;
    }

    if (res.ok) {
      try {
        return await res.json();
      } catch {
        // A 200 carrying an HTML error page is a refusal wearing the wrong hat.
        tried.push(`${host(url)}: replied with something that was not JSON`);
        continue;
      }
    }

    const said = (await res.text().catch(() => "")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    tried.push(`${host(url)}: ${res.status}${said ? ` - ${said.slice(0, 160)}` : ""}`);
  }

  throw new Error(
    `No OpenStreetMap server would answer. They are free services and do turn ` +
    `requests away when busy, so this is often worth retrying in a few minutes. ` +
    `If it keeps happening, paste a list in by hand instead.\n  ${tried.join("\n  ")}`,
  );
}

const host = url => { try { return new URL(url).host; } catch { return url; } };

async function geocode(place) {
  const url = `${nominatimUrl()}?q=${encodeURIComponent(place)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return null;
  const [hit] = await res.json();
  return hit ? { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon) } : null;
}

/* -------------------------------------------------------------------- File */

/**
 * Reads a hand-made list. One business per line:
 *
 *   acehvac.com
 *   Bob's Heating, Inc, bobsheating.com, (555) 111-2222, 4.5, 87
 *
 * Blank lines and #comments are skipped.
 *
 * Fields are located by *shape*, not by position. Splitting on commas and
 * assuming field 1 is the website breaks on any name containing a comma —
 * "Inc", "LLC", "Co." — and those lines produced `website: "https://Inc"`,
 * which then failed to load and was reported as an unreachable business. That
 * silently discarded real leads, which is the worst thing this file can do.
 */
export function discoverFile(text, { category = "manual", city = "manual" } = {}) {
  const looksLikeUrl = s =>
    /^(https?:\/\/|www\.)/i.test(s) ||
    // bare domain: at least one dot and a plausible TLD, and no spaces
    (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s) && /\.[a-z]{2,}(\/|$)/i.test(s));

  return text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map((line, i) => {
      const fields = line.split(",").map(s => s.trim());
      const urlAt = fields.findIndex(looksLikeUrl);

      // Everything before the website is the name, commas and all.
      const rawName = urlAt > 0 ? fields.slice(0, urlAt).join(", ").trim() : "";
      const website = urlAt >= 0 ? fields[urlAt] : null;
      const [phone, rating, reviews] = urlAt >= 0 ? fields.slice(urlAt + 1) : [];

      const url = website
        ? (/^https?:\/\//i.test(website) ? website : `https://${website}`)
        : null;

      return {
        sourceId: `file-${i}`,
        // A line that is only a URL still needs a readable name for the report
        // and for the draft email, so derive one from the domain.
        name: rawName || (url ? nameFromUrl(url) : line),
        website: url,
        phone: phone || null,
        rating: rating && !Number.isNaN(parseFloat(rating)) ? parseFloat(rating) : null,
        reviewCount: reviews && !Number.isNaN(parseInt(reviews, 10)) ? parseInt(reviews, 10) : null,
        status: "OPERATIONAL",
        address: null,
        category,
        city,
        source: "file",
      };
    });
}

/** "https://www.bobs-heating.com/x" -> "Bobs Heating" */
function nameFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host
      .split(".")
      .slice(0, -1)
      .join(" ")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase()) || host;
  } catch {
    return url;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
