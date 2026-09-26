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
/**
 * What is wrong, in the words the owner would use.
 *
 * These used to carry the measurement straight out of the report - "about 980
 * pixels wide", "14 pixel body text", "1.8 seconds". A business owner does not
 * think in pixels and has no idea whether 980 is bad. What they know is that
 * they have to pinch and zoom to read their own site on their phone.
 *
 * So: no pixels, no milliseconds, no percentages. Numbers stay only where a
 * person would use one themselves - the year in the footer, how many links are
 * broken. Several phrasings each, chosen by the business, so two owners who
 * know each other do not compare notes and find the same letter.
 */
const OBSERVE = {
  not_responsive: [
    () => `On a phone it does not shrink to fit the screen, so you have to pinch and zoom just to read anything.`,
    () => `Pulled up on a phone, the page runs off the side and has to be dragged around to read.`,
    () => `It was not built with phones in mind - everything comes out tiny and has to be zoomed in on.`,
  ],
  looks_dated: [
    a => (a.datedSignals ?? 3) >= 5
      ? `The design looks like it has not been touched in well over a decade.`
      : `The design looks like it has not been touched in a long time.`,
    () => `Next to a newer competitor's site it looks noticeably older, and people do read that as the business being behind.`,
    () => `The fonts and layout are the sort that were normal years ago, and they date the whole thing.`,
  ],
  stale_copyright: [
    a => `The bottom of the page still says ${a.copyrightYear}.`,
    a => `The copyright line at the bottom has not been changed since ${a.copyrightYear}.`,
    a => `Right at the bottom it still reads ${a.copyrightYear}, which is the first thing that makes someone wonder if you are still open.`,
  ],
  dead_platform: [
    a => `It was built with ${a.platform}, which stopped being supported years ago.`,
    a => `The site runs on ${a.platform} - software that has not been updated in a very long time.`,
  ],
  broken_assets: [
    a => {
      const bits = [];
      if (a.brokenLinks) bits.push(`${a.brokenLinks === 1 ? 'a link' : `${a.brokenLinks} of the links`} on the front page ${a.brokenLinks === 1 ? 'goes' : 'go'} nowhere`);
      if (a.brokenImages) bits.push(`${a.brokenImages === 1 ? 'a picture does' : 'some of the pictures do'} not load`);
      return bits.length ? `${bits.join(' and ')[0].toUpperCase()}${bits.join(' and ').slice(1)}.` : null;
    },
    a => a.brokenLinks
      ? `Some of the links on the front page do not go anywhere any more.`
      : `Some of the pictures on the front page do not load any more.`,
  ],
  no_contact: [
    () => `Your phone number is not visible until you scroll down.`,
    () => `Someone landing on the page cannot see how to call you without scrolling.`,
  ],
  slow_lcp: [
    () => `It takes a few seconds before anything shows up, and most people will not wait that long.`,
  ],
  text_too_small: [
    () => `The writing is small enough that most people would be zooming in to read it on a phone.`,
    () => `On a phone the text comes out too small to read comfortably.`,
  ],
  tap_targets: [
    () => `The buttons are small enough to be awkward to tap on a phone.`,
  ],
  tiny_tap_targets: [
    () => `The buttons are small enough to be awkward to tap on a phone.`,
  ],
  ssl_broken: [
    () => `Browsers now put a "not secure" warning in front of the page before anyone reaches it.`,
  ],
  structure: [
    () => `The page is not laid out in a way Google reads easily, which costs you in search results.`,
  ],
  weak_structure: [
    () => `The page is not laid out in a way Google reads easily, which costs you in search results.`,
  ],
};

