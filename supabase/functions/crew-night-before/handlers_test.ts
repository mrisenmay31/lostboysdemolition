import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getDenverLocalDateString,
  getTomorrowDenverDateString,
  getDenverLocalHour,
  isInSendWindow,
  formatDateLabel,
  formatJobLine,
  buildCrewDigest,
  groupJobsByCrew,
  resolveCrewChannelEnvVar,
  parseRequestBody,
  runNightBeforeDigest,
  type JobRow,
  type NightBeforeDeps,
} from "./handlers.ts";

// ── getDenverLocalDateString / getTomorrowDenverDateString ────────────────────
// Uses UTC-based Date construction so these tests are deterministic regardless
// of the machine's local timezone.

Deno.test("getDenverLocalDateString: MDT (summer, UTC-6) mid-afternoon", () => {
  // 2026-08-13T22:00:00Z = 16:00 MDT on Aug 13
  assertEquals(getDenverLocalDateString(new Date("2026-08-13T22:00:00Z")), "2026-08-13");
});

Deno.test("getDenverLocalDateString: crosses UTC midnight but not Denver midnight", () => {
  // 2026-08-14T02:00:00Z (UTC calendar day = Aug 14) = 20:00 MDT on Aug 13 (Denver day = Aug 13)
  assertEquals(getDenverLocalDateString(new Date("2026-08-14T02:00:00Z")), "2026-08-13");
});

Deno.test("getDenverLocalDateString: after Denver midnight rolls to next local day", () => {
  // 2026-08-14T07:00:00Z = 01:00 MDT on Aug 14
  assertEquals(getDenverLocalDateString(new Date("2026-08-14T07:00:00Z")), "2026-08-14");
});

Deno.test("getTomorrowDenverDateString: simple next-day", () => {
  assertEquals(getTomorrowDenverDateString(new Date("2026-08-13T22:00:00Z")), "2026-08-14");
});

Deno.test("getTomorrowDenverDateString: UTC-vs-local mismatch still uses Denver date + 1", () => {
  // Denver local date is Aug 13 (see test above) — tomorrow must be Aug 14, not Aug 15.
  assertEquals(getTomorrowDenverDateString(new Date("2026-08-14T02:00:00Z")), "2026-08-14");
});

Deno.test("getTomorrowDenverDateString: month rollover", () => {
  assertEquals(getTomorrowDenverDateString(new Date("2026-08-31T22:00:00Z")), "2026-09-01");
});

// Fix round 1, minor (c): 2026 DST transition days — confirms the calendar-date
// (not clock-time) arithmetic in getDenverDateParts/getTomorrowDenverDateString
// holds across both changeovers.
Deno.test("getTomorrowDenverDateString: 2026 spring-forward day (Mar 8, MST->MDT)", () => {
  // 2026-03-08T22:30:00Z = 16:30 MDT on Mar 8 (the send-window instant, post-transition)
  assertEquals(getTomorrowDenverDateString(new Date("2026-03-08T22:30:00Z")), "2026-03-09");
});

Deno.test("getTomorrowDenverDateString: 2026 fall-back day (Nov 1, MDT->MST)", () => {
  // 2026-11-01T23:30:00Z = 16:30 MST on Nov 1 (the send-window instant, post-transition)
  assertEquals(getTomorrowDenverDateString(new Date("2026-11-01T23:30:00Z")), "2026-11-02");
});

// ── getDenverLocalHour / isInSendWindow ────────────────────────────────────────

Deno.test("getDenverLocalHour: MDT (summer, UTC-6) — 22:00Z is 16:00 local", () => {
  assertEquals(getDenverLocalHour(new Date("2026-08-13T22:00:00Z")), 16);
});

Deno.test("getDenverLocalHour: MST (winter, UTC-7) — 23:00Z is 16:00 local", () => {
  assertEquals(getDenverLocalHour(new Date("2026-01-15T23:00:00Z")), 16);
});

