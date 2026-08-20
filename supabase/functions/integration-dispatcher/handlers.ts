// ============================================================
// Lost Boys Demolition — integration-dispatcher pure logic + deps-injected
// orchestration (v2 Task 5A).
//
// Kept separate from index.ts (which owns Deno.serve + real network/env
// wiring) so this module has zero top-level side effects and can be unit
// tested without hitting the network — same split as ghl-job-webhook and
// crew-night-before. Handlers here NEVER read Deno.env and NEVER call
// fetch directly; every external effect goes through DispatcherDeps.
//
// Consumes rows claimed off the `integration_outbox` table (Task 5A's
// migrations lane owns that schema + the `claim_integration_events` RPC;
// this file only knows the row shape, per the brief). Three event types:
// job.scheduled, ghl.stage.requested, job.cancelled.
// ============================================================

import { addOneDay, formatCurrency } from "../_shared/google.ts";
import {
  buildCrewJobBlock,
  resolveCrewEnvKey,
  type CrewEnvKey,
} from "../_shared/slack.ts";
import { writeSyncLog } from "../_shared/log.ts";

// ── Outbox row contract (claim_integration_events return shape) ────────────

export interface OutboxRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string; // = job_number
  idempotency_key: string;
  payload: any;
  status: string;
  attempts: number;
  available_at: string | null;
  locked_at: string | null;
  last_error: string | null;
  created_at: string;
  completed_at: string | null;
}

// ── Deps ─────────────────────────────────────────────────────────────────
// Same split as ghl-job-webhook: `supabase` is one raw injected client (DB
// reads/writes go straight through it, exactly like the sibling functions
// do), everything that touches an external network — Google Calendar,
// Slack, GHL — is its own named function so tests never need a fetch mock.

export interface GhlPipeline {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }>;
}

export interface DispatcherDeps {
  supabase: any;
  now: () => Date;
  getAccessToken: () => Promise<string>;
  createCalendarEvent: (calendarId: string, accessToken: string, eventBody: any) => Promise<{ id: string }>;
  updateCalendarEvent: (calendarId: string, eventId: string, accessToken: string, eventBody: any) => Promise<{ id: string }>;
  deleteCalendarEvent: (calendarId: string, eventId: string, accessToken: string) => Promise<void>;
  calendarIds: Record<"main" | CrewEnvKey, string>;
  postSlackMessage: (channel: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  slackChannels: Record<CrewEnvKey, string>;
  fetchPipelines: () => Promise<GhlPipeline[]>;
  fetchOpportunity: (id: string) => Promise<any>;
  updateOpportunityStage: (opportunityId: string, stageId: string) => Promise<any>;
}

// ── Dispatch summary ─────────────────────────────────────────────────────

export interface EventOutcome {
  id: string;
  event_type: string;
  outcome: "succeeded" | "failed" | "dead_letter";
  detail?: string;
}

export interface DispatchSummary {
  claimed: number;
  succeeded: number;
  failed: number;
  dead_lettered: number;
  results: EventOutcome[];
}

// ── Event payload contracts (from schedule_estimate / cancel_scheduled_job) ─

export interface JobScheduledPayload {
  job_number: string;
  crew: string;
  start_date: string; // inclusive
  end_date: string; // inclusive
  calendar_sync_revision: number;
}

export interface GhlStageRequestedPayload {
  stage: string;
  job_number: string;
  ghl_opportunity_id: string;
}

export interface JobCancelledPayload {
  job_number: string;
  resolution: "postponed" | "closed_lost";
  gcal_main_event_id: string | null;
  gcal_crew_event_id: string | null;
  crew: string | null;
}

// ── jobs row shape this dispatcher reads/writes ─────────────────────────────

interface DispatcherJobRow {
  id: string;
  job_number: string;
  client_name: string | null;
  client_contact_name: string | null;
  business_name: string | null;
  client_phone: string | null;
  job_address: string | null;
  city: string | null;
  crew: string | null;
  start_date: string | null;
  end_date: string | null;
  estimate_value: number | null;
  gcal_main_event_id: string | null;
  gcal_crew_event_id: string | null;
  slack_notified_at: string | null;
  calendar_sync_revision: number | null;
  status_v2: string | null;
  start_time: string | null;
  scope_summary: string | null;
}

const JOB_ROW_COLUMNS =
  "id, job_number, client_name, client_contact_name, business_name, client_phone, job_address, city, " +
  "crew, start_date, end_date, estimate_value, gcal_main_event_id, gcal_crew_event_id, slack_notified_at, " +
  "calendar_sync_revision, status_v2, start_time, scope_summary";

async function fetchJobRow(deps: DispatcherDeps, jobNumber: string): Promise<DispatcherJobRow | null> {
  const { data, error } = await deps.supabase
    .from("jobs")
    .select(JOB_ROW_COLUMNS)
    .eq("job_number", jobNumber)
    .maybeSingle();
  if (error) throw new Error(`jobs lookup failed for ${jobNumber}: ${error.message ?? String(error)}`);
  return (data as DispatcherJobRow | null) ?? null;
}

async function persistJobField(deps: DispatcherDeps, jobId: string, column: string, value: unknown): Promise<void> {
  const { error } = await deps.supabase.from("jobs").update({ [column]: value }).eq("id", jobId);
  if (error) throw new Error(`failed to persist ${column}: ${error.message ?? String(error)}`);
}

async function persistJobFields(deps: DispatcherDeps, jobId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await deps.supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) throw new Error(`failed to persist jobs update: ${error.message ?? String(error)}`);
}

