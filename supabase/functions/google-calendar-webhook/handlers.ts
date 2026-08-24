// ============================================================
// Lost Boys Demolition — Google Calendar inbound webhook
// v2 Task 5B Step 2 — REAL implementation, replacing the Step-1 spike
// scaffold (spike PASSED 2026-08-20; see BUILD_LOG.md).
//
// Pure logic + DI, per house style (integration-dispatcher is the model):
// zero Deno.env, zero direct fetch — every external effect goes through
// InboundDeps. index.ts owns Deno.serve + real network/env wiring.
//
// Two responsibilities:
//   1. processNotification — Google's push notification handler. Verifies
//      the channel (registry lookup + token hash), then triggers a scoped
//      reconciliation of just that channel's calendar. NEVER throws (see
//      the top-level try/catch below) — index.ts's own catch is defense in
//      depth, not the only guard, because a non-2xx makes Google retry then
//      kill the channel.
//   2. runMaintenance — the pg_cron entry point: renews watch channels
//      nearing expiry, then reconciles ALL five calendars as a fallback
//      poll (so a missed/failed notification and a renewal failure both
//      still converge), then prunes old dedup marks.
//
// Consumes Task 1's (Lane S) calendar_watch_channels / calendar_inbound_marks
// tables and apply_calendar_date_change / open_calendar_deletion_exception
// RPCs — this file only knows their names/shapes, per the brief. Wired
// against the Interfaces block in task-1-brief.md, not the migration files.
// ============================================================

import { resolveCrewEnvKey } from "../_shared/slack.ts";
import { writeSyncLog } from "../_shared/log.ts";

// ── Notification transport (kept from the Step-1 spike, shapes unchanged —
//    still load-bearing: isGoogleNotification routes index.ts, buildWatchBody/
//    registerWatchChannel/stopWatchChannel are the real events.watch/
//    channels.stop glue used both by maintainChannels (via InboundDeps'
//    registerWatch/stopWatch, wired in index.ts) and by index.ts's manual
//    register/stop admin actions). ─────────────────────────────────────────

export interface WatchDeps {
  getAccessToken: () => Promise<string>;
  fetchImpl: typeof fetch;
}

/** Every X-Goog-* header Google attaches to a push notification, per
 *  https://developers.google.com/workspace/calendar/api/guides/push.
 *  `channelExpiration` and `channelToken` are documented as only
 *  sometimes present. */
export interface GoogNotification {
  channelId: string | null;
  channelToken: string | null;
  channelExpiration: string | null;
  messageNumber: string | null;
  resourceId: string | null;
  resourceState: string | null;
  resourceUri: string | null;
}

/** A request is Google's push notification if — and only if — it carries
 *  X-Goog-Channel-ID. Google sends no `x-webhook-secret` (it knows nothing
 *  about ours), so the admin routes and the notification route cannot
 *  share an auth check; the notification route's real auth is the channel
 *  token, verified against the persisted token_hash in processNotification
 *  below. */
export function isGoogleNotification(headers: Headers): boolean {
  return headers.get("x-goog-channel-id") !== null;
}

export function extractNotification(headers: Headers): GoogNotification {
  return {
    channelId: headers.get("x-goog-channel-id"),
    channelToken: headers.get("x-goog-channel-token"),
    channelExpiration: headers.get("x-goog-channel-expiration"),
    messageNumber: headers.get("x-goog-message-number"),
    resourceId: headers.get("x-goog-resource-id"),
    resourceState: headers.get("x-goog-resource-state"),
    resourceUri: headers.get("x-goog-resource-uri"),
  };
}

/** events.watch request body. `id` is capped at 64 chars and `token` at
 *  256 by the API; `expiration` is Unix ms, and Google may shorten it to
 *  its own internal ceiling (Calendar channels top out around 30 days,
 *  which is why renewal-before-expiry exists at all — see maintainChannels). */
