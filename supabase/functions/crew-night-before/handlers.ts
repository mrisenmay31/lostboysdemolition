// ============================================================
// Lost Boys Demolition — crew-night-before pure logic + deps-injected orchestration
// Kept separate from index.ts (which owns Deno.serve + the Supabase/Slack
// network clients) so this module has zero top-level side effects and can be
// unit tested without hitting the network. Mirrors the ghl-job-webhook split.
//
// BL-4: this module now shares supabase/functions/_shared/slack.ts for the
// per-job Slack block format (buildCrewJobBlock), date formatting, crew-env
// resolution, and postSlackMessage — the same module ghl-job-webhook uses, so
// there is exactly one implementation of each going forward.
// ============================================================

import {
  buildCrewJobBlock,
  formatDateLabel,
  joinCrewJobBlocks,
  resolveCrewChannelEnvVar,
} from "../_shared/slack.ts";

// Re-exported for handlers_test.ts / any other callers that import these
// from this module rather than directly from _shared/slack.ts.
export { formatDateLabel, resolveCrewChannelEnvVar };

const DENVER_TZ = "America/Denver";
const SEND_HOUR = 16; // 4pm local — the intended digest send time

// ── Denver-local date/time helpers — all pure, all over an injected `now` ────
// Never do raw UTC date math (ruling 7): every calendar-date computation goes
// through Intl.DateTimeFormat's timeZone-aware parts.

function getDenverDateParts(now: Date): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: DENVER_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function getDenverLocalDateString(now: Date): string {
  const { year, month, day } = getDenverDateParts(now);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function getTomorrowDenverDateString(now: Date): string {
  const { year, month, day } = getDenverDateParts(now);
  // Anchor at noon UTC on the Denver calendar date so a +1 day roll never
  // gets pulled back across a DST boundary by timezone conversion.
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() + 1);
  return `${anchor.getUTCFullYear()}-${pad2(anchor.getUTCMonth() + 1)}-${pad2(anchor.getUTCDate())}`;
}

export function getDenverLocalHour(now: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: DENVER_TZ,
    hour: "2-digit",
    hour12: false,
  });
  const hourStr = fmt.formatToParts(now).find((p) => p.type === "hour")?.value ?? "0";
  let hour = Number(hourStr);
  if (hour === 24) hour = 0; // some locales render midnight as "24" under hour12:false
  return hour;
}

/** DST self-gate (ruling 6): the cron fires both 22:30 and 23:30 UTC daily;
 *  only the one that lands on the SEND_HOUR local hour actually sends. */
export function isInSendWindow(now: Date, force: boolean): boolean {
  if (force) return true;
  return getDenverLocalHour(now) === SEND_HOUR;
}

// ── Job row shape + Slack message building ────────────────────────────────────

export interface JobRow {
  id: string;
  job_number: string | null;
  // L1 (BL-4 adversarial review): unread by formatJobLine — the BL-4 format
  // uses job_number + client_contact_name/business_name for identity, not
  // the combined "JOB-1104 – Contractor Company" string this column holds.
  // Kept selected/typed anyway: it's free (already indexed with the row),
  // and useful for ad-hoc debugging/log inspection without a second query.
  // client_name, its select-neighbor, is NOT dead — see the M1 fix above.
  job_name: string | null;
  job_address: string | null;
  client_name: string | null;
  start_date: string; // "YYYY-MM-DD"
  crew: string | null;
  client_contact_name: string | null;
  business_name: string | null;
  client_phone: string | null;
  start_time: string | null;
  scope_summary: string | null;
}

/** Per-job block, built via the shared BL-4 format (_shared/slack.ts
 *  buildCrewJobBlock): headline carries the job number (not the job name) so
 *  a multi-job digest stays legible once blocks are divider-joined.
 *
 *  M1 fix (BL-4 adversarial review): `client_contact_name` /
 *  `business_name` are written ONLY by ghl-job-webhook's Quote Accepted leg
 *  — the Job Scheduled leg never backfills them — so a job minted before
 *  this column existed and scheduled after has both NULL while
 *  `client_name` (the older, always-populated column) is non-null. Falling
 *  back to `client_name` keeps the client visible in that case; without it
 *  the identity line silently drops the client entirely. */
export function formatJobLine(job: JobRow): string {
  return buildCrewJobBlock({
    headline: `⏰ Tomorrow — ${job.job_number ?? "Job"}`,
    contactName: job.client_contact_name ?? job.client_name,
    businessName: job.business_name,
    clientPhone: job.client_phone,
    startDate: job.start_date,
    startTime: job.start_time,
    jobAddress: job.job_address,
    scopeSummary: job.scope_summary,
  });
}

