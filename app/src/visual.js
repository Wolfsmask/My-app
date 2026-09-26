/**
 * Looks at how a site is *built* and how it *looks* — the two things the
 * technical audit in audit.js misses.
 *
 * Two passes:
 *   structure()  Free, deterministic, always runs. Reads the DOM for the
 *                fingerprints of a site that has aged badly.
 *   vision()     Optional. Sends the screenshot to Claude and asks what a
 *                customer would think of it. Costs about a tenth of a cent.
 *
 * Neither pass invents anything. Every field here is something that was
 * actually measured or actually observed, because these values end up quoted
 * in an email to a stranger.
 */

import fs from "node:fs";

/** Font stacks that were normal in 2005 and are a tell today. */
const SYSTEM_ONLY_FONTS = /^(arial|helvetica|times|times new roman|verdana|georgia|tahoma|courier|comic sans ms|serif|sans-serif|monospace)$/i;

/**
 * Structural analysis. Runs inside the already-open page, so it costs nothing
 * beyond the page load the audit already paid for.
 */
export async function structure(page) {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll("body *")];
    const vis = el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    // --- Semantic markup -----------------------------------------------
    const semantic = ["header", "nav", "main", "footer", "article", "section", "aside"]
      .filter(t => document.querySelector(t));

    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .map(h => parseInt(h.tagName[1], 10));
    let headingSkips = 0;
    for (let i = 1; i < headings.length; i++) {
      if (headings[i] - headings[i - 1] > 1) headingSkips++;
    }

    // --- Typography ------------------------------------------------------
    const fontFamilies = new Set();
    const fontSizes = [];
    let inlineStyled = 0;
    const colors = new Set();

    for (const el of all) {
      if (el.getAttribute && el.getAttribute("style")) inlineStyled++;
      if (!vis(el)) continue;
      const cs = getComputedStyle(el);
      const first = (cs.fontFamily || "").split(",")[0].replace(/["']/g, "").trim();
      if (first) fontFamilies.add(first);
      if (el.childElementCount === 0 && (el.textContent || "").trim().length > 25) {
        fontSizes.push(parseFloat(cs.fontSize));
      }
      if (cs.color) colors.add(cs.color);
      if (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)") colors.add(cs.backgroundColor);
    }

    fontSizes.sort((a, b) => a - b);
    const bodyFontSize = fontSizes.length
      ? fontSizes[Math.floor(fontSizes.length / 2)]  // median beats mean here
      : parseFloat(getComputedStyle(document.body).fontSize);

    /*
      Tap targets.

      Only controls styled as buttons count. An inline link inside a sentence
      is ~20px tall on every well-built site in existence, so counting those
      flags good sites as broken — measured on five hand-built sites that all
      tripped the naive version of this check.

      What counts is something a visitor is meant to press: a real <button>,
      a submit input, an element with role=button, or a link the designer gave
      a background, a border, or real padding.
    */
    const tappable = [...document.querySelectorAll("a,button,input[type=submit],[role=button]")]
      .filter(vis)
      .filter(el => {
        if (el.tagName !== "A") return true;          // buttons always count
        const cs = getComputedStyle(el);
        const hasBg = cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)";
        const hasBorder = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0;
        const padded = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) >= 12;
        return hasBg || hasBorder || padded;
      });

    // Apple and Google both publish ~44px as the comfortable minimum; 32px is
    // the point below which mis-taps become common, so that is the line here.
    const tinyTargets = tappable.filter(el => {
      const r = el.getBoundingClientRect();
      return r.height < 32 || (r.width < 32 && (el.textContent || "").trim().length < 3);
    }).length;

    // --- Images ----------------------------------------------------------
    const images = [...document.images];
    const missingAlt = images.filter(i => !i.getAttribute("alt")).length;
    // An image displayed much larger than its file is a stretched, blurry image.
    const stretched = images.filter(i => {
      const r = i.getBoundingClientRect();
      return i.naturalWidth > 0 && r.width > i.naturalWidth * 1.5 && r.width > 200;
    }).length;

    // --- Layout ----------------------------------------------------------
    const hasFlexOrGrid = all.some(el => {
      const d = getComputedStyle(el).display;
      return d === "flex" || d === "grid";
    });
    const layoutTables = [...document.querySelectorAll("table")]
      .filter(t => !t.querySelector("th") && t.querySelectorAll("td").length > 3).length;

    return {
      semanticTags: semantic,
      semanticTagCount: semantic.length,
      h1Count: document.querySelectorAll("h1").length,
      headingCount: headings.length,
      headingSkips,
      fontFamilies: [...fontFamilies].slice(0, 12),
      bodyFontSize: Math.round(bodyFontSize * 10) / 10,
      distinctFontCount: fontFamilies.size,
      distinctColorCount: colors.size,
      inlineStyledElements: inlineStyled,
      elementCount: all.length,
      tappableCount: tappable.length,
      tinyTapTargets: tinyTargets,
      imageCount: images.length,
      missingAlt,
      stretchedImages: stretched,
      usesFlexOrGrid: hasFlexOrGrid,
      layoutTables,
    };
  });
}

