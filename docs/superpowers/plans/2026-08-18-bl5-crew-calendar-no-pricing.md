# BL-5 — Strip Pricing from Crew Calendar Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crew Google Calendar events stop carrying the `Estimate: $X` line; the main calendar keeps it — closing the known-and-deliberate violation of BL-4's no-pricing-to-crew-channels rule without disturbing the per-target calendar idempotency.

**Architecture:** `buildCalendarDescription`/`buildCalendarEventBody` gain a **required** `audience: "main" | "crew"` parameter (no default — every future caller must decide, so nobody silently inherits the pricing-bearing form). The schedule leg in `handleJobScheduled` builds one `ScheduleJobInput` and attaches a per-audience body to each entry in the existing `targets` array; the `needsMain`/`needsCrew` gating, error aggregation, and immediate event-ID persistence (I2) are untouched.

**Tech Stack:** Deno/TypeScript edge function, `deno task test` (run from repo root; suite is 312 passing at start).

**Spec:** `BUILD_PLAN.md` → "BL-5 — Strip pricing from crew Google Calendar events (Matt, 2026-08-17)". Decision already made by Matt: strip from **crew** calendars only; keep on **main** (Dane may rely on the at-a-glance number).

## Global Constraints

- 🚨 **No pricing may reach a crew channel** — no total bid, quoted price, markup %, true margin %, hours, or dump counts (BL-4 rule, now extended to crew calendars).
- **Main-calendar output must be byte-identical to today.** This is a crew-side-only change.
- **Do not disturb the per-target event-ID idempotency** (`needsMain`/`needsCrew` gating on `gcal_main_event_id`/`gcal_crew_event_id`, the I2 immediate persist, the C1+C2 per-target gates). It took two Phase A fix rounds to get right.
- **Anything deployed to Supabase is committed in the same session** (repo/production parity rule).
- **Never `git add -A`** — stage explicit paths. Delete nothing without Matt's per-item approval.
- Full suite gate: `deno task test` from repo root → must stay at 312 + new tests, all green. If the run is ever piped, check `PIPESTATUS`.
- **Live-probe the deploy.** Mocks can't see the DB or the real GHL/Google payload shapes — this has bitten twice.
- Out of scope, deliberately: the legacy `airtable-job-scheduled` function also posts an `Estimated Revenue` line to crew calendars, but it is the Airtable-era path (Jobs pipeline is scaffolding, slated for retirement), and touching it forces a same-session redeploy of a legacy live function. BL-5 as specced by Matt names `ghl-job-webhook` only. Flagged here so the omission is a decision, not an oversight.

## File Structure

- Modify: `supabase/functions/ghl-job-webhook/handlers.ts` — the two builders (`:1029-1051`) and the schedule-leg wiring (`:1524-1569`). Only file with code changes.
- Modify: `supabase/functions/ghl-job-webhook/handlers_test.ts` — update 4 existing builder tests (`:1386-1445`), add unit + integration tests.
- Modify at close-out: `BUILD_PLAN.md`, `CLAUDE.md`, `BUILD_LOG.md`, `NEXT_SESSION_PROMPT.md`.

Branch: `bl5-crew-calendar-pricing` off `main` (worktree optional — single lane, no siblings).

---

### Task 1: Audience-aware calendar builders (pure functions + unit tests)

**Files:**
- Modify: `supabase/functions/ghl-job-webhook/handlers.ts:1029-1051`
- Test: `supabase/functions/ghl-job-webhook/handlers_test.ts:1386-1445`

**Interfaces:**
- Produces: `export type CalendarAudience = "main" | "crew"`;
  `buildCalendarDescription(job: ScheduleJobInput, audience: CalendarAudience): string`;
  `buildCalendarEventBody(job: ScheduleJobInput, audience: CalendarAudience): { summary; description; start; end }`.
  Task 2 wires these into the schedule leg. The `audience` parameter is **required** — this is deliberate; do not add a default.

- [ ] **Step 1: Write the failing tests**

Replace/extend the block at `handlers_test.ts:1386-1445`. The two existing `buildCalendarDescription` tests and two `buildCalendarEventBody` tests gain the `"main"` argument with **unchanged expected output** (locks main-calendar byte-identity). Add three new tests:

