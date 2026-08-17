import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveCrewEnvKey,
  resolveCrewChannelEnvVar,
  formatDateLabel,
  formatPhone,
  buildCrewJobBlock,
  joinCrewJobBlocks,
  postSlackMessage,
  BLOCK_DIVIDER,
  type CrewJobBlockInput,
} from "./slack.ts";

// ── resolveCrewEnvKey ─────────────────────────────────────────────────────────

Deno.test("resolveCrewEnvKey: all four crews map to their keys", () => {
  assertEquals(resolveCrewEnvKey("Crew 1"), "crew1");
  assertEquals(resolveCrewEnvKey("Crew 2"), "crew2");
  assertEquals(resolveCrewEnvKey("Crew 3"), "crew3");
  assertEquals(resolveCrewEnvKey("Crew 4"), "crew4");
});

Deno.test("resolveCrewEnvKey: mixed case and surrounding whitespace", () => {
  assertEquals(resolveCrewEnvKey("crew 1"), "crew1");
  assertEquals(resolveCrewEnvKey("CREW 2"), "crew2");
  assertEquals(resolveCrewEnvKey("  Crew 3  "), "crew3");
  assertEquals(resolveCrewEnvKey(" cReW 4"), "crew4");
});

Deno.test("resolveCrewEnvKey: unmapped values return null", () => {
  assertEquals(resolveCrewEnvKey("Jackson"), null);
  assertEquals(resolveCrewEnvKey("Other"), null);
  assertEquals(resolveCrewEnvKey(null), null);
  assertEquals(resolveCrewEnvKey(undefined), null);
  assertEquals(resolveCrewEnvKey(""), null);
});

Deno.test("resolveCrewEnvKey: near-miss vocabulary returns null", () => {
  assertEquals(resolveCrewEnvKey("Crew1"), null); // no space
  assertEquals(resolveCrewEnvKey("Crew 5"), null); // out of range
});

// Recommended fix 4 (review): a plain `{}`-literal lookup map inherits from
// Object.prototype, so these keys would resolve to the inherited function
// instead of undefined, and `?? null` would not catch it (it only replaces
// null/undefined, never an inherited truthy value). CREW_ENV_KEY_MAP is now
// built with Object.create(null) specifically to close this hole.
Deno.test("resolveCrewEnvKey: prototype-chain keys return null, not an inherited function", () => {
  assertEquals(resolveCrewEnvKey("constructor"), null);
  assertEquals(resolveCrewEnvKey("toString"), null);
  assertEquals(resolveCrewEnvKey("__proto__"), null);
});

// ── resolveCrewChannelEnvVar ─────────────────────────────────────────────────

Deno.test("resolveCrewChannelEnvVar: all four crews map to correct env var names", () => {
  assertEquals(resolveCrewChannelEnvVar("Crew 1"), "SLACK_CREW1_CHANNEL");
  assertEquals(resolveCrewChannelEnvVar("Crew 2"), "SLACK_CREW2_CHANNEL");
  assertEquals(resolveCrewChannelEnvVar("Crew 3"), "SLACK_CREW3_CHANNEL");
  assertEquals(resolveCrewChannelEnvVar("Crew 4"), "SLACK_CREW4_CHANNEL");
});

Deno.test("resolveCrewChannelEnvVar: unmapped crews return null", () => {
  assertEquals(resolveCrewChannelEnvVar("Jackson"), null);
  assertEquals(resolveCrewChannelEnvVar("Other"), null);
  assertEquals(resolveCrewChannelEnvVar(null), null);
  assertEquals(resolveCrewChannelEnvVar(""), null);
});

Deno.test("resolveCrewChannelEnvVar: undefined returns null", () => {
  assertEquals(resolveCrewChannelEnvVar(undefined), null);
});

// Recommended fix 4 (review): same prototype-chain hole as resolveCrewEnvKey,
// exercised through the composed function so a mis-set crew value can never
// flow a function object into deps.slackChannels[crewEnvKey] or the
// calendar map.
Deno.test("resolveCrewChannelEnvVar: prototype-chain keys return null, not an inherited function", () => {
  assertEquals(resolveCrewChannelEnvVar("constructor"), null);
  assertEquals(resolveCrewChannelEnvVar("toString"), null);
  assertEquals(resolveCrewChannelEnvVar("__proto__"), null);
});