/**
 * Turns raw structure numbers into the two booleans the scorer consumes.
 * Kept separate from the measuring so it can be unit-tested without a browser.
 */
export function interpretStructure(s) {
  if (!s) return {};

  const webFontsUsed = (s.fontFamilies || []).some(f => !SYSTEM_ONLY_FONTS.test(f));
  const inlineRatio = s.elementCount ? s.inlineStyledElements / s.elementCount : 0;

  /*
    "Dated" is a cluster, not any one thing. A site can legitimately use system
    fonts. But a site with system-only fonts AND no flex/grid AND table layout
    was built before roughly 2013 and has not been touched since.
  */
  const datedSignals = [
    !webFontsUsed,
    !s.usesFlexOrGrid,
    s.layoutTables > 0,
    s.semanticTagCount <= 1,
    inlineRatio > 0.25,
  ].filter(Boolean).length;

  const structureProblems = [];
  if (s.h1Count === 0) structureProblems.push("no main heading (hurts Google)");
  else if (s.h1Count > 2) structureProblems.push(`${s.h1Count} competing main headings`);
  if (s.headingSkips > 0) structureProblems.push("headings skip levels");
  if (s.semanticTagCount <= 1) structureProblems.push("no semantic layout tags");
  if (s.missingAlt > 0) structureProblems.push(`${s.missingAlt} image(s) with no alt text`);

  return {
    looksDated: datedSignals >= 3,
    datedSignals,
    usesWebFonts: webFontsUsed,
    inlineStyleRatio: Math.round(inlineRatio * 100) / 100,
    textTooSmall: s.bodyFontSize > 0 && s.bodyFontSize < 14,
    // Needs a real sample before it means anything, and a clear majority —
    // one cramped button on an otherwise fine site is not a reason to call.
    tapTargetsTooSmall: s.tappableCount >= 5 && s.tinyTapTargets / s.tappableCount > 0.5,
    structureProblems,
    hasStructureProblems: structureProblems.length >= 2,
  };
}

/* ------------------------------------------------------------------ vision */

const VISION_SYSTEM = `You judge small-business websites the way a potential customer would in the first three seconds.

You are given a screenshot of a homepage as it appears on a phone.

Rate it honestly. Most small-business sites are mediocre, not terrible — do not inflate problems, and do not be polite about real ones. A clean simple site is a good site; "boring" is not a flaw.

Score 1-10 where:
  1-3  Actively drives customers away. Looks broken, abandoned, or untrustworthy.
  4-6  Dated but functional. Works, looks like nobody has touched it in years.
  7-8  Solid, current, no obvious problems.
  9-10 Genuinely well designed.

Judge only what is visible in the screenshot. Never guess at the business's
quality, prices, or reputation — you are looking at a picture of a web page.`;

/**
 * Asks Claude what a customer would think of the screenshot.
 *
 * Returns null (rather than throwing) when there is no API key or the call
 * fails, because a missing visual score must never take down a whole run.
 *
 * On image size: the screenshots are 780x1688 (390x844 at deviceScaleFactor 2)
 * and are sent as captured. Opus 5 accepts up to 2576px on the long edge, so
 * nothing is resampled server-side, and at roughly 1,750 image tokens each
 * they sit well under the per-image ceiling. Do not add downsampling to "save
 * tokens" — this is a judgement about how a page looks, which is exactly the
 * workload that wants the fidelity.
 */