/** One Slack message body per crew: all its jobs' blocks, joined via the
 *  shared divider (blank line, divider, blank line) so multi-job digests
 *  stay legible — buildCrewJobBlock's per-block blank lines would otherwise
 *  make block boundaries ambiguous under a plain "\n\n".join(). */
export function buildCrewDigest(jobs: JobRow[]): string {
  return joinCrewJobBlocks(jobs.map(formatJobLine));
}

export interface CrewGroup {
  /** First raw crew value seen for this normalized key — for display/logging only. */
  raw: string;
  jobs: JobRow[];
}

/** Groups jobs by NORMALIZED crew value (trim + lowercase) so "Crew 1" and
 *  "crew 1" merge into one group / one Slack message, never two posts to the
 *  same channel (fix round 1, F2). The raw (case-preserved) value of the
 *  first job seen is kept per group for display/logging. Null/blank crew
 *  groups under the "" key. */
export function groupJobsByCrew(jobs: JobRow[]): Map<string, CrewGroup> {
  const map = new Map<string, CrewGroup>();
  for (const job of jobs) {
    const raw = (job.crew ?? "").trim();
    const key = raw.toLowerCase();
    if (!map.has(key)) map.set(key, { raw, jobs: [] });
    map.get(key)!.jobs.push(job);
  }
  return map;
}

// resolveCrewChannelEnvVar (crew → SLACK_CREWn_CHANNEL env var name) now lives
// in _shared/slack.ts — imported and re-exported above.

// ── Request body ──────────────────────────────────────────────────────────────

export function parseRequestBody(json: unknown): { force: boolean } {
  if (typeof json !== "object" || json === null) return { force: false };
  const body = json as Record<string, unknown>;
  return { force: body.force === true };
}

// ── runNightBeforeDigest — deps-injected orchestration ─────────────────────────

export interface SyncLogEntry {
  direction: string;
  trigger_event: string;
  action_taken: "created" | "updated" | "skipped" | "error";
  status: "success" | "error";
  error_message?: string | null;
  payload_in?: unknown;
}