// ── Calendar body — v2 spec, exact shape ────────────────────────────────────
// Separate builder from ghl-job-webhook's buildCalendarEventBody by design
// (house style: no cross-function imports) — this one additionally carries
// extendedProperties.private, which ghl-job-webhook's Phase A version does
// not.

export type DispatcherCalendarAudience = "main" | "crew";

export interface DispatcherCalendarInput {
  jobNumber: string;
  clientName: string | null;
  jobAddress: string | null;
  estimateValue: number | null;
  crew: string | null;
  startDate: string; // inclusive
  endDate: string; // inclusive — caller adds one day for Google's exclusive end
  calendarSyncRevision: number;
}

/** Client, estimate value (main audience only — mirrors the BL-5 no-pricing
 *  boundary from ghl-job-webhook), crew, address — omit any line whose value
 *  is null/empty. Crew audience NEVER contains price/revenue/margin/markup/
 *  hours/dump — the only monetary field this input carries is
 *  `estimateValue`, and it's gated on audience === "main" by construction. */
export function buildDispatcherCalendarDescription(
  job: DispatcherCalendarInput,
  audience: DispatcherCalendarAudience,
): string {
  const lines: string[] = [];
  if (job.clientName) lines.push(`Client: ${job.clientName}`);
  if (audience === "main" && job.estimateValue != null) {
    lines.push(`Estimate: ${formatCurrency(job.estimateValue)}`);
  }
  if (job.crew) lines.push(`Crew: ${job.crew}`);
  if (job.jobAddress) lines.push(`Address: ${job.jobAddress}`);
  return lines.join("\n");
}

/** Exact per-spec event body. Inclusive→exclusive is load-bearing: a job
 *  scheduled Aug 18–19 writes end.date Aug 20 (Google Calendar all-day
 *  events treat `end.date` as exclusive). `extendedProperties.private`
 *  carries the fields the future inbound-calendar-sync leg (Task 5B) will
 *  read back to recognize an app-managed event. */
export function buildScheduleCalendarEventBody(
  job: DispatcherCalendarInput,
  audience: DispatcherCalendarAudience,
): {
  summary: string;
  start: { date: string };
  end: { date: string };
  description: string;
  extendedProperties: { private: { jobNumber: string; scheduleRevision: string; managedBy: string } };
} {
  return {
    summary: `${job.jobNumber} — ${job.clientName ?? ""} — ${job.jobAddress ?? ""}`,
    start: { date: job.startDate },
    end: { date: addOneDay(job.endDate) },
    description: buildDispatcherCalendarDescription(job, audience),
    extendedProperties: {
      private: {
        jobNumber: job.jobNumber,
        scheduleRevision: String(job.calendarSyncRevision),
        managedBy: "lostboys-estimator",
      },
    },
  };
}

// ── Calendar leg — idempotent create-vs-update with the R11 404 fallback ──