export async function vision(screenshotPath, { client, model = "claude-opus-5" } = {}) {
  if (!client || !screenshotPath || !fs.existsSync(screenshotPath)) return null;

  const { z } = await import("zod");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");

  const Judgement = z.object({
    design_score: z.number().int().min(1).max(10),
    looks_like_decade: z.string().describe('e.g. "2005", "mid 2010s", "current"'),
    first_impression: z.string().describe("One sentence, as a customer would say it."),
    visible_problems: z.array(z.string()).describe(
      "Specific things visible in the screenshot. Empty if the site looks fine."
    ),
    would_trust_with_money: z.boolean(),
  });

  try {
    const res = await client.messages.parse({
      model,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(Judgement) },
      system: [{ type: "text", text: VISION_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: fs.readFileSync(screenshotPath).toString("base64"),
            },
          },
          { type: "text", text: "Judge this homepage." },
        ],
      }],
    });
    return res.parsed_output ?? null;
  } catch (e) {
    return { error: e.message.slice(0, 160) };
  }
}

/**
 * Front-end libraries that pin a build to a period.
 *
 * These are the most reliable age markers there are, and they cost nothing:
 * a site shipping jQuery 1.11, Bootstrap 3 and Font Awesome 4 was built
 * around 2014 and has not been touched since, whatever its copyright line
 * says. Read from the HTML source rather than the DOM, because that is where
 * the version numbers survive.
 */
