// ============================================================
// Lost Boys Demolition — crew-night-before pure logic + deps-injected orchestration
// Kept separate from index.ts (which owns Deno.serve + the Supabase/Slack
// network clients) so this module has zero top-level side effects and can be
// unit tested without hitting the network. Mirrors the ghl-job-webhook split.
//
// NOTE ON DUPLICATION: formatJobLine/buildCrewDigest intentionally reimplement
// the per-job Slack line shape Task 4 built in ghl-job-webhook rather than
// importing from a shared module — a parallel agent owns that directory and
// _shared/ is off-limits this session. Consolidate later (controller decision).
// ============================================================

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

/** Formats a plain `date` column value ("YYYY-MM-DD", no time/zone) as
 *  "Thu Aug 20". Anchored at noon UTC and formatted in UTC so the weekday/
 *  month/day are read straight off the calendar string, immune to any
 *  timezone shifting either the machine's or Denver's. */
export function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(dt);
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(dt);
  return `${weekday} ${month} ${d}`;
}

// ── Job row shape + Slack message building ────────────────────────────────────

export interface JobRow {
  id: string;
  job_number: string | null;
  job_name: string | null;
  job_address: string | null;
  client_name: string | null;
  start_date: string; // "YYYY-MM-DD"
  crew: string | null;
}

/** Per-job block, per the controller-specified 4-line spec:
 *  line 1 ⏰ Tomorrow: {job_name}
 *  line 2 📅 {formatted date}
 *  line 3 📍 {job_address}   (omitted if null)
 *  line 4 👤 {client_name}   (omitted if null)
 *  No 🕗 start-time or 📞 phone segment — neither is stored in Phase A. */
export function formatJobLine(job: JobRow): string {
  const lines = [`⏰ Tomorrow: ${job.job_name ?? job.job_number ?? "Job"}`];
  lines.push(`📅 ${formatDateLabel(job.start_date)}`);
  if (job.job_address) lines.push(`📍 ${job.job_address}`);
  if (job.client_name) lines.push(`👤 ${job.client_name}`);
  return lines.join("\n");
}

/** One Slack message body per crew: all its jobs' blocks, blank line between. */
export function buildCrewDigest(jobs: JobRow[]): string {
  return jobs.map(formatJobLine).join("\n\n");
}

/** Groups jobs by their trimmed crew value (raw, case preserved — case-folding
 *  happens only at channel-resolution time). Null/blank crew groups under "". */
export function groupJobsByCrew(jobs: JobRow[]): Map<string, JobRow[]> {
  const map = new Map<string, JobRow[]>();
  for (const job of jobs) {
    const key = (job.crew ?? "").trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(job);
  }
  return map;
}

/** Crew → Slack channel env var name, case-insensitive & trimmed (ruling 3).
 *  Returns the env VAR NAME, not its value — the caller resolves that via
 *  its own env accessor so this stays a pure function. */
export function resolveCrewChannelEnvVar(crew: string | null | undefined): string | null {
  const key = (crew ?? "").trim().toLowerCase();
  switch (key) {
    case "crew 1": return "SLACK_CREW1_CHANNEL";
    case "crew 2": return "SLACK_CREW2_CHANNEL";
    case "crew 3": return "SLACK_CREW3_CHANNEL";
    case "crew 4": return "SLACK_CREW4_CHANNEL";
    default: return null;
  }
}

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

  for (const [crew, crewJobs] of groups) {
    const envVarName = resolveCrewChannelEnvVar(crew);
    const channel = envVarName ? deps.getChannelEnv(envVarName) : undefined;

    if (!envVarName || !channel) {
      const reason = !envVarName ? `unmapped crew "${crew}"` : `${envVarName} not set`;
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

    await deps.writeLog({
      direction: DIRECTION,
      trigger_event: TRIGGER_EVENT,
      action_taken: "created",
      status: "success",
      payload_in: { crew, job_count: crewJobs.length },
    });
    results.push({ crew, action: "created", job_count: crewJobs.length });
  }

  return { status: 200, body: { action: "completed", tomorrow, groups: results } };
}