export function buildWatchBody(input: {
  channelId: string;
  address: string;
  token: string;
  ttlSeconds: number;
  now: number;
}): Record<string, unknown> {
  if (input.channelId.length > 64) {
    throw new Error(`channel id exceeds Google's 64-character limit (${input.channelId.length})`);
  }
  if (input.token.length > 256) {
    throw new Error(`channel token exceeds Google's 256-character limit (${input.token.length})`);
  }
  if (!input.address.startsWith("https://")) {
    throw new Error(`watch address must be HTTPS, got: ${input.address}`);
  }
  return {
    id: input.channelId,
    type: "web_hook",
    address: input.address,
    token: input.token,
    expiration: String(input.now + input.ttlSeconds * 1000),
  };
}

export interface WatchAttempt {
  ok: boolean;
  httpStatus: number;
  /** Google's raw response, verbatim — read for resourceId/expiration on
   *  success, or for the diagnostic message (e.g. "Unauthorized WebHook
   *  callback channel") on failure. */
  body: unknown;
  requestBody: Record<string, unknown>;
}

export async function registerWatchChannel(
  deps: WatchDeps,
  input: { calendarId: string; channelId: string; address: string; token: string; ttlSeconds: number; now: number },
): Promise<WatchAttempt> {
  const requestBody = buildWatchBody(input);
  const accessToken = await deps.getAccessToken();
  const res = await deps.fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/watch`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    },
  );
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, httpStatus: res.status, body, requestBody };
}

/** channels.stop — 204 No Content is the success shape. */
export async function stopWatchChannel(
  deps: WatchDeps,
  input: { channelId: string; resourceId: string },
): Promise<{ ok: boolean; httpStatus: number; body: unknown }> {
  const accessToken = await deps.getAccessToken();
  const res = await deps.fetchImpl("https://www.googleapis.com/calendar/v3/channels/stop", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: input.channelId, resourceId: input.resourceId }),
  });
  const body = res.status === 204 ? null : await res.json().catch(() => ({}));
  return { ok: res.ok, httpStatus: res.status, body };
}

// ── SHA-256 hex — used both for token_hash verification (processNotification)
//    and for hashing a freshly generated token before it's persisted
//    (maintainChannels, and index.ts's manual register action). ───────────

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Deps ─────────────────────────────────────────────────────────────────

export interface InboundDeps {
  supabase: any;
  now: () => Date;
  getAccessToken: () => Promise<string>;
  getCalendarEvent: (calendarId: string, eventId: string, accessToken: string) => Promise<{ status: number; event: any | null }>;
  registerWatch: (calendarId: string, channelId: string, address: string, token: string, ttlSeconds: number) => Promise<{ ok: boolean; httpStatus: number; body: any }>;
  stopWatch: (channelId: string, resourceId: string) => Promise<{ ok: boolean }>;
  calendarIds: Record<"main" | "crew1" | "crew2" | "crew3" | "crew4", string>;
  webhookAddress: string;
}

export type CalendarKey = "main" | "crew1" | "crew2" | "crew3" | "crew4";

const CALENDAR_KEYS: CalendarKey[] = ["main", "crew1", "crew2", "crew3", "crew4"];
const MANAGED_BY = "lostboys-estimator";
const CHANNEL_TTL_SECONDS = 7 * 24 * 60 * 60; // 604800 — Google may shorten this
const RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000; // renew when < 24h from expiry
const MARK_RETENTION_DAYS = 30;

/** Reverse lookup: which configured calendar KEY does this raw Google
 *  calendarId belong to? null when it isn't one of ours (defensive — should
 *  not happen for a channel we registered ourselves). */
function calendarKeyFor(deps: InboundDeps, calendarId: string): CalendarKey | null {
  for (const key of CALENDAR_KEYS) {
    if (deps.calendarIds[key] === calendarId) return key;
  }
  return null;
}

/** Google all-day events carry start.date inclusive and end.date EXCLUSIVE
 *  (see _shared/google.ts's addOneDay, which does the forward conversion on
 *  the outbound leg) — this is the inverse, used to read a fetched event's
 *  canonical inclusive end date. Duplicated locally rather than added to
 *  _shared/google.ts per this lane's file-ownership boundary (additive-only
 *  there, one function). */
function subtractOneDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// ── classifyManagedEvent — pure comparator (exported for tests) ─────────

export type ManagedEventOutcome =
  | "unmanaged"
  | "deleted"
  | "dates_unchanged"
  | "stale_revision"
  | "revision_anomaly"
  | "apply";

/** Pure comparator — plan decision 8. Google all-day events carry
 *  start.date inclusive and end.date EXCLUSIVE, so the canonical inclusive
 *  end date is end.date minus one day (inverse of _shared/google.ts's
 *  addOneDay).
 *
 *  Order: deleted -> unmanaged -> [non-all-day skip] -> dates_unchanged ->
 *  stale_revision -> revision_anomaly -> apply.
 *
 *  Deletion is checked BEFORE the managedBy check (review round 1, ruled
 *  change on finding 8): every event this module ever classifies is ours by
 *  construction — reconcileCalendar only fetches events by a gcal_*_event_id
 *  stored on our own job rows — and Google may strip extendedProperties from
 *  a cancelled resource. Checking deletion first is strictly safer with no
 *  false-positive risk.
 *
 *  Non-all-day events (missing EITHER `start.date` or `end.date`) are a
 *  "revision_anomaly"-class skip with their own log line — a human converted
 *  an all-day event to timed, dates can't be read reliably, and this is
 *  surfaced, never guessed. Requiring both (not just start.date, review
 *  round 1 promoted-minor 7) means an `apply` outcome always carries a real
 *  `end.date` — reconcileCalendar's apply branch reads it unguarded and
 *  relies on that guarantee.
 *
 *  A missing/non-numeric `scheduleRevision` fails CLOSED to
 *  "revision_anomaly" (review round 1, finding 2) rather than falling
 *  through `NaN`'s vacuously-false `<`/`>` comparisons into "apply" —
 *  `Number(undefined)` is `NaN`, and `NaN < x` / `NaN > x` are both `false`,
 *  so without this guard a garbage/missing revision would silently reach
 *  "apply" and hand the RPC `p_expected_revision: null`. */
export function classifyManagedEvent(
  event: any,
  job: { start_date: string; end_date: string; calendar_sync_revision: number },
): ManagedEventOutcome {
  if (event?.status === "cancelled") return "deleted";

  const managedBy = event?.extendedProperties?.private?.managedBy;
  if (managedBy !== MANAGED_BY) return "unmanaged";

  if (!event.start?.date || !event.end?.date) {
    console.error(
      `[google-calendar-webhook] managed event ${event?.id ?? "?"} is no longer all-day (missing start.date or ` +
        "end.date) — dates not comparable, skipping rather than guessing",
    );
    return "revision_anomaly";
  }

  const eventStart = event.start.date as string;
  const eventEnd = subtractOneDay(event.end.date as string);

  if (eventStart === job.start_date && eventEnd === job.end_date) return "dates_unchanged";

  const eventRevision = Number(event.extendedProperties?.private?.scheduleRevision);
  if (!Number.isFinite(eventRevision)) {
    console.error(
      `[google-calendar-webhook] managed event ${event?.id ?? "?"} carries a missing/non-numeric ` +
        `scheduleRevision (${JSON.stringify(event.extendedProperties?.private?.scheduleRevision)}) — ` +
        "failing closed rather than risking a stale/garbage write",
    );
    return "revision_anomaly";
  }
  if (eventRevision < job.calendar_sync_revision) return "stale_revision";
  if (eventRevision > job.calendar_sync_revision) {
    console.error(
      `[google-calendar-webhook] managed event ${event?.id ?? "?"} carries revision ${eventRevision} ahead of ` +
        `job's ${job.calendar_sync_revision} — impossible via current writers, skipping`,
    );
    return "revision_anomaly";
  }

  return "apply";
}

