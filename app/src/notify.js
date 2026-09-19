/**
 * Tells you when a lead worth contacting turns up.
 *
 * Every channel is best-effort and never throws — a failed notification must
 * not kill a run that has already spent real money on audits.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Appends to a newline-delimited JSON file. Always runs, needs nothing set up,
 * and is the record you can re-read later.
 */
export function toInbox(lead, outDir) {
  const file = path.join(outDir, "inbox.jsonl");
  const row = {
    at: new Date().toISOString(),
    tier: lead.tier,
    score: lead.score,
    name: lead.business.name,
    website: lead.business.website,
    phone: lead.business.phone,
    reviews: lead.business.reviewCount,
    rating: lead.business.rating,
    findings: (lead.hits ?? []).map(h => h.label),
    emailSubject: lead.email?.subject ?? null,
    emailSendable: lead.email?.sendable ?? null,
  };
  fs.appendFileSync(file, JSON.stringify(row) + "\n");
  return file;
}

/** A line in the terminal, so a watch run is readable as it goes. */
export function toConsole(lead) {
  const b = lead.business;
  console.log(
    `\n  ★ TIER ${lead.tier} — ${b.name}  (${lead.score}/100)\n` +
    `    ${b.website}\n` +
    `    ${b.reviewCount ? `${b.reviewCount} reviews, ${b.rating}★  ` : ""}${b.phone ?? ""}\n` +
    (lead.hits ?? []).slice(0, 3).map(h => `    · ${h.label} — ${h.evidence}`).join("\n") +
    (lead.email ? `\n    ✉ draft: "${lead.email.subject}"${lead.email.sendable ? "" : "  [FAILED VERIFICATION]"}` : "")
  );
}

/**
 * Emails you the lead. Uses Resend because it is the smallest thing that works
 * and has a free tier; any provider with an HTTP API would slot in here.
 *
 * This notifies YOU. Nothing in this project ever emails the prospect —
 * that stays a human action, by design.
 */
export async function toEmail(leads, { apiKey, to, from = "onboarding@resend.dev" }) {
  if (!apiKey || !to || !leads.length) return { skipped: true };

  const rows = leads.map(l => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #eee">
        <strong>${escapeHtml(l.business.name)}</strong> — ${l.score}/100 (Tier ${l.tier})<br>
        <a href="${escapeHtml(l.business.website)}">${escapeHtml(l.business.website)}</a><br>
        <span style="color:#666;font-size:13px">
          ${(l.hits ?? []).slice(0, 3).map(h => escapeHtml(h.label)).join(" · ")}
        </span>
        ${l.email ? `<div style="margin-top:8px;padding:10px;background:#f6f6f4;border-radius:6px;font-size:13px">
          <strong>${escapeHtml(l.email.subject)}</strong>
          <pre style="white-space:pre-wrap;font-family:inherit;margin:6px 0 0">${escapeHtml(l.email.body)}</pre>
        </div>` : ""}
      </td>
    </tr>`).join("");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `${leads.length} lead${leads.length === 1 ? "" : "s"} worth contacting`,
        html: `<h2 style="font-family:system-ui">New leads</h2>
               <table style="font-family:system-ui;border-collapse:collapse;max-width:680px">${rows}</table>
               <p style="font-family:system-ui;color:#888;font-size:12px">
                 Drafts are not sent. Review, edit, then send them yourself.</p>`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const escapeHtml = s =>
  String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