// ── formatDateLabel ───────────────────────────────────────────────────────────

Deno.test("formatDateLabel: standard date", () => {
  assertEquals(formatDateLabel("2026-08-20"), "Thu Aug 20");
});

Deno.test("formatDateLabel: single-digit day has no leading zero", () => {
  assertEquals(formatDateLabel("2026-08-01"), "Sat Aug 1");
});

Deno.test("formatDateLabel: Jan 1", () => {
  assertEquals(formatDateLabel("2026-01-01"), "Thu Jan 1");
});

Deno.test("formatDateLabel: Dec 31", () => {
  assertEquals(formatDateLabel("2026-12-31"), "Thu Dec 31");
});

Deno.test("formatDateLabel: leap day (2028-02-29)", () => {
  assertEquals(formatDateLabel("2028-02-29"), "Tue Feb 29");
});

Deno.test("formatDateLabel: 2026 spring-forward DST boundary (Mar 8) — UTC-anchored, immune to the shift", () => {
  assertEquals(formatDateLabel("2026-03-08"), "Sun Mar 8");
});

Deno.test("formatDateLabel: 2026 fall-back DST boundary (Nov 1) — UTC-anchored, immune to the shift", () => {
  assertEquals(formatDateLabel("2026-11-01"), "Sun Nov 1");
});

// ── formatPhone ───────────────────────────────────────────────────────────────

Deno.test("formatPhone: plain 10-digit number", () => {
  assertEquals(formatPhone("8015550142"), "(801) 555-0142");
});

Deno.test("formatPhone: 11-digit with leading 1", () => {
  assertEquals(formatPhone("18015550142"), "(801) 555-0142");
});

Deno.test("formatPhone: +1 prefixed", () => {
  assertEquals(formatPhone("+1 801-555-0142"), "(801) 555-0142");
});

Deno.test("formatPhone: already-formatted input is idempotent", () => {
  assertEquals(formatPhone("(801) 555-0142"), "(801) 555-0142");
});

Deno.test("formatPhone: extension passes through trimmed and unchanged", () => {
  assertEquals(formatPhone("  801-555-0142 ext 204  "), "801-555-0142 ext 204");
});

// This case happens to be 12 digits after stripping non-digits, so it only
// ever exercised the "falls through to raw digit length, doesn't equal 10 or
// 11" path — the leading "+" was never the reason it passed. That gave false
// confidence: it would NOT have caught the bug fixed below (BLOCKING fix 3),
// where a "+"-prefixed number that DOES happen to strip to 10/11 digits was
// getting reformatted as if it were domestic.
Deno.test("formatPhone: international number (+44) passes through trimmed and unchanged", () => {
  assertEquals(formatPhone("+44 20 7946 0958"), "+44 20 7946 0958");
});

// BLOCKING fix 3 (review): a "+"-prefixed non-"+1" number is positive
// evidence of a non-NANP number and must never be digit-stripped into a
// plausible-looking but wrong US format. This case strips to exactly 10
// digits ("493012 3456" -> "4930123456"), so pre-fix code silently mangled
// it into "(493) 012-3456" — a number that dials nothing.
Deno.test("formatPhone: +49 (Germany) that would strip to 10 digits is NOT reformatted as a US number", () => {
  assertEquals(formatPhone("+49 30 123456"), "+49 30 123456");
});

Deno.test("formatPhone: +1 with only 7 digits after the country code is not forced into a US format", () => {
  assertEquals(formatPhone("+1 555-0142"), "+1 555-0142");
});

Deno.test("formatPhone: bare 7-digit local number passes through trimmed and unchanged", () => {
  assertEquals(formatPhone("555-0142"), "555-0142");
});

Deno.test("formatPhone: 12+ bare digits (no leading 1) passes through trimmed and unchanged", () => {
  assertEquals(formatPhone("493012345678"), "493012345678");
});

