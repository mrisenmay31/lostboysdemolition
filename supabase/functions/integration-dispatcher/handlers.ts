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
  /** Set when the `integration_outbox` bookkeeping write itself failed (the
   *  status UPDATE for this event, or — for a dead-lettered event — the
   *  `job_alerts` insert too). `outcome` above still reflects the true
   *  processing result, but the ROW may NOT have been updated to record it:
   *  a row stuck in `processing` gets re-claimed and reprocessed on the next
   *  run (re-PUTting GHL, re-writing sync_log, etc.), and a dead-lettered
   *  event whose alert insert failed opens no alert. A monitoring reader
   *  must treat this as needing attention even when `outcome` reads
   *  "succeeded". (Review round 1, finding 3.) */
  bookkeepingError?: string;
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

/** Returns a skip-reason string on a succeeded no-op (stale revision /
 *  cancelled job), or `undefined` on a normal full run — threaded by the
 *  caller into `DispatchSummary.results[].detail` (never written to
 *  `integration_outbox.last_error`, which is reserved for actual failures).
 *  Review round 1, finding 1: this used to return `void`, silently
 *  discarding the very reason a code comment claimed it preserved. */
async function processJobScheduled(deps: DispatcherDeps, row: OutboxRow): Promise<string | undefined> {
  const payload = row.payload as JobScheduledPayload;
  const job = await fetchJobRow(deps, payload.job_number);
  if (!job) {
    throw new Error(`job.scheduled: no jobs row found for job_number ${payload.job_number}`);
  }

  // Stale-event guard: a superseded event must never overwrite newer state.
  // Recorded as a succeeded no-op (not an error) — this is expected, not a
  // failure — but never in last_error (the reason is returned instead, see
  // the doc comment above).
  if (job.status_v2 === "cancelled") return "job is cancelled — stale event, no-op";
  const currentRevision = job.calendar_sync_revision ?? 0;
  if (currentRevision > payload.calendar_sync_revision) {
    return `stale revision (job at ${currentRevision}, event carries ${payload.calendar_sync_revision})`;
  }

  // FIX POLICY (review round 1, finding 2 — orchestrator decision): every
  // leg the payload requires must actually be delivered, or the whole event
  // fails loudly (-> retry/dead-letter/alert), matching processJobCancelled's
  // existing policy below. `payload.crew` is a required field on this event
  // (never optional), so an unmappable crew string or an unset crew
  // calendar/Slack channel is a misconfiguration, not an ordinary "no crew
  // calendar for this job" case — and the main calendar is required
  // unconditionally. Validated eagerly, before any network call, so a
  // standing misconfiguration doesn't burn a Google Calendar write on every
  // backoff cycle while it stays broken.
  if (!deps.calendarIds.main) {
    throw new Error("job.scheduled: main calendar not configured (GOOGLE_CALENDAR_MAIN unset)");
  }
  const crewEnvKey = resolveCrewEnvKey(payload.crew);
  if (!crewEnvKey) {
    throw new Error(
      `job.scheduled: crew "${payload.crew}" is not one of Crew 1-4 — cannot resolve a crew calendar/Slack channel`,
    );
  }
  const crewCalendarId = deps.calendarIds[crewEnvKey];
  if (!crewCalendarId) {
    throw new Error(`job.scheduled: no calendar configured for ${crewEnvKey} (crew "${payload.crew}")`);
  }
  const crewSlackChannel = deps.slackChannels[crewEnvKey];
  if (!crewSlackChannel) {
    throw new Error(`job.scheduled: no Slack channel configured for ${crewEnvKey} (crew "${payload.crew}")`);
  }

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

  // Crew leg — same immediate-persist discipline.
  const crewEventId = await upsertCalendarEvent(deps, {
    audience: "crew",
    calendarId: crewCalendarId,
    existingEventId: job.gcal_crew_event_id,
    input: calendarInput,
    accessToken,
  });
  if (crewEventId && crewEventId !== job.gcal_crew_event_id) {
    await persistJobField(deps, job.id, "gcal_crew_event_id", crewEventId);
    job.gcal_crew_event_id = crewEventId;
  }

  // Slack leg — idempotent on slack_notified_at vs THIS event's created_at
  // (ruling R7): a later reschedule event has a later created_at, so it
  // re-notifies even though slack_notified_at is already non-null.
  const alreadyNotifiedForThisEvent =
    job.slack_notified_at != null && job.slack_notified_at > row.created_at;
  if (!alreadyNotifiedForThisEvent) {
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
      // dispatcher trusts and forwards it verbatim, it does not re-resolve
      // or re-sanitize it.
      scopeSummary: job.scope_summary,
    });
    const result = await deps.postSlackMessage(crewSlackChannel, message);
    if (!result.ok) throw new Error(`Slack post failed: ${result.error ?? "unknown error"}`);
    const nowIso = deps.now().toISOString();
    await persistJobField(deps, job.id, "slack_notified_at", nowIso);
  }

  return undefined;
}