const CONSEQUENCE = {
  not_responsive: [
    `Most people looking for you are on a phone, and a page they have to fight with usually means they back out and call the next name on the list.`,
    `That matters more than it used to - most people find a local business on their phone now, and they do not persevere with a page that is hard to use.`,
  ],
  ssl_broken: [
    `That warning is a hard thing to come back from - most people will not click past it.`,
  ],
  stale_copyright: [
    `To someone who has never heard of you, a date that old reads as "this business may have closed".`,
    `It is a small thing, but it is the sort of small thing that makes a stranger hesitate.`,
  ],
  dead_platform: [
    `That means it cannot really be made safe or quick as it stands - it would need rebuilding rather than patching.`,
  ],
  broken_assets: [
    `Links that go nowhere make people assume nobody is minding the business either.`,
    `It is the kind of thing that makes a first-time visitor quietly lose confidence.`,
  ],
  no_contact: [
    `Someone who has to hunt for a phone number usually does not hunt for long.`,
  ],
  slow_lcp: [
    `People leave a page that keeps them waiting, and most of them do not come back.`,
  ],
  looks_dated: [
    `Fair or not, people judge how good a business is by how current its website looks.`,
    `It still works - it just looks considerably older than the business actually is.`,
    `Someone choosing between you and a competitor often decides on that alone.`,
  ],
  text_too_small: [
    `Anyone over about forty is zooming in to read it, and a good number will not bother.`,
  ],
  tap_targets: [`On a phone that is enough friction to lose a call.`],
  tiny_tap_targets: [`On a phone that is enough friction to lose a call.`],
  structure: [`It is part of why you may not be showing up as high as competitors.`],
  weak_structure: [`It is part of why you may not be showing up as high as competitors.`],
};

/**
 * Each fault as a short phrase, so an email can name two or three things
 * without turning into a report. An owner wants to know what is wrong, not to
 * read an audit - so these are the plain-words version, no numbers and no
 * jargon, and the email carries at most three.
 */
const SHORT_FIX = {
  not_responsive: "make it work properly on a phone",
  looks_dated: "bring the look up to date",
  dead_platform: "rebuild it on something current",
  stale_copyright: "freshen up the footer",
  ssl_broken: "sort out the security warning",
  broken_assets: "fix the links and pictures that do not work",
  no_contact: "put your phone number where people see it first",
  text_too_small: "make the text readable without zooming",
  tiny_tap_targets: "make the buttons easier to tap",
  tap_targets: "make the buttons easier to tap",
  slow_lcp: "speed up how fast it loads",
  structure: "tidy it up so Google reads it properly",
  weak_structure: "tidy it up so Google reads it properly",
  heavy_page: "slim the page down",
  unoptimised_images: "compress the pictures",
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
  ({ trade, town }) => `I have been going through ${trade} businesses in ${town} and had a look at your website.`,
  ({ name }) => `I had a look at the ${name} website this week.`,
  ({ town }) => `I was looking at local business websites around ${town} and yours stood out - not entirely in a good way, which is why I am writing.`,
];

const OPENERS_NO_TOWN = [
  ({ trade }) => `I have been looking at ${trade} websites in the area and yours came up.`,
  ({ name }) => `I came across ${name} online and had a proper look at your site.`,
  () => `Your website came up while I was looking around at local businesses.`,
];

const OFFERS = [
  "If you want, I can put together a one-page mockup of how it could look, free, and you can decide from there whether it is worth doing.",
  "I would be glad to build you a single page as a sample, at no cost, so you can see the difference rather than take my word for it.",
  "I can mock up a new version of your front page for free if you would like to see what it would look like.",
  "Happy to put together a free sample of how the front page could look, so you have something to judge rather than a pitch.",
  "If it would help, I can redo your front page as a free mockup - no obligation, just so you can see it.",
];

/*
  What to say to somebody who plainly needs the work and plainly cannot pay
  nine hundred dollars for it.

  A rebuild proposal landing on a one-person shop that is barely covering rent
  is not a sale, it is an insult with a price on it. Those are often the
  businesses a decent website would help most, so the answer is not to skip
  them - it is to offer it free and mean it, without saying "I can tell you are
  struggling", which no owner wants to read.
*/
const FREE_OFFERS = [
  "I am still building up my portfolio, so I would do this one free - a proper site, not a trial. I would rather have the work to show than the money.",
  "I would build it for you free. I am fourteen and still putting a portfolio together, so having a real local business to show matters more to me than being paid for it.",
  "There is no charge for this one. I am building up examples of my work, and a site I am proud of is worth more to me right now than the fee.",
  "I would do it free. I am early on and what I need is work I can point to, so if you like the result all I would ask is that you let me show it.",
];

