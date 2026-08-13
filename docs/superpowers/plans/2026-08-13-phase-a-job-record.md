# Phase A — Job Record (Keystone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking. On approval, first copy this plan to `docs/superpowers/plans/2026-08-13-phase-a-job-record.md` in the repo.

## Execution Model (Matt, 2026-08-13)

- **Main session = adviser/orchestrator only.** Writes no code, runs no implementation. Dispatches, reviews reports, resolves questions, talks to Matt.
- **Implementation: one fresh subagent per task, `model: sonnet`** (Agent tool), given the task's full text from this plan plus the Global Constraints section — tasks are written to be self-contained for zero-context workers.
- **Review: adversarial reviewer per task, `model: opus`** (per superpowers:requesting-code-review / the two-stage review in subagent-driven-development). Reviewer is prompted to REFUTE: find correctness bugs, constraint violations (parity rule, sync_log constraint, key-format rules), and untested claims. Findings go back to a fresh Sonnet implementer; task is not checked off until the Opus reviewer passes it and its verification steps have actually run.
- **Deploys** (Supabase MCP) and **live verification** are executed by the implementer subagents; the orchestrator confirms parity (`list_edge_functions` vs repo) at each gate.
- Matt checkpoints: after Task 1 (schema), after Task 4 (before Slack secrets point at real crew channels), and at Task 6 (GHL workflow wiring + the Dane/Jackson habit conversation).

**Goal:** Create the canonical Postgres job record with `JOB-XXXX` as the universal key, minted when a GHL opportunity moves to Quote Accepted, propagating to GHL, Google Calendar, Slack, and (gated) BILL.

**Architecture:** One new edge function `ghl-job-webhook` receives GHL workflow webhooks for two stage moves (Quote Accepted → create job; Job Scheduled → calendar + Slack + BILL code). Postgres mints job numbers via a sequence. A `_shared/` module holds helpers lifted from proven deployed functions. Existing Airtable-triggered functions are untouched (parallel running).

**Tech Stack:** Supabase Postgres + Deno/TypeScript edge functions (project `eiqqqwajmcpcwhvxxnhx`), GHL REST API v2021-07-28, Google Calendar API (service-account JWT), Slack `chat.postMessage`, BILL Spend & Expense v3 (gated), pg_cron.

**Spec:** `BUILD_PLAN.md` → "Revised phases (2026-07-31)" → Phase A, plus two decisions made by Matt 2026-08-13: (1) trigger = GHL stage move to Quote Accepted; (2) job name format = `JOB-XXXX – Client – City` (client = company name for businesses else last name; city segment omitted if unparseable).

## Global Constraints

- Supabase project: `eiqqqwajmcpcwhvxxnhx`. Anything deployed MUST be committed to the repo in the same session (CLAUDE.md parity rule).
- Job number format: `JOB-` + integer, sequence starts at **1100**. Canonical validator regex: `/^JOB-\d{4,}$/`.
- Job name format: `JOB-1100 – Morrison – Holladay` (en dash ` – ` separators, exactly).
- `sync_log.action_taken` MUST be one of `'created' | 'updated' | 'skipped' | 'error'` (DB check constraint).
- Never put success narration in `sync_log.error_message` (existing functions do; do not propagate).
- Webhook auth: compare `x-webhook-secret` header to `GHL_WEBHOOK_SECRET` env var; 401 on mismatch.
- Do NOT modify any deployed Airtable-triggered function.
- GHL API: base `https://services.leadconnectorhq.com`, headers `{ Authorization: Bearer ${GHL_API_KEY}, Version: '2021-07-28' }`. Opportunity ID extraction must handle both response shapes: `resp.opportunity?.id ?? resp.id`.
- All new code writes `job_events.job_number` (JOB-XXXX); never write `job_events.job_id` (legacy column holding Airtable rec IDs).
- Deno tests live next to sources as `*_test.ts`, run with `deno test`.
- End every commit message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- End of session: append `BUILD_LOG.md` entry, update `CLAUDE.md`, regenerate `NEXT_SESSION_PROMPT.md`.

---

### Task 0: Session doc updates (pre-build, separate commit)

