/**
 * What the app remembers between runs.
 *
 * The tool is meant to be started in the morning and left alone. That only
 * works if closing the window, a crash, or a reboot costs nothing: on the way
 * back it has to pick up where it stopped rather than start the same sweep
 * again. A full sweep is around two thousand queries to free, volunteer-run
 * servers, so repeating work already done is not just slow, it is rude.
 *
 * Four files, all plain JSON so they can be read or deleted by hand:
 *
 *   places.json    where each town is. Towns do not move, so this is asked
 *                  once ever rather than once per pass.
 *   progress.json  which searches have been run. The ledger that makes a
 *                  restart cheap.
 *   found.json     every business found, with its website if one was found.
 *   leads.json     every business audited and scored.
 */

import fs from "node:fs";
import path from "node:path";

const read = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
};

const write = (file, value) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Written to one side and moved into place, so an interrupted write cannot
    // leave a half-finished file where the day's work used to be.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
};

export function createStore(dir) {
  const file = name => path.join(dir, name);

  const places = read(file("places.json"), {});
  const progress = read(file("progress.json"), { done: [] });
  const done = new Set(progress.done);
  let found = read(file("found.json"), []);
  let leads = read(file("leads.json"), []);

  // Businesses are recognised by name and town together. By name alone, a
  // second "Arctic Air" one town over would be silently discarded as a repeat.
  const seenBusiness = new Set(found.map(b => `${(b.name ?? "").toLowerCase()}|${b.town ?? ""}`));
  const auditedUrls = new Set(leads.map(l => l.business?.website).filter(Boolean));

  /**
   * One site, one business. A company listed under two trades - "Smith Heating
   * & Plumbing" as both hvac and plumber - is found twice under two names and
   * resolves to the same website both times. Left alone that is two audits of
   * one page and, worse, two emails to one owner about the same site.
   */
  const claimedSites = new Set(found.map(b => b.website).filter(Boolean));

  // A plain function rather than a method: summary() is an arrow and has no
  // `this`, so calling it as a method there would have thrown the moment the
  // page asked how much was left.
  /**
   * The verdict on a site, if there is one, and whether it is settled.
   *
   * A low score is the machine's opinion, not a decision. Writing a business
   * off forever on an unreviewed guess is how a real lead disappears without
   * anyone ever looking at it, so a low rank only becomes permanent once it
   * has been confirmed by eye. Until then the site can be checked again.
   */
  const verdictFor = url => leads.find(l => l.business?.website === url) ?? null;

  const settled = lead => {
    if (!lead) return false;
    if (lead.review === "confirmed") return true;   // looked at and agreed
    if (lead.review === "keep") return true;        // looked at and kept
    // A high rank is not a write-off - it is a lead waiting to be emailed, and
    // re-checking it would only churn. Only unreviewed low ranks stay open.
    return lead.tier === "A" || lead.tier === "B";
  };

  const pendingAudit = () => {
    const seen = new Set();
    return found.filter(b => {
      if (!b.website || b.duplicateOf) return false;
      if (seen.has(b.website)) return false;
      if (settled(verdictFor(b.website))) return false;
      seen.add(b.website);
      return true;
    });
  };

  return {
    /** Where a town is, asked once and kept. */
    place: town => places[town] ?? null,
    rememberPlace(town, place) { places[town] = place; write(file("places.json"), places); },

    /** Has this exact search been run before? */
    isDone: key => done.has(key),
    markDone(key) {
      if (done.has(key)) return;
      done.add(key);
      write(file("progress.json"), { done: [...done] });
    },

    get found() { return found; },
    hasBusiness: (name, town) => seenBusiness.has(`${(name ?? "").toLowerCase()}|${town ?? ""}`),
    /** Already found under some other name? */
    hasSite: url => Boolean(url) && claimedSites.has(url),
    addBusiness(business) {
      seenBusiness.add(`${(business.name ?? "").toLowerCase()}|${business.town ?? ""}`);
      // Recorded, but marked as the same company found again, so it is not
      // audited or emailed twice.
      if (business.website) {
        if (claimedSites.has(business.website)) business.duplicateOf = business.website;
        else claimedSites.add(business.website);
      }
      found.push(business);
      write(file("found.json"), found);
    },

    get leads() { return leads; },
    /** Audited already? Re-auditing a site costs a browser load for nothing. */
    isAudited: url => auditedUrls.has(url),
    addLead(lead) {
      if (lead.business?.website) {
        auditedUrls.add(lead.business.website);
        // Re-checking replaces the old verdict rather than adding a second
        // one, so a business never appears twice in the report.
        const at = leads.findIndex(l => l.business?.website === lead.business.website);
        if (at >= 0) {
          // A decision already made is kept: a re-check should not quietly
          // undo something that was looked at and settled.
          lead.review = leads[at].review ?? null;
          leads[at] = lead;
          write(file("leads.json"), leads);
          return;
        }
      }
      leads.push(lead);
      write(file("leads.json"), leads);
    },

    /**
     * Records that a person looked at this one. "confirmed" means the low
     * rank is right and it should not come back; "keep" means it is worth
     * pursuing whatever the score said.
     */
    review(url, decision) {
      const lead = leads.find(l => l.business?.website === url);
      if (!lead) return false;
      lead.review = decision === "confirmed" || decision === "keep" ? decision : null;
      write(file("leads.json"), leads);
      return true;
    },

    /** Checked, ranked low, and nobody has looked at it yet. */
    awaitingReview: () => leads.filter(l =>
      !l.review && l.tier !== "A" && l.tier !== "B" && l.business?.website),

    /** Everything found that still needs auditing, one entry per website. */
    pendingAudit,

    summary: () => ({
      towns: Object.keys(places).length,
      searches: done.size,
      found: found.length,
      withSite: found.filter(b => b.website && !b.duplicateOf).length,
      audited: leads.length,
      awaitingReview: leads.filter(l => !l.review && l.tier !== "A" && l.tier !== "B" && l.business?.website).length,
      pending: pendingAudit().length,
    }),

    /** Start over. Only ever on an explicit ask. */
    reset() {
      for (const name of ["places.json", "progress.json", "found.json", "leads.json"]) {
        try { fs.rmSync(file(name), { force: true }); } catch { /* nothing to remove */ }
      }
      done.clear(); seenBusiness.clear(); auditedUrls.clear(); claimedSites.clear();
      found = []; leads = [];
      for (const k of Object.keys(places)) delete places[k];
    },
  };
}
