/**
 * Towns worth searching, so the area can be worked through without having to
 * already know what is out there.
 *
 * Grouped by drive time from Liberty, because that is the order the work is
 * actually worth doing in: a business twenty minutes away can be met in
 * person, and meeting in person is the whole advantage over a web design firm
 * in another state.
 *
 * These are starting points, not a boundary. Any town can be typed in by hand.
 */

export const REGIONS = [
  {
    key: "northland",
    name: "Northland — closest to Liberty",
    note: "Twenty minutes or less. Start here.",
    cities: [
      "Liberty, MO", "Kearney, MO", "Smithville, MO", "Excelsior Springs, MO",
      "Gladstone, MO", "North Kansas City, MO", "Pleasant Valley, MO", "Claycomo, MO",
      "Platte City, MO", "Parkville, MO", "Riverside, MO", "Lawson, MO",
      "Plattsburg, MO", "Holt, MO",
    ],
  },
  {
    key: "kc-metro-mo",
    name: "Kansas City metro — Missouri side",
    note: "Thirty to forty-five minutes.",
    cities: [
      "Kansas City, MO", "Independence, MO", "Blue Springs, MO", "Lee's Summit, MO",
      "Raytown, MO", "Grandview, MO", "Belton, MO", "Raymore, MO",
      "Sugar Creek, MO", "Grain Valley, MO", "Oak Grove, MO", "Harrisonville, MO",
      "Peculiar, MO", "Pleasant Hill, MO", "Richmond, MO",
    ],
  },
  {
    key: "kc-metro-ks",
    name: "Kansas City metro — Kansas side",
    note: "Across the state line, still the same metro.",
    cities: [
      "Overland Park, KS", "Olathe, KS", "Lenexa, KS", "Shawnee, KS",
      "Leawood, KS", "Prairie Village, KS", "Mission, KS", "Merriam, KS",
      "Kansas City, KS", "Bonner Springs, KS", "Gardner, KS", "Spring Hill, KS",
      "De Soto, KS", "Edwardsville, KS", "Roeland Park, KS",
    ],
  },
  {
    key: "wider",
    name: "Wider Missouri & Kansas",
    note: "An hour or more. Worth it once the closer towns are worked through.",
    cities: [
      "St. Joseph, MO", "Cameron, MO", "Warrensburg, MO", "Sedalia, MO",
      "Marshall, MO", "Lexington, MO", "Higginsville, MO", "Odessa, MO",
      "Leavenworth, KS", "Lansing, KS", "Tonganoxie, KS", "Basehor, KS",
      "Lawrence, KS", "Ottawa, KS", "Paola, KS", "Louisburg, KS", "Atchison, KS",
    ],
  },
];

/** Every town in one list, nearest group first. */
export const ALL_CITIES = REGIONS.flatMap(r => r.cities);

/** The towns for one group key, or everything when the key is "all". */
export function citiesFor(key) {
  if (!key || key === "all") return ALL_CITIES;
  return REGIONS.find(r => r.key === key)?.cities ?? [];
}
