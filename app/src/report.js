/**
 * Turns scored leads into something you can actually read: a CSV for sorting
 * and an HTML page for reviewing with the evidence in front of you.
 */

import { TIER_MEANING } from "./score.js";

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function toCsv(leads) {
  const cols = [
    "tier", "score", "name", "website", "phone", "rating", "reviewCount",
    "qualified", "responsive", "ssl", "copyrightYear", "platform",
    "lighthouse", "topFindings", "dropReason",
  ];

  const rows = leads.map(l => [
    l.tier, l.score ?? "", l.business.name, l.business.website ?? "",
    l.business.phone ?? "", l.business.rating ?? "", l.business.reviewCount ?? "",
    l.qualified === null ? "unknown" : l.qualified ? "yes" : "no",
    fmtBool(l.audit?.isResponsive), fmtBool(l.audit?.sslValid),
    l.audit?.copyrightYear ?? "", l.audit?.platform ?? "",
    l.audit?.lighthousePerf ?? "",
    (l.hits ?? []).slice(0, 3).map(h => h.label).join(" | "),
    l.dropReason ?? "",
  ]);

  return [cols, ...rows]
    .map(r => r.map(csvCell).join(","))
    .join("\n");
}

/**
 * Quoting alone is not enough. Excel and Sheets treat a cell beginning with
 * =, +, - or @ as a formula, so a business whose name is `=HYPERLINK(...)`
 * becomes a live formula the moment this file is opened. Business names come
 * from Google Places, which is user-editable, so prefix those with an
 * apostrophe — the standard mitigation, and invisible in the spreadsheet.
 */
function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const fmtBool = v => (v === undefined || v === null ? "" : v ? "yes" : "no");

export function toHtml(leads, meta = {}) {
  const live = leads.filter(l => !l.dropReason);
  const dropped = leads.filter(l => l.dropReason);
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  live.forEach(l => { counts[l.tier] = (counts[l.tier] ?? 0) + 1; });

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lead audit — ${esc(meta.category)} in ${esc(meta.city)}</title>
<style>
  :root{--bg:#080b10;--card:#12171f;--line:rgba(255,255,255,.09);--gold:#c9ad72;--gold-l:#e6d3a5;
    --text:#f5f3ed;--soft:#b3b6bd;--muted:#7d828c;--a:#4ade80;--b:#facc15;--c:#fb923c;--d:#64748b}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);line-height:1.6;
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:28px 20px 80px}
  .wrap{max-width:1080px;margin:0 auto}
  h1{font-size:clamp(1.6rem,3.4vw,2.4rem);letter-spacing:-.03em;margin:0 0 6px}
  .sub{color:var(--muted);font-size:.9rem;margin:0 0 28px}
  .totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:34px}
  .tot{border:1px solid var(--line);border-radius:12px;padding:16px 18px;background:var(--card)}
  .tot b{display:block;font-size:1.9rem;line-height:1;letter-spacing:-.02em}
  .tot span{font-size:.76rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
  .lead{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:20px 22px;margin-bottom:14px}
  .lead.A{border-left:4px solid var(--a)} .lead.B{border-left:4px solid var(--b)}
  .lead.C{border-left:4px solid var(--c)} .lead.D{border-left:4px solid var(--d)}
  .lead__top{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:4px}
  .lead__score{font-size:1.7rem;font-weight:700;letter-spacing:-.02em;min-width:56px}
  .A .lead__score{color:var(--a)} .B .lead__score{color:var(--b)}
  .C .lead__score{color:var(--c)} .D .lead__score{color:var(--d)}
  .lead__name{font-size:1.1rem;font-weight:600;margin-right:auto}
  .pill{font-size:.68rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;
    padding:4px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
  .pill.no{border-color:rgba(248,113,113,.5);color:#f87171}
  .pill.yes{border-color:rgba(74,222,128,.45);color:var(--a)}
  .lead__meta{color:var(--muted);font-size:.83rem;margin-bottom:14px;word-break:break-word}
  .lead__meta a{color:var(--gold-l)}
  .finding{display:grid;grid-template-columns:38px 1fr;gap:12px;padding:9px 0;border-top:1px solid var(--line)}
  .finding__pts{font-size:.78rem;font-weight:700;color:var(--gold)}
  .finding__label{font-weight:600;font-size:.92rem}
  .finding__ev{color:var(--soft);font-size:.86rem}
  .perf .finding__pts{color:var(--muted)}
  h2{font-size:1rem;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-l);
    margin:40px 0 14px;font-weight:700}
  .dropped{color:var(--muted);font-size:.86rem}
  .dropped li{margin-bottom:5px}
  .note{border:1px solid var(--line);border-left:2px solid var(--gold);border-radius:8px;
    background:rgba(201,173,114,.04);padding:14px 18px;font-size:.86rem;color:var(--soft);margin-bottom:28px}
</style></head><body><div class="wrap">

<h1>${esc(meta.category)} &middot; ${esc(meta.city)}</h1>
<p class="sub">${live.length} audited &middot; ${dropped.length} dropped before auditing &middot;
  ${esc(meta.source)} &middot; ${new Date().toLocaleString()}</p>

<div class="totals">
  ${["A", "B", "C", "D"].map(t => `<div class="tot"><b style="color:var(--${t.toLowerCase()})">${counts[t] ?? 0}</b>
    <span>Tier ${t}</span></div>`).join("")}
</div>

<div class="note"><strong>How to read this:</strong> Tier A and B are worth contacting.
  The findings under each are the exact facts to quote — they are measured, not guessed.
  ${TIER_MEANING.A}</div>

${live.map(l => `
<div class="lead ${l.tier}">
  <div class="lead__top">
    <span class="lead__score">${l.score}</span>
    <span class="lead__name">${esc(l.business.name)}</span>
    ${l.qualified === null
      ? '<span class="pill">no review data</span>'
      : l.qualified ? '<span class="pill yes">can pay</span>'
                    : `<span class="pill no">${esc((l.qualifyReasons ?? []).join("; "))}</span>`}
    <span class="pill">Tier ${l.tier}</span>
  </div>
  <p class="lead__meta">
    <a href="${esc(l.business.website)}" target="_blank" rel="noopener">${esc(l.business.website)}</a>
    ${l.business.phone ? " &middot; " + esc(l.business.phone) : ""}
    ${l.business.reviewCount != null ? ` &middot; ${l.business.reviewCount} reviews (${l.business.rating}★)` : ""}
    ${l.audit?.platform ? " &middot; " + esc(l.audit.platform) : ""}
  </p>
  ${(l.hits ?? []).map(h => `
    <div class="finding ${h.group === "performance" ? "perf" : ""}">
      <span class="finding__pts">+${h.points}</span>
      <span><span class="finding__label">${esc(h.label)}</span><br>
        <span class="finding__ev">${esc(h.evidence)}</span></span>
    </div>`).join("") || '<p class="dropped">No problems found — this site is in good shape.</p>'}
</div>`).join("")}

${dropped.length ? `<h2>Dropped before auditing</h2><ul class="dropped">
  ${dropped.map(l => `<li><strong>${esc(l.business.name)}</strong> — ${esc(l.dropReason)}</li>`).join("")}
</ul>` : ""}

</div></body></html>`;
}
