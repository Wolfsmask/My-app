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

/**
 * Moves a file that cannot be read out of the way rather than losing it.
 *
 * Returns where it went, or null if even that failed.
 */
const rescue = file => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const saved = `${file}.unreadable-${stamp}`;
  try { fs.renameSync(file, saved); return saved; } catch { return null; }
};

/**
 * Reads one of the files, and says which kind of nothing it got.
 *
 * This used to answer the fallback for every failure, so "not written yet"
 * and "here, and I cannot read it" looked identical. The second one is a
 * hundred nights of work, and the next save wrote an empty list straight over
 * it. An unreadable file is now moved aside before anything else touches the
 * folder, and reported so the page can say what happened.
 */
const read = (file, fallback, onDamage) => {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    // Not being there yet is an ordinary first run, not a problem.
    if (error.code !== "ENOENT") onDamage?.(file, rescue(file), error.code ?? "could not be opened");
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    onDamage?.(file, rescue(file), "was not readable JSON");
    return fallback;
  }
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

  // Anything that was there but could not be read, so the page can say so
  // instead of showing a confident, wrong zero.
  const damaged = [];
  const note = (bad, movedTo, why) => damaged.push({
    file: path.basename(bad), why, movedTo: movedTo ? path.basename(movedTo) : null,
  });

  const places = read(file("places.json"), {}, note);
  const progress = read(file("progress.json"), { done: [] }, note);
  const done = new Set(progress.done);
  let found = read(file("found.json"), [], note);
  let leads = read(file("leads.json"), [], note);
  /*
    Sites deleted by hand, kept as a list of addresses after the row itself is
    gone. Without this, deleting a lead is pointless: the business is still in
    found.json, so the next sweep audits it again and puts it straight back on
    the page. The list is tiny - a URL each - so keeping it forever costs
    nothing next to re-checking the same site every night.
  */
  const forgotten = new Set(read(file("forgotten.json"), [], note));

  /*
    One copy of the leads as they were when this window opened.

    Everything else in here is written many times a night, so copying on every
    write would mean copying megabytes per site checked. Once per launch is
    almost free and is the version anyone would actually want back: the state
    before today's run touched anything.
  */
  if (leads.length) {
    try { fs.copyFileSync(file("leads.json"), file("leads.backup.json")); } catch { /* best effort */ }
  }

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
      if (forgotten.has(b.website)) return false;
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
    // Deleted sites answer yes too, so a later sweep skips them as "already
    // seen" rather than finding them afresh and putting them back.
    hasSite: url => Boolean(url) && (claimedSites.has(url) || forgotten.has(url)),
    addBusiness(business) {
      if (business.website && forgotten.has(business.website)) return;
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
      // The screenshot goes with a dropped lead, whatever tier it was.
      return { ok: true, slug: lead.review === "confirmed" ? (lead.slug ?? null) : null };
    },

    /**
     * Keeps the leads worth keeping and closes the book on the rest.
     *
     * Everything ranked A or B is kept, plus any low-ranked ones picked out by
     * hand. Everything else is marked settled, which takes it out of the queue
     * for good - so a later run is not spending its night re-checking sites
     * that were looked at and passed over days ago.
     */
    saveNow(keepUrls = []) {
      const keep = new Set(keepUrls);
      let kept = 0, closed = 0;
      const closedSlugs = [];
      for (const lead of leads) {
        const url = lead.business?.website;
        if (!url) continue;

        // A decision already made by hand stands. Save now is a bulk action
        // for the ones nobody has looked at yet - it used to force every A
        // and B back to "keep", so dropping a good-looking lead you had
        // decided against was undone the next time you pressed Save.
        if (lead.review === "confirmed") { closed++; continue; }
        if (lead.review === "keep") { kept++; continue; }

        if (lead.tier === "A" || lead.tier === "B" || keep.has(url)) {
          lead.review = "keep"; kept++;
        } else {
          lead.review = "confirmed"; closed++;
          // Handed back so the caller can bin the screenshot with it. A
          // night's checking writes something like 180MB of them, and nothing
          // was ever removing the ones for sites already passed over.
          if (lead.slug) closedSlugs.push(lead.slug);
        }
      }
      write(file("leads.json"), leads);
      return { kept, closed, closedSlugs };
    },

    /**
     * Deletes saved sites outright, rather than marking them settled.
     *
     * "Drop" keeps the row and stops it coming back. This removes it: the
     * lead, and the business it came from, both go, and the address is
     * remembered so a later sweep does not rediscover it and audit it again.
     *
     * Takes a list so a bulk delete is one write rather than two thousand.
     * Returns the screenshots to bin, because the caller owns the filesystem.
     */
    forget(urls = []) {
      const drop = new Set(urls.filter(Boolean));
      if (!drop.size) return { removed: 0, slugs: [] };

      const slugs = [];
      for (const lead of leads) {
        const url = lead.business?.website;
        if (url && drop.has(url) && lead.slug) slugs.push(lead.slug);
      }

      const before = leads.length;
      leads = leads.filter(l => !(l.business?.website && drop.has(l.business.website)));
      found = found.filter(b => !(b.website && drop.has(b.website)));
      for (const url of drop) {
        forgotten.add(url);
        auditedUrls.delete(url);
        claimedSites.delete(url);
      }

      write(file("leads.json"), leads);
      write(file("found.json"), found);
      write(file("forgotten.json"), [...forgotten]);
      return { removed: before - leads.length, slugs };
    },

    /** Every saved site in one tier, for the bulk delete on the page. */
    websitesInTier(tier) {
      return leads
        .filter(l => (tier === "-" ? (l.tier ?? "-") === "-" : l.tier === tier))
        .map(l => l.business?.website)
        .filter(Boolean);
    },

    /** Deleted by hand and never to be looked at again. */
    isForgotten: url => forgotten.has(url),

    /** Checked, ranked low, and nobody has looked at it yet. */
    awaitingReview: () => leads.filter(l =>
      !l.review && l.tier !== "A" && l.tier !== "B" && l.business?.website),

    /** Everything found that still needs auditing, one entry per website. */
    pendingAudit,

    summary: () => ({
      /*
        Where these numbers came from.

        The files live beside the app, so a copy of the app unzipped somewhere
        else starts empty and looks exactly like a night's work vanishing. The
        page shows this folder, which turns "where did my leads go" into one
        glance.
      */
      folder: dir,
      damaged,
      forgotten: forgotten.size,
      towns: Object.keys(places).length,
      searches: done.size,
      found: found.length,
      withSite: found.filter(b => b.website && !b.duplicateOf).length,
      audited: leads.length,
      kept: leads.filter(l => l.review !== "confirmed").length,
      closed: leads.filter(l => l.review === "confirmed").length,
      awaitingReview: leads.filter(l => !l.review && l.tier !== "A" && l.tier !== "B" && l.business?.website).length,
      pending: pendingAudit().length,
      /*
        Why the skipped ones were skipped, counted.

        A night's run puts thousands in the skipped pile and the page only
        ever showed the total, which says nothing about whether the tool is
        working. "Two thousand had no website at all" and "two thousand could
        not be reached" are very different problems and only one of them is a
        bug.
      */
      skippedReasons: leads.reduce((tally, l) => {
        if (l.tier !== "-" && l.tier != null) return tally;
        const why = String(l.dropReason ?? "skipped").split(":")[0].trim();
        tally[why] = (tally[why] ?? 0) + 1;
        return tally;
      }, {}),
      tiers: leads.reduce((tally, l) => {
        const t = l.tier ?? "-";
        tally[t] = (tally[t] ?? 0) + 1;
        return tally;
      }, {}),
    }),

    /** Start over. Only ever on an explicit ask. */
    reset() {
      for (const name of ["places.json", "progress.json", "found.json", "leads.json"]) {
        try { fs.rmSync(file(name), { force: true }); } catch { /* nothing to remove */ }
      }
      /*
        Deletions survive a reset on purpose. Reset means "run the searches
        again from nothing"; deleting a site means "never show me this one
        again", which is a decision about that site and not about the ledger.
        Clearing the list here would quietly undo it.
      */
      done.clear(); seenBusiness.clear(); auditedUrls.clear(); claimedSites.clear();
      found = []; leads = [];
      for (const k of Object.keys(places)) delete places[k];
    },
  };
}
