/**
 * Writes the outreach email for one lead.
 *
 * The hard part is not writing well — it is writing something that sounds like
 * a person and contains nothing invented. A single fabricated number turns you
 * from "someone who looked at my site" into "a bot that also lies", and there
 * is no recovering from that with a business owner.
 *
 * So: Claude is given only verified findings, told it may state nothing else,
 * and then the draft is mechanically checked for numbers that did not come
 * from those findings. A draft that fails the check is never queued.
 */

import { EMAIL_RULES } from "./email-rules.js";

const MODEL = "claude-opus-5";

/**
 * Stable across every lead, so it is worth a cache breakpoint — at 40 emails a
 * day this prefix would otherwise be re-read from scratch 40 times.
 */
const SYSTEM = `${EMAIL_RULES}

You write one email at a time. You are given verified measurements of one
business's website and you write the email that gets a reply.

ABSOLUTE RULES — breaking any of these makes the email worthless:

1. Every factual claim must come from the FINDINGS you are given. If a number
   is not in the findings, it does not go in the email. Do not estimate, do not
   round, do not add plausible detail.
2. Never claim to be a customer of theirs, never claim someone referred you,
   never imply you have worked with them before.
3. Never promise a search ranking, a number of customers, or revenue.
4. Do not mention the writer's age, and do not describe the business as
   "small", "struggling", "outdated" or anything that reads as an insult.
5. No greeting like "I hope this finds you well". No sign-off block. No job
   title. First name only.
6. Four to six short sentences. If it is longer, cut it.
7. Plain text. No markdown, no bullet points, no bold, no links other than the
   one audit link you are given.

The subject line is lowercase, five words or fewer, and reads like something a
person typed in a hurry — not a marketing headline.`;

/**
 * @param {object} lead      the scored lead (business + audit + hits)
 * @param {object} opts      { client, auditUrl, senderName, model }
 */
export async function writeEmail(lead, { client, auditUrl, senderName = "Micah", model = MODEL } = {}) {
  if (!client) throw new Error("No Anthropic client — set ANTHROPIC_API_KEY to generate emails.");

  const { z } = await import("zod");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");

  const Draft = z.object({
    subject: z.string().describe("Lowercase, five words or fewer."),
    body: z.string().describe("Plain text, 4-6 short sentences, signed with the first name only."),
    lead_finding: z.string().describe("Which finding id the email leads with."),
    self_check: z.string().describe(
      "One sentence: confirm every number in the body came from the findings."
    ),
  });

  const facts = buildFacts(lead, auditUrl, senderName);

  const res = await client.messages.parse({
    model,
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(Draft) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: factsToPrompt(facts) }],
  });

  const draft = res.parsed_output;
  if (!draft) throw new Error("Model returned no parseable draft.");

  const check = verifyDraft(draft, facts);

  return {
    ...draft,
    facts,
    verification: check,
    // A draft that failed verification is kept for inspection but never queued
    // as sendable. Silently dropping it would hide a prompt regression.
    sendable: check.ok,
    usage: res.usage,
  };
}

/** Only verified, measured things reach the model. Nothing else. */
function buildFacts(lead, auditUrl, senderName) {
  const b = lead.business ?? {};
  const a = lead.audit ?? {};
  return {
    businessName: b.name,
    category: b.category,
    city: b.city,
    website: b.website,
    senderName,
    auditUrl: auditUrl ?? null,
    findings: (lead.hits ?? []).map(h => ({
      id: h.id,
      weight: h.points,
      what: h.label,
      evidence: h.evidence,
    })),
    visual: lead.visualJudgement
      ? {
          looksLikeDecade: lead.visualJudgement.looks_like_decade,
          firstImpression: lead.visualJudgement.first_impression,
          visibleProblems: lead.visualJudgement.visible_problems,
        }
      : null,
    platform: a.platform ?? null,
  };
}