/** 404/410 detection on an UPDATE failure — matches the exact error-text
 *  shape `_shared/google.ts`'s updateCalendarEvent throws
 *  (`Calendar event update failed (${res.status}): ...`). deleteCalendarEvent
 *  has its own 404/410-is-success contract inside google.ts itself and never
 *  needs this — only updateCalendarEvent's failure path does. */
function isNotFoundError(err: unknown): boolean {
  const msg = (err as any)?.message ?? String(err);
  return /\(404\)|\(410\)/.test(msg);
}

/** Create-vs-update on one calendar target. Returns the event id that ended
 *  up live on `calendarId` (existing id when nothing changed, or the fresh
 *  id from a create/404-fallback-create), or null if `calendarId` isn't
 *  configured (caller's job to decide whether that's ordinary or a
 *  misconfiguration — this function stays agnostic). */
async function upsertCalendarEvent(
  deps: DispatcherDeps,
  opts: {
    audience: DispatcherCalendarAudience;
    calendarId: string;
    existingEventId: string | null;
    input: DispatcherCalendarInput;
    accessToken: string;
  },
): Promise<string | null> {
  if (!opts.calendarId) return null;
  const body = buildScheduleCalendarEventBody(opts.input, opts.audience);

  if (!opts.existingEventId) {
    const created = await deps.createCalendarEvent(opts.calendarId, opts.accessToken, body);
    return created.id;
  }

  try {
    const updated = await deps.updateCalendarEvent(opts.calendarId, opts.existingEventId, opts.accessToken, body);
    return updated?.id ?? opts.existingEventId;
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    // R11: the stored event id no longer resolves on this calendar — most
    // often a crew reassignment moved which calendar this job's event
    // "should" live on, orphaning the old event on the PREVIOUS crew's
    // calendar (never deleted here — that cleanup is out of scope for this
    // task; a future pass could hunt orphans via
    // extendedProperties.private.jobNumber). Create fresh on the CURRENT
    // calendar and let the caller overwrite the stored id.
    const created = await deps.createCalendarEvent(opts.calendarId, opts.accessToken, body);
    return created.id;
  }
}

// ── job.scheduled ────────────────────────────────────────────────────────

async function processJobScheduled(deps: DispatcherDeps, row: OutboxRow): Promise<void> {
  const payload = row.payload as JobScheduledPayload;
  const job = await fetchJobRow(deps, payload.job_number);
  if (!job) {
    throw new Error(`job.scheduled: no jobs row found for job_number ${payload.job_number}`);
  }

  // Stale-event guard: a superseded event must never overwrite newer state.
  // Recorded as a succeeded no-op (not an error) — this is expected, not a
  // failure — but never in last_error (per brief: leave last_error null on
  // the outbox row; the reason lives only in this function's return, which
  // the caller folds into DispatchSummary.results[].detail).
  if (job.status_v2 === "cancelled") return;
  const currentRevision = job.calendar_sync_revision ?? 0;
  if (currentRevision > payload.calendar_sync_revision) return;

  const clientName = job.client_contact_name ?? job.client_name ?? job.business_name ?? null;
  const calendarInput: DispatcherCalendarInput = {
    jobNumber: job.job_number,
    clientName,
    jobAddress: job.job_address,
    estimateValue: job.estimate_value,
    crew: payload.crew,
    startDate: payload.start_date,
    endDate: payload.end_date,
    calendarSyncRevision: payload.calendar_sync_revision,
  };

  const accessToken = await deps.getAccessToken();

  // Main leg — persisted immediately on success, before the crew leg runs,
  // so a crew-leg failure can never orphan an already-created main event
  // (retry sees gcal_main_event_id already set and takes the update path).
  if (deps.calendarIds.main) {
    const mainEventId = await upsertCalendarEvent(deps, {
      audience: "main",
      calendarId: deps.calendarIds.main,
      existingEventId: job.gcal_main_event_id,
      input: calendarInput,
      accessToken,
    });
    if (mainEventId && mainEventId !== job.gcal_main_event_id) {
      await persistJobField(deps, job.id, "gcal_main_event_id", mainEventId);
      job.gcal_main_event_id = mainEventId;
    }
  }

  // Crew leg — same immediate-persist discipline.
  const crewEnvKey = resolveCrewEnvKey(payload.crew);
  if (crewEnvKey && deps.calendarIds[crewEnvKey]) {
    const crewEventId = await upsertCalendarEvent(deps, {
      audience: "crew",
      calendarId: deps.calendarIds[crewEnvKey],
      existingEventId: job.gcal_crew_event_id,
      input: calendarInput,
      accessToken,
    });
    if (crewEventId && crewEventId !== job.gcal_crew_event_id) {
      await persistJobField(deps, job.id, "gcal_crew_event_id", crewEventId);
      job.gcal_crew_event_id = crewEventId;
    }
  }

  // Slack leg — idempotent on slack_notified_at vs THIS event's created_at
  // (ruling R7): a later reschedule event has a later created_at, so it
  // re-notifies even though slack_notified_at is already non-null.
  const alreadyNotifiedForThisEvent =
    job.slack_notified_at != null && job.slack_notified_at > row.created_at;
  if (!alreadyNotifiedForThisEvent && crewEnvKey) {
    const channel = deps.slackChannels[crewEnvKey];
    if (channel) {
      const message = buildCrewJobBlock({
        headline: `🗓️ Job scheduled — ${job.job_number}`,
        contactName: job.client_contact_name ?? job.client_name,
        businessName: job.business_name,
        clientPhone: job.client_phone,
        startDate: payload.start_date,
        startTime: job.start_time,
        jobAddress: job.job_address,
        // scope_summary is a DB invariant (CLAUDE.md: "MUST NOT contain
        // pricing") set by whichever upstream writer resolved it — this
        // dispatcher trusts and forwards it verbatim, it does not
        // re-resolve or re-sanitize it.
        scopeSummary: job.scope_summary,
      });
      const result = await deps.postSlackMessage(channel, message);
      if (!result.ok) throw new Error(`Slack post failed: ${result.error ?? "unknown error"}`);
      const nowIso = deps.now().toISOString();
      await persistJobField(deps, job.id, "slack_notified_at", nowIso);
    }
  }
}

