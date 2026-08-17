import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveCrewEnvKey,
  resolveCrewChannelEnvVar,
  formatDateLabel,
  formatPhone,
  buildCrewJobBlock,
  joinCrewJobBlocks,
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

Deno.test("formatPhone: international number passes through trimmed and unchanged", () => {
  assertEquals(formatPhone("+44 20 7946 0958"), "+44 20 7946 0958");
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

// ── joinCrewJobBlocks ─────────────────────────────────────────────────────────

Deno.test("joinCrewJobBlocks: single block returns it unchanged, no divider", () => {
  assertEquals(joinCrewJobBlocks(["block one"]), "block one");
});

Deno.test("joinCrewJobBlocks: two blocks joined with a divider", () => {
  const expected = ["block one", "", BLOCK_DIVIDER, "", "block two"].join("\n");
  assertEquals(joinCrewJobBlocks(["block one", "block two"]), expected);
});

Deno.test("joinCrewJobBlocks: empty array returns empty string", () => {
  assertEquals(joinCrewJobBlocks([]), "");
});
