/**
 * Writes the outreach email for one lead, without needing an API key.
 *
 * src/email.js does this with Claude and is better at it, but it needs an
 * Anthropic key and therefore a billing account. This writes from the same
 * verified findings using sentences chosen in advance, so the tool is useful
 * on day one and the draft can still be edited before it is sent.
 *
 * Four things are being aimed at, in this order:
 *
 *   Nothing invented.  Every number in the email is one that was measured.
 *                      A single made-up figure turns "someone who looked at my
 *                      site" into "a bot that also lies".
 *   Legal.             US commercial email must not mislead, must identify who
 *                      is sending, must carry a real postal address, and must
 *                      offer a way to be left alone. The address is the one
 *                      thing this file cannot supply, so it refuses to call a
 *                      draft ready without it.
 *   Not a form letter. The opening, the framing and the close vary with the
 *                      business, so two owners who know each other do not
 *                      compare notes and find the same email.
 *   Worth replying to. It leads with something the owner can check on their
 *                      own phone in ten seconds. Nothing else in a cold email
 *                      earns attention as reliably as being demonstrably right.
 */

/** Deterministic, so the same business always gets the same email. */
function pick(options, seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return options[h % options.length];
}

/** The finding worth leading with: the one that costs them the most. */
function headline(findings) {
  return [...findings].sort((a, b) => b.points - a.points)[0] ?? null;
}

/**
 * How each problem is described to an owner - in terms of what it costs them,
 * not what it is called. "Not responsive" means nothing; "people give up and
 * call the next one" is the same fact in their language.
 */
/**
 * The measurement, said the way an owner would say it.
 *
 * The raw evidence line is written for the report - "Page is 980px wide on a
 * 390px phone screen" is exact and unreadable. These carry the same numbers
 * into a sentence a person would actually write, because the number has to
 * survive: it is the thing that proves the page was really looked at.
 */
const OBSERVE = {
  not_responsive: a => `Opened on a phone it comes out about ${a.mobileScrollWidth} pixels wide, so the screen only shows part of it at a time.`,
  ssl_broken: () => `The security certificate has lapsed, so browsers show a warning page before anyone reaches the site.`,
  stale_copyright: a => `The footer still says ${a.copyrightYear}.`,
  dead_platform: a => `It looks like it was built with ${a.platform}.`,
  broken_assets: a => {
    const bits = [];
    if (a.brokenLinks) bits.push(`${a.brokenLinks} link${a.brokenLinks === 1 ? '' : 's'} that go nowhere`);
    if (a.brokenImages) bits.push(`${a.brokenImages} image${a.brokenImages === 1 ? '' : 's'} that do not load`);
    return bits.length ? `On the front page there ${bits.length === 1 && /^1 /.test(bits[0]) ? 'is' : 'are'} ${bits.join(' and ')}.` : null;
  },
  no_contact: () => `There is no phone number visible until you scroll.`,
  slow_lcp: a => `It takes about ${(a.lcpMs / 1000).toFixed(1)} seconds before anything useful appears.`,
  looks_dated: () => `The styling is the sort that was common around ten years ago.`,
  text_too_small: a => `The body text comes out at about ${Math.round(a.bodyFontSize)} pixels on a phone, which is small to read.`,
  tap_targets: a => `${a.tinyTapTargets} of the buttons are small enough to be fiddly on a touchscreen.`,
  structure: () => `The headings are not in an order search engines can follow.`,
};