// ── jobs row shape this leg reads (RPCs own every write) ────────────────

interface InboundJobRow {
  job_number: string;
  status_v2: string;
  start_date: string;
  end_date: string;
  calendar_sync_revision: number;
  gcal_main_event_id: string | null;
  gcal_crew_event_id: string | null;
  crew: string | null;
}

const JOB_ROW_COLUMNS =
  "job_number, status_v2, start_date, end_date, calendar_sync_revision, gcal_main_event_id, gcal_crew_event_id, crew";

/** Scheduled jobs owning a managed event on this calendar. Main: every
 *  scheduled job with a gcal_main_event_id. Crew: scheduled jobs whose
 *  resolveCrewEnvKey(crew) maps to this calendar AND have a
 *  gcal_crew_event_id — filtered in JS, per the brief, rather than pushed
 *  into the query. */
async function fetchCandidateJobs(
  deps: InboundDeps,
  calendarKey: CalendarKey,
): Promise<Array<{ job: InboundJobRow; eventId: string }>> {
  const { data, error } = await deps.supabase.from("jobs").select(JOB_ROW_COLUMNS).eq("status_v2", "scheduled");
  if (error) throw new Error(`jobs lookup failed: ${error.message ?? String(error)}`);
  const rows: InboundJobRow[] = Array.isArray(data) ? data : [];

  if (calendarKey === "main") {
    return rows.filter((r) => r.gcal_main_event_id).map((r) => ({ job: r, eventId: r.gcal_main_event_id as string }));
  }
  return rows
    .filter((r) => r.gcal_crew_event_id && resolveCrewEnvKey(r.crew) === calendarKey)
    .map((r) => ({ job: r, eventId: r.gcal_crew_event_id as string }));
}