Deno.test("getDenverLocalHour: MDT — 21:00Z is 15:00 local (not the send hour)", () => {
  assertEquals(getDenverLocalHour(new Date("2026-08-13T21:00:00Z")), 15);
});

Deno.test("isInSendWindow: true during the summer 22:30 UTC cron fire (16:xx MDT)", () => {
  assertEquals(isInSendWindow(new Date("2026-08-13T22:30:00Z"), false), true);
});

Deno.test("isInSendWindow: false during the summer 23:30 UTC cron fire (17:xx MDT — wrong one)", () => {
  assertEquals(isInSendWindow(new Date("2026-08-13T23:30:00Z"), false), false);
});

Deno.test("isInSendWindow: true during the winter 23:30 UTC cron fire (16:xx MST)", () => {
  assertEquals(isInSendWindow(new Date("2026-01-15T23:30:00Z"), false), true);
});

Deno.test("isInSendWindow: false during the winter 22:30 UTC cron fire (15:xx MST — wrong one)", () => {
  assertEquals(isInSendWindow(new Date("2026-01-15T22:30:00Z"), false), false);
});

Deno.test("isInSendWindow: force:true bypasses the gate at any hour", () => {
  assertEquals(isInSendWindow(new Date("2026-08-13T12:00:00Z"), true), true);
});

// ── formatDateLabel ─────────────────────────────────────────────────────────

Deno.test("formatDateLabel: formats a plain date string as 'Thu Aug 20'", () => {
  assertEquals(formatDateLabel("2026-08-20"), "Thu Aug 20");
});

Deno.test("formatDateLabel: single-digit day, no leading zero", () => {
  assertEquals(formatDateLabel("2026-01-05"), "Mon Jan 5");
});

// ── formatJobLine / buildCrewDigest ─────────────────────────────────────────

const fullJob: JobRow = {
  id: "11111111-1111-1111-1111-111111111111",
  job_number: "JOB-1100",
  job_name: "JOB-1100 – Morrison – Holladay",
  job_address: "4285 S 300 W, Murray",
  client_name: "Ann Morrison",
  start_date: "2026-08-20",
  crew: "Crew 1",
  client_contact_name: "Ann Morrison",
  business_name: "Morrison Construction",
  client_phone: "(801) 555-0142",
  start_time: "8:00 AM",
  scope_summary: "Kitchen Demo — Remove and haul off all kitchen cabinets, countertops, and backsplash.",
};

Deno.test("formatJobLine: full job matches the exact BL-4 block format", () => {
  assertEquals(
    formatJobLine(fullJob),
    [
      "⏰ Tomorrow — JOB-1100",
      "Ann Morrison",
      "Morrison Construction",
      "(801) 555-0142",
      "",
      "Thu Aug 20",
      "8:00 AM",
      "4285 S 300 W, Murray",
      "",
      "Kitchen Demo — Remove and haul off all kitchen cabinets, countertops, and backsplash.",
    ].join("\n"),
  );
});

Deno.test("formatJobLine: omits the address line when job_address is null", () => {
  const job = { ...fullJob, job_address: null };
  assertEquals(
    formatJobLine(job),
    [
      "⏰ Tomorrow — JOB-1100",
      "Ann Morrison",
      "Morrison Construction",
      "(801) 555-0142",
      "",
      "Thu Aug 20",
      "8:00 AM",
      "",
      "Kitchen Demo — Remove and haul off all kitchen cabinets, countertops, and backsplash.",
    ].join("\n"),
  );
});

// M1 fix (BL-4 adversarial review): formatJobLine now falls back to
// client_name when client_contact_name is null, so genuinely omitting the
// identity-name line requires BOTH to be null (client_name null too) — see
// the dedicated M1 fallback tests above for the "falls back" case.
Deno.test("formatJobLine: omits the contact-name line when client_contact_name AND client_name are both null", () => {
  const job = { ...fullJob, client_contact_name: null, client_name: null };
  assertEquals(
    formatJobLine(job),
    [
      "⏰ Tomorrow — JOB-1100",
      "Morrison Construction",
      "(801) 555-0142",
      "",
      "Thu Aug 20",
      "8:00 AM",
      "4285 S 300 W, Murray",
      "",
      "Kitchen Demo — Remove and haul off all kitchen cabinets, countertops, and backsplash.",
    ].join("\n"),
  );
});