Deno.test("formatPhone: letters mixed with digits passes through trimmed and unchanged", () => {
  assertEquals(formatPhone("1-800-FLOWERS"), "1-800-FLOWERS");
});

Deno.test("formatPhone: null/empty/whitespace-only returns null", () => {
  assertEquals(formatPhone(null), null);
  assertEquals(formatPhone(undefined), null);
  assertEquals(formatPhone(""), null);
  assertEquals(formatPhone("   "), null);
});

// ── buildCrewJobBlock ─────────────────────────────────────────────────────────

const fullInput: CrewJobBlockInput = {
  headline: "🏗️ New job scheduled — JOB-1104",
  contactName: "Ann Morrison",
  businessName: "Morrison Construction",
  clientPhone: "8015550142",
  startDate: "2026-08-20",
  startTime: "8:00 AM",
  jobAddress: "4285 S 300 W, Murray",
  scopeSummary:
    "Kitchen Demo — Remove and haul off all kitchen cabinets, countertops, and backsplash.\n" +
    "Jobsite Cleanup — Full cleanup and haul-off of remaining debris.",
};

Deno.test("buildCrewJobBlock: fully-populated block matches the exact literal spec output", () => {
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Ann Morrison",
    "Morrison Construction",
    "(801) 555-0142",
    "",
    "Thu Aug 20",
    "8:00 AM",
    "4285 S 300 W, Murray",
    "",
    "Kitchen Demo — Remove and haul off all kitchen cabinets, countertops, and backsplash.",
    "Jobsite Cleanup — Full cleanup and haul-off of remaining debris.",
  ].join("\n");
  assertEquals(buildCrewJobBlock(fullInput), expected);
});

Deno.test("buildCrewJobBlock: null contactName omits that line, no blank gap left", () => {
  const input = { ...fullInput, contactName: null };
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Morrison Construction",
    "(801) 555-0142",
    "",
    "Thu Aug 20",
    "8:00 AM",
    "4285 S 300 W, Murray",
    "",
    fullInput.scopeSummary,
  ].join("\n");
  assertEquals(buildCrewJobBlock(input), expected);
});

Deno.test("buildCrewJobBlock: null businessName omits that line, no blank gap left", () => {
  const input = { ...fullInput, businessName: null };
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Ann Morrison",
    "(801) 555-0142",
    "",
    "Thu Aug 20",
    "8:00 AM",
    "4285 S 300 W, Murray",
    "",
    fullInput.scopeSummary,
  ].join("\n");
  assertEquals(buildCrewJobBlock(input), expected);
});

Deno.test("buildCrewJobBlock: null clientPhone omits that line, no blank gap left", () => {
  const input = { ...fullInput, clientPhone: null };
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Ann Morrison",
    "Morrison Construction",
    "",
    "Thu Aug 20",
    "8:00 AM",
    "4285 S 300 W, Murray",
    "",
    fullInput.scopeSummary,
  ].join("\n");
  assertEquals(buildCrewJobBlock(input), expected);
});

Deno.test("buildCrewJobBlock: null startDate omits that line, group still separated correctly", () => {
  const input = { ...fullInput, startDate: null };
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Ann Morrison",
    "Morrison Construction",
    "(801) 555-0142",
    "",
    "8:00 AM",
    "4285 S 300 W, Murray",
    "",
    fullInput.scopeSummary,
  ].join("\n");
  assertEquals(buildCrewJobBlock(input), expected);
});

Deno.test("buildCrewJobBlock: null startTime omits that line", () => {
  const input = { ...fullInput, startTime: null };
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Ann Morrison",
    "Morrison Construction",
    "(801) 555-0142",
    "",
    "Thu Aug 20",
    "4285 S 300 W, Murray",
    "",
    fullInput.scopeSummary,
  ].join("\n");
  assertEquals(buildCrewJobBlock(input), expected);
});

Deno.test("buildCrewJobBlock: null jobAddress omits that line", () => {
  const input = { ...fullInput, jobAddress: null };
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Ann Morrison",
    "Morrison Construction",
    "(801) 555-0142",
    "",
    "Thu Aug 20",
    "8:00 AM",
    "",
    fullInput.scopeSummary,
  ].join("\n");
  assertEquals(buildCrewJobBlock(input), expected);
});

