/**
 * The safety net around AI-written email.
 *
 * These run without an API key, on purpose. The failure that actually costs
 * money is a confident invented measurement reaching a business owner, and
 * that is caught by verifyDraft() — a pure function — not by the model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyDraft, writeEmail } from "../src/email.js";
import { interpretStructure } from "../src/visual.js";

const facts = {
  businessName: "Ace Heating and Cooling",
  category: "hvac",
  city: "Kansas City, MO",
  website: "https://acehvac.example.com",
  senderName: "Micah",
  auditUrl: "https://mbonyx.com/audit/ace-heating-and-cooling",
  findings: [
    {
      id: "not_responsive",
      weight: 25,
      what: "Not readable on a phone",
      evidence: "Page is 980px wide on a 390px phone screen — visitors have to pinch and drag to read it.",
    },
    {
      id: "stale_copyright",
      weight: 10,
      what: "Footer looks abandoned",
      evidence: "Footer still says © 2018.",
    },
  ],
  visual: null,
  platform: "Microsoft FrontPage",
};

const good = {
  subject: "your site on my phone",
  body:
    "Hi — I was looking up HVAC companies around Kansas City and opened your site on my phone. " +
    "The page is 980px wide on a 390px screen, so I had to pinch and zoom to read anything.\n\n" +
    "I rebuilt your homepage to see the difference: https://mbonyx.com/audit/ace-heating-and-cooling\n\n" +
    "If it's useful I can do the whole site. If not, no worries — delete this.\n\nMicah",
  lead_finding: "not_responsive",
  self_check: "980 and 390 both come from the responsive finding.",
};

test("a clean draft passes", () => {
  const v = verifyDraft(good, facts);
  assert.equal(v.ok, true, v.problems.join("; "));
  assert.ok(v.numbersChecked >= 2, "it should actually have checked the numbers");
});

test("an invented measurement is caught", () => {
  // The model has helpfully added a load time nobody measured.
  const bad = { ...good, body: good.body.replace("980px wide", "980px wide and takes 7.4 seconds to load") };
  const v = verifyDraft(bad, facts);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some(p => p.includes("7.4")), `expected 7.4 to be flagged, got: ${v.problems.join("; ")}`);
});

test("a number glued to its unit is still checked", () => {
  /*
    Regression: the number regex ended with \b, so "6800px" never matched —
    digit and "p" are both word characters. Every unit-suffixed number went
    unchecked, which is the majority of the numbers worth checking.
  */
  const bad = { ...good, body: good.body.replace("980px wide", "6800px wide") };
  const v = verifyDraft(bad, facts);
  assert.equal(v.ok, false, "an invented pixel width must be caught");
  assert.ok(v.problems.some(p => p.includes("6800")), v.problems.join("; "));

  const ok = verifyDraft(good, facts);
  assert.ok(ok.numbersChecked >= 2, `expected the real widths to be checked, got ${ok.numbersChecked}`);
});

test("an invented review count is caught", () => {
  const bad = { ...good, body: good.body + "\n\nYour 214 Google reviews deserve better." };
  const v = verifyDraft(bad, facts);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some(p => p.includes("214")));
});

test("numbers that ARE in the findings are allowed through", () => {
  const ok = { ...good, body: good.body.replace("delete this", "Your footer also still says 2018 — delete this if not interested") };
  assert.equal(verifyDraft(ok, facts).ok, true);
});

test("the spam openers are rejected", () => {
  for (const phrase of [
    "I hope this email finds you well.",
    "I came across your website recently.",
    "We are a leading provider of web solutions.",
    "Happy to jump on a quick 15-minute call.",
  ]) {
    const bad = { ...good, body: phrase + "\n" + good.body };
    const v = verifyDraft(bad, facts);
    assert.equal(v.ok, false, `"${phrase}" should be rejected`);
  }
});

test("promising rankings or results is rejected", () => {
  for (const phrase of ["I guarantee more calls", "This will get you to the first page of Google"]) {
    assert.equal(verifyDraft({ ...good, body: good.body + " " + phrase }, facts).ok, false, phrase);
  }
});

test("markdown, extra links and over-long drafts are rejected", () => {
  assert.equal(verifyDraft({ ...good, body: good.body + "\n\n**Call today**" }, facts).ok, false);
  assert.equal(
    verifyDraft({ ...good, body: good.body + "\nAlso see https://example.com/pricing" }, facts).ok,
    false, "a second link should be rejected"
  );
  assert.equal(verifyDraft({ ...good, subject: "a much longer subject line than allowed here" }, facts).ok, false);
});

