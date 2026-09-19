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