Deno.test("buildCrewJobBlock: businessName equal to contactName omits business line", () => {
  const input = { ...fullInput, contactName: "Ann Morrison", businessName: "Ann Morrison" };
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Ann Morrison",
    "(801) 555-0142",
    "",
    "Thu Aug 20",
    "8:00 AM",
    "4285 S 300 W, Murray",
    "",
    fullInput.scopeSummary,
  ].join("\n");
  assertEquals(buildCrewJobBlock(input), expected);
});

Deno.test("buildCrewJobBlock: businessName equal to contactName by case/whitespace also omits", () => {
  const input = { ...fullInput, contactName: "Ann Morrison", businessName: "  ann morrison  " };
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Ann Morrison",
    "(801) 555-0142",
    "",
    "Thu Aug 20",
    "8:00 AM",
    "4285 S 300 W, Murray",
    "",
    fullInput.scopeSummary,
  ].join("\n");
  assertEquals(buildCrewJobBlock(input), expected);
});

Deno.test("buildCrewJobBlock: everything optional null except headline -> just the headline", () => {
  const input: CrewJobBlockInput = {
    headline: "🏗️ New job scheduled — JOB-1104",
    contactName: null,
    businessName: null,
    clientPhone: null,
    startDate: null,
    startTime: null,
    jobAddress: null,
    scopeSummary: null,
  };
  assertEquals(buildCrewJobBlock(input), "🏗️ New job scheduled — JOB-1104");
});

Deno.test("buildCrewJobBlock: scope-only-empty -> exactly two groups, one blank-line separator", () => {
  const input = { ...fullInput, scopeSummary: null };
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Ann Morrison",
    "Morrison Construction",
    "(801) 555-0142",
    "",
    "Thu Aug 20",
    "8:00 AM",
    "4285 S 300 W, Murray",
  ].join("\n");
  assertEquals(buildCrewJobBlock(input), expected);
});

Deno.test("buildCrewJobBlock: whitespace-only scopeSummary is treated as empty", () => {
  const input = { ...fullInput, scopeSummary: "   " };
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Ann Morrison",
    "Morrison Construction",
    "(801) 555-0142",
    "",
    "Thu Aug 20",
    "8:00 AM",
    "4285 S 300 W, Murray",
  ].join("\n");
  assertEquals(buildCrewJobBlock(input), expected);
});

Deno.test("buildCrewJobBlock: multi-line scopeSummary preserved verbatim", () => {
  const input = {
    ...fullInput,
    scopeSummary: "Line one\nLine two\nLine three",
  };
  const result = buildCrewJobBlock(input);
  assertEquals(result.endsWith("Line one\nLine two\nLine three"), true);
  assertEquals(result.includes("Line one\nLine two\nLine three"), true);
});

// ── BLOCKING fix 2 (review): scopeSummary inserted untrimmed could emit a
// forbidden double blank line. Verified failure case:
// scopeSummary = "\nSCOPE\n" on a populated identity+schedule block used to
// yield "...4285 S 300 W, Murray\n\n\nSCOPE\n" — three consecutive newlines
// (a stray blank line between groups) plus a trailing newline, violating
// hard rule 1 of the format spec (no double blank lines). ────────────────────

Deno.test("buildCrewJobBlock: leading-newline scopeSummary does not produce a stray blank line", () => {
  const input = { ...fullInput, scopeSummary: "\nKitchen Demo — haul off cabinets." };
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Ann Morrison",
    "Morrison Construction",
    "(801) 555-0142",
    "",
    "Thu Aug 20",
    "8:00 AM",
    "4285 S 300 W, Murray",
    "",
    "Kitchen Demo — haul off cabinets.",
  ].join("\n");
  assertEquals(buildCrewJobBlock(input), expected);
});