Deno.test("formatJobLine: all five new fields (plus client_name) null degrades to headline + date + address block, no blank-line artifacts", () => {
  const job = {
    ...fullJob,
    client_contact_name: null,
    client_name: null, // M1 fallback source — must also be null to truly omit identity
    business_name: null,
    client_phone: null,
    start_time: null,
    scope_summary: null,
  };
  assertEquals(
    formatJobLine(job),
    ["⏰ Tomorrow — JOB-1100", "", "Thu Aug 20", "4285 S 300 W, Murray"].join("\n"),
  );
});

Deno.test("formatJobLine: scope_summary present renders as its own trailing group", () => {
  const job = {
    ...fullJob,
    client_contact_name: null,
    client_name: null, // M1 fallback source — must also be null to truly omit identity
    business_name: null,
    client_phone: null,
    start_time: null,
    job_address: null,
  };
  assertEquals(
    formatJobLine(job),
    [
      "⏰ Tomorrow — JOB-1100",
      "",
      "Thu Aug 20",
      "",
      "Kitchen Demo — Remove and haul off all kitchen cabinets, countertops, and backsplash.",
    ].join("\n"),
  );
});

Deno.test("formatJobLine: start_time present but client_phone null", () => {
  const job = { ...fullJob, client_phone: null, scope_summary: null, business_name: null };
  assertEquals(
    formatJobLine(job),
    [
      "⏰ Tomorrow — JOB-1100",
      "Ann Morrison",
      "",
      "Thu Aug 20",
      "8:00 AM",
      "4285 S 300 W, Murray",
    ].join("\n"),
  );
});

// M1 fix (BL-4 adversarial review): client_contact_name/business_name are
// written only by ghl-job-webhook's Quote Accepted leg; a job minted before
// that column existed and scheduled after has both NULL while client_name
// (the older, always-populated column) is not. formatJobLine must fall back
// to client_name so the client doesn't silently vanish from the digest.
Deno.test("formatJobLine: all five new columns NULL but client_name populated — client_name fills the identity line", () => {
  const job: JobRow = {
    id: "33333333-3333-3333-3333-333333333333",
    job_number: "JOB-1102",
    job_name: null,
    job_address: null,
    client_name: "Contractor Company",
    start_date: "2026-08-20",
    crew: "Crew 1",
    client_contact_name: null,
    business_name: null,
    client_phone: null,
    start_time: null,
    scope_summary: null,
  };
  assertEquals(
    formatJobLine(job),
    ["⏰ Tomorrow — JOB-1102", "Contractor Company", "", "Thu Aug 20"].join("\n"),
  );
});

// buildCrewJobBlock's identical-string suppression (businessName vs
// contactName, case-insensitive) must still hold once contactName is
// resolved via the client_name fallback rather than client_contact_name —
// otherwise "Contractor Company" would print twice (once as the fallback
// identity line, once as the business line).
Deno.test("formatJobLine: client_name fallback equals business_name — no duplicate business line", () => {
  const job: JobRow = {
    ...fullJob,
    client_contact_name: null,
    client_name: "Contractor Company",
    business_name: "Contractor Company",
  };
  const line = formatJobLine(job);
  assertEquals(line.includes("Contractor Company"), true);
  // Exactly one occurrence — proves the business line was suppressed as a
  // duplicate of the client_name-derived identity line, not printed twice.
  assertEquals(line.split("Contractor Company").length - 1, 1);
});

// client_contact_name still wins over client_name when both are present —
// the fallback must not shadow the primary field.
Deno.test("formatJobLine: client_contact_name present takes precedence over client_name", () => {
  const job = { ...fullJob, client_name: "Some Other Legal Name" };
  assertEquals(formatJobLine(job).split("\n")[1], "Ann Morrison");
});