// ── ghl.stage.requested ──────────────────────────────────────────────────

/** Case-insensitive substring match, same predicate as ghl-job-webhook's
 *  findStageId and web/src/lib/ghl/pipeline.ts's resolveStage — a May 2026
 *  error log showed combined live stage names (e.g. "Deposit
 *  Received/Job Scheduled"), which is why substring, not exact equality. */
export function findStageId(stages: Array<{ id: string; name: string }>, substring: string): string | null {
  const needle = substring.toLowerCase();
  const match = stages.find((s) => (s?.name ?? "").toLowerCase().includes(needle));
  return match ? match.id : null;
}

/** "Job Pipeline" resolution — the location has a SECOND pipeline
 *  ("Contractor Pipeline") with its own "Job Scheduled" stage (live-verified,
 *  see web/src/lib/ghl/pipeline.ts), which is exactly why
 *  processGhlStageRequested asserts pipeline membership on the fetched
 *  opportunity rather than trusting a stage-name match alone. */
export function findJobPipeline(pipelines: GhlPipeline[]): GhlPipeline | null {
  const needle = "job pipeline";
  return pipelines.find((p) => (p?.name ?? "").toLowerCase().includes(needle)) ?? null;
}

async function processGhlStageRequested(
  deps: DispatcherDeps,
  row: OutboxRow,
  resolvePipeline: () => Promise<GhlPipeline>,
): Promise<void> {
  const payload = row.payload as GhlStageRequestedPayload;
  const pipeline = await resolvePipeline();

  const stageId = findStageId(pipeline.stages, payload.stage);
  if (!stageId) {
    throw new Error(
      `GHL stage "${payload.stage}" not found in "Job Pipeline". ` +
        `Available: ${pipeline.stages.map((s) => s.name).join(", ") || "none"}`,
    );
  }

  const opportunity = await deps.fetchOpportunity(payload.ghl_opportunity_id);
  const opp = opportunity?.opportunity ?? opportunity;

  // Live-proven hazard: a second pipeline has its own "Job Scheduled" stage
  // — a name match alone does not prove which pipeline the opportunity is
  // actually in. Refuse the PUT on mismatch rather than risk moving the
  // wrong opportunity's stage.
  if (opp?.pipelineId !== pipeline.id) {
    throw new Error(
      `Opportunity ${payload.ghl_opportunity_id} is not in "Job Pipeline" ` +
        `(pipelineId=${opp?.pipelineId ?? "unknown"}, expected ${pipeline.id}) — refusing to move stage`,
    );
  }

  // The underlying PUT sends ONLY { pipelineStageId } — GHL merges
  // customFields/other opportunity data on PUT (live-verified, CV-2), so a
  // narrow body here can never clobber a field another writer owns. That
  // narrowing lives in index.ts's real updateOpportunityStage, not here.
  await deps.updateOpportunityStage(payload.ghl_opportunity_id, stageId);

  await writeSyncLog(deps.supabase, {
    direction: "app_to_ghl",
    trigger_event: "ghl_stage_requested",
    action_taken: "updated",
    status: "success",
    payload_in: row.payload,
  });
}