// ── ghl.stage.requested ──────────────────────────────────────────────────

/** Strips a trailing parenthetical (and surrounding whitespace) before
 *  lowercasing — mirrors web/src/lib/ghl/pipeline.ts's `needleFor` exactly,
 *  duplicated rather than imported per house style (no cross-module imports
 *  between the Deno edge functions and the Next.js web app). Review round 1,
 *  finding 4: without this, a live rename that reshapes the parenthetical
 *  qualifier — e.g. "Closed Lost (Declined)" -> "Closed Lost / Declined",
 *  the wording CLAUDE.md's own pipeline table uses — stops matching the
 *  literal payload value `'Closed Lost (Declined)'` even though both names
 *  plainly mean the same stage. "Job Scheduled" / "Quote Accepted" have no
 *  parenthetical, so stripping is a no-op for them. */
function needleFor(stageName: string): string {
  return stageName.split("(")[0].trim().toLowerCase();
}

/** Case-insensitive substring match on the CLEANED needle (see needleFor) —
 *  same predicate as ghl-job-webhook's findStageId, now additionally
 *  parenthetical-stripped like web/src/lib/ghl/pipeline.ts's resolveStage. A
 *  May 2026 error log showed combined live stage names (e.g. "Deposit
 *  Received/Job Scheduled"), which is why substring, not exact equality.
 *  Exported for direct testing; the real call site is resolveStageId below,
 *  which adds the ambiguity + empty-id guards this function deliberately
 *  does not (mirrors pipeline.ts's split between a plain finder and its
 *  validating resolveStage). */
export function findStageId(stages: Array<{ id: string; name: string }>, substring: string): string | null {
  const needle = needleFor(substring);
  const match = stages.find((s) => (s?.name ?? "").toLowerCase().includes(needle));
  return match ? match.id : null;
}

/** Resolves AND validates in one step — throws (never returns null) on
 *  every failure mode: not found, ambiguous (>1 stage matches the cleaned
 *  needle), or a matched stage carrying no usable id. Mirrors
 *  web/src/lib/ghl/pipeline.ts's resolveStage's three guards exactly; these
 *  ids drive a real PUT that moves a live opportunity through the pipeline,
 *  so a silent first-match pick on an ambiguous config is not safe here. */