const CLOSERS = [
  "Either way, thought it was worth telling you.",
  "No pressure at all - happy to leave it there if you are not interested.",
  "If it is not something you are thinking about, no problem.",
  "And if the timing is wrong, that is completely fine.",
  "Either way I hope it is useful to know.",
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
  // says, so everything after the slash is dropped. "manual" and "found" are
  // internal names for where a list came from - they are not a trade, and
  // "I was looking at manual websites" is not a sentence anyone would write.
  const INTERNAL = new Set(["manual", "found", "osm", "places", "", "local"]);
  const raw = String(lead.business?.category ?? "").split("/")[0].trim();
  // The adjective, not the noun: the openers already supply "websites" and
  // "businesses", so "local business" made "local business businesses".
  const trade = INTERNAL.has(raw.toLowerCase()) ? "local" : raw;
  const opener = pick(town ? OPENERS : OPENERS_NO_TOWN, business)({ trade, town, name: business });
  /*
    Which offer goes in. The paid one asks for a mockup and a conversation;
    the free one asks for nothing. It is only used where the business looks
    very small AND the site is genuinely bad enough to be worth a rebuild -
    a tiny business with a perfectly good website does not need charity, and
    an established one with an awful website can pay.
  */
  const offerFree = Boolean(lead.offerFree ?? (lead.audit?.business?.offerFree && (lead.score ?? 0) >= 25));
  const offer = offerFree ? pick(FREE_OFFERS, business + "f") : pick(OFFERS, business + "o");
  const closer = pick(CLOSERS, business + "c");

  // Said plainly, but built from the audit's own numbers. Falls back to the
  // report's wording rather than to nothing, since a clumsy true sentence
  // beats a missing one.
  const audit = lead.audit ?? {};
  let observation = null;
  let consequence = null;
  if (lead_) {
    // A different phrasing per business, so a town's worth of these do not
    // all read the same.
    const ways = OBSERVE[lead_.id];
    if (Array.isArray(ways) && ways.length) {
      try { observation = pick(ways, business + lead_.id)(audit) ?? null; } catch { observation = null; }
    }
    // The report's own wording is the fallback, since a clumsy true sentence
    // beats a missing one - but it is jargon, so it is a last resort.
    observation = observation ?? lead_.evidence ?? null;

    const results = CONSEQUENCE[lead_.id];
    if (Array.isArray(results) && results.length) consequence = pick(results, business + 'c' + lead_.id);
  }


  // Tied to what the email is actually about. Picked at random it promised
  // "Your website on a phone" above a letter about obsolete software.
  const SUBJECTS = {
    not_responsive: [`Your website on a phone`, `Your site on a phone screen`, `How your website looks on a phone`],
    looks_dated: [`The look of your website`, `Something I noticed about your website`, `Your website's design`],
    dead_platform: [`What your website is built on`, `Something worth knowing about your site`],
    stale_copyright: [`Something small on your website`, `A quick note about your website`],
    broken_assets: [`A couple of broken links on your site`, `Something not working on your website`],
    no_contact: [`Your phone number on your website`, `A quick note about your website`],
    ssl_broken: [`The security warning on your website`],
    text_too_small: [`Your website on a phone`],
    tiny_tap_targets: [`Your website on a phone`],
  };
  const subject = lead_
    ? pick(SUBJECTS[lead_.id] ?? [`Quick note about the ${business} website`, `Something I noticed on your website`], business)
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

  return { subject, body, claims, offerFree, warnings, facts: findings.map(f => f.evidence).filter(Boolean) };
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
