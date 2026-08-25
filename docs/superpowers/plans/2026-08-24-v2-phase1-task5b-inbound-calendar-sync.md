# Profitability v2 Phase 1 — Task 5B Step 2: Inbound Google Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution model: parallel Sonnet implementer lanes with disjoint file ownership; adversarial Opus review per task + the whole slice; orchestrator serializes only at the integrity boundaries (branch validation, prod applies, deploys, commits).

**Goal:** Make Google Calendar a real two-way schedule projection: a managed watch-channel lifecycle (registry, renewal-before-expiry, overlap dedup, reconciliation fallback), revision-guarded **date-only** inbound writes to the canonical schedule, and deletion → `job_schedule_exceptions` + alert with explicit `resolveDeletedCalendarEvent` resolutions — never auto-unschedule.

**Architecture:** The Step-1 spike scaffold in `supabase/functions/google-calendar-webhook/` is **replaced** (it has zero DB access by design and is not a foundation). The rewritten function owns the entire inbound side: Google's push notifications (always-200, token-hash auth) and a cron-driven `maintain` action (channel renewal + reconciliation poll + dedup-mark pruning). Push and poll share **one code path**: both resolve the set of scheduled jobs whose managed events live on a calendar, fetch each event by its stored id (the notification body is empty — spike fact (a)), classify it with a pure comparator, and act through three new locked SQL RPCs. The outbound dispatcher is untouched; inbound mirroring rides the existing `job.scheduled` outbox event with a bumped `calendar_sync_revision`, so the dispatcher's idempotent update-not-create path does the mirroring.

**Tech Stack:** Supabase Postgres 17 (project `eiqqqwajmcpcwhvxxnhx`) + pgTAP (branches only), Supabase MCP, Deno 2 edge functions, Google Calendar API (`events.watch`, `channels.stop`, `events.get`), Next 16 App Router + vitest (in `web/`), pg_cron + pg_net.

**Spec:** `docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` Task 5 Step 6 (lines 1326–1346) + the dispatcher test list (lines 1260–1278, inbound subset) + the channel-lifecycle adjustment (4) in the landing note. Execution context: `docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md` Task 6 (5B), spike results in its Step 1 record. **The spike's banked design facts are binding inputs:** (a) notification body is empty — fetch by stored event id; (b) `X-Goog-Channel-Token` round-trips — `token_hash` auth is viable; (c) Google honors requested TTL — renewal can trust returned `expiration`; (d) the notification route and admin routes need different auth and the notification route must **always return 200**.

> ## ⚡ Execution status (2026-08-24, same session as approval)
>
> **Tasks 1–3 COMPLETE** (all steps, all reviews clean after fix rounds — commits
> `cf240a2..8553aa2`, pushed). **Task 4 Steps 1–2 COMPLETE**: per-lane adversarial reviews + fix
> rounds + whole-slice final review + final fix wave all clean; runbook cycle done (branch
> `v2-phase1-task5b`, probes a–d FAITHFUL, RED 32/32 not-ok, GREEN **147/147 first execution**,
> branch deleted; suites deno 411/411 golden intact, web 596/596, build green).
>
> **UPDATE 2026-08-25 (Session 8): Task 4 Steps 3–4 COMPLETE, Step 5 PARTIAL.** Matt approved
> items 1+2; the 3 migrations are **APPLIED TO PRODUCTION** (head `20260825171051`, 38 applied;
> secret substituted server-side; post-apply assertions + advisors clean) and
> `google-calendar-webhook` **v2 is DEPLOYED** via the invariant (siblings sha-undisturbed).
> Decision-9 satisfied via `SLACK_TEST_CHANNEL_OVERRIDE=C0BPPG8997Z` (#ops-test) — **SET, must be
> unset at probe close**. Probe legs 1 (5 active channels, sync handshakes ×5) and 2 (estimate
> 1428 → JOB-1106, Crew 4, 2026-12-22→23, dispatcher succeeded attempt 1 incl. the FIRST-EVER
> dispatcher Slack delivery) plus early echo termination (real `exists` notification →
> `dates_unchanged` mark) are **PROVEN LIVE**. JOB-1106 carries NO GHL identity link, deliberately
> (both GHL enqueues are conditional — zero GHL artifacts, no re-drag hazard). **Steps 5 legs
> 3/5/6 REMAIN — next session opens with Matt's two calendar actions** (drag the main event's
> dates; delete the crew event) then dismiss-resolve via RPC (the `/jobs/exceptions` UI is on the
> branch, not prod Vercel), `closed_lost` teardown, unset the override. Full record: the
> 2026-08-25 Session 8 `BUILD_LOG.md` entry. Two ruled amendments to this plan's text, made
> during execution and binding: (1) `resolve_schedule_exception`'s `dismiss` on a non-scheduled job
> is an **acknowledge-and-close** (closes exception + alert, zero jobs/outbox writes) rather than
> sharing raise text 8 — text 8 stays verbatim for `reschedule`; (2) `classifyManagedEvent` checks
> `deleted` BEFORE `unmanaged` (Google may strip extendedProperties on cancelled resources; every
> fetched event is ours by construction). Full record: the 2026-08-24 `BUILD_LOG.md` entry.

## Global Constraints

- Every schema task follows `docs/runbooks/profitability-schema-validation.md` (8-step sequence, fidelity probes a–d, pgTAP on branches only, plain-SQL catalog assertions post-apply, verbatim BUILD_LOG record).
- Phase-1 plan deviations 1–4 apply to everything here: pgTAP description args on every multi-overload assertion; explicit `revoke ... from public, anon, authenticated` + ACL assertions on every new table; `set search_path = public, pg_temp` pinned on every new function, EXECUTE revoked from `public, anon, authenticated` and granted to `service_role` only; migration filename prefixes use 2026-08-24+ dates (prod head is `20260820152300`).
- All new RPCs are **plain plpgsql, NOT SECURITY DEFINER** (house rule since Task 4's F5 reversal — see `20260819170000_schedule_estimate_rpc.sql`'s header).
- `google-calendar-webhook` deploys ONLY via `--no-verify-jwt` + readback, and the readback must confirm `ghl-job-webhook` and `integration-dispatcher` were not disturbed (sha check on cosmetic version bumps).
- No pricing to crew surfaces. Inbound writes touch **only** `jobs.start_date`, `jobs.end_date`, `calendar_sync_revision` (+ audit rows) — never crew, scope, prices, lifecycle, or financial data.
- **M7 cross-lane constraint (ledger):** `cancel_scheduled_job` does NOT bump `calendar_sync_revision`, so `job.scheduled:<job>:revN` and `job.cancelled:<job>:revN` share a rev. The inbound guard must not assume rev monotonicity separates them — the `status_v2 = 'scheduled'` check under lock is the real guard.
- Quote math untouched: `deno task test` (382 at last close, golden-321 gate) and `cd web && npx vitest run` (556) green at every task close.
- Sonnet implements; adversarial Opus review per task + whole slice. No deletes without Matt's per-item approval; never `git add -A`; everything applied to Supabase committed same session; BUILD_LOG entry at session close.
- The three raise-text families already pinned as cross-lane APIs must not be collided with: `classifyScheduleError` needles ("already", "accept", "supersed", "financial", "not presented") and `classifyCancelError` needles ("no job found", "cannot be cancelled", "actor name is required", "invalid resolution", "reason is required"). Every new raise text in this plan avoids all of them and is byte-pinned in Task 1.