export function detectOldLibraries(html = "") {
  const found = [];
  const seen = new Set();
  const add = (name, era) => { if (!seen.has(name)) { seen.add(name); found.push({ name, era }); } };

  // jQuery 3 is current and says nothing. 1.x and 2.x do.
  const jq = html.match(/jquery[.-]?(?:min\.)?(?:js)?[^"'>]*?[?v=/-](1|2)\.(\d+)\.(\d+)/i)
          || html.match(/jquery[/-](1|2)\.(\d+)\.(\d+)[^"']*\.js/i);
  if (jq) add(`jQuery ${jq[1]}.${jq[2]}`, jq[1] === "1" ? 2013 : 2015);

  if (/bootstrap[/-]?3\.\d|navbar-default|glyphicon|col-(xs|sm|md|lg)-\d/i.test(html)) add("Bootstrap 3", 2014);
  if (/bootstrap[/-]?2\.\d|span\d{1,2}["'\s].*?row-fluid/i.test(html)) add("Bootstrap 2", 2012);
  if (/font-?awesome[/-]?4\.\d|class=["'][^"']*\bfa fa-/i.test(html)) add("Font Awesome 4", 2014);
  if (/revslider|rev_slider|revolution-slider/i.test(html)) add("Revolution Slider", 2013);
  if (/owl\.carousel|owl-carousel/i.test(html)) add("Owl Carousel", 2013);
  if (/nivo-?slider/i.test(html)) add("Nivo Slider", 2011);
  if (/flexslider/i.test(html)) add("FlexSlider", 2012);
  if (/prettyphoto|fancybox[/-]?1\./i.test(html)) add("prettyPhoto", 2011);
  if (/modernizr[.-](1|2)\./i.test(html)) add("Modernizr 2", 2012);
  if (/<script[^>]+src=["'][^"']*swfobject/i.test(html)) add("SWFObject (Flash)", 2008);

  return found;
}

/** Body fonts that were the default choice of a particular few years. */
const ERA_FONTS = /^(open sans|lato|pt sans|droid sans|source sans pro|raleway|ubuntu|cabin|oxygen|istok web|arvo|museo sans)$/i;

/**
 * How old the design looks, as opposed to how old the code is.
 *
 * The two are not the same, and conflating them was the bug. A restaurant
 * site built last year on a 2014 template is modern code and a dated design;
 * a hand-written 2006 page that has aged gracefully is old code and an
 * unremarkable design. What gets an owner to reply is the first one, and the
 * old detector scored it zero.
 *
 * Ten markers, five about construction and five about composition. The score
 * is out of six rather than ten, deliberately: a site does not have to be
 * wrong in every possible way to look a decade old, and requiring that is how
 * two and a half thousand sites ended up in the bottom tier.
 */
export function visualAge(input = {}) {
  const {
    oldLibraries = [], bodyFontName = "", biggestHeadingPx = null,
    chromeStyling = null, sectionRhythmPx = null,
    usesWebFonts = null, usesFlexOrGrid = null, layoutTables = 0,
    semanticTagCount = null, inlineStyleRatio = 0,
    elementCount = null, contentWidthPct = null,
  } = input;

  const markers = [];
  const mark = (era, why) => markers.push({ era, why });

  /*
    Some markers only mean anything on a page with a design to speak of.

    A one-column shop page with a phone number and a list of services has no
    flexbox and no <section> tags because it has nothing to lay out, not
    because it was built in 2009. Counting those against it put a perfectly
    serviceable little site in the same tier as a rotting template. The gate
    is element count: below about sixty elements there is no layout to judge.
  */
  const isDesigned = elementCount === null || elementCount >= 60;
  // Likewise a headline: 26px is small across a full screen and perfectly
  // proportionate on a page that is only a phone's width wide.
  const fillsScreen = contentWidthPct === null || contentWidthPct >= 60;

  // --- Construction ---------------------------------------------------
  if (usesWebFonts === false) mark(2012, "system-only fonts");
  if (isDesigned && usesFlexOrGrid === false) mark(2015, "no flexbox or grid anywhere");
  if (layoutTables > 0) mark(2008, "laid out with tables");
  if (isDesigned && semanticTagCount !== null && semanticTagCount <= 1) mark(2012, "no semantic layout tags");
  if (inlineStyleRatio > 0.25) mark(2010, "styling written into the markup");

  // --- Composition ----------------------------------------------------
  if (oldLibraries.length) {
    const oldest = Math.min(...oldLibraries.map(l => l.era));
    mark(oldest, `still running ${oldLibraries.slice(0, 3).map(l => l.name).join(", ")}`);
  }
  if (bodyFontName && ERA_FONTS.test(bodyFontName.trim())) mark(2013, `${bodyFontName} as the body font`);
  if (fillsScreen && biggestHeadingPx !== null && biggestHeadingPx < 34) mark(2016, `headlines only ${biggestHeadingPx}px across a full screen`);
  if (chromeStyling !== null && chromeStyling >= 35) mark(2011, "gradients, bevels and text shadows on buttons and headings");
  if (sectionRhythmPx !== null && sectionRhythmPx < 40) mark(2015, `only ${sectionRhythmPx}px of space between sections`);

  const signals = markers.length;
  /*
    Six is "full marks" rather than ten. Measured against the fixtures: the
    2011 table-layout page hits 7, a bought-in 2014 template hits 4-5, and a
    site built this year hits 0-1. Dividing by ten would have scored that
    template at 40% of the points when it is plainly most of the way to a
    rebuild; dividing by six puts it where a person would put it.
  */
  const share = Math.min(1, signals / 6);

  /*
    When the design reads from, taken from the markers rather than from how
    many there are.

    Counting them put a table-layout FrontPage page and a 2014 Bootstrap
    template in the same decade, which is visibly wrong to anyone looking at
    the two. The median marker is the fairest single answer, except that
    laying a page out with tables or shipping Flash is on its own conclusive -
    nobody did either after about 2008 - so those decide it outright.
  */
  const eras = markers.map(m => m.era).sort((a, b) => a - b);
  let decade = null;
  if (eras.length) {
    const conclusive = eras[0] <= 2008;
    const era = conclusive ? eras[0] : eras[Math.floor(eras.length / 2)];
    decade = era <= 2009 ? "the mid-2000s"
           : era <= 2012 ? "around 2010"
           : era <= 2015 ? "the early 2010s"
           : "the mid-2010s";
  }

  return {
    visualAgeSignals: signals,
    visualAgeShare: Math.round(share * 100) / 100,
    visualAgeMarkers: markers,
    visualAgeEra: eras.length ? (eras[0] <= 2008 ? eras[0] : eras[Math.floor(eras.length / 2)]) : null,
    visualDecade: decade,
    looksDated: signals >= 2,
  };
}