**Files:**
- Modify: `BUILD_LOG.md` (new entry at top of *Entries*, after line 36)
- Modify: `CLAUDE.md:43`

**Interfaces:** none (docs only).

- [ ] **Step 1: Add BUILD_LOG.md entry** at the top of the Entries section:

```markdown
### 2026-08-13 — Status review; Aug-11 sync error burst analyzed; Phase A decisions taken
**Status:** 🟢 Complete · **Deploys:** none (review + planning only)

Live verification 13 days after the discovery session: repo clean and synced, function versions
unchanged (19/20/21/16/14/11/11). `sync_log` 668 → **918** rows, daily traffic. Estimates
296 → **321** (~2/business day). Jobs still **9** — zero job records created in ~12 weeks. All
actuals tables still 0 rows. The 321-estimates-to-9-jobs gap is the Phase A problem, measured.

**New defect, self-healed — CLAUDE.md's "no errors since May 2" is stale.** 14 sync errors on
2026-08-11 18:29:36 ("Airtable create returned no record ID") during a 156-record burst day
(~8/day is normal). All 14 contacts recovered within 5 minutes and have both Airtable and GHL IDs —
no data loss. Likely Airtable rate-limiting under bulk load, rescued by GHL webhook redelivery.
`airtable-client-sync` has no explicit retry/backoff; a larger bulk import could drop records less
gracefully. CLAUDE.md line corrected this session.

**Phase A decisions (Matt, 2026-08-13):**
- **Trigger = GHL stage move.** Opportunity → "Quote Accepted" mints the job record. Path B jobs
  must also get an opportunity staged in GHL — behavioral, restate to Dane.
- **Job name = `JOB-XXXX – Client – City`** (company name for businesses, else last name).

Phase A implementation plan written and approved; build follows in next entry.
```

- [ ] **Step 2: Fix CLAUDE.md line 43.** Replace:

```
`ghl-contact-sync`). 668 rows in `sync_log`, processing traffic daily, no errors since May 2.
```

with:

```
`ghl-contact-sync`). 918 rows in `sync_log`, processing traffic daily. One transient error burst
2026-08-11 (14 Airtable-create failures under bulk load, all self-healed within 5 minutes, no data
loss); no retry/backoff exists, so treat bulk imports with care.
```

- [ ] **Step 3: Commit**

```bash
git add BUILD_LOG.md CLAUDE.md
git commit -m "docs: log 2026-08-13 status review; correct stale sync-health claim

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: Migration — canonical `jobs` schema, sequence, RLS

**Files:**
- Create: `supabase/migrations/20260813T1_phase_a_jobs_keystone.sql` (timestamp per convention `YYYYMMDDHHMMSS` at creation time)

**Interfaces:**
- Produces: `public.jobs` columns consumed by Tasks 3–5: `id uuid PK`, `job_number text UNIQUE`, `job_name text`, `client_name text`, `client_type text`, `job_address text`, `city text`, `ghl_opportunity_id text UNIQUE NOT NULL`, `ghl_contact_id text`, `estimate_value numeric`, `crew text`, `start_date date`, `end_date date`, `status job_status`, `gcal_main_event_id text`, `gcal_crew_event_id text`, `slack_notified_at timestamptz`, `night_before_sent_on date`, `bill_job_code text`, `created_at`, `updated_at`.
- Produces: function `public.next_job_number() RETURNS text` → `'JOB-1100'`, `'JOB-1101'`, …

- [ ] **Step 1: Write the migration SQL** (apply via `mcp__claude_ai_Supabase__apply_migration`, save identical content to the repo file):

```sql
-- Phase A keystone: canonical job record. Evolves public.jobs in place.
-- Existing 7 rows are May-2026 test mirrors (FK target for empty time_entries); archived below.

-- 1. Archive legacy mirror rows, keep the table
create table if not exists jobs_legacy_backup as select * from jobs;
delete from jobs;

-- 2. Job-number sequence. Airtable's autonumber is at ~JOB-1012 and mints ~3/month;
--    1100 leaves ~87 numbers of headroom for parallel running with zero collision risk.
create sequence if not exists job_number_seq start 1100;
create or replace function next_job_number() returns text
language sql as $$ select 'JOB-' || nextval('job_number_seq')::text $$;