```ts
Deno.test('buildCalendarDescription: crew audience omits the Estimate line (BL-5)', () => {
  const desc = buildCalendarDescription({
    job_name: "JOB-1100 – Morrison – Holladay",
    client_name: "Ann Morrison",
    job_address: "4285 S 300 W, Murray",
    estimate_value: 4200,
    crew: "Crew 1",
    start_date: "2026-08-20",
    end_date: null,
  }, "crew");
  assertEquals(desc, "Client: Ann Morrison\nCrew: Crew 1\nAddress: 4285 S 300 W, Murray");
});

Deno.test("buildCalendarDescription: crew and main identical when estimate_value is null", () => {
  const input = {
    job_name: "JOB-1100", client_name: "Ann Morrison", job_address: null,
    estimate_value: null, crew: "Crew 1", start_date: "2026-08-20", end_date: null,
  };
  assertEquals(buildCalendarDescription(input, "crew"), buildCalendarDescription(input, "main"));
});

Deno.test('buildCalendarEventBody: crew description carries no "Estimate:" line while main does', () => {
  const input = {
    job_name: "JOB-1100", client_name: null, job_address: null,
    estimate_value: 4200, crew: "Crew 1", start_date: "2026-08-20", end_date: null,
  };
  const main = buildCalendarEventBody(input, "main");
  const crew = buildCalendarEventBody(input, "crew");
  assert(main.description.includes("Estimate: $4,200.00"));
  assert(!crew.description.includes("Estimate:"));
  // Everything except the description is audience-independent.
  assertEquals(main.summary, crew.summary);
  assertEquals(main.start, crew.start);
  assertEquals(main.end, crew.end);
});
```

Update the 4 existing tests in place: `buildCalendarDescription({...}, "main")` / `buildCalendarEventBody({...}, "main")`, expectations unchanged.

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all supabase/functions/ghl-job-webhook/handlers_test.ts --filter "buildCalendar"`
Expected: FAIL — type errors / wrong output (functions don't take an audience yet).

- [ ] **Step 3: Implement**

At `handlers.ts:1029-1051`:

```ts
// BL-5: which calendar this body is for. "crew" omits the Estimate line —
// no pricing may reach a crew channel (same rule as the Slack messages,
// see the scope-summary section below). REQUIRED with no default, so every
// caller must decide rather than silently inheriting the pricing form.
export type CalendarAudience = "main" | "crew";

/** Client, estimate value (main audience only — BL-5), crew, address —
 *  omit any line whose value is null/empty. No scope/line-items section. */
export function buildCalendarDescription(job: ScheduleJobInput, audience: CalendarAudience): string {
  const lines: string[] = [];
  if (job.client_name) lines.push(`Client: ${job.client_name}`);
  if (audience === "main" && job.estimate_value != null) {
    lines.push(`Estimate: ${formatCurrency(job.estimate_value)}`);
  }
  if (job.crew) lines.push(`Crew: ${job.crew}`);
  if (job.job_address) lines.push(`Address: ${job.job_address}`);
  return lines.join("\n");
}

