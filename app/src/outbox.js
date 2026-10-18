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
 * Saved before the search looked past the homepage and off its own domain
 * (version 1), or searched without finding anything before it learned to
 * scroll footers in, follow quote and booking links, read local providers'
 * addresses and look again as a desktop browser (version 2).
 */
export function needsEmailSearch(lead) {
  if (lead.emailOverride) return false;
  const v = lead.audit?.emailSearchVersion ?? 1;
  return v < 2 || (v < 3 && !lead.audit?.contactEmail);
}

const PHONE_HITS = new Set(["not_responsive", "text_too_small", "tiny_tap_targets"]);

/**
 * Saved with a phone problem found the old way - one look, by a browser that
 * did not say it was a phone, counting content the page had clipped. None of
 * it goes in a letter until it has been checked again.
 */
export function needsPhoneCheck(lead) {
  return (lead.audit?.phoneCheckVersion ?? 1) < 2 && (lead.hits ?? []).some(h => PHONE_HITS.has(h.id));
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
 * Without an address there are two groups, and neither is ever sent:
 *   "pick"     an address was on their site, but not on their own domain or
 *              a regular email provider, so it might be a supplier's or a
 *              parent company's. One click on "Use" once checked.
 *   "noEmail"  nothing at all - or the site could not be read, which the
 *              draft says rather than claiming there was nothing.
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
    // Belt and braces: the re-check runs before drafts are written, but if
    // it was stopped part-way an old phone verdict must not go out unchecked.
    if (needsPhoneCheck(lead)) warnings.push("Its phone problem was found by the old check and has not been looked at again yet. Press Write emails to re-check it before sending.");
    if (to && store.isSuppressed(to)) warnings.push(`${to} asked not to be contacted. This will not be sent.`);
    else if (to && store.alreadyMailed(to)) warnings.push(`A letter has already gone to ${to} for another business. Sending again would be a second letter to the same inbox.`);

    const searched = lead.audit?.emailPagesSearched ?? [];
    const maybe = (lead.audit?.emailCandidates ?? []).filter(a => a !== to);
    const group = !to ? (maybe.length ? "pick" : "noEmail") : warnings.length ? "attention" : "ready";

    drafts.push({
      name: lead.business?.name, website: lead.business?.website,
      tier: lead.tier, score: lead.score,
      to,
      toWhy: lead.emailOverride ? "picked by you" : lead.audit?.contactEmailWhy ?? null,
      maybe,
      pagesSearched: searched,
      searchBlocked: lead.audit?.emailSearchBlocked === true,
      searchError: lead.audit?.emailSearchError ?? null,
      phone: lead.business?.phone ?? null,
      subject: draft.subject, body: draft.body,
      offerFree: draft.offerFree,
      size: lead.audit?.business?.size ?? null,
      warnings,
      group,
      sendable: group === "ready",
    });
  }
  const order = { ready: 0, attention: 1, pick: 2, noEmail: 3 };
  drafts.sort((a, b) => order[a.group] - order[b.group] || (b.score ?? 0) - (a.score ?? 0));
  return drafts;
}