-- 3. Status enum for the new lifecycle
do $$ begin
  create type job_status as enum
    ('accepted','scheduled','in_progress','completed','invoiced','paid','cancelled');
exception when duplicate_object then null; end $$;

-- 4. Reshape jobs. Old columns airtable_job_id/airtable_status/estimated_hours/
--    job_start_date/archived_at kept for now (legacy readers); new canonical columns added.
alter table jobs
  add column if not exists job_number text unique,
  add column if not exists client_name text,
  add column if not exists client_type text,
  add column if not exists job_address text,
  add column if not exists city text,
  add column if not exists ghl_opportunity_id text unique,
  add column if not exists ghl_contact_id text,
  add column if not exists estimate_value numeric,
  add column if not exists crew text,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists status_v2 job_status,
  add column if not exists gcal_main_event_id text,
  add column if not exists gcal_crew_event_id text,
  add column if not exists slack_notified_at timestamptz,
  add column if not exists night_before_sent_on date,
  add column if not exists bill_job_code text,
  add column if not exists updated_at timestamptz default now();

-- 5. Key-format guard (canonical validator, DB-side)
alter table jobs add constraint jobs_job_number_format
  check (job_number is null or job_number ~ '^JOB-\d{4,}$');

-- 6. RLS — jobs was missed by the 2026-07-30 security sweep
alter table jobs enable row level security;
alter table jobs_legacy_backup enable row level security;

-- 7. Legacy-semantics documentation
comment on column job_events.job_id is
  'LEGACY: holds Airtable recXXX IDs (written by airtable-* functions). New code writes job_number only.';
```

- [ ] **Step 2: Verify** via `mcp__claude_ai_Supabase__execute_sql`:

```sql
select next_job_number();                            -- expect JOB-1100
select count(*) from jobs;                           -- expect 0
select count(*) from jobs_legacy_backup;             -- expect 7
select relrowsecurity from pg_class where relname='jobs';  -- expect true
```
Also confirm anon-key access returns 0 rows (same check pattern as the 2026-07-30 sweep).
Note: `next_job_number()` was consumed once by verification — expect JOB-1101 next. Acceptable gap; do NOT reset the sequence.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: Phase A migration — canonical jobs schema, JOB-XXXX sequence, RLS

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `_shared/` module with unit-tested pure helpers

**Files:**
- Create: `supabase/functions/_shared/google.ts` — lift verbatim from `supabase/functions/airtable-job-scheduled/index.ts:141-235`: `pemToArrayBuffer`, `base64urlEncode`, `getGoogleAccessToken(serviceAccountJson: string): Promise<string>`, `createCalendarEvent(calendarId, accessToken, eventBody)`, `addOneDay(date: string): string`, `formatCurrency(n)`. Keep the `\\n`-unescape guard and 30s clock-skew backdate. Export all.
- Create: `supabase/functions/_shared/job.ts` — new pure functions (below).
- Create: `supabase/functions/_shared/job_test.ts`
- Create: `supabase/functions/_shared/log.ts` — `writeSyncLog(supabase, entry)` and `writeJobEvent(supabase, event)` wrappers; each swallows its own errors (log failure must not 500 the handler — same pattern as `airtable-job-scheduled/index.ts:507-522`).

**Interfaces:**
- Produces (job.ts):
  - `isValidJobNumber(s: string): boolean` — regex `/^JOB-\d{4,}$/`
  - `parseCity(address: string | null | undefined): string | null` — extracts city from a US street address
  - `clientLabel(opts: {companyName?: string|null, firstName?: string|null, lastName?: string|null}): string` — company name if present, else last name, else first name, else `'Client'`
  - `buildJobName(jobNumber: string, client: string, city: string | null): string` — `` `${jobNumber} – ${client}${city ? ` – ${city}` : ''}` ``
- Produces (log.ts): `writeSyncLog(supabase, {direction, trigger_event, action_taken, status, error_message?, payload_in?})`, `writeJobEvent(supabase, {job_number, stage_from, stage_to, function_name, trigger_source, ghl_opportunity_id?, action_summary, status, error_message?, payload_in?})`

- [ ] **Step 1: Write failing tests** in `supabase/functions/_shared/job_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isValidJobNumber, parseCity, clientLabel, buildJobName } from "./job.ts";