const CONSEQUENCE = {
  not_responsive: "Most people looking for you are on a phone, and a page they have to pinch and drag usually means they back out and call the next name on the list.",
  ssl_broken: "Browsers now put a warning in front of the page before anyone sees it, which is a hard thing to recover from.",
  stale_copyright: "To someone who has never heard of you, a date that old reads as \"this business may have closed\".",
  dead_platform: "That software stopped getting security updates years ago, so the site cannot really be made safe or fast as it stands.",
  broken_assets: "Links that go nowhere make people assume nobody is looking after the business either.",
  no_contact: "Someone who has to hunt for a phone number usually does not hunt for long.",
  slow_lcp: "People leave a page that keeps them waiting, and most of them never come back.",
  looks_dated: "It still works, but it looks considerably older than the business actually is.",
  text_too_small: "Anyone over about forty is zooming in to read it, and a good number will not bother.",
  tap_targets: "On a phone the buttons are small enough to be genuinely fiddly to hit.",
  structure: "Search engines have a hard time working out what the page is about, which costs you in results.",
};

// Named parameters, because a shared "b" slot meant one opener wanted the
// trade and the next wanted the business, and the wrong one read
// "I came across HVAC while looking through Kearney".
/**
 * Each fault as a short phrase, so an email can name two or three things
 * without turning into a report. An owner wants to know what is wrong, not
 * to read an audit - so these are the plain-words version, no numbers and no
 * jargon, and the email carries at most three.
 */
const SHORT_FIX = {
  not_responsive: "make it fit a phone screen properly",
  looks_dated: "bring the look up to date",
  dead_platform: "rebuild it on something current",
  stale_copyright: "freshen up the footer",
  ssl_broken: "sort out the security certificate",
  broken_assets: "fix the links and images that do not load",
  no_contact: "put your phone number where people see it first",
  text_too_small: "make the text readable without zooming",
  tiny_tap_targets: "make the buttons easier to tap",
  slow_lcp: "speed up how fast it loads",
  structure: "tidy up the headings so Google reads it properly",
  weak_structure: "tidy up the headings so Google reads it properly",
  heavy_page: "slim the page down",
  unoptimised_images: "compress the images",
};

/** Two or three things, as a sentence rather than a list. */
function whatNeedsDoing(findings) {
  const bits = [...findings]
    .sort((a, b) => b.points - a.points)
    .map(f => SHORT_FIX[f.id])
    .filter(Boolean)
    .slice(0, 3);
  if (bits.length < 2) return null;
  const last = bits.pop();
  return `The main things would be to ${bits.join(", ")} and ${last}.`;
}

const OPENERS = [
  ({ trade, town }) => `I was looking at ${trade} websites around ${town} and yours came up.`,
  ({ name, town }) => `I came across ${name} while looking through ${town} businesses online.`,
  ({ town }) => `Your site came up while I was going through ${town} and I had a proper look at it.`,
];

// A hand-typed list carries no town, and an opener with a hole in it
// ("going through  and I had a look") is worse than one that never
// mentions where they are.
const OPENERS_NO_TOWN = [
  ({ trade }) => `I have been looking at ${trade} websites in the area and yours came up.`,
  ({ name }) => `I came across ${name} online and had a proper look at your site.`,
  () => `Your website came up while I was looking around at local businesses.`,
];

const OFFERS = [
  "If you want, I can put together a one-page mockup of how it could look, free, and you can decide from there whether it is worth doing.",
  "I would be glad to build you a single page as a sample, at no cost, so you can see the difference rather than take my word for it.",
  "I can mock up a new version of your front page for free if you would like to see what it would look like.",
];

const CLOSERS = [
  "Either way, thought it was worth telling you.",
  "No pressure at all - happy to leave it there if you are not interested.",
  "If it is not something you are thinking about, no problem.",
];

/**
 * Builds the draft.
 *
 * Returns { subject, body, warnings, facts }. `warnings` is what must be dealt
 * with before it is sent; a draft with warnings is still returned, because
 * seeing the draft is how you learn what it needs.
 */