Deno.test("buildCrewDigest: single job — no divider", () => {
  assertEquals(buildCrewDigest([fullJob]), formatJobLine(fullJob));
});

Deno.test("buildCrewDigest: two jobs joined by the divider, exactly once, never trailing", () => {
  const jobTwo: JobRow = {
    id: "22222222-2222-2222-2222-222222222222",
    job_number: "JOB-1101",
    job_name: "JOB-1101 – Sunline Landscape",
    job_address: "812 E 900 S, Salt Lake City",
    client_name: null,
    start_date: "2026-08-20",
    crew: "Crew 1",
    client_contact_name: null,
    business_name: null,
    client_phone: null,
    start_time: null,
    scope_summary: null,
  };
  const expected = [
    "⏰ Tomorrow — JOB-1100",
    "Ann Morrison",
    "Morrison Construction",
    "(801) 555-0142",
    "",
    "Thu Aug 20",
    "8:00 AM",
    "4285 S 300 W, Murray",
    "",
    "Kitchen Demo — Remove and haul off all kitchen cabinets, countertops, and backsplash.",
    "",
    "———",
    "",
    "⏰ Tomorrow — JOB-1101",
    "",
    "Thu Aug 20",
    "812 E 900 S, Salt Lake City",
  ].join("\n");
  const actual = buildCrewDigest([fullJob, jobTwo]);
  assertEquals(actual, expected);
  // Divider proves it separates blocks, and appears exactly once for 2 jobs —
  // never after the last block.
  assertEquals(actual.split("———").length, 2);
  assertEquals(actual.endsWith("———"), false);
});

// ── groupJobsByCrew ──────────────────────────────────────────────────────────

Deno.test("groupJobsByCrew: groups by trimmed crew value", () => {
  const jobA = { ...fullJob, id: "a", crew: "Crew 1" };
  const jobB = { ...fullJob, id: "b", crew: " Crew 1 " };
  const jobC = { ...fullJob, id: "c", crew: "Crew 2" };
  const groups = groupJobsByCrew([jobA, jobB, jobC]);
  assertEquals(groups.get("crew 1")?.jobs.length, 2);
  assertEquals(groups.get("crew 2")?.jobs.length, 1);
  assertEquals(groups.size, 2);
});

Deno.test("groupJobsByCrew: null/empty crew groups under empty-string key", () => {
  const jobA = { ...fullJob, id: "a", crew: null };
  const jobB = { ...fullJob, id: "b", crew: "" };
  const groups = groupJobsByCrew([jobA, jobB]);
  assertEquals(groups.get("")?.jobs.length, 2);
});

// Fix round 1, F2: case-insensitive grouping — "Crew 1" and "crew 1" (and any
// other-cased variant) must merge into ONE group, so exactly one Slack
// message goes to the shared channel instead of two.
Deno.test("groupJobsByCrew: mixed-case same-crew rows merge into one group", () => {
  const jobA = { ...fullJob, id: "a", crew: "Crew 1" };
  const jobB = { ...fullJob, id: "b", crew: "crew 1" };
  const jobC = { ...fullJob, id: "c", crew: "CREW 1" };
  const jobD = { ...fullJob, id: "d", crew: " Crew 1 " };
  const groups = groupJobsByCrew([jobA, jobB, jobC, jobD]);
  assertEquals(groups.size, 1);
  const group = groups.get("crew 1");
  assertEquals(group?.jobs.length, 4);
  assertEquals(group?.raw, "Crew 1"); // first raw value seen, preserved for display
});

// ── resolveCrewChannelEnvVar ─────────────────────────────────────────────────

Deno.test("resolveCrewChannelEnvVar: maps Crew 1-4 case-insensitively, trimmed", () => {
  assertEquals(resolveCrewChannelEnvVar("Crew 1"), "SLACK_CREW1_CHANNEL");
  assertEquals(resolveCrewChannelEnvVar("crew 2"), "SLACK_CREW2_CHANNEL");
  assertEquals(resolveCrewChannelEnvVar(" CREW 3 "), "SLACK_CREW3_CHANNEL");
  assertEquals(resolveCrewChannelEnvVar("Crew 4"), "SLACK_CREW4_CHANNEL");
});