export function buildCalendarEventBody(job: ScheduleJobInput, audience: CalendarAudience): {
  summary: string;
  description: string;
  start: { date: string };
  end: { date: string };
} {
  const effectiveEnd = job.end_date || job.start_date;
  return {
    summary: job.job_name,
    description: buildCalendarDescription(job, audience),
    start: { date: job.start_date },
    end: { date: addOneDay(effectiveEnd) },
  };
}
```

Note: this will make the schedule-leg call at `:1524` a compile error — that is Task 2's edit. For this task's test run, use the `--filter` above (the file won't type-check whole until Task 2, so run Task 1 and Task 2 as one commit if the filter can't dodge the type error — Deno type-checks the whole module, so **expect to need Task 2's edit before the suite compiles**; the failing-test step still proves the tests bite by running them against the pre-change code first).

- [ ] **Step 4: Proceed to Task 2 before the green run** (single-module type-checking means Tasks 1+2 land as one commit; the boundary between them is review-scope, not commit-scope).

### Task 2: Schedule-leg wiring — per-target bodies

**Files:**
- Modify: `supabase/functions/ghl-job-webhook/handlers.ts:1524-1569`
- Test: `supabase/functions/ghl-job-webhook/handlers_test.ts` (schedule-leg integration tests, near the existing calendar tests at `:2466-2560`)

**Interfaces:**
- Consumes: `buildCalendarEventBody(job, audience)` from Task 1.
- Produces: no new exports. `deps.createCalendarEvent(calendarId, accessToken, eventBody)` signature unchanged — only the body passed per target differs.

- [ ] **Step 1: Write the failing integration tests**

```ts
Deno.test("handleJobScheduled calendar: main body carries Estimate line, crew body does not (BL-5)", async () => {
  const job = freshJobRow({ estimate_value: 4200, client_name: "Ann Morrison" });
  const supabase = fakeScheduleSupabase({ job });
  const bodies: Record<string, any> = {};
  const deps = {
    supabase,
    ...happyScheduleDeps({
      createCalendarEvent: (calendarId: string, _tok: string, eventBody: any) => {
        bodies[calendarId] = eventBody;
        return Promise.resolve({ id: `gcal-evt-${calendarId}` });
      },
    }),
  };
  const res = await handleJobScheduled(deps, "opp-sched-1");
  assertEquals(res.calendar, "success");
  assert(bodies["main-cal"].description.includes("Estimate: $4,200.00"));
  assert(!bodies["crew1-cal"].description.includes("Estimate:"));
  // Same event otherwise — title and dates identical across targets.
  assertEquals(bodies["main-cal"].summary, bodies["crew1-cal"].summary);
  assertEquals(bodies["main-cal"].start, bodies["crew1-cal"].start);
  assertEquals(bodies["main-cal"].end, bodies["crew1-cal"].end);
});

Deno.test("handleJobScheduled calendar: main already stamped -> only crew created, still without Estimate (BL-5 x C1 gate)", async () => {
  const job = freshJobRow({ estimate_value: 4200, gcal_main_event_id: "already-there" });
  const supabase = fakeScheduleSupabase({ job });
  const bodies: Record<string, any> = {};
  const deps = {
    supabase,
    ...happyScheduleDeps({
      createCalendarEvent: (calendarId: string, _tok: string, eventBody: any) => {
        bodies[calendarId] = eventBody;
        return Promise.resolve({ id: `gcal-evt-${calendarId}` });
      },
    }),
  };
  await handleJobScheduled(deps, "opp-sched-1");
  assertEquals(bodies["main-cal"], undefined);       // C1 per-target gate intact
  assert(!bodies["crew1-cal"].description.includes("Estimate:"));
});
```

(Adapt `handleJobScheduled(deps, ...)` call shape and `freshJobRow` field names to the file's existing schedule-leg tests at `:2466+` — copy the invocation pattern of the neighbouring `createCalendarEvent` tests verbatim. If `freshJobRow`'s defaults don't include `estimate_value`, add it to the override object as shown.)

- [ ] **Step 2: Implement the wiring**

At `:1524`, replace the single shared `eventBody` with per-target bodies:

```ts
const calendarJobInput: ScheduleJobInput = {
  job_name: jobRow.job_name,
  client_name: jobRow.client_name,
  job_address: jobRow.job_address,
  estimate_value: jobRow.estimate_value,
  crew: fields.crew,
  start_date: startDate,
  end_date: fields.endDate,
};