function factsToPrompt(f) {
  const findings = f.findings
    .map(x => `- [${x.id}] ${x.what}\n  Measured: ${x.evidence}`)
    .join("\n");

  const visual = f.visual
    ? `\nWHAT IT LOOKS LIKE (from a screenshot):\n` +
      `- Reads as: ${f.visual.looksLikeDecade}\n` +
      `- First impression: ${f.visual.firstImpression}\n` +
      (f.visual.visibleProblems?.length
        ? `- Visible problems: ${f.visual.visibleProblems.join("; ")}\n`
        : "")
    : "";

  return `BUSINESS
- Name: ${f.businessName}
- Type: ${f.category}
- Area: ${f.city}
- Website: ${f.website}

FINDINGS (these are the only facts you may state)
${findings || "- (none)"}
${visual}
${f.auditUrl ? `AUDIT PAGE (the one link you may include): ${f.auditUrl}` : "Do not include any link."}

You are writing as ${f.senderName}, who builds websites.

Lead with the single strongest finding. Mention at most two findings total —
more reads like a report, not a note from a person. Close by offering the
rebuild without pressure, and give them an easy way to say no.`;
}

/**
 * Mechanical hallucination check.
 *
 * Pulls every number out of the draft and asserts it appears somewhere in the
 * facts the model was given. This catches the exact failure that matters —
 * a confident, specific, invented measurement.
 */
export function verifyDraft(draft, facts) {
  const haystack = JSON.stringify(facts).toLowerCase();
  const body = `${draft.subject}\n${draft.body}`;
  const problems = [];

  // Numbers the model is always allowed to use without them being "findings".
  const ALLOWED = new Set(["1", "2", "3", "4", "5", "10", "24", "30", "100"]);

  /*
    No trailing \b. A word boundary after the digits means "980px" never
    matches at all — digit and "p" are both word characters — so every number
    glued to a unit slipped through unchecked, which is most of the numbers
    that matter. The left guard rejects digits inside identifiers ("v2") and
    version fragments (".1") while still catching "980px" and "$1,800".
  */
  const numbers = [...body.matchAll(/(?<![\w.])\d[\d,]*(?:\.\d+)?/g)].map(m => m[0]);
  for (const n of numbers) {
    const bare = n.replace(/,/g, "");
    if (ALLOWED.has(bare)) continue;
    if (haystack.includes(bare) || haystack.includes(n.toLowerCase())) continue;
    problems.push(`"${n}" does not appear in the findings`);
  }

  const lower = body.toLowerCase();
  const BANNED = [
    ["hope this email finds you", "the single most recognisable spam opener"],
    ["hope you're doing well", "filler opener"],
    ["i came across your", "reads as a mail merge"],
    ["reach out", "corporate filler"],
    ["circle back", "corporate filler"],
    ["leading provider", "nobody says this to a person"],
    ["quick 15-minute call", "in every spam email ever sent"],
    ["synerg", "corporate filler"],
    ["dear sir", "obviously a template"],
    ["guarantee", "never promise results"],
    ["rank #1", "never promise rankings"],
    ["first page of google", "never promise rankings"],
  ];
  for (const [phrase, why] of BANNED) {
    if (lower.includes(phrase)) problems.push(`contains "${phrase}" — ${why}`);
  }

  const sentences = draft.body.split(/[.!?]+\s/).filter(s => s.trim().length > 3);
  if (sentences.length > 8) problems.push(`${sentences.length} sentences — too long, cut to 4-6`);
  if (draft.subject.split(/\s+/).length > 6) problems.push("subject line is too long");
  if (/[*_#>]|\[.+\]\(.+\)/.test(draft.body)) problems.push("contains markdown formatting");

  const links = [...draft.body.matchAll(/https?:\/\/\S+|\b[\w-]+\.(?:com|net|org|io)\/\S*/gi)];
  if (links.length > 1) problems.push(`${links.length} links — one at most`);

  return { ok: problems.length === 0, problems, numbersChecked: numbers.length };
}