Deno.test("job number validation", () => {
  assertEquals(isValidJobNumber("JOB-1100"), true);
  assertEquals(isValidJobNumber("JOB-10000"), true);   // 5 digits must pass
  assertEquals(isValidJobNumber("JOB-999"), false);
  assertEquals(isValidJobNumber("rec9AOlcpomOjzDNP"), false);
  assertEquals(isValidJobNumber("job-1100"), false);
});

Deno.test("city parsing", () => {
  assertEquals(parseCity("4285 S 300 W, Murray, UT 84107"), "Murray");
  assertEquals(parseCity("123 Main St, Salt Lake City, UT"), "Salt Lake City");
  assertEquals(parseCity("123 Main St Holladay UT 84117"), "Holladay"); // no commas: token before state
  assertEquals(parseCity("Holladay"), "Holladay");                      // bare city
  assertEquals(parseCity(""), null);
  assertEquals(parseCity(null), null);
});

Deno.test("client label precedence", () => {
  assertEquals(clientLabel({companyName: "Sunline Landscape", lastName: "Smith"}), "Sunline Landscape");
  assertEquals(clientLabel({firstName: "Ann", lastName: "Morrison"}), "Morrison");
  assertEquals(clientLabel({firstName: "Ann"}), "Ann");
  assertEquals(clientLabel({}), "Client");
});

Deno.test("job name format", () => {
  assertEquals(buildJobName("JOB-1100", "Morrison", "Holladay"), "JOB-1100 – Morrison – Holladay");
  assertEquals(buildJobName("JOB-1101", "Sunline Landscape", null), "JOB-1101 – Sunline Landscape");
});
```

- [ ] **Step 2: Run to verify failure.** `cd supabase/functions/_shared && deno test job_test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Implement `job.ts`:**

```ts
export function isValidJobNumber(s: string): boolean {
  return /^JOB-\d{4,}$/.test(s);
}

const STATE_TOKEN = /^(UT|Utah)\.?,?$/i;

export function parseCity(address: string | null | undefined): string | null {
  if (!address?.trim()) return null;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // "street, city, state zip" → second-to-last segment unless it's the state itself
    const candidate = parts.length >= 3 ? parts[parts.length - 2] : parts[1];
    const cleaned = candidate.replace(/\s+(UT|Utah)\.?(\s+\d{5}(-\d{4})?)?$/i, "").trim();
    return cleaned || null;
  }
  // No commas: take tokens before a state token, drop leading street-number/name heuristically
  const tokens = parts[0].split(/\s+/);
  const stateIdx = tokens.findIndex((t) => STATE_TOKEN.test(t));
  if (stateIdx > 0) {
    // walk back from state collecting capitalized tokens that aren't obviously street words
    const cityTokens: string[] = [];
    for (let i = stateIdx - 1; i >= 0; i--) {
      const t = tokens[i];
      if (/^\d/.test(t) || /^(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Ct|Way|Pl|S|N|E|W)\.?$/i.test(t)) break;
      cityTokens.unshift(t);
    }
    return cityTokens.length ? cityTokens.join(" ") : null;
  }
  return tokens.length <= 3 ? parts[0] : null; // bare city name
}

export function clientLabel(opts: {
  companyName?: string | null; firstName?: string | null; lastName?: string | null;
}): string {
  return opts.companyName?.trim() || opts.lastName?.trim() || opts.firstName?.trim() || "Client";
}

export function buildJobName(jobNumber: string, client: string, city: string | null): string {
  return `${jobNumber} – ${client}${city ? ` – ${city}` : ""}`;
}
```

- [ ] **Step 4: Run tests to verify pass.** `deno test job_test.ts` — expect PASS (iterate on `parseCity` until all cases pass; if a case proves unreasonable, adjust the test with a comment, not silently).

- [ ] **Step 5: Create `google.ts` (verbatim lift) and `log.ts`.** `log.ts`:

```ts
// Both writers swallow their own errors: logging failure must never 500 a handler.
export async function writeSyncLog(supabase: any, entry: {
  direction: string; trigger_event: string;
  action_taken: "created" | "updated" | "skipped" | "error";
  status: "success" | "error"; error_message?: string | null; payload_in?: unknown;
}) {
  try { await supabase.from("sync_log").insert(entry); }
  catch (e) { console.error("[log] sync_log insert failed:", e); }
}

export async function writeJobEvent(supabase: any, event: {
  job_number: string | null; stage_from: number | null; stage_to: number;
  function_name: string; trigger_source: string; ghl_opportunity_id?: string | null;
  action_summary: string; status: "success" | "error" | "skipped";
  error_message?: string | null; payload_in?: unknown;
}) {
  try { await supabase.from("job_events").insert(event); }
  catch (e) { console.error("[log] job_events insert failed:", e); }
}
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/
git commit -m "feat: _shared module — job naming/validation (tested), Google auth lift, log writers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `ghl-job-webhook` — create path (Quote Accepted)

**Files:**
- Create: `supabase/functions/ghl-job-webhook/index.ts`
- Create: `supabase/functions/ghl-job-webhook/handlers_test.ts` (pure-logic tests)

**Interfaces:**
- Consumes: Task 1 `next_job_number()`, `jobs` columns; Task 2 `buildJobName`, `clientLabel`, `parseCity`, `writeSyncLog`, `writeJobEvent`.
- Produces: HTTP endpoint `POST /functions/v1/ghl-job-webhook` with body `{event: "quote_accepted" | "job_scheduled", opportunityId: string}` (the GHL workflow webhook is configured in Task 6 to send this shape; actual GHL payload fields are mapped in the workflow's custom-data config so the function owns its own contract rather than GHL's).
- Produces (for Task 4): `handleQuoteAccepted(deps, opportunityId)` and the module's cold-start `resolvePipeline()` cache.

**Design notes for the implementer:**
- Cold start: GET `/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`, find pipeline `'Job Pipeline'`. **List all live stage names in the logs.** Resolve stage IDs for names matching (case-insensitive, substring) `'Quote Accepted'` and `'Job Scheduled'` — a May 2026 error log shows live names like "Deposit Received/Job Scheduled", so match by substring and log exactly what matched. If either stage cannot be resolved, set a `STARTUP_ERROR` string and 500 with it at request time (pattern: `airtable-job-created/index.ts:94-127`).
- Fetch opportunity: GET `/opportunities/${id}`. Fetch its contact: GET `/contacts/${contactId}`. Pull `companyName`, `firstName`, `lastName` from the contact; job address from the opportunity custom field `Job Address` (ID in `field_mapping.md`) falling back to contact address; `monetaryValue` → `estimate_value`.
- Idempotency: `select id, job_number from jobs where ghl_opportunity_id = $1` first; if present, respond 200 `{action:'skipped', job_number}` and `writeSyncLog(action_taken:'skipped')`. Only then mint.
- Mint + insert in one statement so a crash can't leak numbers separately from rows:

```sql
insert into jobs (job_number, job_name, client_name, client_type, job_address, city,
                  ghl_opportunity_id, ghl_contact_id, estimate_value, status_v2)