Deno.test("resolveCrewChannelEnvVar: unmapped crew (Jackson, Other, unknown) returns null", () => {
  assertEquals(resolveCrewChannelEnvVar("Jackson"), null);
  assertEquals(resolveCrewChannelEnvVar("Other"), null);
  assertEquals(resolveCrewChannelEnvVar("Crew 5"), null);
  assertEquals(resolveCrewChannelEnvVar(null), null);
  assertEquals(resolveCrewChannelEnvVar(""), null);
});

// ── parseRequestBody ─────────────────────────────────────────────────────────

Deno.test("parseRequestBody: {force:true} is force", () => {
  assertEquals(parseRequestBody({ force: true }), { force: true });
});

Deno.test("parseRequestBody: empty body, null, non-object all default force:false", () => {
  assertEquals(parseRequestBody({}), { force: false });
  assertEquals(parseRequestBody(null), { force: false });
  assertEquals(parseRequestBody("nope"), { force: false });
  assertEquals(parseRequestBody(undefined), { force: false });
});

// ── runNightBeforeDigest — deps-injected orchestration ────────────────────────

function makeDeps(overrides: Partial<NightBeforeDeps> = {}): NightBeforeDeps {
  return {
    fetchScheduledJobs: async () => [],
    getChannelEnv: () => undefined,
    postSlackMessage: async () => ({ ok: true }),
    updateSentOn: async () => ({ error: null }),
    writeLog: async () => {},
    now: new Date("2026-08-13T22:00:00Z"),
    force: false,
    ...overrides,
  };
}

Deno.test("runNightBeforeDigest: outside send window returns skipped without touching deps", async () => {
  let fetchCalled = false;
  const deps = makeDeps({
    now: new Date("2026-08-13T12:00:00Z"), // 6am MDT — well outside window
    fetchScheduledJobs: async () => { fetchCalled = true; return []; },
  });
  const result = await runNightBeforeDigest(deps);
  assertEquals(result, { status: 200, body: { action: "skipped", reason: "outside send window" } });
  assertEquals(fetchCalled, false);
});

Deno.test("runNightBeforeDigest: force:true fires even outside the window", async () => {
  const deps = makeDeps({
    now: new Date("2026-08-13T12:00:00Z"),
    force: true,
    fetchScheduledJobs: async () => [],
  });
  const result = await runNightBeforeDigest(deps);
  assertEquals(result.body.action, "skipped");
  assertEquals(result.body.reason, "no jobs");
});

Deno.test("runNightBeforeDigest: no jobs tomorrow logs skipped and returns 200", async () => {
  const logs: any[] = [];
  const deps = makeDeps({
    fetchScheduledJobs: async () => [],
    writeLog: async (entry) => { logs.push(entry); },
  });
  const result = await runNightBeforeDigest(deps);
  assertEquals(result.status, 200);
  assertEquals(result.body.action, "skipped");
  assertEquals(logs.length, 1);
  assertEquals(logs[0].action_taken, "skipped");
  assertEquals(logs[0].status, "success");
});