Deno.test("buildCrewJobBlock: trailing-newline scopeSummary does not leave a dangling newline at the end", () => {
  const input = { ...fullInput, scopeSummary: "Kitchen Demo — haul off cabinets.\n" };
  const result = buildCrewJobBlock(input);
  assertEquals(result.endsWith("Kitchen Demo — haul off cabinets."), true);
  assertEquals(result.endsWith("\n"), false);
});

Deno.test("buildCrewJobBlock: internal blank line inside scopeSummary is dropped, not just leading/trailing", () => {
  // Realistic source: joining estimate line items as "name — description"
  // with one blank line-item name in the middle.
  const input = { ...fullInput, scopeSummary: "Kitchen Demo — haul off cabinets.\n\nJobsite Cleanup — full haul-off." };
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Ann Morrison",
    "Morrison Construction",
    "(801) 555-0142",
    "",
    "Thu Aug 20",
    "8:00 AM",
    "4285 S 300 W, Murray",
    "",
    "Kitchen Demo — haul off cabinets.",
    "Jobsite Cleanup — full haul-off.",
  ].join("\n");
  assertEquals(buildCrewJobBlock(input), expected);
  // No triple-newline (or any double-newline) survives inside the result.
  assertEquals(buildCrewJobBlock(input).includes("\n\n\n"), false);
});

Deno.test("buildCrewJobBlock: whitespace-only line inside scopeSummary is dropped like a truly blank line", () => {
  const input = { ...fullInput, scopeSummary: "Kitchen Demo — haul off cabinets.\n   \nJobsite Cleanup — full haul-off." };
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Ann Morrison",
    "Morrison Construction",
    "(801) 555-0142",
    "",
    "Thu Aug 20",
    "8:00 AM",
    "4285 S 300 W, Murray",
    "",
    "Kitchen Demo — haul off cabinets.",
    "Jobsite Cleanup — full haul-off.",
  ].join("\n");
  assertEquals(buildCrewJobBlock(input), expected);
});

// ── Coverage gap: the double-blank-line trap at the GROUP level (group 1
// populated, group 2 — schedule — wholly empty, group 3 — scope — populated)
// exercises the same "no stray blank line" invariant from a different angle:
// an entirely-dropped middle group must not leave behind an extra "\n\n". ──

Deno.test("buildCrewJobBlock: identity populated, schedule wholly empty, scope populated -> exactly one blank line between them", () => {
  const input: CrewJobBlockInput = {
    headline: "🏗️ New job scheduled — JOB-1104",
    contactName: "Ann Morrison",
    businessName: "Morrison Construction",
    clientPhone: "8015550142",
    startDate: null,
    startTime: null,
    jobAddress: null,
    scopeSummary: "Kitchen Demo — haul off cabinets.",
  };
  const expected = [
    "🏗️ New job scheduled — JOB-1104",
    "Ann Morrison",
    "Morrison Construction",
    "(801) 555-0142",
    "",
    "Kitchen Demo — haul off cabinets.",
  ].join("\n");
  assertEquals(buildCrewJobBlock(input), expected);
  assertEquals(buildCrewJobBlock(input).includes("\n\n\n"), false);
});

Deno.test("buildCrewJobBlock: headline-plus-scope-only (every other field null) -> single blank-line separator, nothing else", () => {
  const input: CrewJobBlockInput = {
    headline: "🏗️ New job scheduled — JOB-1104",
    contactName: null,
    businessName: null,
    clientPhone: null,
    startDate: null,
    startTime: null,
    jobAddress: null,
    scopeSummary: "Kitchen Demo — haul off cabinets.",
  };
  assertEquals(
    buildCrewJobBlock(input),
    "🏗️ New job scheduled — JOB-1104\n\nKitchen Demo — haul off cabinets.",
  );
});

// ── Recommended fix 5 (review): the money invariant. buildCrewJobBlock
// cannot leak pricing BY CONSTRUCTION for any field except headline and
// scopeSummary — see the comment on buildCrewJobBlock in slack.ts for where
// the actual "never forward GHL Scope Notes" guard lives (the caller). ────────

Deno.test("buildCrewJobBlock: fully-populated block contains no $ and no % — the money invariant", () => {
  const result = buildCrewJobBlock(fullInput);
  assertEquals(result.includes("$"), false);
  assertEquals(result.includes("%"), false);
});

