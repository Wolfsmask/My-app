/**
 * Turns a raw audit into a 0-100 "does this business need a new website" score.
 *
 * Pure functions only — no network, no files. That is deliberate: this is the
 * part most likely to be wrong, so it has to be the part that is easiest to test.
 *
 * The weighting is the whole argument of this project. A slow site is not a
 * reason to email someone; most owners of slow sites do not care. An
 * embarrassing site is. So the score is three groups, deliberately unequal:
 *
 *   EMBARRASSMENT  70 pts — things an owner would wince at being shown
 *   DESIGN         30 pts — how it looks and how it is built
 *   PERFORMANCE    25 pts — real, but supporting evidence, never the headline
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

/**
 * How the site looks and how it is put together. Separate from the technical
 * checks above because a site can be perfectly responsive, perfectly secure,
 * and still look like it was made in 2006 — which is its own reason to call.
 */
export const DESIGN = [
  {
    id: "looks_dated",
    points: 12,
    label: "Looks a decade out of date",
    test: a => a.looksDated === true,
    evidence: a =>
      a.visualDecade
        ? `The design reads as ${a.visualDecade} — system-only fonts, no modern layout, built before responsive design was standard.`
        : `Built with pre-2013 techniques: ${a.datedSignals} of 5 dated-design markers present.`,
  },
  {
    id: "poor_first_impression",
    // Needs a measurement a plain page load does not produce, so it only
    // counts against a site when it was actually taken.
    optional: true,
    points: 8,
    label: "Puts customers off on sight",
    test: a => a.visualDesignScore != null && a.visualDesignScore <= 4,
    evidence: a =>
      a.visualFirstImpression
        ? `Rated ${a.visualDesignScore}/10 on first impression: "${a.visualFirstImpression}"`
        : `Rated ${a.visualDesignScore}/10 on visual first impression.`,
  },
  {
    id: "text_too_small",
    points: 4,
    label: "Body text too small to read on a phone",
    test: a => a.textTooSmall === true,
    evidence: a => `Body text is ${a.bodyFontSize}px. Below 14px is uncomfortable on a phone and readers give up.`,
  },
  {
    id: "tiny_tap_targets",
    points: 3,
    label: "Buttons and links too small to tap",
    test: a => a.tapTargetsTooSmall === true,
    evidence: a => `${a.tinyTapTargets} of ${a.tappableCount} links and buttons are under 32px tall — hard to hit with a thumb.`,
  },
  {
    id: "weak_structure",
    points: 3,
    label: "Page structure works against Google",
    test: a => a.hasStructureProblems === true,
    evidence: a => `Structural issues: ${(a.structureProblems || []).slice(0, 3).join("; ")}.`,
  },
];

/** Real, but supporting evidence — never the headline of an email. */
export const PERFORMANCE = [
  {
    id: "slow_lcp",
    // Needs a measurement a plain page load does not produce, so it only
    // counts against a site when it was actually taken.
    optional: true,
    points: 10,
    label: "Very slow to show content",
    test: a => a.lcpMs != null && a.lcpMs > 4000,
    evidence: a => `Main content takes ${(a.lcpMs / 1000).toFixed(1)}s to appear. Google's threshold for "good" is 2.5s.`,
  },
  {
    id: "low_lighthouse",
    // Needs a measurement a plain page load does not produce, so it only
    // counts against a site when it was actually taken.
    optional: true,
    points: 8,
    label: "Poor mobile performance score",
    test: a => a.lighthousePerf != null && a.lighthousePerf < 50,
    evidence: a => `Google rates this site ${a.lighthousePerf}/100 for mobile speed.`,
  },
  {
    id: "heavy_page",
    points: 4,
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

  let coreChecks = 0;
  let coreRan = 0;

  for (const check of [...EMBARRASSMENT, ...DESIGN, ...PERFORMANCE]) {
    const ran = didCheckRun(check, audit);
    if (!check.optional) { coreChecks++; if (ran) coreRan++; }

    // An optional check counts only when its measurement was taken - including
    // its points otherwise would mark every site down for a test that was
    // never run.
    //
    // A core check counts whether or not it ran. It used to be skipped, which
    // shrank the denominator: a page where only one check could be measured,
    // and it failed, scored 100 out of 100 and came out Tier A. The same
    // single fault on a fully measured page scored 25. Missing data must
    // never raise a score.
    if (check.optional && !ran) continue;

    possible += check.points;
    if (ran && check.test(audit)) {
      earned += check.points;
      hits.push({
        id: check.id,
        points: check.points,
        label: check.label,
        evidence: safeEvidence(check, audit),
        group: EMBARRASSMENT.includes(check) ? "embarrassment"
             : DESIGN.includes(check) ? "design"
             : "performance",
      });
    }
  }

  const value = possible === 0 ? 0 : Math.round((earned / possible) * 100);
  hits.sort((a, b) => b.points - a.points);

  // How much of the page could actually be examined. A score built on half an
  // audit is a guess, and the report says so rather than presenting it as a
  // measurement like any other.
  const confidence = coreChecks === 0 ? 0 : Math.round((coreRan / coreChecks) * 100);

  return { score: value, earned, possible, tier: tierFor(value), hits, confidence, coreRan, coreChecks };
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
    case "looks_dated":            return a.looksDated !== undefined && a.looksDated !== null;
    case "poor_first_impression":  return a.visualDesignScore != null;
    case "text_too_small":         return a.textTooSmall !== undefined && a.textTooSmall !== null;
    case "tiny_tap_targets":       return a.tapTargetsTooSmall !== undefined && a.tapTargetsTooSmall !== null;
    case "weak_structure":         return a.hasStructureProblems !== undefined && a.hasStructureProblems !== null;
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