Deno.test("runNightBeforeDigest: happy path — posts one message per crew and stamps sent-on", async () => {
  const posted: Array<{ channel: string; text: string }> = [];
  const updated: Array<{ ids: string[]; sentOn: string }> = [];
  const logs: any[] = [];
  const jobs: JobRow[] = [
    { ...fullJob, id: "a", crew: "Crew 1" },
    { ...fullJob, id: "b", crew: "Crew 2" },
  ];
  const deps = makeDeps({
    fetchScheduledJobs: async () => jobs,
    getChannelEnv: (name: string) =>
      name === "SLACK_CREW1_CHANNEL" ? "#crew1" : name === "SLACK_CREW2_CHANNEL" ? "#crew2" : undefined,
    postSlackMessage: async (channel: string, text: string) => {
      posted.push({ channel, text });
      return { ok: true };
    },
    updateSentOn: async (ids: string[], sentOn: string) => {
      updated.push({ ids, sentOn });
      return { error: null };
    },
    writeLog: async (entry) => { logs.push(entry); },
  });
  const result = await runNightBeforeDigest(deps);
  assertEquals(result.status, 200);
  assertEquals(posted.length, 2);
  assertEquals(posted.map((p) => p.channel).sort(), ["#crew1", "#crew2"]);
  assertEquals(updated.length, 2);
  assertEquals(updated[0].sentOn, "2026-08-14");
  assertEquals(logs.filter((l) => l.action_taken === "created").length, 2);
});

Deno.test("runNightBeforeDigest: unmapped crew is skipped, never throws, other groups still send", async () => {
  const posted: string[] = [];
  const logs: any[] = [];
  const jobs: JobRow[] = [
    { ...fullJob, id: "a", crew: "Jackson" }, // unmapped
    { ...fullJob, id: "b", crew: "Crew 1" },
  ];
  const deps = makeDeps({
    fetchScheduledJobs: async () => jobs,
    getChannelEnv: (name: string) => (name === "SLACK_CREW1_CHANNEL" ? "#crew1" : undefined),
    postSlackMessage: async (channel: string) => { posted.push(channel); return { ok: true }; },
    writeLog: async (entry) => { logs.push(entry); },
  });
  const result = await runNightBeforeDigest(deps);
  assertEquals(result.status, 200);
  assertEquals(posted, ["#crew1"]);
  assertEquals(logs.some((l) => l.action_taken === "skipped"), true);
  assertEquals(logs.some((l) => l.action_taken === "created"), true);
});

// Fix round 1, F1: a MAPPED crew (resolves to an env var name) whose
// SLACK_CREWn_CHANNEL is unset is a misconfiguration, not a benign skip —
// it must surface as action_taken:'error' with the missing env var named in
// error_message, since (per controller ruling) this design never retries.
Deno.test("runNightBeforeDigest: missing env var on a MAPPED crew logs error naming the env var, never throws", async () => {
  const logs: any[] = [];
  const jobs: JobRow[] = [{ ...fullJob, id: "a", crew: "Crew 3" }];
  const deps = makeDeps({
    fetchScheduledJobs: async () => jobs,
    getChannelEnv: () => undefined, // SLACK_CREW3_CHANNEL unset
    writeLog: async (entry) => { logs.push(entry); },
  });
  const result = await runNightBeforeDigest(deps);
  assertEquals(result.status, 200);
  assertEquals(logs.length, 1);
  assertEquals(logs[0].action_taken, "error");
  assertEquals(logs[0].status, "error");
  assertEquals(typeof logs[0].error_message, "string");
  assertEquals(logs[0].error_message.includes("SLACK_CREW3_CHANNEL"), true);
});

// Fix round 1, F1 contrast: an UNMAPPED crew (no env var name at all) stays
// the benign, permanent, expected skip — distinct from the mapped-but-unset
// case above.
Deno.test("runNightBeforeDigest: unmapped crew stays skipped/success (not error)", async () => {
  const logs: any[] = [];
  const jobs: JobRow[] = [{ ...fullJob, id: "a", crew: "Jackson" }];
  const deps = makeDeps({
    fetchScheduledJobs: async () => jobs,
    writeLog: async (entry) => { logs.push(entry); },
  });
  const result = await runNightBeforeDigest(deps);
  assertEquals(result.status, 200);
  assertEquals(logs.length, 1);
  assertEquals(logs[0].action_taken, "skipped");
  assertEquals(logs[0].status, "success");
});