const targets: Array<{
  label: "main" | "crew";
  calendarId: string;
  body: ReturnType<typeof buildCalendarEventBody>;
}> = [];
const mainConfigMissing = needsMain && !deps.calendarIds.main;
if (needsMain && deps.calendarIds.main) {
  targets.push({
    label: "main",
    calendarId: deps.calendarIds.main,
    body: buildCalendarEventBody(calendarJobInput, "main"),
  });
}
```

…and in the crew branch (`:1551`):

```ts
targets.push({
  label: "crew",
  calendarId: crewCalId,
  body: buildCalendarEventBody(calendarJobInput, "crew"),
});
```

…and the dispatch (`:1569`):

```ts
targets.map((t) => deps.createCalendarEvent(t.calendarId, accessToken, t.body)),
```

Nothing else in the leg changes — gating, `Promise.allSettled`, error aggregation, status computation, and the I2 persist block are untouched.

- [ ] **Step 3: Run the function's suite**

Run: `deno test --allow-all supabase/functions/ghl-job-webhook/`
Expected: PASS, including Task 1's unit tests and both new integration tests.

- [ ] **Step 4: Run the full gate**

Run: `deno task test`
Expected: all green — 312 existing + 5 new (317). No other directory touched, so any other failure is pre-existing; stop and report if one appears.

- [ ] **Step 5: Commit (Tasks 1+2 together — single-module type-check forces it)**

```bash
git add supabase/functions/ghl-job-webhook/handlers.ts supabase/functions/ghl-job-webhook/handlers_test.ts
git commit -m "BL-5: strip Estimate line from crew calendar events, keep on main"
```

### Task 3: Adversarial review gate

- [ ] **Step 1:** Dispatch an Opus adversarial review of the diff (standing build-execution model: every build-sized task gets one before deploy). Reviewer brief: verify (a) main-calendar output byte-identical for every input, (b) the per-target idempotency gates and I2 persist are behaviourally unchanged, (c) no other code path can hand a `"main"`-audience body to a crew calendar, (d) the required-parameter design has no defaulted escape hatch, (e) tests would actually catch a regression (assert on literals, not on the constant-vs-constant pattern that let the BL-4 divider slip through).
- [ ] **Step 2:** Fix any findings, re-run `deno task test`, amend/commit.

### Task 4: Deploy, live probe, docs, merge

- [ ] **Step 1: Deploy** `ghl-job-webhook` via `mcp__claude_ai_Supabase__deploy_edge_function` (project `eiqqqwajmcpcwhvxxnhx`). Record the new version; `sha256` proves the redeploy, not the counter.
- [ ] **Step 2: Live probe** (mocks can't see the real Google/GHL shapes — standing lesson). Using TEST job **JOB-1104** (cancelled, TEST-prefixed identity, its old calendar events already deleted):
  1. Confirm `estimate_value` is non-null on the row (set a TEST value via SQL if null).
  2. Null out `gcal_main_event_id` and `gcal_crew_event_id` via SQL so the calendar leg re-fires. (`slack_notified_at` stays stamped — the probe must not ping a crew channel.)
  3. Fire the schedule leg: Matt re-drags the test opportunity to Job Scheduled (workflow re-entry is proven), or POST directly with the webhook secret if available in-session.
  4. Verify from the function logs + Google Calendar: main event description **contains** `Estimate: $…`, crew event description **does not**; both event IDs stamped back onto the row.
  5. Cleanup: delete both probe events (Matt or the service account), note final row state in the BUILD_LOG entry.
  - Assumption to check at execution: `handleJobScheduled` does not refuse `status_v2='cancelled'` rows (nothing in the current code suggests it does; if it does, flip JOB-1104's status for the probe and restore after).
- [ ] **Step 3: Docs close-out** — `BUILD_PLAN.md` BL-5 marked shipped (mirror the BL-4 pattern: one line + pointer to BUILD_LOG); `CLAUDE.md` BL-5/6/7 row and the two "KNOWN AND DELIBERATE" call-outs updated (the inconsistency is now closed); `BUILD_LOG.md` entry at the top of Entries (deploy version, probe evidence, findings); regenerate `NEXT_SESSION_PROMPT.md`.
- [ ] **Step 4: Commit docs, merge branch to `main`, push** (deploy and merge in the same session — parity rule).

## Self-Review

- **Spec coverage:** strip crew ✓ (Task 1/2), keep main ✓ (byte-identity locked by unchanged expectations + integration assert), idempotency undisturbed ✓ (Task 2 explicitly leaves gates/persist alone + regression test), legacy `airtable-job-scheduled` explicitly out of scope with rationale ✓.
- **Placeholder scan:** all code steps carry real code; the two "adapt to neighbouring test pattern" notes point at exact line ranges rather than inventing signatures this plan can't verify from here.
- **Type consistency:** `CalendarAudience` used identically in Tasks 1 and 2; `deps.createCalendarEvent` signature unchanged throughout.