export interface NightBeforeDeps {
  fetchScheduledJobs: (tomorrow: string) => Promise<JobRow[]>;
  getChannelEnv: (envVarName: string) => string | undefined;
  postSlackMessage: (channel: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  updateSentOn: (jobIds: string[], sentOn: string) => Promise<{ error: unknown }>;
  writeLog: (entry: SyncLogEntry) => Promise<void>;
  now: Date;
  force?: boolean;
  /** H1 fix (BL-4 adversarial review): true when SLACK_TEST_CHANNEL_OVERRIDE
   *  is active, i.e. every crew's digest this run was posted to a scratch
   *  channel instead of its real SLACK_CREWn_CHANNEL. Orchestration uses this
   *  to suppress the night_before_sent_on stamp — stamping it here would make
   *  the real 4pm send believe the redirected job's digest already went out
   *  (excluded by index.ts's .or(night_before_sent_on...) filter), and since
   *  this design sends at most once with no retry, that crew would silently
   *  never get a real digest. */
  testChannelOverride?: boolean;
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

const DIRECTION = "supabase_to_slack";
const TRIGGER_EVENT = "night_before_digest";

export async function runNightBeforeDigest(deps: NightBeforeDeps): Promise<HandlerResult> {
  const force = deps.force ?? false;

  // ── DST self-gate — outside the send hour and not forced: no DB/Slack calls,
  //    no log write. This branch fires twice a day, every day, by design
  //    (ruling 6); logging it would just double sync_log noise for nothing. ──
  if (!isInSendWindow(deps.now, force)) {
    return { status: 200, body: { action: "skipped", reason: "outside send window" } };
  }

  const tomorrow = getTomorrowDenverDateString(deps.now);
  const jobs = await deps.fetchScheduledJobs(tomorrow);

  if (jobs.length === 0) {
    await deps.writeLog({
      direction: DIRECTION,
      trigger_event: TRIGGER_EVENT,
      action_taken: "skipped",
      status: "success",
      payload_in: { tomorrow, reason: "no jobs" },
    });
    return { status: 200, body: { action: "skipped", reason: "no jobs", tomorrow } };
  }

  const groups = groupJobsByCrew(jobs);
  const results: Array<Record<string, unknown>> = [];

  for (const [, { raw: crew, jobs: crewJobs }] of groups) {
    // Fix round 1, minor (b): isolate each crew group so a non-Slack throw
    // (e.g. a bad date string blowing up formatDateLabel inside buildCrewDigest)
    // can't abort the remaining groups — log it as this group's error and move on.
    try {
      const envVarName = resolveCrewChannelEnvVar(crew);

      // Unmapped crew (Jackson/Other/null/unknown) — permanent, expected,
      // never retried. Benign skip.
      if (!envVarName) {
        const reason = `unmapped crew "${crew}"`;
        console.error(`[crew-night-before] Skipping crew "${crew}" (${crewJobs.length} job(s)): ${reason}`);
        await deps.writeLog({
          direction: DIRECTION,
          trigger_event: TRIGGER_EVENT,
          action_taken: "skipped",
          status: "success",
          payload_in: { crew, job_count: crewJobs.length, reason },
        });
        results.push({ crew, action: "skipped", reason });
        continue;
      }

      const channel = deps.getChannelEnv(envVarName);

      // Fix round 1, F1: a MAPPED crew whose channel secret is unset is a
      // misconfiguration, not an expected/permanent skip — and per controller
      // ruling, this design sends at most once (the hour gate kills the
      // second cron fire same day; next day the date window has moved on),
      // so there is no retry to fall back on. Must be visible as an error.
      if (!channel) {
        const msg = `${envVarName} is not set — cannot send digest for crew "${crew}" (${crewJobs.length} job(s))`;
        console.error(`[crew-night-before] ${msg}`);
        await deps.writeLog({
          direction: DIRECTION,
          trigger_event: TRIGGER_EVENT,
          action_taken: "error",
          status: "error",
          error_message: msg,
          payload_in: { crew, job_count: crewJobs.length, missing_env_var: envVarName },
        });
        results.push({ crew, action: "error", error: msg });
        continue;
      }

      const text = buildCrewDigest(crewJobs);
      let slackResult: { ok: boolean; error?: string };
      try {
        slackResult = await deps.postSlackMessage(channel, text);
      } catch (err) {
        slackResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }

      if (!slackResult.ok) {
        const msg = `Slack post failed for crew "${crew}": ${slackResult.error ?? "unknown error"}`;
        console.error(`[crew-night-before] ${msg}`);
        await deps.writeLog({
          direction: DIRECTION,
          trigger_event: TRIGGER_EVENT,
          action_taken: "error",
          status: "error",
          error_message: msg,
          payload_in: { crew, job_count: crewJobs.length },
        });
        results.push({ crew, action: "error", error: msg });
        continue;
      }

      const jobIds = crewJobs.map((j) => j.id);

      // H1 fix (BL-4 adversarial review): under testChannelOverride the post
      // above went to a scratch channel, not this crew's real channel — do
      // NOT stamp night_before_sent_on, or the real 4pm send will believe
      // this job's digest already went out and silently skip it (no retry
      // exists once the date window moves on). Everything else in this
      // function is unchanged.
      if (!deps.testChannelOverride) {
        const { error: updateError } = await deps.updateSentOn(jobIds, tomorrow);
        if (updateError) {
          const msg = `Slack sent but night_before_sent_on stamp failed for crew "${crew}": ${
            updateError instanceof Error ? updateError.message : String(updateError)
          }`;
          console.error(`[crew-night-before] ${msg}`);
          await deps.writeLog({
            direction: DIRECTION,
            trigger_event: TRIGGER_EVENT,
            action_taken: "error",
            status: "error",
            error_message: msg,
            payload_in: { crew, job_count: crewJobs.length },
          });
          results.push({ crew, action: "sent_unstamped", error: msg });
          continue;
        }
      }

      await deps.writeLog({
        direction: DIRECTION,
        trigger_event: TRIGGER_EVENT,
        action_taken: "created",
        status: "success",
        payload_in: deps.testChannelOverride
          ? {
              crew,
              job_count: crewJobs.length,
              stamped: false,
              skip_reason: "test_channel_override_active",
            }
          : { crew, job_count: crewJobs.length },
      });
      results.push({
        crew,
        action: "created",
        job_count: crewJobs.length,
        ...(deps.testChannelOverride ? { stamped: false } : {}),
      });
    } catch (err) {
      const msg = `Unexpected error processing crew "${crew}": ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[crew-night-before] ${msg}`);
      await deps.writeLog({
        direction: DIRECTION,
        trigger_event: TRIGGER_EVENT,
        action_taken: "error",
        status: "error",
        error_message: msg,
        payload_in: { crew, job_count: crewJobs.length },
      });
      results.push({ crew, action: "error", error: msg });
    }
  }

  return { status: 200, body: { action: "completed", tomorrow, groups: results } };
}
