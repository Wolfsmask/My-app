/**
 * Which letters exist, and which of them may go out.
 *
 * Shared by the page that shows the drafts and the code that sends them, so
 * the letter that is sent is always the letter that was shown - regenerated
 * here from the saved audit, never taken back from the browser - and the
 * rules about what may be sent live in exactly one place.
 */
import { draftEmail, numbersAreReal, claimsAreMeasured } from "./draft.js";

/** Leads worth a letter, that have not had one or been passed over. */
export function wantsLetter(lead) {
  if (lead.mail?.status) return false;
  if (lead.review === "confirmed") return false;
  return lead.tier === "A" || lead.tier === "B" || lead.review === "keep";
}

/**
 * Every draft, with whether it can be sent and, if not, why not.
 *
 * A letter is sendable only when all of these hold:
 *   - there is an address, found on their site or picked by hand;
 *   - nobody at that address has asked not to be contacted;
 *   - nothing has already been sent to that address for another business;
 *   - the draft carries no warnings: a postal address is set, every number
 *     in it was measured, every symptom it describes was measured, and it
 *     says something specific about their site.
 * "No email anywhere on their site" is its own group, and those are never
 * sent - there is nobody to send them to.
 */
export function buildDrafts(store, sender = {}) {
  const drafts = [];
  for (const lead of store.leads.filter(wantsLetter)) {
    const draft = draftEmail(lead, sender);
    const numbers = numbersAreReal(draft, draft.facts);
    const claims = claimsAreMeasured(draft, lead.audit ?? {});
    const to = lead.emailOverride ?? lead.audit?.contactEmail ?? null;

    const warnings = [
      ...draft.warnings,
      ...(numbers.ok ? [] : [`Contains a number that was not measured: ${numbers.invented.join(", ")}`]),
      ...(claims.ok ? [] : [`Describes something that was not measured on this site: ${claims.unsupported.join("; ")}. Do not send this without checking it yourself.`]),
    ];
    if (to && store.isSuppressed(to)) warnings.push(`${to} asked not to be contacted. This will not be sent.`);
    else if (to && store.alreadyMailed(to)) warnings.push(`A letter has already gone to ${to} for another business. Sending again would be a second letter to the same inbox.`);

    const searched = lead.audit?.emailPagesSearched ?? [];
    const group = !to ? "noEmail" : warnings.length ? "attention" : "ready";

    drafts.push({
      name: lead.business?.name, website: lead.business?.website,
      tier: lead.tier, score: lead.score,
      to,
      toWhy: lead.emailOverride ? "picked by you" : lead.audit?.contactEmailWhy ?? null,
      maybe: (lead.audit?.emailCandidates ?? []).filter(a => a !== to),
      pagesSearched: searched,
      phone: lead.business?.phone ?? null,
      subject: draft.subject, body: draft.body,
      offerFree: draft.offerFree,
      size: lead.audit?.business?.size ?? null,
      warnings,
      group,
      sendable: group === "ready",
    });
  }
  const order = { ready: 0, attention: 1, noEmail: 2 };
  drafts.sort((a, b) => order[a.group] - order[b.group] || (b.score ?? 0) - (a.score ?? 0));
  return drafts;
}
