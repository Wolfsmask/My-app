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

const UA = "MBOnyxAudit/1.0 (+https://mbonyx.netlify.app/)";

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

  const query = `[out:json][timeout:60];\n(\n  ${parts}\n);\nout center tags ${limit * 3};`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: "data=" + encodeURIComponent(query),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);

  const data = await res.json();
  const seen = new Set();
  const out = [];

  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    const website = t.website || t["contact:website"] || null;
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

async function geocode(place) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return null;
  const [hit] = await res.json();
  return hit ? { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon) } : null;
}

/* -------------------------------------------------------------------- File */

/**
 * Reads a hand-made list. One business per line, either just a website or
 * `Name, website, phone, rating, reviewCount`. Blank lines and #comments skipped.
 */
export function discoverFile(text, { category = "manual", city = "manual" } = {}) {
  return text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map((line, i) => {
      const [a, b, c, d, e] = line.split(",").map(s => (s ?? "").trim());
      const looksLikeUrl = s => /^(https?:\/\/|www\.|[\w-]+\.[a-z]{2,})/i.test(s);

      const name = looksLikeUrl(a) && !b ? a : a;
      const website = looksLikeUrl(a) ? a : b;

      return {
        sourceId: `file-${i}`,
        name,
        website: website ? (website.startsWith("http") ? website : `https://${website}`) : null,
        phone: c || null,
        rating: d ? parseFloat(d) : null,
        reviewCount: e ? parseInt(e, 10) : null,
        status: "OPERATIONAL",
        address: null,
        category,
        city,
        source: "file",
      };
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