async function callRpc(deps: InboundDeps, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await deps.supabase.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message ?? String(error)}`);
  return data;
}

/** Dedup pre-check: a plain SELECT for the exact (calendar, event, updated)
 *  generation — NOT a claim-by-insert. (Final whole-slice review: a
 *  pre-RPC insert-as-claim leaves a crash-strand window — if the isolate
 *  dies between the insert and the RPC call, nothing survives to run a
 *  compensating delete, and the tuple stays claimed with no RPC ever having
 *  run, forever. A SELECT has no such window.) Matches Lane S's documented
 *  migration contract verbatim: "insert AFTER a successful outcome only." */
async function markExists(
  deps: InboundDeps,
  calendarId: string,
  eventId: string,
  eventUpdated: string,
): Promise<boolean> {
  const { data, error } = await deps.supabase
    .from("calendar_inbound_marks")
    .select("id")
    .eq("calendar_id", calendarId)
    .eq("event_id", eventId)
    .eq("event_updated", eventUpdated)
    .maybeSingle();
  if (error) throw new Error(`calendar_inbound_marks lookup failed: ${error.message ?? String(error)}`);
  return data != null;
}

/** Records the outcome AFTER whatever action it required (an RPC call, or
 *  nothing at all for a no-op outcome) has already completed without
 *  throwing. A throw before this point (network blip, RPC raise, isolate
 *  kill) simply leaves no mark behind — the next pass's markExists sees
 *  nothing and retries naturally; there is no compensation to run because
 *  there is nothing to compensate.
 *
 *  A 23505 here means an overlapping channel's notification (or the
 *  reconciliation fallback poll) raced past this iteration's markExists
 *  SELECT and reached this same insert independently. For an
 *  RPC-calling outcome that means the RPC was invoked twice for the same
 *  generation — provably benign, since the RPC's own guards make the
 *  second call a no-op (apply_calendar_date_change's second call sees the
 *  dates already applied -> 'dates_unchanged'; open_calendar_deletion_
 *  exception's second call sees the exception already open ->
 *  'exception_already_open'). Any OTHER insert error is logged, not
 *  re-thrown: this table is bookkeeping, not the source of correctness
 *  (the RPC guards are), so a bookkeeping-write failure must not make an
 *  otherwise-successful RPC call look like a failed reconciliation. */
async function insertMarkOutcome(
  deps: InboundDeps,
  calendarId: string,
  eventId: string,
  eventUpdated: string,
  outcome: string,
): Promise<void> {
  const { error } = await deps.supabase.from("calendar_inbound_marks").insert({
    calendar_id: calendarId,
    event_id: eventId,
    event_updated: eventUpdated,
    outcome,
  });
  if (error && error.code !== "23505") {
    console.error(
      `[google-calendar-webhook] failed to record dedup mark for event ${eventId} on calendar ${calendarId}:`,
      error.message ?? String(error),
    );
  }
}

export interface ReconcileSummary {
  applied: number;
  deleted: number;
  skipped: number;
  errored: number;
}

/** Reconciles ONE calendar: fetches every candidate job's stored event,
 *  classifies it, and applies the corresponding RPC. Used both by
 *  processNotification (scoped to the notifying channel's calendar) and by
 *  runMaintenance (the fallback poll, over all five). A per-event throw is
 *  caught, logged to sync_log, and does not abort sibling events. */
export async function reconcileCalendar(deps: InboundDeps, calendarId: string): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { applied: 0, deleted: 0, skipped: 0, errored: 0 };
  const calendarKey = calendarKeyFor(deps, calendarId);
  if (!calendarKey) return summary;

  const candidates = await fetchCandidateJobs(deps, calendarKey);
  if (candidates.length === 0) return summary;

  const accessToken = await deps.getAccessToken();
  const source: "main" | "crew" = calendarKey === "main" ? "main" : "crew";

  for (const { job, eventId } of candidates) {
    try {
      const fetched = await deps.getCalendarEvent(calendarId, eventId, accessToken);

      // Gone entirely — no event body to classify. M7: open_calendar_
      // deletion_exception's own status_v2 guard is what makes this inert
      // for a job the dispatcher's own cancel-cleanup already deleted;
      // this leg always calls the RPC and trusts its {opened:false,...}
      // benign-skip return.
      if (fetched.status === 404 || fetched.status === 410) {
        const eventUpdated = deps.now().toISOString();
        if (await markExists(deps, calendarId, eventId, eventUpdated)) {
          summary.skipped++;
          continue;
        }
        await callRpc(deps, "open_calendar_deletion_exception", {
          p_job_number: job.job_number,
          p_external_event_id: eventId,
          p_incoming_event: { status: fetched.status },
        });
        summary.deleted++;
        await insertMarkOutcome(deps, calendarId, eventId, eventUpdated, "deleted");
        continue;
      }

      const event = fetched.event;
      const outcome = classifyManagedEvent(event, job);
      const eventUpdated = event?.updated ?? deps.now().toISOString();

      if (await markExists(deps, calendarId, eventId, eventUpdated)) {
        summary.skipped++;
        continue;
      }

      if (outcome === "apply") {
        // classifyManagedEvent guarantees both start.date and end.date are
        // present whenever it returns "apply" (review round 1, promoted
        // minor 7) — these reads cannot throw.
        const startDate = event.start.date as string;
        const endDate = subtractOneDay(event.end.date as string);
        const expectedRevision = Number(event.extendedProperties.private.scheduleRevision);
        await callRpc(deps, "apply_calendar_date_change", {
          p_job_number: job.job_number,
          p_start_date: startDate,
          p_end_date: endDate,
          p_expected_revision: expectedRevision,
          p_event_id: eventId,
          p_event_updated: eventUpdated,
          p_source: source,
        });
        summary.applied++;
      } else if (outcome === "deleted") {
        // A human deleted the event on Google (status:'cancelled') rather
        // than it 404ing — same M7 guard applies inside the RPC.
        await callRpc(deps, "open_calendar_deletion_exception", {
          p_job_number: job.job_number,
          p_external_event_id: eventId,
          p_incoming_event: event,
        });
        summary.deleted++;
      } else {
        // unmanaged / dates_unchanged / stale_revision / revision_anomaly —
        // no RPC call; the mark below still records the outcome so a
        // repeated notification for the same generation short-circuits at
        // the markExists check above instead of re-fetching and
        // re-classifying every time.
        summary.skipped++;
      }

      // Recorded only now that the outcome's action (if any) has completed
      // without throwing — see insertMarkOutcome's doc comment. A throw
      // ANYWHERE above this line (including inside the RPC call) means no
      // mark is written at all, so the next pass retries from scratch.
      await insertMarkOutcome(deps, calendarId, eventId, eventUpdated, outcome);
    } catch (err) {
      summary.errored++;
      await writeSyncLog(deps.supabase, {
        direction: "google_to_supabase",
        trigger_event: "calendar_reconcile",
        action_taken: "error",
        status: "error",
        error_message: (err as any)?.message ?? String(err),
        payload_in: { calendarId, jobNumber: job.job_number, eventId },
      });
    }
  }

  return summary;
}

// ── Channel registry lookups ─────────────────────────────────────────────

interface ChannelRow {
  id: string;
  channel_id: string;
  resource_id: string;
  calendar_id: string;
  token_hash: string;
  status: string;
  expires_at: string;
}

async function lookupChannelById(deps: InboundDeps, channelId: string): Promise<ChannelRow | null> {
  const { data, error } = await deps.supabase
    .from("calendar_watch_channels")
    .select("id, channel_id, resource_id, calendar_id, token_hash, status, expires_at")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (error) throw new Error(`calendar_watch_channels lookup failed: ${error.message ?? String(error)}`);
  return data ?? null;
}

async function fetchActiveChannel(deps: InboundDeps, calendarId: string): Promise<ChannelRow | null> {
  const { data, error } = await deps.supabase
    .from("calendar_watch_channels")
    .select("id, channel_id, resource_id, calendar_id, token_hash, status, expires_at")
    .eq("calendar_id", calendarId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`calendar_watch_channels active lookup failed: ${error.message ?? String(error)}`);
  return data ?? null;
}

async function updateChannel(deps: InboundDeps, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await deps.supabase.from("calendar_watch_channels").update(patch).eq("id", id);
  if (error) throw new Error(`calendar_watch_channels update failed: ${error.message ?? String(error)}`);
}

async function insertChannel(deps: InboundDeps, row: Record<string, unknown>): Promise<void> {
  const { error } = await deps.supabase.from("calendar_watch_channels").insert(row);
  if (error) throw new Error(`calendar_watch_channels insert failed: ${error.message ?? String(error)}`);
}

// ── processNotification ──────────────────────────────────────────────────

/** Google's push notification handler. NEVER throws — every failure mode
 *  (unknown channel, bad token, non-active/superseded status, an internal
 *  bug anywhere downstream) is caught, logged to sync_log + console, and
 *  swallowed, so index.ts's `return json(200, ...)` always follows. This is
 *  belt-and-suspenders with index.ts's own try/catch around the call —
 *  Google kills a channel that doesn't get 200s, so nothing here may ever
 *  escape as a rejected promise. */
export async function processNotification(deps: InboundDeps, headers: Headers): Promise<void> {
  try {
    const n = extractNotification(headers);
    if (!n.channelId) return;

    const channel = await lookupChannelById(deps, n.channelId);
    if (!channel) {
      await writeSyncLog(deps.supabase, {
        direction: "google_to_supabase",
        trigger_event: "calendar_notification",
        action_taken: "skipped",
        status: "success",
        payload_in: { channelId: n.channelId, resourceState: n.resourceState, reason: "unknown_channel" },
      });
      return;
    }

    if (channel.status !== "active" && channel.status !== "superseded") {
      await writeSyncLog(deps.supabase, {
        direction: "google_to_supabase",
        trigger_event: "calendar_notification",
        action_taken: "skipped",
        status: "success",
        payload_in: { channelId: n.channelId, channelStatus: channel.status, reason: "channel_not_accepted" },
      });
      return;
    }

    const incomingHash = await sha256Hex(n.channelToken ?? "");
    if (incomingHash !== channel.token_hash) {
      await writeSyncLog(deps.supabase, {
        direction: "google_to_supabase",
        trigger_event: "calendar_notification",
        action_taken: "skipped",
        status: "success",
        payload_in: { channelId: n.channelId, reason: "token_mismatch" },
      });
      return;
    }

    await updateChannel(deps, channel.id, { last_notification_at: deps.now().toISOString() });

    // 'sync' is the handshake Google sends immediately on watch creation —
    // no resource has changed yet, nothing to reconcile.
    if (n.resourceState === "sync") return;

    await reconcileCalendar(deps, channel.calendar_id);
  } catch (err) {
    const message = (err as any)?.message ?? String(err);
    console.error("[google-calendar-webhook] processNotification failed:", message);
    await writeSyncLog(deps.supabase, {
      direction: "google_to_supabase",
      trigger_event: "calendar_notification",
      action_taken: "error",
      status: "error",
      error_message: message,
      payload_in: { channelId: headers.get("x-goog-channel-id") },
    });
  }
}

// ── Channel lifecycle: renewal ───────────────────────────────────────────

function generateChannelId(key: CalendarKey): string {
  const id = `lbd-${key}-${crypto.randomUUID()}`;
  return id.length <= 64 ? id : id.slice(0, 64);
}

async function alertScheduledJobsForCalendar(deps: InboundDeps, calendarId: string, message: string): Promise<void> {
  const calendarKey = calendarKeyFor(deps, calendarId);
  if (!calendarKey) return;
  const candidates = await fetchCandidateJobs(deps, calendarKey);
  const fingerprint = `calendar_watch:${calendarId}`;
  for (const { job } of candidates) {
    // Plain insert + swallow 23505, same design as integration-dispatcher's
    // insertJobAlert — job_alerts_one_open_fingerprint is a PARTIAL unique
    // index (where resolved_at is null), which supabase-js's .upsert()
    // onConflict option cannot express.
    const { error } = await deps.supabase.from("job_alerts").insert({
      job_number: job.job_number,
      fingerprint,
      severity: "watch",
      title: "Calendar watch channel renewal failed",
      message,
      action_path: `/jobs/${job.job_number}`,
    });
    if (error && error.code !== "23505") {
      console.error(`[google-calendar-webhook] job_alerts insert failed for ${job.job_number}:`, error.message ?? String(error));
    }
  }
}

export interface MaintainSummary {
  renewed: CalendarKey[];
  failed: CalendarKey[];
}

/** For each configured calendar with no active channel, or one expiring
 *  within 24h: register the NEW watch first. On success, mark the old row
 *  superseded, insert the new row active, THEN stop the old channel (a
 *  stop failure is logged, not fatal — the old channel expires on its own
 *  and 'superseded' rows still accept notifications during the overlap).
 *  On registration failure: the old row (if any) -> renewal_failed +
 *  last_error, one job_alerts insert per scheduled job on that calendar,
 *  one sync_log error row. */
export async function maintainChannels(deps: InboundDeps): Promise<MaintainSummary> {
  const summary: MaintainSummary = { renewed: [], failed: [] };
  const now = deps.now();

  for (const key of CALENDAR_KEYS) {
    const calendarId = deps.calendarIds[key];
    if (!calendarId) continue; // unconfigured calendar — nothing to watch

    try {
      const active = await fetchActiveChannel(deps, calendarId);
      const needsRenewal =
        !active || new Date(active.expires_at).getTime() - now.getTime() < RENEWAL_WINDOW_MS;
      if (!needsRenewal) continue;

      const channelId = generateChannelId(key);
      const token = crypto.randomUUID();

      let attempt: { ok: boolean; httpStatus: number; body: any };
      try {
        attempt = await deps.registerWatch(calendarId, channelId, deps.webhookAddress, token, CHANNEL_TTL_SECONDS);
      } catch (err) {
        attempt = { ok: false, httpStatus: 0, body: { error: (err as any)?.message ?? String(err) } };
      }

      if (!attempt.ok) {
        const message =
          `watch registration failed for ${key} (${calendarId}): HTTP ${attempt.httpStatus} ${JSON.stringify(attempt.body)}`;
        if (active) {
          await updateChannel(deps, active.id, { status: "renewal_failed", last_error: message });
        }
        await alertScheduledJobsForCalendar(deps, calendarId, message);
        await writeSyncLog(deps.supabase, {
          direction: "google_to_supabase",
          trigger_event: "calendar_watch_renewal",
          action_taken: "error",
          status: "error",
          error_message: message,
          payload_in: { calendarKey: key, calendarId },
        });
        summary.failed.push(key);
        continue;
      }

      const tokenHash = await sha256Hex(token);
      const resourceId = attempt.body?.resourceId ?? "";
      const expiration = attempt.body?.expiration
        ? new Date(Number(attempt.body.expiration)).toISOString()
        : new Date(now.getTime() + CHANNEL_TTL_SECONDS * 1000).toISOString();

      if (active) {
        await updateChannel(deps, active.id, { status: "superseded" });
      }
      await insertChannel(deps, {
        channel_id: channelId,
        resource_id: resourceId,
        calendar_id: calendarId,
        token_hash: tokenHash,
        expires_at: expiration,
        status: "active",
      });

      if (active) {
        try {
          await deps.stopWatch(active.channel_id, active.resource_id);
        } catch (err) {
          console.error(
            `[google-calendar-webhook] stopWatch failed for old channel ${active.channel_id}:`,
            (err as any)?.message ?? String(err),
          );
        }
      }

      summary.renewed.push(key);
    } catch (err) {
      // Finding 3: an unexpected throw from fetchActiveChannel/
      // updateChannel/insertChannel/alertScheduledJobsForCalendar must not
      // abort the whole loop — calendars later in CALENDAR_KEYS still get a
      // renewal attempt. The designed "registration returned ok:false"
      // failure path above handles itself (its own sync_log row + continue)
      // and never reaches this catch; this is for genuine bugs/DB errors.
      const message =
        `unexpected error maintaining watch for ${key} (${calendarId}): ${(err as any)?.message ?? String(err)}`;
      console.error(`[google-calendar-webhook] ${message}`);
      await writeSyncLog(deps.supabase, {
        direction: "google_to_supabase",
        trigger_event: "calendar_watch_renewal",
        action_taken: "error",
        status: "error",
        error_message: message,
        payload_in: { calendarKey: key, calendarId },
      });
      summary.failed.push(key);
    }
  }

  return summary;
}

// ── runMaintenance — the pg_cron entry point ─────────────────────────────

export interface MaintenanceSummary {
  channelsRenewed: CalendarKey[];
  channelsFailed: CalendarKey[];
  eventsApplied: number;
  eventsDeleted: number;
  eventsSkipped: number;
  eventsErrored: number;
  marksPruned: number;
}

/** maintainChannels -> reconcileCalendar over all five calendars (the
 *  fallback poll — runs regardless of any individual calendar's renewal
 *  outcome, so a renewal failure never blocks the reconciliation pass that
 *  detects the same underlying change) -> prune marks older than 30 days. */
export async function runMaintenance(deps: InboundDeps): Promise<MaintenanceSummary> {
  const channelSummary = await maintainChannels(deps);

  const totals = { applied: 0, deleted: 0, skipped: 0, errored: 0 };
  for (const key of CALENDAR_KEYS) {
    const calendarId = deps.calendarIds[key];
    if (!calendarId) continue;
    try {
      const result = await reconcileCalendar(deps, calendarId);
      totals.applied += result.applied;
      totals.deleted += result.deleted;
      totals.skipped += result.skipped;
      totals.errored += result.errored;
    } catch (err) {
      // Finding 3: a throw from reconcileCalendar ITSELF — e.g. its jobs
      // lookup or its own deps.getAccessToken() call, both of which sit
      // outside reconcileCalendar's per-event try/catch — must not skip the
      // remaining calendars or (see below) the prune step.
      const message = `reconciliation failed for ${key} (${calendarId}): ${(err as any)?.message ?? String(err)}`;
      console.error(`[google-calendar-webhook] ${message}`);
      await writeSyncLog(deps.supabase, {
        direction: "google_to_supabase",
        trigger_event: "calendar_reconcile",
        action_taken: "error",
        status: "error",
        error_message: message,
        payload_in: { calendarKey: key, calendarId },
      });
      totals.errored++;
    }
  }

  const cutoff = new Date(deps.now().getTime() - MARK_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await deps.supabase
    .from("calendar_inbound_marks")
    .delete({ count: "exact" })
    .lt("processed_at", cutoff);
  if (error) throw new Error(`calendar_inbound_marks prune failed: ${error.message ?? String(error)}`);

  return {
    channelsRenewed: channelSummary.renewed,
    channelsFailed: channelSummary.failed,
    eventsApplied: totals.applied,
    eventsDeleted: totals.deleted,
    eventsSkipped: totals.skipped,
    eventsErrored: totals.errored,
    marksPruned: count ?? 0,
  };
}
