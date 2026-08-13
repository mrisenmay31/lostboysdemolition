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
};

Deno.test("formatJobLine: full job matches the exact 4-line spec format", () => {
  assertEquals(
    formatJobLine(fullJob),
    "⏰ Tomorrow: JOB-1100 – Morrison – Holladay\n📅 Thu Aug 20\n📍 4285 S 300 W, Murray\n👤 Ann Morrison",
  );
});

Deno.test("formatJobLine: omits the address line when job_address is null", () => {
  const job = { ...fullJob, job_address: null };
  assertEquals(
    formatJobLine(job),
    "⏰ Tomorrow: JOB-1100 – Morrison – Holladay\n📅 Thu Aug 20\n👤 Ann Morrison",
  );
});

Deno.test("formatJobLine: omits the client line when client_name is null", () => {
  const job = { ...fullJob, client_name: null };
  assertEquals(
    formatJobLine(job),
    "⏰ Tomorrow: JOB-1100 – Morrison – Holladay\n📅 Thu Aug 20\n📍 4285 S 300 W, Murray",
  );
});

Deno.test("formatJobLine: omits both optional lines when both are null", () => {
  const job = { ...fullJob, job_address: null, client_name: null };
  assertEquals(
    formatJobLine(job),
    "⏰ Tomorrow: JOB-1100 – Morrison – Holladay\n📅 Thu Aug 20",
  );
});

Deno.test("buildCrewDigest: two jobs joined with a blank line between them (exact expected message)", () => {
  const jobTwo: JobRow = {
    id: "22222222-2222-2222-2222-222222222222",
    job_number: "JOB-1101",
    job_name: "JOB-1101 – Sunline Landscape",
    job_address: "812 E 900 S, Salt Lake City",
    client_name: null,
    start_date: "2026-08-20",
    crew: "Crew 1",
  };
  const expected = [
    "⏰ Tomorrow: JOB-1100 – Morrison – Holladay",
    "📅 Thu Aug 20",
    "📍 4285 S 300 W, Murray",
    "👤 Ann Morrison",
    "",
    "⏰ Tomorrow: JOB-1101 – Sunline Landscape",
    "📅 Thu Aug 20",
    "📍 812 E 900 S, Salt Lake City",
  ].join("\n");
  assertEquals(buildCrewDigest([fullJob, jobTwo]), expected);
});

// ── groupJobsByCrew ──────────────────────────────────────────────────────────

Deno.test("groupJobsByCrew: groups by trimmed crew value", () => {
  const jobA = { ...fullJob, id: "a", crew: "Crew 1" };
  const jobB = { ...fullJob, id: "b", crew: " Crew 1 " };
  const jobC = { ...fullJob, id: "c", crew: "Crew 2" };
  const groups = groupJobsByCrew([jobA, jobB, jobC]);
  assertEquals(groups.get("Crew 1")?.length, 2);
  assertEquals(groups.get("Crew 2")?.length, 1);
  assertEquals(groups.size, 2);
});

Deno.test("groupJobsByCrew: null/empty crew groups under empty-string key", () => {
  const jobA = { ...fullJob, id: "a", crew: null };
  const jobB = { ...fullJob, id: "b", crew: "" };
  const groups = groupJobsByCrew([jobA, jobB]);
  assertEquals(groups.get("")?.length, 2);
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

Deno.test("runNightBeforeDigest: missing env var (mapped crew, unset secret) is skipped, never throws", async () => {
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
  assertEquals(logs[0].action_taken, "skipped");
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