## Decisions this plan makes (approved with the plan; deviations from the v2 doc's literal text are marked ⚠️)

1. **One code path for push and poll.** A notification for calendar X triggers a *scoped reconciliation* of calendar X (fetch every scheduled job's stored event on that calendar, compare, act); the fallback poll is the same routine over all five calendars. The v2 text describes them separately; unifying them means the fallback exercises the exact code the push path uses, not a parallel implementation.
2. ⚠️ **Dedup tuple keyed on `calendar_id`, not `resource_id`.** The spec says dedup by `(resource_id, event id, event updated)`. `resource_id` is per-channel-registration; `calendar_id` is stable across channel generations and maps 1:1 to the resource. Keying on `calendar_id` preserves the spec's intent (overlapping channels for one resource cannot double-apply one change) and additionally dedups across channel replacement and the poll path. Dedup marks are inserted **after** a successful outcome only — correctness comes from the RPC guards; the marks are an overlap/echo optimization.
3. **Inbound mirroring reuses the `job.scheduled` outbox event** with a bumped revision. The dispatcher already does idempotent update-not-create against stored event ids, and its Slack leg re-notifies per ruling R7 (a reschedule re-notifies). **Consequence Matt should be aware of: a calendar date edit will post a fresh crew Slack message** — the crew learns the dates moved, which is the R7 semantics applied consistently. No new dispatcher event types.
4. ⚠️ **No GHL projection on an inbound date change.** The spec's "enqueue updates for the other projection and GHL summary" — but the outbound path today projects no dates to GHL either (`schedule_estimate` enqueues stage moves only; GHL date custom fields are the legacy webhook's concern). Enqueueing a redundant `ghl.stage.requested: Job Scheduled` would be a pointless idempotent PUT. GHL field projection is v2 Task 15 territory. Recorded as an accepted, consistent gap.
5. **Alerts are `job_alerts` rows only — no Slack delivery.** `job_alerts.job_number` is a NOT NULL FK to `jobs`, so channel-level failures alert **per affected scheduled job** (fingerprint `calendar_watch:<calendar_id>`, severity `watch`); a renewal failure with zero scheduled jobs on that calendar writes a `sync_log` error row only (the reconciliation poll still covers the gap). Deletion exceptions alert per job (fingerprint `calendar_deleted:<event_id>`, severity `at_risk`). Slack delivery of alerts is v2 Task 12 (this matches 5A's dead-letter alerts, which are also `job_alerts`-only today).
6. **Minimal exception-resolution UI ships in this slice** (`/jobs/exceptions`): a list of open `job_schedule_exceptions` with a resolve form. Without it, `resolveDeletedCalendarEvent` is unreachable except via console and the Phase 1 gate's "simulate deletion and resolve it" has no app path. Full dashboard integration remains v2 Task 6.
7. **Watch TTL 7 days, renewal threshold 24 h, maintenance cron every 30 min.** The spike proved Google honors the requested TTL and returns the real `expiration`; renewal registers the replacement **before** stopping the old channel and marks the old row `superseded`.
8. **Revision guard semantics:** an event's `extendedProperties.private.scheduleRevision` must equal the job's current `calendar_sync_revision` for its dates to apply (the guard re-checked inside the RPC under lock, via `p_expected_revision`). Lower ⇒ stale (a newer app edit exists) ⇒ skip. Higher ⇒ impossible via any current writer ⇒ log anomaly, skip. **Echo termination is the dates-equal no-op**, which runs before the revision check: after the dispatcher mirrors an inbound change, the resulting notifications find event dates equal to canonical dates and stop.
9. **Live-probe prerequisites:** the probe's inbound-apply step enqueues `job.scheduled`, whose Slack leg fails while the bot is not in the crew channels (🔴 open gate item) — the probe either follows Matt's bot invitations or runs with `SLACK_TEST_CHANNEL_OVERRIDE` pointed at a channel the bot is in. And the probe uses **`closed_lost` resolutions only** — `postponed` returns GHL to Quote Accepted, which trips the still-live legacy minting workflow (same hazard 5A dodged); it is probed only after the gate flag flip.

## Concurrency map

| Lane | Task | Files owned | Can run alongside |
|---|---|---|---|
| S (SQL) | Task 1 | `supabase/migrations/20260824150000_calendar_watch_registry.sql`, `20260824151000_calendar_inbound_rpcs.sql`, `20260824152000_schedule_calendar_maintenance.sql`, `supabase/tests/calendar_inbound_sync_test.sql` | F and W entirely |
| F (function) | Task 2 | `supabase/functions/google-calendar-webhook/{index,handlers,handlers_test}.ts` (rewrite), `supabase/functions/_shared/google.ts` (additive `getCalendarEvent` only) | S and W entirely (wires against the RPC signatures fixed verbatim in Task 1's Interfaces block) |
| W (web) | Task 3 | `web/src/lib/jobs/exceptionActions.ts`, `web/src/lib/jobs/__tests__/exceptionActions.test.ts`, `web/src/app/(app)/jobs/exceptions/page.tsx`, `web/src/app/(app)/jobs/exceptions/ResolveExceptionForm.tsx` | S and F entirely (wires against the same fixed RPC signatures) |
| — | Reviews | none (read-only) | any unrelated implementation lane |
| — | Task 4 serial tail | branch validation, prod DB, deploys, `BUILD_LOG.md`, docs | nothing (integrity boundary) |

All three lanes wire against interfaces fixed **in this plan** (RPC signatures, raise texts, table/column names, notification-route contract), so no lane blocks another. The integrity boundaries are exactly: the shared runbook/prod applies (Task 4), and nothing else.

---

### Task 1 (Lane S): Registry, dedup, and inbound RPC migrations + pgTAP

**Files:**
- Create: `supabase/migrations/20260824150000_calendar_watch_registry.sql`
- Create: `supabase/migrations/20260824151000_calendar_inbound_rpcs.sql`
- Create: `supabase/migrations/20260824152000_schedule_calendar_maintenance.sql`
- Create: `supabase/tests/calendar_inbound_sync_test.sql`

**Interfaces:**
- Consumes: `public.jobs` (`job_number`, `status_v2`, `start_date`, `end_date`, `calendar_sync_revision`, `gcal_main_event_id`, `gcal_crew_event_id`, `crew`, `cancelled_at`, `cancellation_reason`), `public.job_schedule_exceptions`, `public.job_alerts` (+ partial unique index `job_alerts_one_open_fingerprint`), `public.integration_outbox`, `public.job_events`, `public.cancel_scheduled_job(text,text,text,uuid,text)`.
- Produces (Tasks 2 and 3 wire against these exact names — they are the cross-lane API):
  - enum `public.watch_channel_status` = `('active','superseded','expired','renewal_failed')`
  - table `public.calendar_watch_channels`
  - table `public.calendar_inbound_marks`
  - partial unique index `job_schedule_exceptions_one_open` on `(job_number, external_event_id) where status = 'open'`
  - `public.apply_calendar_date_change(p_job_number text, p_start_date date, p_end_date date, p_expected_revision bigint, p_event_id text, p_event_updated timestamptz, p_source text) returns jsonb`
  - `public.open_calendar_deletion_exception(p_job_number text, p_external_event_id text, p_incoming_event jsonb) returns jsonb`
  - `public.resolve_schedule_exception(p_exception_id uuid, p_resolution text, p_reason text, p_start_date date, p_end_date date, p_actor uuid, p_actor_name text) returns jsonb`
  - **Byte-pinned raise texts** (the web lane's classifier and the function lane's benign-skip detection match on these verbatim; none contain any sibling classifier's needles):
    1. `'resolve_schedule_exception: exception % not found'`
    2. `'resolve_schedule_exception: exception % is not open (status %)'`
    3. `'resolve_schedule_exception: invalid resolution %'`
    4. `'resolve_schedule_exception: resolution reason is required'`
    5. `'resolve_schedule_exception: reschedule requires startDate and endDate'`
    6. `'resolve_schedule_exception: endDate (%) must be on or after startDate (%)'`
    7. `'resolve_schedule_exception: actor name is required'`
    8. `'resolve_schedule_exception: job % is no longer scheduled (status %)'`
  - `sync_log.direction` CHECK **widened to add `'google_to_supabase'`** (the live constraint allows only the five existing values; Phase A shipped a live 400 by missing exactly this — the widening lives in `20260824150000` and Lane F's log writes depend on it)

- [ ] **Step 1: Write the failing pgTAP suite**

Create `supabase/tests/calendar_inbound_sync_test.sql` following `integration_dispatcher_rpcs_test.sql`'s house style (`begin; select plan(n); … select * from finish(); rollback;`, description args everywhere). Assert, at minimum:

- existence + shape: `has_enum('public','watch_channel_status','watch_channel_status enum exists')`; `has_table` for both new tables; `has_column` spot-checks (`calendar_watch_channels`: `channel_id`, `resource_id`, `calendar_id`, `token_hash`, `expires_at`, `status`, `last_notification_at`; `calendar_inbound_marks`: `calendar_id`, `event_id`, `event_updated`); the `calendar_watch_channels_one_active` and `job_schedule_exceptions_one_open` partial unique indexes exist; RLS enabled + anon/authenticated hold no table privileges on both new tables (deviation-2 ACL assertions); `function_privs_are` denies `anon`/`authenticated` EXECUTE on all three RPCs.
- `apply_calendar_date_change` behavior, on a seeded scheduled job (seed via direct inserts inside the rolled-back transaction, mirroring `schedule_estimate_rpc_test.sql`'s seeding approach):
  - matching revision + new dates ⇒ `applied=true`, `jobs.start_date/end_date` updated, `calendar_sync_revision` bumped by 1, one `job_events` row (`function_name='apply_calendar_date_change'`, `trigger_source='google_calendar'`), one `integration_outbox` row `job.scheduled:<job>:rev<new>` whose payload carries the new dates and new revision;
  - same dates ⇒ `applied=false, reason='dates_unchanged'`, revision NOT bumped, no outbox row;
  - `p_expected_revision` below current ⇒ `applied=false, reason='stale_revision'`, nothing written;
  - job `status_v2='cancelled'` ⇒ `applied=false, reason='not_scheduled'`, nothing written (**the M7 case**);
  - `p_end_date < p_start_date` ⇒ raises.
- `open_calendar_deletion_exception`:
  - scheduled job ⇒ `opened=true`, one open `job_schedule_exceptions` row (`kind='calendar_deleted'`, `previous_schedule` carrying crew + both dates + both gcal ids), one open `job_alerts` row fingerprint `calendar_deleted:<event_id>` severity `at_risk`;
  - second call, same job + event ⇒ `opened=false, reason='exception_already_open'` (the partial unique index path), no second alert;
  - cancelled job ⇒ `opened=false, reason='not_scheduled'`, no exception row (**the M7 case: the dispatcher's own `job.cancelled` cleanup deletions must never open exceptions**).
- `resolve_schedule_exception`:
  - `reschedule` with dates ⇒ jobs dates updated, revision bumped, the deleted projection's `gcal_*_event_id` cleared (whichever of `gcal_main_event_id`/`gcal_crew_event_id` equals `external_event_id`), fresh `job.scheduled:<job>:rev<new>` outbox row, exception `status='rescheduled'` + `resolved_at`/`resolved_by`/`resolution_note` set, matching `calendar_deleted:*` alert resolved;
  - `reschedule` without dates ⇒ raises text 5 verbatim;
  - `closed_lost` ⇒ job `status_v2='cancelled'` with `cancellation_reason` set (via the internal `cancel_scheduled_job` call), `job.cancelled` + `ghl.stage.requested` outbox rows exist (written by `cancel_scheduled_job`), exception `status='unscheduled'`;
  - `postponed` ⇒ same shape as `closed_lost` but the `ghl.stage.requested` payload stage is `Quote Accepted`;
  - `dismiss` ⇒ dates unchanged, revision bumped, deleted event id cleared, fresh `job.scheduled` outbox row, exception `status='dismissed'`;
  - resolving a non-open exception ⇒ raises text 2 verbatim;
  - blank actor name ⇒ raises text 7 verbatim.

Count the assertions and set `plan(n)` accordingly.

- [ ] **Step 2: Run the suite on a disposable branch and verify it fails**

Per the runbook: create branch `v2-phase1-task5b` (with `confirm_cost`), run fidelity probes a–d, install pgTAP, run the suite. Expected: FAIL on every existence assertion (RED recorded verbatim).

- [ ] **Step 3: Write `20260824150000_calendar_watch_registry.sql`**

House style: header comment explaining purpose + BL-7/INVOKER/pinning rationale pointers, then:

```sql
create type public.watch_channel_status as enum ('active','superseded','expired','renewal_failed');

create table public.calendar_watch_channels (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null unique,
  resource_id text not null,
  calendar_id text not null,
  token_hash text not null,
  registered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status public.watch_channel_status not null default 'active',
  last_notification_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

-- At most one ACTIVE channel per calendar. Renewal registers the
-- replacement BEFORE stopping the old one, so the old row must already be
-- 'superseded' before the new row inserts as 'active' — the edge function's
-- renewal sequence (mark old superseded -> insert new active -> stop old)
-- is ordered around exactly this index.
create unique index calendar_watch_channels_one_active
  on public.calendar_watch_channels (calendar_id) where status = 'active';

-- Inbound dedup marks (plan decision 2: calendar_id, not resource_id — see
-- the plan header). Insert AFTER a successful outcome only; a conflict
-- means an overlapping channel or the reconciliation poll already
-- processed exactly this (event, updated) generation.
create table public.calendar_inbound_marks (
  id bigint generated always as identity primary key,
  calendar_id text not null,
  event_id text not null,
  event_updated timestamptz not null,
  outcome text not null,
  processed_at timestamptz not null default now(),
  unique (calendar_id, event_id, event_updated)
);

-- One OPEN deletion exception per (job, external event) — the inbound path
-- inserts with ON CONFLICT DO NOTHING against this index.
create unique index job_schedule_exceptions_one_open
  on public.job_schedule_exceptions (job_number, external_event_id)
  where status = 'open';

alter table public.calendar_watch_channels enable row level security;
alter table public.calendar_inbound_marks enable row level security;
revoke all on table public.calendar_watch_channels from public, anon, authenticated;
revoke all on table public.calendar_inbound_marks from public, anon, authenticated;

create index idx_calendar_watch_channels_expiry
  on public.calendar_watch_channels (status, expires_at);
create index idx_calendar_inbound_marks_age
  on public.calendar_inbound_marks (processed_at);

-- Widen sync_log.direction for the inbound leg's log writes (house
-- pattern: phase_a_audit_write_fixups and phase_b2_ghl_push_state did
-- exactly this drop-and-re-add for their new directions).
alter table public.sync_log drop constraint sync_log_direction_check;
alter table public.sync_log add constraint sync_log_direction_check
  check (direction in ('ghl_to_airtable','airtable_to_ghl','ghl_to_supabase',
                       'supabase_to_slack','app_to_ghl','google_to_supabase'));
```

⚠️ Before writing the widening, read the live constraint name and definition (`pg_constraint` on the branch) — the name above is the conventional default; if the live name differs, use the live name. The pgTAP suite (Step 1) asserts a `google_to_supabase` insert into `sync_log` is accepted (and rolled back with the transaction).

No immutability triggers — both tables are mutable operational bookkeeping, the same class as `ghl_push_state`.

- [ ] **Step 4: Write `20260824151000_calendar_inbound_rpcs.sql`**

All three functions: plain plpgsql (NOT SECURITY DEFINER), `set search_path = public, pg_temp`, `revoke all ... from public, anon, authenticated`, `grant execute ... to service_role`. Header comment carries the byte-pinned raise-text table from the Interfaces block above, the M7 explanation, and the needle-avoidance constraint.

**`apply_calendar_date_change`** — the only inbound writer, date-only by construction:

```sql
create function public.apply_calendar_date_change(
  p_job_number text,
  p_start_date date,
  p_end_date date,
  p_expected_revision bigint,
  p_event_id text,
  p_event_updated timestamptz,
  p_source text
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job public.jobs;
  v_new_revision bigint;
begin
  if p_job_number is null or p_start_date is null or p_end_date is null
     or p_expected_revision is null then
    raise exception 'apply_calendar_date_change: p_job_number, p_start_date, p_end_date, p_expected_revision are required';
  end if;
  if p_end_date < p_start_date then
    raise exception 'apply_calendar_date_change: endDate (%) must be on or after startDate (%)', p_end_date, p_start_date;
  end if;

  select * into v_job from public.jobs where job_number = p_job_number for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'job_not_found');
  end if;

  -- M7: the status check IS the guard separating a live schedule from a
  -- cancelled job whose rev the cancel path deliberately did not bump.
  if v_job.status_v2 is distinct from 'scheduled'::public.job_lifecycle then
    return jsonb_build_object('applied', false, 'reason', 'not_scheduled');
  end if;

  -- Echo termination FIRST: after the dispatcher mirrors an inbound edit,
  -- the resulting notifications see event dates equal to canonical dates
  -- and stop here regardless of revision bookkeeping.
  if v_job.start_date = p_start_date and v_job.end_date = p_end_date then
    return jsonb_build_object('applied', false, 'reason', 'dates_unchanged');
  end if;

  -- Revision guard (plan decision 8), re-checked under the row lock so a
  -- racing app edit cannot interleave between the TS comparator and this
  -- write. Higher-than-current is impossible via any current writer —
  -- treated as stale, surfaced in the reason for the caller to log.
  if v_job.calendar_sync_revision is distinct from p_expected_revision then
    return jsonb_build_object('applied', false, 'reason', 'stale_revision',
      'job_revision', v_job.calendar_sync_revision, 'event_revision', p_expected_revision);
  end if;

  v_new_revision := v_job.calendar_sync_revision + 1;

  update public.jobs
     set start_date = p_start_date,
         end_date = p_end_date,
         calendar_sync_revision = v_new_revision,
         updated_at = now()
   where job_number = v_job.job_number
   returning * into v_job;

  insert into public.job_events (
    job_number, stage_from, stage_to, function_name, trigger_source,
    ghl_opportunity_id, action_summary, status, payload_in
  ) values (
    v_job.job_number, 6, 6, 'apply_calendar_date_change', 'google_calendar',
    v_job.ghl_opportunity_id,
    format('Schedule dates updated from Google Calendar (%s): %s to %s', p_source, p_start_date, p_end_date),
    'success',
    jsonb_build_object('event_id', p_event_id, 'event_updated', p_event_updated,
      'source', p_source, 'start_date', p_start_date, 'end_date', p_end_date,
      'calendar_sync_revision', v_new_revision)
  );

  -- Mirror through the EXISTING dispatcher machinery (plan decision 3):
  -- rev-scoped key = fresh delivery; the dispatcher's update path rewrites
  -- both projections (including the originating event, a harmless
  -- idempotent PUT) and re-notifies the crew per ruling R7.
  insert into public.integration_outbox (event_type, aggregate_type, aggregate_id, idempotency_key, payload)
  values (
    'job.scheduled', 'job', v_job.job_number,
    'job.scheduled:' || v_job.job_number || ':rev' || v_new_revision::text,
    jsonb_build_object('job_number', v_job.job_number, 'crew', v_job.crew,
      'start_date', p_start_date, 'end_date', p_end_date,
      'calendar_sync_revision', v_new_revision)
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('applied', true, 'calendar_sync_revision', v_new_revision);
end;
$$;
```

**`open_calendar_deletion_exception`** — same lock + status guard shape; returns `{'opened': false, 'reason': 'not_scheduled'}` for a non-scheduled job (M7 again: the dispatcher's own cancel-cleanup deletions land here and must be inert), `{'opened': false, 'reason': 'exception_already_open'}` when the `ON CONFLICT DO NOTHING` insert against `job_schedule_exceptions_one_open` returns no id, else inserts the exception row —

```sql
  insert into public.job_schedule_exceptions (job_number, external_event_id, kind, previous_schedule, incoming_event)
  values (
    v_job.job_number, p_external_event_id, 'calendar_deleted',
    jsonb_build_object('crew', v_job.crew, 'start_date', v_job.start_date,
      'end_date', v_job.end_date, 'gcal_main_event_id', v_job.gcal_main_event_id,
      'gcal_crew_event_id', v_job.gcal_crew_event_id),
    p_incoming_event
  )
  on conflict (job_number, external_event_id) where status = 'open' do nothing
  returning id into v_exception_id;
```

*(Note: `ON CONFLICT` with a partial index requires the `where status = 'open'` inference clause exactly as written — same lesson as 5A's `insertJobAlert` design note, solved here in SQL where the predicate CAN be expressed.)* Then one `job_alerts` insert (fingerprint `'calendar_deleted:' || p_external_event_id`, severity `'at_risk'`, title `'Calendar event deleted: ' || v_job.job_number`, message naming the dates and calendar, `action_path '/jobs/exceptions'`), plain insert with 23505 swallowed via an exception block (the partial-index dedup), one `job_events` row (`stage_from 6, stage_to 6`, `status 'success'`, `action_summary` naming the deletion), and `return jsonb_build_object('opened', true, 'exception_id', v_exception_id)`. **It never touches `jobs.status_v2`, GHL, or the stored gcal ids** — the spec's "do not update jobs.status_v2 or GHL automatically."

**`resolve_schedule_exception`** — validation order = raise-text order (actor name → resolution ∈ (`reschedule`,`postponed`,`closed_lost`,`dismiss`) → reason → exception lookup `for update` → open check → per-resolution date checks). Then:

- `reschedule`: lock the job; require it still `scheduled` (if not, raise `'resolve_schedule_exception: job % is no longer scheduled (status %)'` — pinned as raise text 8, added to the table); update dates, bump `calendar_sync_revision`, clear whichever of `gcal_main_event_id`/`gcal_crew_event_id` equals the exception's `external_event_id` (so the dispatcher's create path replaces the deleted event), `job_events` row, `job.scheduled:<job>:rev<new>` outbox insert (same shape as `apply_calendar_date_change`'s), exception → `'rescheduled'`.
- `postponed` / `closed_lost`: `perform public.cancel_scheduled_job(v_exception.job_number, p_resolution, p_reason, p_actor, p_actor_name);` — reusing the 5A RPC verbatim buys the status-guard, audit, `job.cancelled` + `ghl.stage.requested` enqueues, and the byte-pinned cancel raise texts for free (a job no longer cancellable surfaces `cancel_scheduled_job`'s own raise, which the web classifier already routes). Exception → `'unscheduled'`.
- `dismiss`: same as `reschedule` but with the job's **current** dates (no date args needed; if provided, ignore) — clear the deleted event id, bump revision, enqueue `job.scheduled` — the dispatcher recreates the managed event. Exception → `'dismissed'`.
- All four: stamp `resolved_at = now()`, `resolved_by = p_actor`, `resolution_note = p_reason`; resolve the paired alert (`update public.job_alerts set resolved_at = now(), resolution_note = p_reason where job_number = ... and fingerprint = 'calendar_deleted:' || v_exception.external_event_id and resolved_at is null`); return `jsonb_build_object('resolution', p_resolution, 'job_number', ..., 'exception_id', ...)`.

- [ ] **Step 5: Write `20260824152000_schedule_calendar_maintenance.sql`**

Copy the structure of `20260820152000_schedule_integration_dispatcher.sql` verbatim (pg_cron + pg_net, `__WEBHOOK_SECRET__` placeholder, server-side substitution note, deploy-posture warning):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'calendar-sync-maintenance',
  '7,37 * * * *',
  $$
  select net.http_post(
    url := 'https://eiqqqwajmcpcwhvxxnhx.supabase.co/functions/v1/google-calendar-webhook',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', '__WEBHOOK_SECRET__'
    ),
    body := '{"action":"maintain"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
```

- [ ] **Step 6: Apply all three migrations on the branch, re-run pgTAP, expect GREEN**

Record RED → GREEN verbatim per the runbook. Then `deno task test` and `cd web && npx vitest run` — both must stay green (no code in those suites touches the new schema yet).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260824150000_calendar_watch_registry.sql \
  supabase/migrations/20260824151000_calendar_inbound_rpcs.sql \
  supabase/migrations/20260824152000_schedule_calendar_maintenance.sql \
  supabase/tests/calendar_inbound_sync_test.sql
git commit -m "feat: add calendar watch registry and inbound date-sync RPCs"
```

---

### Task 2 (Lane F): Rewrite `google-calendar-webhook` — notification path, channel lifecycle, reconciliation

**Files:**
- Modify (rewrite): `supabase/functions/google-calendar-webhook/index.ts`
- Modify (rewrite): `supabase/functions/google-calendar-webhook/handlers.ts`
- Modify (rewrite): `supabase/functions/google-calendar-webhook/handlers_test.ts`
- Modify (additive only): `supabase/functions/_shared/google.ts`

**Interfaces:**
- Consumes: Task 1's three RPCs and two tables (exact signatures in Task 1's Interfaces block); `getGoogleAccessToken`, `createCalendarEvent` (not called here — dispatcher's job), `_shared/log.ts`'s `writeSyncLog`; `resolveCrewEnvKey` from `_shared/slack.ts` (crew → calendar mapping); the spike's `isGoogleNotification`/`extractNotification`/`buildWatchBody`/`registerWatchChannel`/`stopWatchChannel` shapes (kept, extended).
- Produces:
  - `getCalendarEvent(calendarId: string, eventId: string, accessToken: string): Promise<{ status: number; event: any | null }>` in `_shared/google.ts` — returns `{status: 404, event: null}` / `{status: 410, event: null}` instead of throwing on gone-events (deletion is data here, not an error), throws on other non-OK statuses.
  - `classifyManagedEvent(event, job)` pure comparator (exported for tests): returns one of `'unmanaged' | 'deleted' | 'dates_unchanged' | 'stale_revision' | 'revision_anomaly' | 'apply'` given a fetched event and a job row.
  - The deployed function's routes: Google notification path (always 200), admin `action` ∈ `ping | maintain | register | stop` (secret-gated).

- [ ] **Step 1: Write the failing Deno tests**

Rewrite `handlers_test.ts` (the spike's tests go with the scaffold — the spike file header itself says Step 2 replaces it). DI style mirrors `integration-dispatcher/handlers_test.ts`: a fake `supabase` client, fake `getCalendarEvent`/`fetchImpl`, injected `now`. Cases (the v2 list's inbound subset + spike-mandated pins):

1. **`exists` notification transport pin** (the spike observed only `sync`; the plan's first integration test pins `exists` — same headers, `X-Goog-Resource-State: exists`): notification with a registered channel's token → triggers scoped reconciliation of that channel's calendar.
2. `sync` notification → 200, `last_notification_at` stamped, no event fetches.
3. Unknown `channel_id` or token-hash mismatch → logged, **still 200**, no processing (spike fact (d): a non-2xx makes Google retry then kill the channel).
4. Internal throw during processing → caught, **still 200** (the always-200 rule holds even on our own bugs; the error goes to `sync_log` + console).
5. `calendar date edit updates canonical schedule and mirrors other projections once` (v2 list): managed event, revision matches, dates differ → `apply_calendar_date_change` RPC called with the event's dates + `p_expected_revision` = the event's `scheduleRevision`; the mirroring itself is the RPC's outbox insert (asserted in pgTAP), so the handler test asserts exactly one RPC call.
6. `stale calendar revision cannot overwrite a newer app edit` (v2 list): event `scheduleRevision` below job's → comparator says `stale_revision`, no RPC call, dedup mark written with that outcome.
7. Echo termination: event dates equal canonical → `dates_unchanged`, no RPC call.
8. Unmanaged event (no `extendedProperties.private.managedBy === "lostboys-estimator"`) → ignored.
9. `calendar deletion opens scheduling required and does not delete or roll back the job` (v2 list): `getCalendarEvent` returns 404/410 OR an event with `status: "cancelled"` → `open_calendar_deletion_exception` called; job row untouched by the handler itself.
10. **M7:** deletion notification for a job whose `status_v2='cancelled'` → the handler still calls the RPC, and a fake RPC returning `{opened:false, reason:'not_scheduled'}` is treated as a benign skip (no error, no retry).
11. Dedup: a mark-insert conflict (fake supabase returns 23505) → event skipped, no RPC call.
12. `watch channel is renewed before expiry and overlapping channels deduplicate notifications` (v2 list): `maintain` with an active channel inside the 24 h window → new channel registered **before** old stopped, old row → `superseded`, new row `active`; then notifications arriving on BOTH channels for one event generation produce one processed outcome (the mark conflict absorbs the second).
13. `channel renewal failure opens an alert and the reconciliation fallback still detects the change` (v2 list): watch registration fails → channel row → `renewal_failed` + `last_error`, `job_alerts` insert per scheduled job on that calendar (fingerprint `calendar_watch:<calendar_id>`, severity `watch`), `sync_log` error row; a subsequent `maintain` reconciliation pass still fetches the changed event and applies it.
14. `maintain` prunes `calendar_inbound_marks` older than 30 days.

Run: `deno test --allow-all supabase/functions/google-calendar-webhook/` — expected: FAIL (functions don't exist yet).

- [ ] **Step 2: Add `getCalendarEvent` to `_shared/google.ts`** (additive, below the Task 5A additions marker, same style):

```ts
// 404/410 are DATA for the inbound sync leg (the event was deleted), not
// errors — unlike updateCalendarEvent, whose 404 is a failure. Any other
// non-OK status throws with the same error-text shape as its siblings.
export async function getCalendarEvent(calendarId: string, eventId: string, accessToken: string): Promise<{ status: number; event: any | null }> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (res.status === 404 || res.status === 410) return { status: res.status, event: null }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Calendar event fetch failed (${res.status}): ${JSON.stringify(data)}`)
  return { status: res.status, event: data }
}
```

- [ ] **Step 3: Implement `handlers.ts`**

Pure logic + DI, zero `Deno.env`, zero direct `fetch` — the house split. Core pieces:

```ts
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

export type ManagedEventOutcome =
  | "unmanaged" | "deleted" | "dates_unchanged" | "stale_revision"
  | "revision_anomaly" | "apply";

/** Pure comparator — plan decision 8. Google all-day events carry
 *  start.date inclusive and end.date EXCLUSIVE, so the canonical inclusive
 *  end date is end.date minus one day (inverse of _shared/google.ts's
 *  addOneDay). */
export function classifyManagedEvent(
  event: any,
  job: { start_date: string; end_date: string; calendar_sync_revision: number },
): ManagedEventOutcome;
```

`classifyManagedEvent` rules, in order: no `extendedProperties?.private?.managedBy === "lostboys-estimator"` → `unmanaged`; `event.status === "cancelled"` → `deleted`; inclusive dates equal job's → `dates_unchanged`; `Number(scheduleRevision)` < job's revision → `stale_revision`; > job's revision → `revision_anomaly` (console.error + skip — impossible via current writers); else `apply`. Non-all-day events (no `start.date`) → treat as `revision_anomaly`-class skip with its own log line (a human converted an all-day event to timed; dates can't be read reliably — surfaced, never guessed).

`reconcileCalendar(deps, calendarId)`: select scheduled jobs owning an event on this calendar (`gcal_main_event_id` where calendarId is main; `gcal_crew_event_id` where `resolveCrewEnvKey(job.crew)` maps to this calendar), fetch each stored event via `getCalendarEvent`, classify, then per outcome: `apply` → check/insert dedup mark (skip on conflict) then `apply_calendar_date_change` RPC (event dates converted exclusive→inclusive, `p_expected_revision` from the event property, `p_source` = `'main'`/`'crew'`, mark inserted after with the RPC's outcome); `deleted` (or fetch 404/410) → dedup mark then `open_calendar_deletion_exception`; everything else → mark with outcome, move on. A per-event throw is caught, logged to `sync_log` (`direction: 'google_to_supabase'` — **see Step 5's constraint note**), and does not abort the sibling events.

`processNotification(deps, headers)`: extract → look up `calendar_watch_channels` by `channel_id` → missing/`expired`/`renewal_failed` or SHA-256(token) ≠ `token_hash` → log + return (index.ts still 200s). `active`/`superseded` accepted (`superseded` = overlap window). Stamp `last_notification_at`. `resourceState === 'sync'` → done. Else → `reconcileCalendar` for that channel's calendar.

`maintainChannels(deps)`: for each configured calendar with no `active` channel or one expiring within 24 h — generate `channelId` (`lbd-<calendarKey>-<random>`, ≤64 chars) + token (random UUID), **register the new watch first**; on success mark the old row `superseded`, insert the new row `active` (with the response's `resourceId` and `expiration`), then `stopWatch` the old channel (a stop failure is logged, not fatal — the old channel expires on its own and `superseded` rows still accept notifications). On registration failure: old row (if any) → `renewal_failed` + `last_error`, `job_alerts` per scheduled job on that calendar, `sync_log` error. Token hashing: `crypto.subtle.digest("SHA-256", ...)` hex.

`runMaintenance(deps)`: `maintainChannels` → `reconcileCalendar` over all five calendars (the fallback poll) → prune marks older than 30 days. Returns a summary object (channels renewed/failed, events applied/skipped/deleted, marks pruned) for the cron response body.

- [ ] **Step 4: Implement `index.ts`**

Keep the spike's route split and always-200 discipline, now with a supabase service-role client (mirror `integration-dispatcher/index.ts`'s env surface). Google notification path: `try { await processNotification(deps, req.headers) } catch (e) { console.error(...) } return json(200, { received: true })`. Admin path (secret-gated, `GHL_WEBHOOK_SECRET`): `ping` (config presence), `maintain` (→ `runMaintenance`, returns its summary), `register`/`stop` (kept as manual operator tools, now writing/updating the registry). `webhookAddress` computed as `` `${SUPABASE_URL}/functions/v1/google-calendar-webhook` ``.

- [ ] **Step 5: `sync_log` direction constraint check**

`sync_log.direction` has a live CHECK allowing only `'ghl_to_airtable' | 'airtable_to_ghl' | 'ghl_to_supabase' | 'supabase_to_slack' | 'app_to_ghl'` — **`google_to_supabase` is not in it.** The Lane S migration `20260824150000` must widen the constraint (drop + re-add with the new value, exactly how `phase_a_audit_write_fixups` and `widen_sync_log_match_method` did it), and this lane's tests pin the direction string. *This is a cross-lane fact both lanes must honor: Lane S owns the migration line, Lane F owns the string.* (Phase A shipped a live 400 by missing exactly this; it is called out here so neither lane rediscovers it.)

- [ ] **Step 6: Run the suite**

`deno test --allow-all supabase/functions/google-calendar-webhook/` → all cases pass. Then the full `deno task test` → green, golden-321 intact.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/google-calendar-webhook supabase/functions/_shared/google.ts
git commit -m "feat: inbound Google Calendar sync — channel lifecycle, revision-guarded date writes, deletion exceptions"
```

---

### Task 3 (Lane W): `resolveDeletedCalendarEvent` server action + minimal exceptions UI

**Files:**
- Create: `web/src/lib/jobs/exceptionActions.ts`
- Create: `web/src/lib/jobs/__tests__/exceptionActions.test.ts`
- Create: `web/src/app/(app)/jobs/exceptions/page.tsx`
- Create: `web/src/app/(app)/jobs/exceptions/ResolveExceptionForm.tsx`

**Interfaces:**
- Consumes: `resolve_schedule_exception` (Task 1's exact signature + byte-pinned raise texts 1–8), `createAdminClient` from `@/lib/supabase/admin`, `useEstimator()` picker identity (no-login model: `p_actor` always `null`, `p_actor_name` = picker name).
- Produces: `resolveDeletedCalendarEvent(input): Promise<ResolvedException>` (the v2 spec's exact exported name), `listOpenScheduleExceptions(): Promise<OpenScheduleException[]>`, `classifyResolveError(message): ResolveExceptionErrorCode` — plus the `/jobs/exceptions` page.
- ⚠️ **Deviation from the v2 signature:** the spec's input keys on `jobNumber`; this plan keys on `exceptionId` (+ `actorName`, absent from the spec's input but required by the audit contract). A job can hold two open exceptions at once (main and crew events deleted separately — the partial unique index is per `(job_number, external_event_id)`), so `jobNumber` alone is ambiguous; the exception id names exactly the row being resolved. Recorded here rather than silently changed.

- [ ] **Step 1: Write the failing vitest suite**

Mirror `scheduleActions.ts`'s structure and its test file's style. Cases: Zod rejects a non-UUID `exceptionId`, blank reason, unknown resolution, `reschedule` without dates, `endDate < startDate`; `classifyResolveError` routes each pinned raise text (`not found` → `not_found`, `is not open` → `not_open`, `invalid resolution`/`reason is required`/`requires startDate`/`must be on or after`/`actor name` → `invalid_input`, `no longer scheduled` → `not_resolvable`, `cancel_scheduled_job`'s `cannot be cancelled` → `not_resolvable`, anything else → `other`); a successful RPC round-trip normalizes the returned jsonb; RPC error → typed `ResolveExceptionError`. Run `cd web && npx vitest run src/lib/jobs/__tests__/exceptionActions.test.ts` — expected FAIL.

- [ ] **Step 2: Implement `exceptionActions.ts`**

`"server-only"` module, house pattern from `scheduleActions.ts` verbatim (inline Zod, typed error class, lowercased-substring classifier, admin client RPC call):

```ts
export interface ResolveDeletedCalendarEventInput {
  exceptionId: string;                 // uuid
  resolution: "reschedule" | "postponed" | "closed_lost" | "dismiss";
  reason: string;                      // nonblank
  actorName: string;                   // picker name, nonblank
  startDate?: string;                  // required iff resolution === "reschedule"
  endDate?: string;
}

export type ResolveExceptionErrorCode =
  | "not_found" | "not_open" | "not_resolvable" | "invalid_input" | "other";
```

Zod `superRefine`: `reschedule` requires both ISO dates with `endDate >= startDate`. RPC call: `admin.rpc("resolve_schedule_exception", { p_exception_id, p_resolution, p_reason, p_start_date: startDate ?? null, p_end_date: endDate ?? null, p_actor: null, p_actor_name })`. `listOpenScheduleExceptions()` selects open `job_schedule_exceptions` joined shape (id, job_number, external_event_id, previous_schedule, opened_at) ordered `opened_at desc`.

- [ ] **Step 3: Build the minimal UI**

`page.tsx`: server component, `listOpenScheduleExceptions()`, renders each exception as a card (job number, previous schedule dates + crew from `previous_schedule` jsonb, opened-at) with a `ResolveExceptionForm`. Empty state: "No open schedule exceptions." `ResolveExceptionForm.tsx`: client component, resolution radio (four options with one-line explanations — reschedule shows date inputs; postponed notes "returns GHL to Quote Accepted"; closed lost notes "moves GHL to Closed Lost"; dismiss notes "recreates the calendar event as scheduled"), reason textarea, submits a server action wrapping `resolveDeletedCalendarEvent` with the picker name, renders the classified error message on failure. Match the existing `(app)` styling (Tailwind, mobile-first — same patterns as `estimates/[id]/schedule`). No pricing appears anywhere on this page (it renders dates, crew, job number only).

- [ ] **Step 4: Run the suites**

`cd web && npx vitest run` → green (556 + new), `npm run build` → green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/jobs/exceptionActions.ts web/src/lib/jobs/__tests__/exceptionActions.test.ts \
  'web/src/app/(app)/jobs/exceptions'
git commit -m "feat: schedule-exception resolution action and queue page"
```

---

### Task 4 (Serial tail): Reviews, runbook cycle, prod apply, deploy, live probe

- [ ] **Step 1: Adversarial Opus reviews** — one per lane (SQL logic + live-DB read-only; function; web), run concurrently with any still-open sibling fix rounds, then fix rounds until APPROVE. Reviewers do not run the full suite mid-flight and do not report on files outside their lane.
- [ ] **Step 2: Full branch validation** — fresh disposable branch if the SQL changed after Step 1's fix rounds (runbook cycle re-run, RED/GREEN recorded); full suites `deno task test` + `cd web && npx vitest run` + `npm run build`; golden-321 intact.
- [x] **Step 3 (Matt approval required): apply to production** — DONE 2026-08-25 (head `20260825171051`, 38 applied; server-side secret substitution; assertions + row counts + advisors clean; disposable branch was already deleted in Session 6).
- [x] **Step 4 (Matt approval required): deploy** `google-calendar-webhook` via the two-command invariant — DONE 2026-08-25 (v2, `verify_jwt=false` read back; `ghl-job-webhook` v20 + `integration-dispatcher` v1 shas undisturbed):

```bash
supabase functions deploy google-calendar-webhook --project-ref eiqqqwajmcpcwhvxxnhx --no-verify-jwt
supabase functions list --project-ref eiqqqwajmcpcwhvxxnhx
```

Readback: `verify_jwt=false` for `google-calendar-webhook`, AND `ghl-job-webhook` + `integration-dispatcher` undisturbed (sha unchanged on any cosmetic version bump).

- [~] **Step 5: Live probe — PARTIAL 2026-08-25** (legs 1, 2, and early echo termination PROVEN LIVE — estimate 1428 → JOB-1106, Crew 4, 2026-12-22→23, `SLACK_TEST_CHANNEL_OVERRIDE` route; legs 3, 5, 6 remain and open the next session) (production, TEST-labeled, far-future dates per the JOB-1105 precedent; prerequisites per plan decision 9 — Slack bot invited or `SLACK_TEST_CHANNEL_OVERRIDE` set):
  1. `action=maintain` via secret-POST → five `active` registry rows, `sync` notifications logged, `last_notification_at` stamped.
  2. Schedule a TEST estimate (≥1428 burn awareness: use the next number knowingly) → JOB-XXXX → dispatcher creates both events.
  3. **Inbound apply:** Matt drags/edits the main-calendar event's dates in the Google Calendar UI → within seconds, `exists` notification → `jobs.start_date/end_date` updated, revision bumped, mirrored `job.scheduled` delivered on the next cron tick (crew event dates updated; Slack message lands per prerequisite).
  4. **Stale guard:** verified implicitly by the echo chain terminating (no infinite mirror loop — watch `calendar_inbound_marks` and outbox row counts go quiet).
  5. **Deletion:** Matt deletes the crew-calendar event → exception row + alert open, job untouched; resolve via `/jobs/exceptions` with `dismiss` → event recreated. Then resolve teardown: `closed_lost` cancel (NOT `postponed` — legacy-minting hazard), cleanup per the 5A probe's checklist, re-cancel raise check.
  6. Read function logs (not just HTTP bodies) for every leg — the 5A lesson: probe the integration's state, not just our tables.
- [ ] **Step 6: Land the session** — BUILD_LOG entry (verbatim runbook records, probe transcript), CLAUDE.md function-table + `NEXT_SESSION_PROMPT.md` updates, commit docs. 5B gates separately from the phase gate (deviation 5); Task 7 of the phase plan (whole-branch review → E2E → flag flip) remains next.

## Risk flags

- **The R11 resurrect window:** if a `job.scheduled` retry is pending when a human deletes an event, the dispatcher's 404-fallback recreates it before Dane resolves the exception. Narrow (requires a pending outbox row at deletion time), self-announcing (the recreated event is visible), accepted — noted so a reviewer doesn't re-derive it.
- **Notification burst behavior:** Google may coalesce or repeat notifications; correctness never depends on notification count (fetch-and-compare + RPC guards + dedup marks), only latency does.
- **Timed-event conversion:** a human converting an all-day event to a timed event makes dates unreadable; the comparator skips + logs rather than guessing. If it happens in practice, it becomes a reconciliation-visible anomaly, not silent drift.
- **`estimate_number` burn:** the probe consumes one estimate number; the "first real estimate" floor moves accordingly and must be recorded in the BUILD_LOG entry.

## Verification summary

- pgTAP on branch: the full Task 1 suite RED → GREEN, recorded verbatim.
- Deno: the 14 Task 2 cases + full `deno task test` (golden-321 intact).
- Web: Task 3 suite + full vitest + `npm run build`.
- Live probe: Task 4 Step 5's six legs, with function-log verification.
- The v2 gate text's inbound clauses ("edit dates in both directions", "simulate deletion and resolve it") become executable at the Phase 1 gate once this slice is live.

## Explicitly out of scope

GHL date-field projection (v2 Task 15); Slack delivery of alerts (v2 Task 12); the full jobs dashboard including exception surfacing there (v2 Task 6); `postponed` live probing (post-gate, legacy-minting hazard); orphaned-event cleanup on crew reassignment (pre-existing R11 note); `calendar_inbound_marks` retention beyond the 30-day prune.