Deno.test("buildCrewJobBlock: money placed in scopeSummary DOES pass through verbatim — the guard must live at the caller, not here", () => {
  const input = { ...fullInput, scopeSummary: "Total Bid: $4,200.00 (25% markup, true margin 19.3%)" };
  const result = buildCrewJobBlock(input);
  assertEquals(result.includes("$4,200.00"), true);
  assertEquals(result.includes("25% markup"), true);
});

// ── joinCrewJobBlocks ─────────────────────────────────────────────────────────

Deno.test("joinCrewJobBlocks: single block returns it unchanged, no divider", () => {
  assertEquals(joinCrewJobBlocks(["block one"]), "block one");
});

Deno.test("joinCrewJobBlocks: two blocks joined with a divider", () => {
  const expected = ["block one", "", BLOCK_DIVIDER, "", "block two"].join("\n");
  assertEquals(joinCrewJobBlocks(["block one", "block two"]), expected);
});

// BLOCKING fix 1 (review): BLOCK_DIVIDER previously read "──────────" (10x
// U+2500 BOX DRAWINGS LIGHT HORIZONTAL), contradicting the approved BL-4
// build brief's "Format" section, which specifies exactly 3x U+2014 EM DASH.
// The test above asserts against the exported constant, so it would pass
// for ANY glyph value — that's why the deviation was invisible. This test
// pins the literal so a future regression to the wrong glyph fails loudly.
Deno.test("joinCrewJobBlocks: divider is the literal em-dash sequence, not box-drawing characters", () => {
  const expected = ["block one", "", "———", "", "block two"].join("\n");
  assertEquals(joinCrewJobBlocks(["block one", "block two"]), expected);
});

Deno.test("joinCrewJobBlocks: three blocks — divider appears exactly twice, never trailing or leading", () => {
  const result = joinCrewJobBlocks(["block one", "block two", "block three"]);
  const expected = ["block one", "", BLOCK_DIVIDER, "", "block two", "", BLOCK_DIVIDER, "", "block three"].join("\n");
  assertEquals(result, expected);
  assertEquals(result.split(BLOCK_DIVIDER).length, 3);
  assertEquals(result.startsWith(BLOCK_DIVIDER), false);
  assertEquals(result.endsWith(BLOCK_DIVIDER), false);
});

Deno.test("joinCrewJobBlocks: empty array returns empty string", () => {
  assertEquals(joinCrewJobBlocks([]), "");
});

// ── postSlackMessage — Recommended fix 6 (review): zero prior coverage on
// the highest-blast-radius function in the module. Stubs globalThis.fetch,
// restored in a finally so a failure never leaks a stubbed fetch into other
// test files. Deliberately does NOT add a res.ok check inside the function
// under test — Slack returns HTTP 200 with ok:false for application errors,
// and both live callers already catch a thrown res.json(), so its absence
// was reviewed and cleared as correct. ──────────────────────────────────────

Deno.test("postSlackMessage: posts the exact URL, method, headers, and body; returns ok:true shape", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: string | URL | Request | undefined;
  let capturedInit: RequestInit | undefined;
  try {
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    }) as typeof fetch;

    const result = await postSlackMessage("xoxb-test-token", "C12345", "hello crew");

    assertEquals(capturedUrl, "https://slack.com/api/chat.postMessage");
    assertEquals(capturedInit?.method, "POST");
    assertEquals(
      (capturedInit?.headers as Record<string, string>)["Authorization"],
      "Bearer xoxb-test-token",
    );
    assertEquals(
      (capturedInit?.headers as Record<string, string>)["Content-Type"],
      "application/json",
    );
    assertEquals(capturedInit?.body, JSON.stringify({ channel: "C12345", text: "hello crew" }));
    assertEquals(result, { ok: true, error: undefined });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("postSlackMessage: ok:false Slack response is returned, not thrown", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), { status: 200 }),
      )) as typeof fetch;

    const result = await postSlackMessage("xoxb-test-token", "C-bad", "hello crew");
    assertEquals(result, { ok: false, error: "channel_not_found" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