// ── job.cancelled ─────────────────────────────────────────────────────────

async function processJobCancelled(deps: DispatcherDeps, row: OutboxRow): Promise<void> {
  const payload = row.payload as JobCancelledPayload;
  const job = await fetchJobRow(deps, payload.job_number);
  if (!job) {
    throw new Error(`job.cancelled: no jobs row found for job_number ${payload.job_number}`);
  }

  const accessToken = await deps.getAccessToken();
  const clearFields: Record<string, unknown> = {};

  // Event ids come from the PAYLOAD (the RPC's snapshot at cancel time), not
  // from the current jobs row — the row's ids may already have been cleared
  // by a prior partial run of this same event on retry.
  if (payload.gcal_main_event_id) {
    if (!deps.calendarIds.main) {
      throw new Error("job.cancelled: main calendar not configured, cannot delete gcal_main_event_id");
    }
    // deleteCalendarEvent's own 404/410-is-success contract (see
    // _shared/google.ts) means "already gone" resolves cleanly here with no
    // special-casing needed at this call site.
    await deps.deleteCalendarEvent(deps.calendarIds.main, payload.gcal_main_event_id, accessToken);
    clearFields.gcal_main_event_id = null;
  }

  if (payload.gcal_crew_event_id) {
    const crewEnvKey = resolveCrewEnvKey(payload.crew);
    const crewCalId = crewEnvKey ? deps.calendarIds[crewEnvKey] : null;
    if (!crewCalId) {
      throw new Error(
        `job.cancelled: crew calendar not configured for crew "${payload.crew}", cannot delete gcal_crew_event_id`,
      );
    }
    await deps.deleteCalendarEvent(crewCalId, payload.gcal_crew_event_id, accessToken);
    clearFields.gcal_crew_event_id = null;
  }

  // No Slack, no GHL here — the GHL stage move rides the separate
  // ghl.stage.requested event, emitted independently by the RPC that wrote
  // this outbox row.
  if (Object.keys(clearFields).length > 0) {
    await persistJobFields(deps, job.id, clearFields);
  }
}

// ── runDispatch — claim, process sequentially, never let one throw kill
//    the batch ──────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const DEAD_LETTER_THRESHOLD = 5;
const BACKOFF_CAP_MINUTES = 60;

function computeBackoffMinutes(attempts: number): number {
  return Math.min(BACKOFF_CAP_MINUTES, Math.pow(2, attempts));
}

async function markSucceeded(deps: DispatcherDeps, id: string): Promise<void> {
  const nowIso = deps.now().toISOString();
  const { error } = await deps.supabase
    .from("integration_outbox")
    .update({ status: "succeeded", completed_at: nowIso, last_error: null })
    .eq("id", id);
  if (error) {
    console.error("[integration-dispatcher] failed to mark outbox row succeeded:", error.message ?? String(error));
  }
}

async function markFailed(deps: DispatcherDeps, row: OutboxRow, message: string): Promise<"failed" | "dead_letter"> {
  const isDead = row.attempts >= DEAD_LETTER_THRESHOLD;
  if (isDead) {
    const { error } = await deps.supabase
      .from("integration_outbox")
      .update({ status: "dead_letter", last_error: message })
      .eq("id", row.id);
    if (error) {
      console.error("[integration-dispatcher] failed to mark outbox row dead_letter:", error.message ?? String(error));
    }
    await insertJobAlert(deps, row, message);
    return "dead_letter";
  }

  const backoffMinutes = computeBackoffMinutes(row.attempts);
  const availableAt = new Date(deps.now().getTime() + backoffMinutes * 60_000).toISOString();
  const { error } = await deps.supabase
    .from("integration_outbox")
    .update({ status: "failed", last_error: message, available_at: availableAt })
    .eq("id", row.id);
  if (error) {
    console.error("[integration-dispatcher] failed to mark outbox row failed:", error.message ?? String(error));
  }
  return "failed";
}

