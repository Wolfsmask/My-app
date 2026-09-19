/**
 * Turns a raw audit into a 0-100 "does this business need a new website" score.
 *
 * Pure functions only — no network, no files. That is deliberate: this is the
 * part most likely to be wrong, so it has to be the part that is easiest to test.
 *
 * The weighting is the whole argument of this project. A slow site is not a
 * reason to email someone; most owners of slow sites do not care. An
 * embarrassing site is. So embarrassment signals carry 70% of the weight and
 * raw speed carries 30%.
 */

/** Signals a business owner would be embarrassed to have pointed out. */
export const EMBARRASSMENT = [
  {
    id: "not_responsive",
    points: 25,
    label: "Not readable on a phone",
    // The single strongest signal. Over half of local searches are mobile, so
    // this is lost revenue the owner can feel, not an abstract metric.
    test: a => a.isResponsive === false,
    evidence: a => `Page is ${a.mobileScrollWidth}px wide on a 390px phone screen — visitors have to pinch and drag to read it.`,
  },
  {
    id: "ssl_broken",
    points: 15,
    label: "Security warning in the browser",
    test: a => a.sslValid === false,
    evidence: a =>
      a.sslExpiredAt
        ? `Security certificate expired ${a.sslExpiredAt}. Chrome shows visitors a full-page "Not Secure" warning.`
        : `No working HTTPS. Chrome marks the site "Not Secure" in the address bar.`,
  },
  {
    id: "stale_copyright",
    points: 10,
    label: "Footer looks abandoned",
    test: a => a.copyrightYear != null && new Date().getFullYear() - a.copyrightYear >= 3,
    evidence: a => `Footer still says © ${a.copyrightYear}. To a first-time visitor that reads as "this business may have closed".`,
  },
  {
    id: "dead_platform",
    points: 10,
    label: "Built on obsolete technology",
    test: a => a.platformIsObsolete === true,
    evidence: a => `Running on ${a.platform}, which stopped being maintained. It is a security risk and it cannot be made fast.`,
  },
  {
    id: "broken_assets",
    points: 5,
    label: "Broken links or missing images",
    test: a => (a.brokenLinks || 0) + (a.brokenImages || 0) > 0,
    evidence: a => `${a.brokenLinks} broken link(s) and ${a.brokenImages} missing image(s) on the homepage alone.`,
  },
  {
    id: "no_contact",
    points: 5,
    label: "No way to make contact without scrolling",
    test: a => a.hasContactAboveFold === false,
    evidence: () => `No phone number, email or form visible without scrolling. Every extra scroll loses callers.`,
  },
];

/** Real, but supporting evidence — never the headline of an email. */
export const PERFORMANCE = [
  {
    id: "slow_lcp",
    points: 12,
    label: "Very slow to show content",
    test: a => a.lcpMs != null && a.lcpMs > 4000,
    evidence: a => `Main content takes ${(a.lcpMs / 1000).toFixed(1)}s to appear. Google's threshold for "good" is 2.5s.`,
  },
  {
    id: "low_lighthouse",
    points: 10,
    label: "Poor mobile performance score",
    test: a => a.lighthousePerf != null && a.lighthousePerf < 50,
    evidence: a => `Google rates this site ${a.lighthousePerf}/100 for mobile speed.`,
  },
  {
    id: "heavy_page",
    points: 5,
    label: "Very heavy page",
    test: a => a.pageWeightBytes != null && a.pageWeightBytes > 5_000_000,
    evidence: a => `Homepage downloads ${(a.pageWeightBytes / 1e6).toFixed(1)}MB — punishing on phone data.`,
  },
  {
    id: "unoptimised_images",
    points: 3,
    label: "Images not compressed",
    test: a => a.usesModernImages === false,
    evidence: () => `No modern image formats (WebP/AVIF). Images are several times larger than they need to be.`,
  },
];