export function draftEmail(lead, sender = {}) {
  const business = lead.business?.name ?? "your business";
  const town = String(lead.business?.town ?? lead.business?.city ?? "").trim();
  // score() returns its findings as `hits`. Reading only `findings` meant
  // every real lead produced an email with no measurement in it at all -
  // which is the one thing the email exists to carry.
  const findings = lead.hits ?? lead.audit?.findings ?? lead.findings ?? [];
  const lead_ = headline(findings);

  const from = sender.name ?? "Brennen";
  const email = sender.email ?? "mbonyxstudios@gmail.com";
  const site = sender.site ?? "https://mbonyx.netlify.app";
  const address = (sender.address ?? "").trim();

  // "HVAC / heating & cooling" is a dropdown label, not something a person
  // says. Everything after the slash is for the dropdown, not the email.
  const trade = String(lead.business?.category ?? "local").split("/")[0].trim() || "local";
  const opener = pick(town ? OPENERS : OPENERS_NO_TOWN, business)({ trade, town, name: business });
  const offer = pick(OFFERS, business + "o");
  const closer = pick(CLOSERS, business + "c");

  // Said plainly, but built from the audit's own numbers. Falls back to the
  // report's wording rather than to nothing, since a clumsy true sentence
  // beats a missing one.
  const audit = lead.audit ?? {};
  let observation = null;
  if (lead_) {
    try { observation = OBSERVE[lead_.id]?.(audit) ?? null; } catch { observation = null; }
    observation = observation ?? lead_.evidence ?? null;
  }
  const consequence = lead_ ? CONSEQUENCE[lead_.id] ?? null : null;

  const subject = lead_
    ? pick([
        `Your website on a phone`,
        `Quick note about the ${business} website`,
        `Something I noticed on your website`,
      ], business)
    : `Quick note about the ${business} website`;

  // Split deliberately. Everything in `claims` is a statement about their
  // business and is held to the measurements; the sign-off is contact details
  // and a legal requirement, and its house number is not a claim about
  // anyone's website.
  const summary = whatNeedsDoing(findings);

  const claims = [
    [opener, observation, consequence].filter(Boolean).join(" "),
    ...(summary ? [``, summary] : []),
    ``,
    `I build websites for local businesses - I am based in Liberty, so I am nearby rather than a company in another state. You can see some of my work at ${site}.`,
    ``,
    offer + " " + closer,
  ].join("\n");

  const signature = [
    from,
    email,
    ...(address ? [address] : []),
    ``,
    `If you would rather not hear from me again, reply with "no thanks" and I will not write again.`,
  ].join("\n");

  const body = [`Hi,`, ``, claims, ``, signature].join("\n");

  const warnings = [];
  if (!address) {
    // CAN-SPAM requires a real postal address in commercial email. A PO box
    // registered to him counts; nothing at all does not.
    warnings.push('No postal address set. US law requires a real postal address in a commercial email — a PO box counts. This draft is not ready to send until you have one.');
  }
  if (!lead_) {
    warnings.push('Nothing specific was measured on this site, so the email has no concrete observation in it. Worth writing this one by hand.');
  }
  if (!findings.length) warnings.push('No findings for this business.');

  return { subject, body, claims, warnings, facts: findings.map(f => f.evidence).filter(Boolean) };
}

/**
 * Every number in the draft must be one that was measured.
 *
 * This is the check that matters. It is easy to write a sentence that reads
 * well and contains a figure nobody took off the page, and that figure is what
 * an owner will notice and disbelieve.
 */
export function numbersAreReal(draft, facts) {
  // Only the part that makes claims. A PO box number and a zip code are not
  // assertions about their website, and checking them flagged every draft
  // that carried the address the law requires.
  const text = draft.claims ?? draft.body;
  const claimed = [...String(text).matchAll(/(?<![\w.])\d[\d,]*(?:\.\d+)?/g)].map(m => m[0]);
  const allowed = new Set(
    facts.flatMap(f => [...String(f).matchAll(/(?<![\w.])\d[\d,]*(?:\.\d+)?/g)].map(m => m[0])),
  );
  const invented = claimed.filter(n => !allowed.has(n));
  return { ok: invented.length === 0, invented };
}