function resolveStageId(stages: Array<{ id: string; name: string }>, rawStage: string): string {
  const needle = needleFor(rawStage);
  const matches = stages.filter((s) => (s?.name ?? "").toLowerCase().includes(needle));

  if (matches.length === 0) {
    throw new Error(
      `GHL stage "${rawStage}" not found in "Job Pipeline". Available: ${stages.map((s) => s.name).join(", ") || "none"}`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `GHL stage "${rawStage}" is AMBIGUOUS in "Job Pipeline" — ${matches.length} stages matched: ` +
        `${matches.map((s) => s.name).join(", ")}.`,
    );
  }
  const id = matches[0].id;
  if (!id) {
    throw new Error(`GHL stage "${matches[0].name}" matched "${rawStage}" but has no id.`);
  }
  return id;
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

  const stageId = resolveStageId(pipeline.stages, payload.stage);

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

/** Returns the write error message, or null on a clean write. Review round
 *  1, finding 3: this used to only console.error and swallow the outcome,
 *  so a row stuck in 'processing' (bookkeeping write failed) was reported
 *  identically to a real success — it then gets re-claimed and reprocessed
 *  on the next run (re-PUTting GHL, re-writing sync_log, etc.) with no
 *  visible signal anywhere in the summary. */
async function markSucceeded(deps: DispatcherDeps, id: string): Promise<string | null> {
  const nowIso = deps.now().toISOString();
  const { error } = await deps.supabase
    .from("integration_outbox")
    .update({ status: "succeeded", completed_at: nowIso, last_error: null })
    .eq("id", id);
  if (error) {
    const msg = error.message ?? String(error);
    console.error("[integration-dispatcher] failed to mark outbox row succeeded:", msg);
    return msg;
  }
  return null;
}

/** Same bookkeeping-visibility fix as markSucceeded, folded across BOTH
 *  writes a dead-letter can make (the outbox status UPDATE and the
 *  job_alerts INSERT) — either one failing silently used to leave a
 *  dead-lettered event with no visible trace anywhere except a console
 *  log line. */
async function markFailed(
  deps: DispatcherDeps,
  row: OutboxRow,
  message: string,
): Promise<{ outcome: "failed" | "dead_letter"; bookkeepingError: string | null }> {
  const isDead = row.attempts >= DEAD_LETTER_THRESHOLD;
  if (isDead) {
    const { error } = await deps.supabase
      .from("integration_outbox")
      .update({ status: "dead_letter", last_error: message })
      .eq("id", row.id);
    const outboxErrorMsg = error ? (error.message ?? String(error)) : null;
    if (outboxErrorMsg) {
      console.error("[integration-dispatcher] failed to mark outbox row dead_letter:", outboxErrorMsg);
    }
    const alertErrorMsg = await insertJobAlert(deps, row, message);
    const combined = [outboxErrorMsg, alertErrorMsg].filter((m): m is string => m !== null).join("; ");
    return { outcome: "dead_letter", bookkeepingError: combined.length > 0 ? combined : null };
  }

  const backoffMinutes = computeBackoffMinutes(row.attempts);
  const availableAt = new Date(deps.now().getTime() + backoffMinutes * 60_000).toISOString();
  const { error } = await deps.supabase
    .from("integration_outbox")
    .update({ status: "failed", last_error: message, available_at: availableAt })
    .eq("id", row.id);
  if (error) {
    const msg = error.message ?? String(error);
    console.error("[integration-dispatcher] failed to mark outbox row failed:", msg);
    return { outcome: "failed", bookkeepingError: msg };
  }
  return { outcome: "failed", bookkeepingError: null };
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
 *  other non-fatal logging path in this codebase. Returns the write error
 *  message (null for a clean insert OR a benign 23505 dedup hit) — folded
 *  by markFailed into EventOutcome.bookkeepingError (review round 1,
 *  finding 3) so a REAL insert failure (FK violation, RLS, etc.) is no
 *  longer invisible outside a console log line. */
async function insertJobAlert(deps: DispatcherDeps, row: OutboxRow, message: string): Promise<string | null> {
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
    const msg = error.message ?? String(error);
    console.error("[integration-dispatcher] failed to insert job_alerts row:", msg);
    return msg;
  }
  return null;
}

/** Returns the succeeded-no-op skip reason (job.scheduled's stale/cancelled
 *  guard) or undefined for every other outcome — see processJobScheduled's
 *  doc comment (review round 1, finding 1). */
async function processEvent(
  deps: DispatcherDeps,
  row: OutboxRow,
  resolvePipeline: () => Promise<GhlPipeline>,
): Promise<string | undefined> {
  switch (row.event_type) {
    case "job.scheduled":
      return await processJobScheduled(deps, row);
    case "ghl.stage.requested":
      await processGhlStageRequested(deps, row, resolvePipeline);
      return undefined;
    case "job.cancelled":
      await processJobCancelled(deps, row);
      return undefined;
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
      const detail = await processEvent(deps, row, resolvePipeline);
      const bookkeepingError = await markSucceeded(deps, row.id);
      results.push({
        id: row.id,
        event_type: row.event_type,
        outcome: "succeeded",
        ...(detail ? { detail } : {}),
        ...(bookkeepingError ? { bookkeepingError } : {}),
      });
      succeeded++;
    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.error(`[integration-dispatcher] event ${row.id} (${row.event_type}) failed:`, message);
      const { outcome, bookkeepingError } = await markFailed(deps, row, message);
      results.push({
        id: row.id,
        event_type: row.event_type,
        outcome,
        detail: message,
        ...(bookkeepingError ? { bookkeepingError } : {}),
      });
      if (outcome === "dead_letter") deadLettered++;
      else failed++;
    }
  }

  return { claimed: claimed.length, succeeded, failed, dead_lettered: deadLettered, results };
}