/**
 * Reasons to drop a lead entirely and spend nothing further on it.
 * Checked before anything else, because the cheapest audit is the one
 * that never runs.
 */
export function disqualify(business, audit = {}) {
  if (!business.website) return "no_website";
  if (/facebook\.com|instagram\.com|linktr\.ee/i.test(business.website)) return "social_only";
  if (business.status && business.status !== "OPERATIONAL") return "closed";
  if (business.suppressed) return "suppressed";
  if (audit.fetchFailed) return "unreachable";
  return null;
}

/**
 * Can this business actually pay?
 *
 * Review count is the proxy. Real traffic data does not exist for businesses
 * this size at any sane price — Similarweb and friends are guessing below a
 * few hundred thousand visits, and their APIs cost hundreds a month. A
 * contractor with 180 reviews is demonstrably busy; one with 4 is not.
 */
export function qualifies(business, opts = {}) {
  const minReviews = opts.minReviews ?? 25;
  const minRating = opts.minRating ?? 3.8;
  const reasons = [];

  if ((business.reviewCount ?? 0) < minReviews) reasons.push(`only ${business.reviewCount ?? 0} reviews (need ${minReviews}+)`);
  if ((business.rating ?? 0) < minRating) reasons.push(`rated ${business.rating ?? "?"} (need ${minRating}+)`);
  if (!business.phone) reasons.push("no phone number listed");

  return { ok: reasons.length === 0, reasons };
}

/**
 * Score an audit.
 *
 * Only checks that actually ran count toward the maximum, so a run without a
 * PageSpeed key still produces a meaningful 0-100 number rather than silently
 * capping every lead at 70.
 */
export function score(audit) {
  const hits = [];
  let earned = 0;
  let possible = 0;

  for (const check of [...EMBARRASSMENT, ...PERFORMANCE]) {
    const ran = check.test(audit) !== null && didCheckRun(check, audit);
    if (!ran) continue;

    possible += check.points;
    if (check.test(audit)) {
      earned += check.points;
      hits.push({
        id: check.id,
        points: check.points,
        label: check.label,
        evidence: safeEvidence(check, audit),
        group: EMBARRASSMENT.includes(check) ? "embarrassment" : "performance",
      });
    }
  }

  const value = possible === 0 ? 0 : Math.round((earned / possible) * 100);
  hits.sort((a, b) => b.points - a.points);

  return { score: value, earned, possible, tier: tierFor(value), hits };
}

/** A check only counts if the data it needs was actually collected. */
function didCheckRun(check, a) {
  switch (check.id) {
    case "not_responsive":   return a.isResponsive !== undefined && a.isResponsive !== null;
    case "ssl_broken":       return a.sslValid !== undefined && a.sslValid !== null;
    case "stale_copyright":  return a.copyrightYear !== undefined;
    case "dead_platform":    return a.platformIsObsolete !== undefined && a.platformIsObsolete !== null;
    case "broken_assets":    return a.brokenLinks !== undefined || a.brokenImages !== undefined;
    case "no_contact":       return a.hasContactAboveFold !== undefined && a.hasContactAboveFold !== null;
    case "slow_lcp":         return a.lcpMs != null;
    case "low_lighthouse":   return a.lighthousePerf != null;
    case "heavy_page":       return a.pageWeightBytes != null;
    case "unoptimised_images": return a.usesModernImages !== undefined && a.usesModernImages !== null;
    default: return false;
  }
}

function safeEvidence(check, audit) {
  try { return check.evidence(audit); } catch { return check.label; }
}

export function tierFor(value) {
  if (value >= 70) return "A";
  if (value >= 50) return "B";
  if (value >= 25) return "C";
  return "D";
}

export const TIER_MEANING = {
  A: "Contact now — rebuilt demo + personally written email",
  B: "Contact — audit summary + templated email",
  C: "Hold. Re-check in 6 months",
  D: "Drop. Site is fine",
};