// Fix round 1, F2 (orchestration level): mixed-case crew values for the same
// crew must produce exactly ONE Slack post, not two, to the shared channel.
Deno.test("runNightBeforeDigest: mixed-case same-crew rows produce exactly one Slack message", async () => {
  const posted: Array<{ channel: string; text: string }> = [];
  const jobs: JobRow[] = [
    { ...fullJob, id: "a", crew: "Crew 1" },
    { ...fullJob, id: "b", crew: "crew 1", job_number: "JOB-1101", job_name: "JOB-1101 – Other Client" },
  ];
  const deps = makeDeps({
    fetchScheduledJobs: async () => jobs,
    getChannelEnv: (name: string) => (name === "SLACK_CREW1_CHANNEL" ? "#crew1" : undefined),
    postSlackMessage: async (channel: string, text: string) => {
      posted.push({ channel, text });
      return { ok: true };
    },
  });
  const result = await runNightBeforeDigest(deps);
  assertEquals(result.status, 200);
  assertEquals(posted.length, 1);
  assertEquals(posted[0].channel, "#crew1");
  // Both jobs' blocks present in the single combined message.
  assertEquals(posted[0].text.includes("JOB-1100"), true);
  assertEquals(posted[0].text.includes("JOB-1101"), true);
});

Deno.test("runNightBeforeDigest: Slack post failure logs error, does not stamp night_before_sent_on, does not throw", async () => {
  const updated: any[] = [];
  const logs: any[] = [];
  const jobs: JobRow[] = [{ ...fullJob, id: "a", crew: "Crew 1" }];
  const deps = makeDeps({
    fetchScheduledJobs: async () => jobs,
    getChannelEnv: (name: string) => (name === "SLACK_CREW1_CHANNEL" ? "#crew1" : undefined),
    postSlackMessage: async () => ({ ok: false, error: "channel_not_found" }),
    updateSentOn: async (ids: string[], sentOn: string) => { updated.push({ ids, sentOn }); return { error: null }; },
    writeLog: async (entry) => { logs.push(entry); },
  });
  const result = await runNightBeforeDigest(deps);
  assertEquals(result.status, 200);
  assertEquals(updated.length, 0);
  assertEquals(logs[0].action_taken, "error");
  assertEquals(logs[0].status, "error");
});

// Fix round 1, minor (b): a non-Slack throw inside one crew group's
// processing (e.g. formatDateLabel blowing up on a malformed start_date)
// must not abort the remaining groups.
Deno.test("runNightBeforeDigest: a throw building one crew's digest is isolated — other crews still send", async () => {
  const posted: string[] = [];
  const logs: any[] = [];
  const jobs: JobRow[] = [
    { ...fullJob, id: "a", crew: "Crew 1", start_date: "not-a-date" }, // will throw in formatDateLabel
    { ...fullJob, id: "b", crew: "Crew 2" },
  ];
  const deps = makeDeps({
    fetchScheduledJobs: async () => jobs,
    getChannelEnv: (name: string) =>
      name === "SLACK_CREW1_CHANNEL" ? "#crew1" : name === "SLACK_CREW2_CHANNEL" ? "#crew2" : undefined,
    postSlackMessage: async (channel: string) => { posted.push(channel); return { ok: true }; },
    writeLog: async (entry) => { logs.push(entry); },
  });
  const result = await runNightBeforeDigest(deps);
  assertEquals(result.status, 200);
  assertEquals(posted, ["#crew2"]);
  assertEquals(logs.some((l) => l.action_taken === "error"), true);
  assertEquals(logs.some((l) => l.action_taken === "created"), true);
});

// ── H1 fix (BL-4 adversarial review): testChannelOverride ─────────────────────
// SLACK_TEST_CHANNEL_OVERRIDE routes every crew's post to a scratch channel;
// without this fix, updateSentOn still stamped night_before_sent_on as if
// the real crew had been notified, so the real 4pm send would silently skip
// that job (no retry exists once the date window moves on).