/** Design decision (documented per the brief): plain INSERT + swallow 23505,
 *  not `.upsert(..., {ignoreDuplicates:true})`. The dedup index
 *  (`job_alerts_one_open_fingerprint`) is a PARTIAL unique index
 *  (`where resolved_at is null`) — a bare `ON CONFLICT (job_number,
 *  fingerprint) DO NOTHING` without a matching WHERE predicate does not
 *  target a partial index in Postgres, and supabase-js's `.upsert()`
 *  `onConflict` option has no way to express that predicate. A plain
 *  insert lets Postgres's own conflict resolution do the right thing
 *  against the real index, and a 23505 here is expected/benign (an alert
 *  for this exact outbox row is already open) — swallowed same as every
 *  other non-fatal logging path in this codebase. */
async function insertJobAlert(deps: DispatcherDeps, row: OutboxRow, message: string): Promise<void> {
  const fingerprint = `integration:${row.id}`;
  const { error } = await deps.supabase.from("job_alerts").insert({
    job_number: row.aggregate_id,
    fingerprint,
    severity: "at_risk",
    title: `Integration event failed: ${row.event_type}`,
    message: `${row.event_type} failed after ${row.attempts} attempt(s): ${message}`,
    action_path: `/jobs/${row.aggregate_id}`,
  });
  if (error && error.code !== "23505") {
    console.error("[integration-dispatcher] failed to insert job_alerts row:", error.message ?? String(error));
  }
}

async function processEvent(
  deps: DispatcherDeps,
  row: OutboxRow,
  resolvePipeline: () => Promise<GhlPipeline>,
): Promise<void> {
  switch (row.event_type) {
    case "job.scheduled":
      return await processJobScheduled(deps, row);
    case "ghl.stage.requested":
      return await processGhlStageRequested(deps, row, resolvePipeline);
    case "job.cancelled":
      return await processJobCancelled(deps, row);
    default:
      // R6 (orchestrator ruling): no special-casing for an unknown
      // event_type — it takes the ordinary failure path and dead-letters at
      // DEAD_LETTER_THRESHOLD attempts like anything else.
      throw new Error(`Unknown event_type: "${row.event_type}"`);
  }
}

export async function runDispatch(deps: DispatcherDeps, opts?: { limit?: number }): Promise<DispatchSummary> {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const { data, error } = await deps.supabase.rpc("claim_integration_events", { p_limit: limit });
  if (error) {
    throw new Error(`claim_integration_events failed: ${error.message ?? String(error)}`);
  }
  const claimed: OutboxRow[] = Array.isArray(data) ? data : [];

  // Job Pipeline resolution memoized once per runDispatch call (not
  // module-level — each invocation gets a fresh resolution, no cross-test
  // leakage, no cross-invocation staleness). Multiple ghl.stage.requested
  // events in the same claimed batch share one fetchPipelines() call.
  let pipelinePromise: Promise<GhlPipeline> | null = null;
  const resolvePipeline = (): Promise<GhlPipeline> => {
    if (!pipelinePromise) {
      pipelinePromise = deps.fetchPipelines().then((pipelines) => {
        const found = findJobPipeline(pipelines);
        if (!found) {
          throw new Error(
            `"Job Pipeline" not found. Available: ${pipelines.map((p) => p.name).join(", ") || "none"}`,
          );
        }
        return found;
      });
    }
    return pipelinePromise;
  };

  const results: EventOutcome[] = [];
  let succeeded = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const row of claimed) {
    try {
      await processEvent(deps, row, resolvePipeline);
      await markSucceeded(deps, row.id);
      results.push({ id: row.id, event_type: row.event_type, outcome: "succeeded" });
      succeeded++;
    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.error(`[integration-dispatcher] event ${row.id} (${row.event_type}) failed:`, message);
      const outcome = await markFailed(deps, row, message);
      results.push({ id: row.id, event_type: row.event_type, outcome, detail: message });
      if (outcome === "dead_letter") deadLettered++;
      else failed++;
    }
  }

  return { claimed: claimed.length, succeeded, failed, dead_lettered: deadLettered, results };
}