values (next_job_number(), $1, $2, $3, $4, $5, $6, $7, $8, 'accepted')
returning id, job_number;
```
(Build `job_name` before insert by pre-reading `nextval`? No — insert with a placeholder name is worse. Do: `select next_job_number()` then insert with that number and the built name; the UNIQUE constraint on `ghl_opportunity_id` makes a duplicate race lose cleanly — catch unique-violation and re-read the existing row, respond `skipped`.)
- After insert: PUT the GHL opportunity — `name` = job name, and custom field `Gtl6ADpbBGOlYYFil4n6` (existing "Airtable Job ID" field, reused as the job-number field) = job number. GHL write failure is non-fatal: job row stays, log `status:'error'` detail, respond 200 with `ghl_update: 'failed'` (retry lands via idempotent re-fire).
- `writeJobEvent({job_number, stage_from: null, stage_to: 5, function_name: 'ghl-job-webhook', trigger_source: 'ghl_workflow', ...})` and `writeSyncLog(direction: 'ghl_to_supabase', trigger_event: 'quote_accepted', action_taken: 'created', status: 'success', payload_in: <request body>)`.
- Auth: `x-webhook-secret` vs `GHL_WEBHOOK_SECRET`, 401 on mismatch (secret already exists in Supabase env).

- [ ] **Step 1: Write failing tests** for the request-validation + body-mapping pure functions (extract `parseWebhookBody(json): {event, opportunityId} | {error}` and test valid/missing/unknown-event bodies in `handlers_test.ts`).
- [ ] **Step 2: Run tests — expect FAIL.** `deno test supabase/functions/ghl-job-webhook/`
- [ ] **Step 3: Implement the function** per design notes (structure mirrors `airtable-job-created/index.ts`: module-scope env consts, cold-start resolution, big try/catch, mutable `actionTaken/status/errorMessage`, per-integration nested try/catch).
- [ ] **Step 4: Run tests — expect PASS.**
- [ ] **Step 5: Deploy** via `mcp__claude_ai_Supabase__deploy_edge_function` (`verify_jwt: false`, consistent with the fleet — auth is the secret header).
- [ ] **Step 6: Live-verify create path** with curl against a real GHL test opportunity ID (create one in GHL UI or via API on the test contact "Test Client" `Rp59SoK4lW88TjTkAr5N`):
  - POST with correct secret + `{event:'quote_accepted', opportunityId}` → expect 200, `jobs` row with `JOB-11xx`, standardized name, GHL opp renamed in UI, custom field set, `job_events` + `sync_log` rows correct.
  - POST again → `{action:'skipped'}`, no second row.
  - POST with wrong secret → 401, nothing written.
- [ ] **Step 7: Commit** (same session as deploy — parity rule):

```bash
git add supabase/functions/ghl-job-webhook/
git commit -m "feat: ghl-job-webhook create path — mint JOB-XXXX on Quote Accepted (v1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `ghl-job-webhook` — schedule path (Job Scheduled)

**Files:**
- Modify: `supabase/functions/ghl-job-webhook/index.ts` (add `handleJobScheduled`)
- Modify: `supabase/functions/ghl-job-webhook/handlers_test.ts`

**Interfaces:**
- Consumes: Task 2 `getGoogleAccessToken`, `createCalendarEvent`, `addOneDay`; Task 3's opportunity-fetch helpers; `jobs` row from create path.
- Produces: calendar events (main + crew), Slack crew message, optional BILL job code; `jobs` updates: `crew`, `start_date`, `end_date`, `status_v2='scheduled'`, `gcal_main_event_id`, `gcal_crew_event_id`, `slack_notified_at`, `bill_job_code`.

**Design notes:**
- Guard: job row must exist for `ghl_opportunity_id` (else 200 `{action:'skipped', reason:'no job record — was Quote Accepted skipped?'}`). Crew + Start Date custom fields must be populated on the opportunity (else `skipped` with reason `'crew or start date not set'` — this is the explicit scheduled-but-unassigned state).
- Idempotency: if `gcal_main_event_id` already set → skip calendar creation; if `slack_notified_at` set → skip Slack; each leg independently resumable (fixes the old single-ID limitation).
- Calendar: title = **full job name** (`JOB-1100 – Morrison – Holladay`), all-day `start_date`→`addOneDay(end_date || start_date)`, description block (client, estimate value, crew, address, phone, start time; NO scope section — line items arrive in Phase B). Main calendar (`GOOGLE_CALENDAR_MAIN`) + crew calendar via map `{'crew 1': GOOGLE_CALENDAR_CREW1, ...}` (pattern: `airtable-job-scheduled/index.ts:64`). `Promise.allSettled`; persist BOTH event IDs.
- Slack: POST `https://slack.com/api/chat.postMessage`, bearer `SLACK_BOT_TOKEN` (already in secrets), `channel` from new secrets `SLACK_CREW1_CHANNEL`..`SLACK_CREW4_CHANNEL`. Message:

```
🏗️ New job scheduled: JOB-1100 – Morrison – Holladay
📅 Thu Aug 20 · 🕗 8:00 AM
📍 4285 S 300 W, Murray
👤 Ann Morrison · 📞 (801) 555-0100
```
Working call pattern: `airtable-job-completed/index.ts:403-435` (`slackData.ok === true`, non-fatal try/catch).
- BILL (gated): if `BILL_API_TOKEN` env is absent → log `skipped`, continue. If present: ensure custom field "Lost Boys Job ID" exists (`POST /v3/spend/custom-fields`, `CUSTOM_SELECTOR`, `allowCustomValues: true`, idempotent by list-first), add the job name as a value; store `bill_job_code`. (Full BILL edge-case rules live in `INTEGRATION_DESIGN.md` — only field/value creation here, no transaction ingestion; that's Phase C.)
- `writeJobEvent(stage_from: 5, stage_to: 6, ...)`; per-leg status summary in response (`calendar: 'success'|'partial'|'skipped'`, `slack: ...`, `bill: ...`).

- [ ] **Step 1: Write failing tests** for the new pure pieces: crew→channel-env mapping resolver, Slack message builder (given a jobs row, exact expected string), schedule-guard logic (`shouldSkip(job, opp): {skip: boolean, reason?: string}`).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Look up crew Slack channel IDs** via `mcp__claude_ai_Slack__slack_search_channels` (crew channels are in daily use; confirm the 4 with Matt if ambiguous) and set secrets `SLACK_CREW1_CHANNEL`..`SLACK_CREW4_CHANNEL`. For live-verify, point one at a test channel first.
- [ ] **Step 6: Deploy + live-verify**: set Crew + Start Date on the test opportunity, fire `{event:'job_scheduled', ...}` → calendar events on BOTH calendars with correct title, both IDs persisted, Slack message in test channel, row updated to `scheduled`. Re-fire → all legs skip. Fire on an opportunity without crew → clean `skipped` with reason. BILL leg logs `skipped` (no creds yet).
- [ ] **Step 7: Commit** (same session as deploy):

```bash
git add supabase/functions/ghl-job-webhook/
git commit -m "feat: ghl-job-webhook schedule path — calendar, Slack crew notify, gated BILL code (v2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Night-before crew digest (`crew-night-before`)

**Files:**
- Create: `supabase/functions/crew-night-before/index.ts`
- Create: `supabase/migrations/<ts>_schedule_crew_night_before.sql` (pg_cron)

**Interfaces:**
- Consumes: `jobs` rows (`status_v2='scheduled'`, `start_date`, `crew`, `night_before_sent_on`), Slack helpers/secrets from Task 4.
- Produces: daily 16:30 America/Denver digest per crew channel; stamps `night_before_sent_on = start_date` per job (idempotency key).

**Design notes:** Replaces the hand-typed night-before message (the one Zapier used to send unreliably). Query `where status_v2='scheduled' and start_date = (now() at time zone 'America/Denver')::date + 1 and (night_before_sent_on is null or night_before_sent_on <> start_date)`. Group by crew; one message per crew listing its jobs (same line format as Task 4's message, prefixed "⏰ Tomorrow:"). Cron: `select cron.schedule('crew-night-before','30 22 * * *', $$select net.http_post(url:='https://eiqqqwajmcpcwhvxxnhx.supabase.co/functions/v1/crew-night-before', headers:=jsonb_build_object('x-webhook-secret', '<from vault>'))$$);` — 22:30 UTC = 16:30 MDT; NOTE cron is UTC and will drift 1h at DST — add a comment and a winter follow-up, or schedule both 22:30 and 23:30 with the function checking local time (pick the local-time-check approach: cron hourly window, function decides — simpler than seasonal edits). Verify pg_cron + pg_net extensions via `list_extensions` first; secret handling for the cron header goes through Supabase Vault, not a literal in the migration.

- [ ] **Step 1: Failing test** for the digest message builder (given 2 jobs for crew 1 tomorrow, exact expected message) and the date-window predicate (pure function over injected `now`).
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement.** **Step 4: Run — PASS.**
- [ ] **Step 5: Deploy function; apply cron migration; manual live-verify**: seed the test job's `start_date` to tomorrow, invoke the function directly → digest in test channel, `night_before_sent_on` stamped; invoke again → no duplicate.
- [ ] **Step 6: Commit** function + migration.

---

### Task 6: GHL workflow wiring + end-to-end

**Files:** none (GHL configuration) — document in `field_mapping.md` + `CLAUDE.md`.

- [ ] **Step 1:** In GHL, create two workflows: trigger "Opportunity stage changed" → (Quote Accepted | Job Scheduled) → Webhook action POSTing `{event, opportunityId}` (custom data mapping) to the function URL. Custom header `x-webhook-secret` if supported; if GHL workflow webhooks can't set headers, fall back to a `?secret=` query param over HTTPS and adjust the function to accept either (decide at build, document which).
- [ ] **Step 2:** Capture one real fired payload (function logs) and confirm the body contract; adjust `parseWebhookBody` mapping if GHL's custom-data shape differs — update tests to the recorded reality.
- [ ] **Step 3: Full end-to-end** on a fresh test opportunity driven only from the GHL UI: drag to Quote Accepted → job minted + opp renamed; set crew/date, drag to Job Scheduled → calendar + Slack. This is the Phase A acceptance test.
- [ ] **Step 4:** Walk Dane/Jackson's new habit through with Matt (async note is fine): opp → Quote Accepted births the job; crew + dates before → Job Scheduled.

---

### Task 7: Docs close-out + parity check

**Files:**
- Modify: `CLAUDE.md` (new function + secrets in the tables, Phase A status → in progress/complete, edge-function inventory)
- Modify: `BUILD_LOG.md` (build-session entry: versions, deploy URLs, defects found, decisions)
- Modify: `NEXT_SESSION_PROMPT.md` (regenerate)
- Airtable Pipeline Reference base (`appA7uj7FhnPp9Bvg`): add new secrets to Secrets & Credentials, GHL field reuse to Field Registry.

- [ ] **Step 1:** `mcp__claude_ai_Supabase__list_edge_functions` — confirm every deployed version has identical source committed.
- [ ] **Step 2:** Update the three docs + Airtable reference tables.
- [ ] **Step 3: Commit + push.**

---

## Prerequisites / asks (Matt) — needed during execution, none block starting

1. **Slack crew channel IDs** — I'll look up via Slack MCP (Task 4 Step 5); confirm the 4 channels if the search is ambiguous.
2. **BILL API credentials** — only if you want the BILL leg live in Phase A; otherwise it ships gated-off and Phase C turns it on.
3. **GHL workflow access** — Task 6 needs workflows created in the GHL UI (or confirm API access covers it).
4. Tell Dane/Jackson the new habit (Task 6 Step 4).

## Risk flags

- **Adoption**: the trigger bets on Dane/Jackson moving GHL stages, which isn't their habit today. Mitigation: immediate visible payoff (numbered job + calendar + Slack, zero typing) and Track B reinforcing GHL use.
- **GHL webhook payload/headers unverified** — Task 6 Step 2 records reality and adjusts; function contract is deliberately minimal (`event`, `opportunityId`).
- **Live stage names may differ from the documented 13-stage table** — cold start lists and logs them; substring match; confirm with Matt if "Quote Accepted" isn't found.
- **Path B jobs** get records only if an opp is staged in GHL — behavioral.
- **DST** on the night-before cron — handled by local-time check inside the function.

## Out of scope

Time tracking (Phase D — blocked on Matt's separate decision) · estimate line items in GHL/calendar (Phase B) · Stripe/stripe-webhook (Phase E) · Gusto (Phase D) · retiring `receive-airtable-webhook` (separate small task: disable Airtable automations `wflYoupCQ00h2BrVa`/`wfldrRGvkSgRsE3ok` first) · Next.js skeleton.

## Verification (whole-phase)

The Task 6 Step 3 end-to-end from the GHL UI is the acceptance gate. Plus: anon-key reads 0 rows from `jobs`; re-fired webhooks are no-ops at every leg; `job_events`/`sync_log` rows well-formed with `job_number` (never rec IDs); repo/production parity confirmed; docs updated. Execution uses superpowers:subagent-driven-development (or executing-plans), superpowers:test-driven-development per task, and superpowers:verification-before-completion before reporting done.