Deno.test("runNightBeforeDigest: testChannelOverride true — posts, but does NOT call updateSentOn", async () => {
  const posted: Array<{ channel: string; text: string }> = [];
  let updateSentOnCalled = false;
  const logs: any[] = [];
  const jobs: JobRow[] = [{ ...fullJob, id: "a", crew: "Crew 1" }];
  const deps = makeDeps({
    fetchScheduledJobs: async () => jobs,
    getChannelEnv: (name: string) => (name === "SLACK_CREW1_CHANNEL" ? "#scratch-test" : undefined),
    postSlackMessage: async (channel: string, text: string) => {
      posted.push({ channel, text });
      return { ok: true };
    },
    updateSentOn: async (ids: string[], sentOn: string) => {
      updateSentOnCalled = true;
      return { error: null };
    },
    writeLog: async (entry) => { logs.push(entry); },
    testChannelOverride: true,
  });
  const result = await runNightBeforeDigest(deps);
  assertEquals(result.status, 200);
  // The post itself still happens — only the stamp is suppressed.
  assertEquals(posted.length, 1);
  assertEquals(updateSentOnCalled, false);
});

Deno.test("runNightBeforeDigest: testChannelOverride true — logs status:success, action_taken:created, payload_in marks stamped:false with a reason", async () => {
  const logs: any[] = [];
  const jobs: JobRow[] = [{ ...fullJob, id: "a", crew: "Crew 1" }];
  const deps = makeDeps({
    fetchScheduledJobs: async () => jobs,
    getChannelEnv: (name: string) => (name === "SLACK_CREW1_CHANNEL" ? "#scratch-test" : undefined),
    postSlackMessage: async () => ({ ok: true }),
    writeLog: async (entry) => { logs.push(entry); },
    testChannelOverride: true,
  });
  const result = await runNightBeforeDigest(deps);
  assertEquals(result.status, 200);
  assertEquals(logs.length, 1);
  // The post genuinely succeeded, so status stays success — action_taken
  // stays within the CHECK-constrained enum ('created'), never a new value.
  assertEquals(logs[0].action_taken, "created");
  assertEquals(logs[0].status, "success");
  // But payload_in must make the un-stamped state unmistakable.
  assertEquals(logs[0].payload_in.stamped, false);
  assertEquals(typeof logs[0].payload_in.skip_reason, "string");
  assertEquals(logs[0].payload_in.skip_reason.length > 0, true);
});

Deno.test("runNightBeforeDigest: testChannelOverride false/undefined — updateSentOn IS still called (no behavior change on the real path)", async () => {
  let updateSentOnCalled = false;
  const logs: any[] = [];
  const jobs: JobRow[] = [{ ...fullJob, id: "a", crew: "Crew 1" }];
  const deps = makeDeps({
    fetchScheduledJobs: async () => jobs,
    getChannelEnv: (name: string) => (name === "SLACK_CREW1_CHANNEL" ? "#crew1" : undefined),
    postSlackMessage: async () => ({ ok: true }),
    updateSentOn: async () => { updateSentOnCalled = true; return { error: null }; },
    writeLog: async (entry) => { logs.push(entry); },
    // testChannelOverride intentionally omitted — must default to the
    // pre-H1 behavior.
  });
  const result = await runNightBeforeDigest(deps);
  assertEquals(result.status, 200);
  assertEquals(updateSentOnCalled, true);
  assertEquals(logs[0].payload_in, { crew: "Crew 1", job_count: 1 });
});

Deno.test("runNightBeforeDigest: Slack post throws is caught, logged as error, does not throw", async () => {
  const logs: any[] = [];
  const jobs: JobRow[] = [{ ...fullJob, id: "a", crew: "Crew 1" }];
  const deps = makeDeps({
    fetchScheduledJobs: async () => jobs,
    getChannelEnv: (name: string) => (name === "SLACK_CREW1_CHANNEL" ? "#crew1" : undefined),
    postSlackMessage: async () => { throw new Error("network down"); },
    writeLog: async (entry) => { logs.push(entry); },
  });
  const result = await runNightBeforeDigest(deps);
  assertEquals(result.status, 200);
  assertEquals(logs[0].action_taken, "error");
});