test("writeEmail sends only verified findings to the model, and nothing else", async () => {
  // A stand-in client that records the prompt instead of calling the API.
  let seenPrompt = "", seenSystem = "", seenModel = "";
  const fakeClient = {
    messages: {
      parse: async req => {
        seenModel = req.model;
        seenSystem = req.system.map(s => s.text).join("\n");
        seenPrompt = req.messages[0].content;
        return { parsed_output: good, usage: { input_tokens: 1, output_tokens: 1 } };
      },
    },
  };

  const lead = {
    business: {
      name: "Ace Heating and Cooling", category: "hvac", city: "Kansas City, MO",
      website: "https://acehvac.example.com",
      // Deliberately present, and deliberately NOT expected in the prompt:
      // the model has no business quoting a rating it was not asked to use.
      rating: 4.4, reviewCount: 130, phone: "(555) 212-9000",
    },
    audit: { platform: "Microsoft FrontPage", lcpMs: 7400, sslDaysLeft: 12 },
    hits: facts.findings.map(f => ({ id: f.id, points: f.weight, label: f.what, evidence: f.evidence })),
  };

  const out = await writeEmail(lead, {
    client: fakeClient,
    auditUrl: "https://mbonyx.com/audit/ace-heating-and-cooling",
    senderName: "Micah",
  });

  assert.equal(seenModel, "claude-opus-5");
  assert.match(seenPrompt, /980px/, "the verified evidence must reach the model");
  assert.doesNotMatch(seenPrompt, /7400|7\.4/, "unscored audit internals must not leak into the prompt");
  assert.doesNotMatch(seenPrompt, /130|4\.4/, "review data was not a finding, so it must not be offered as a fact");
  assert.match(seenSystem, /Every factual claim must come from the FINDINGS/);
  assert.equal(out.sendable, true);
  assert.equal(out.verification.ok, true);
});

test("a draft that fails verification is never marked sendable", async () => {
  const fakeClient = {
    messages: {
      parse: async () => ({
        parsed_output: { ...good, body: good.body + " Your site gets 4,200 visits a month." },
        usage: {},
      }),
    },
  };
  const lead = {
    business: { name: "X", category: "hvac", city: "KC", website: "https://x.example.com" },
    audit: {},
    hits: facts.findings.map(f => ({ id: f.id, points: f.weight, label: f.what, evidence: f.evidence })),
  };
  const out = await writeEmail(lead, { client: fakeClient });
  assert.equal(out.sendable, false);
  assert.ok(out.verification.problems.some(p => p.includes("4,200")));
});

test("writeEmail refuses to run without a client rather than silently skipping", async () => {
  await assert.rejects(() => writeEmail({ business: {}, hits: [] }, {}), /ANTHROPIC_API_KEY/);
});

/* ---------------------------------------------------- structure heuristics */

test("dated design needs a cluster of signals, not just one", () => {
  const modern = {
    fontFamilies: ["Inter", "system-ui"], usesFlexOrGrid: true, layoutTables: 0,
    semanticTagCount: 5, inlineStyledElements: 2, elementCount: 200, bodyFontSize: 16,
    tappableCount: 10, tinyTapTargets: 0, missingAlt: 0, h1Count: 1, headingSkips: 0,
  };
  assert.equal(interpretStructure(modern).looksDated, false);

  // System fonts alone is a style choice, not a symptom.
  assert.equal(interpretStructure({ ...modern, fontFamilies: ["Georgia"] }).looksDated, false);

  const ancient = {
    fontFamilies: ["Verdana", "Arial"], usesFlexOrGrid: false, layoutTables: 3,
    semanticTagCount: 0, inlineStyledElements: 90, elementCount: 200, bodyFontSize: 12,
    tappableCount: 10, tinyTapTargets: 8, missingAlt: 4, h1Count: 0, headingSkips: 2,
  };
  const a = interpretStructure(ancient);
  assert.equal(a.looksDated, true);
  assert.equal(a.textTooSmall, true);
  assert.equal(a.tapTargetsTooSmall, true);
  assert.equal(a.hasStructureProblems, true);
});

test("one cramped button on a good site is not a finding", () => {
  const s = interpretStructure({
    fontFamilies: ["Inter"], usesFlexOrGrid: true, layoutTables: 0, semanticTagCount: 5,
    inlineStyledElements: 0, elementCount: 200, bodyFontSize: 16,
    tappableCount: 12, tinyTapTargets: 2, missingAlt: 0, h1Count: 1, headingSkips: 0,
  });
  assert.equal(s.tapTargetsTooSmall, false);
});
