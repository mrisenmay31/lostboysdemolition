# Adoption checkpoint — where the build stands vs. its purpose (2026-09-02, Session 16)

> **Status: assessment + proposal, PENDING MATT'S RULING.** Nothing in this document is built,
> decided, or applied. Session 16 was docs-only: no code, no deploys, no migrations, no data
> writes. The three open questions in §8 are the first item of the next session.

Matt opened Session 16 intending to build v2 Task 8b, then redirected: "investigate this repo in
its entirety and give me an update on where we are in this build plan in relation to the scope
of this project … in case we need to make any adjustments to the overall build." This is that
assessment, the proposal that came out of the brainstorm, and the questions Matt still has to
answer.

Sources: CLAUDE.md, DISCOVERY_2026-07-31.md, BUILD_PLAN.md (all amendments), the v2 program
plan, BUILD_LOG Sessions 13–15, the 8a build plan and runbook, three read-only code
explorations (web auth/jobs patterns; migrations + RPC conventions; dispatcher/Slack/GHL), plus
**live read-only checks** of production Supabase, the live Airtable base, git, Vercel, and the
prototype artifact's comments.

## 1. The purpose, in one paragraph

Lost Boys prices demolition jobs with a cost-plus calculator (labor $26/hr, overhead $23/hr,
dump $300/load, 25% markup, 3.5% card allowance) and has **never once measured a job's actual
profit**. Discovery found the business hits roughly its intended margin only because four wrong
numbers cancel: a ~$221k/yr dump-fee pad and ~$56k of rate/fee pads are financing a ~$246k/yr
labor-hours estimating shortfall. Nobody can tell whether that shortfall is bad bidding or
unbillable crew time, because nothing attributes hours, card spend, or dump loads to a job. The
system's job is to close two loops: **(1) estimate → actuals → per-job profitability → calibrated
scope defaults** (so pricing decisions get made once, on real data, without moving any quoted
price blind), and **(2) lead → estimate → schedule → field → invoice → paid** with human
checkpoints only, killing the daily rekeying between Fillout, GHL, Calendar, Slack, and Stripe.
Secondary named pains: no lead tracking at all, $61k overdue AR, invoice detail never reaching
QuickBooks, uncontrolled line-item names (no scope-mix data), change orders untracked.

## 2. What is built and live (production, main `162f64a`)

| Capability | State | Real-world use since going live |
|---|---|---|
| Airtable ↔ GHL client sync (2 functions) | Live, healthy | **The only path with real daily traffic** (32 sync rows in the last 7 days) |
| Estimate builder + GHL push (`/estimates`, no login, picker) | Live since 2026-08-14 | **0 real estimates.** 21 rows, all test-created (Matt/scripts); last row 2026-08-27 |
| Pricing engine (golden-tested to the cent vs 321 Airtable estimates) | Live | Reproduces Fillout math exactly; unused by the business |
| Estimate lifecycle: present / accept / reverse, identity links, economics | Live (v2 Phase 1) | Test only (4 acceptance events) |
| App-side scheduling mints `JOB-XXXX`; GHL Quote-Accepted minting permanently disabled | Live | 6 jobs, **all cancelled test rows** |
| Outbound dispatcher: Calendar (main + crew), GHL stage, Slack; two-way Calendar sync w/ channels + exceptions | Live, probed 6 legs | No real job has flowed. **Slack bot still not in the crew channels** (since 2026-08-20) |
| Job Dashboard `/jobs`, job detail, health/forecast engine, manual cost/revenue ledger, audit | Live (v2 Phase 2) | Test data only (9 cost entries on JOB-1107/1108) |
| Owner auth (magic link, invite-only), `/jobs/*` owner-gated, `/` flip, forecast overrides | Live (Tasks 8a + 9) | Matt is the sole auth user; **Dane never invited** |
| Legacy Airtable-era job functions (created/scheduled/completed, webhook, push) | Deployed | **Dead traffic**: last Airtable Jobs record 2026-05-22 |

Size: ~28k lines web TS (10k tests, 811 passing), ~14.6k lines Deno functions (411 tests),
6k lines SQL across 39 applied migrations, 28 build-log sessions since 2026-07-30. Every
build-sized task got an adversarial review; two gates passed on synthetic E2E probes.

## 3. Progress against the ratified v2 program (19 tasks, 6 phases)

- Phase 0 (0A, 0B) ✅ · Phase 1 (1–5) ✅ · Phase 2 (6–7) ✅ · Phase 3: 8a ✅ 9 ✅ **8b ⏳**
  · Phase 4 (10 change orders, 11 invoice review/closure) ⬜ · Phase 5 (12 Slack, 13 time D1,
  14 BILL, 15 Stripe/Synder/QBO) ⬜ · Phase 6 (16 feedback facts, 17 launch) ⬜.
- **By task count ~50%. By business value delivered: close to 0%**, because every automated
  *actuals* source sits in Phase 5 (time, BILL expenses + dump counts, Stripe revenue), and no
  real estimate or job has entered the system. The dashboard can only show what someone types in.

## 4. The critical finding: the business has not started using any of it

- **Fillout is still the estimating tool.** Live Airtable check (base `apptzp0IclCaAtOk2`,
  `Estimates` table): **64 real estimates created via Fillout between 2026-07-31 and 2026-09-02**
  (Estimate IDs 297 → 360; latest that morning). Every one sits at status "Draft" — Airtable
  status is never maintained; the Fillout→Airtable path is a fire-and-forget calculator. Over the
  same 19 days the web builder received zero real estimates.
- Ratified decision 1 assumed "the estimate builder is the committed path for every job". Its
  precondition (Matt's phone smoke + one real estimate) was **backlogged to BL-8 on 2026-08-25**
  and the Phase 1 and Phase 2 gates passed on synthetic probes. The assumption is now empirically
  unmet — not because the builder is broken, but because nobody has been asked to switch.
- Dane has **never seen** the dashboard prototype (zero artifact comments) and never signed in;
  no foreman has an account; custom SMTP is not configured; the Slack bot invite (Matt-only,
  since 2026-08-20) is still open.
- **Consequence for 8b:** foreman checklists attach to Postgres jobs, which only exist when an
  estimate is scheduled in the app. Building 8b now produces a third test-only surface and a
  Phase 3 gate that is, again, a synthetic probe. It cannot be adopted by foremen before
  Dane/Jackson adopt the estimator.
- Vercel Web Analytics is not enabled on the project, so page-visit counts are unavailable.

## 5. Scope gaps between BUILD_PLAN (A–G + Track B) and the v2 program

The v2 program absorbed C, E, F, G and D1, but these ratified/named items have **no owner in v2**
and no other live plan (grep-verified):

- **Track B — lead intake** (Grasshopper/GHL routing, stale-lead alarm, one-tap denial reason).
  Discovery called this "the biggest business pain"; never started, not in v2.
- **Scope-library calibration loop** (Phase G's human review queue, versioned defaults, dump
  load-count variance as its own number). v2 Task 16 records feedback *facts* only and
  explicitly never touches rates or defaults.
- **Fillout / Airtable / Zapier retirement and the estimating cutover.** No plan names a cutover
  date, a mandate, or what happens to the ~64/month Fillout estimates. The parallel-running
  principle has no exit criterion.
- **Deposit policy** (open decision 4, "now decidable"), **callbacks table** (Phase F), **client
  sign-off at completion**, BL-1/BL-2 equipment/tools hooks on the checklists — none in v2.
- BL-6 (client-sync echo guard) design draft still awaits Matt's review; the data-loss item stays
  open.

## 6. Assessment

- **Engineering quality is not the risk.** Reviews caught real defects every session; the
  invariants (immutability, idempotency, no pricing to crews, the `--no-verify-jwt` readback) are
  sound and live-proven.
- **The risk is build-ahead-of-use.** Roughly 50k lines exist with zero real transactions. Each
  further phase adds surface whose *fitness* (not correctness) is unverified: mobile ergonomics for
  Dane on a job site, whether the picker/GHL-push flow is faster than Fillout, whether the crew
  Slack format lands. The reviewed-prototype feedback loop with Dane never closed.
- The two loops the project exists for need **real estimates in Postgres** as their first input.
  Nothing downstream — jobs, dashboard, checklists, change orders, closure — can produce a real
  number until that happens. This is the one dependency that no amount of building can satisfy.

## 7. Matt's response (in-session) and the refined proposal

Matt agreed to an adoption sprint before 8b and reframed the priority, verbatim in substance:
**the profitability dashboard is the product**; everything else is a tool or appendage feeding
it. Bare bones first — the estimate tool functional, creating live jobs, estimate data flowing
directly into the dashboard, labor and other expense estimates/actuals flowing in — even if
actuals are entered manually at first; automation later. "We will not get everything completed
first, but I do want to have the bare bones completed, and then we can add in new features
along the way."

The refined proposal (presented in chat, **not yet ruled on**):

1. **The bare-bones loop is nearly built.** Estimate → schedule (mints the job, pushes Calendar
   and GHL) → manual cost entries on the job's costs screen (labor hours at real rates, dump
   loads, materials, rentals) → manual revenue entry → dashboard. **The one gap:** nothing but
   the unbuilt foreman checklist moves a job to `in_progress` / `completed`, so every job would
   stay "scheduled" forever and the health engine's freshness rules never engage.
2. **Replace 8b-as-specced with an owner-side "Mark started / Mark completed" action** on the
   job detail page: a status-transition RPC (service-role, house pattern) + GHL stage projection
   through the existing dispatcher (the exploration confirmed `ghl.stage.requested` already
   resolves "Job In Progress" and "Job Completed" with no handler change; the enqueue must copy
   the `ghl_opportunity_id is not null` guard and use a non-revision idempotency key) + optional
   crew-size / remaining-days fields. The existing forecast override panel already captures the
   checklist's forecast values. Roughly a day of work versus a session-plus for foreman auth +
   offline queue + photos + custom SMTP + the first `authenticated`-callable RPC (which the
   exploration showed is a much wider RLS blast radius than the plan implies — see §9).
3. **Freeze v2 Phases 4–6 as backlog.** Change orders can be a manual revenue entry for now.
   One milestone: **30 days of real jobs through the manual loop**, then automate whichever
   manual step hurt most (bet: BILL / Task 14 first — dump cost and load count for free — then
   time import / Task 13).
4. **No-code blockers first (Matt-only, both open since 2026-08-20/27):** invite the Slack bot
   to the four crew channels; invite Dane as owner (runbook §4). Have Jackson build one real
   estimate in both Fillout and the app side by side and time it; if the app is slower on a
   phone, that friction list is the only 8b-adjacent code worth writing first.
5. **Amend the v2 plan** to own the §5 gaps explicitly (Track B as a parallel config track, a
   Fillout/Airtable retirement task with the cutover criterion, deposit policy, calibration-loop
   owner) or record each as a deliberate drop.

## 8. OPEN QUESTIONS — the first item of the next session

Matt closed the session before answering these. They decide what gets built next.

1. **8b scope.** Replace the foreman checklist area with the owner "Mark started / Mark
   completed" action for the bare-bones loop (recommended); keep 8b as specced (foreman auth,
   offline queue, photos, SMTP, gated on a synthetic probe until real jobs exist); or owner
   action now + the foreman area as the next build once one real job has gone through?
2. **Who enters actuals** (labor hours, dump loads, card spend, invoice amount) per job during
   the manual phase? (a) Matt / CTA bookkeeping weekly from Gusto + BILL exports — hours per job
   still need a source; (b) Dane at job completion when he marks it completed; (c) foremen
   report crew + hours at completion (the existing completed-form habit) and Matt's team enters
   costs and revenue weekly.
3. **How does a quote reach the customer today?** A GHL estimate document (the app's GHL push
   replaces real rekeying — that is the adoption pitch), a texted/emailed/verbal number (speed of
   entry on a phone is the whole pitch), or mixed by client type?

Also still owed by Matt from earlier sessions: the Slack bot invitations (BL-8), Dane's owner
invite, the BL-6 echo-guard design review, and the per-item cleanup OKs (branch
`claude/v2-task8a-owner-auth`, worktree `.claude/worktrees/task8a`, its SDD ledger, GHL TEST
opportunity `UuTLn5Xg2Bb9EEj4UUBv`).

## 9. Exploration findings that shape 8b whichever way Matt rules

Recorded so the next session does not re-derive them (three read-only Explore passes).

- **`job_time_entries` does not exist until Task 13**, so "completion with an open clock →
  exception + Slack warning" cannot be built or gated in 8b; the Phase 3 gate leg is deferred to
  Task 13.
- **`ghl.stage.requested` needs zero dispatcher changes** for "Job in Progress" / "Job
  Completed" — `resolveStageId` lowercases and substring-matches, both names are unique among
  the live 12. Work is SQL-side: enqueue with the `ghl_opportunity_id is not null` guard
  (`schedule_estimate` / `cancel_scheduled_job` precedent) and an idempotency key that does NOT
  reuse `:rev<n>` (neither start nor completion bumps `calendar_sync_revision`; key off the
  checklist/transition id). Add the two stages to `makePipelines()` in `handlers_test.ts` + two
  tests. `job_events.stage_from/stage_to` integers for stages 7/8 are not established anywhere
  yet (5→6 scheduled, 6→12 closed lost are the precedents).
- **`job.checklist.submitted` has no dispatcher arm** — enqueuing it dead-letters at attempt 5
  and opens an `integration:<id>` alert. Same for the standing `slack_reconciliation_required`
  obligation: the dispatcher's `default:` throws, so the first reconciliation event will
  dead-letter. Any Slack leg (open clocks, scope-change, reconciliation) needs an **owner/ops
  Slack channel secret that does not exist** — every Slack path is crew-keyed
  (`Record<CrewEnvKey, string>`); no `SLACK_OPS_CHANNEL` anywhere.
- **INVOKER vs DEFINER is the biggest open design question for a foreman-callable RPC.** Every
  RPC in the repo is service-role-only, plain plpgsql INVOKER, and `schedule_estimate`'s header
  records the reversal of a DEFINER draft as a caught defect. `submit_job_checklist` would be
  the first `grant execute … to authenticated`: INVOKER requires `authenticated` grants +
  permissive policies on `job_checklists`, `jobs`, `job_events`, `integration_outbox`,
  `job_alerts` (four of which are deliberately revoked/policy-free); DEFINER needs explicit
  ratification and an `is_workforce_*` gate as the first statement. The owner-action alternative
  in §7 sidesteps this entirely (service-role RPC behind `requireActiveOwner()`).
- **Storage is greenfield** (no bucket, no `storage.objects` policy, no `config.toml`);
  `storage`-schema DDL likely inherits the auth-schema ownership caveat (branch validation may be
  insufficient; plan a production single-transaction dry-run). Photos would upload client-side
  first, then pass bucket-relative paths to the RPC.
- **Web gating for a foreman area needs three edits, not one:** `proxy.ts` matcher, the pure
  `decideProxyAction` prefix clause (+ negative test), and a new `(ops)/layout.tsx`; the `/`
  flip in `(app)/page.tsx` needs a third branch. `profile.ts` needs `crew_external_id` in the
  select + a foreman predicate/`requireActiveForeman`. `crew_external_id` (text, unconstrained,
  unwritten today) vs `jobs.crew` (`'Crew 1'..'Crew 4'`, unconstrained text) has no bridge.
- **Testing gaps:** vitest runs `environment: "node"`, no jsdom/RTL, no IndexedDB shim
  installed; `getWorkforceSession` / `requireActiveOwner` / `createForecastOverrideAction` have
  no tests — the "action-level auth-branch tests" carry has no precedent to copy. pgTAP RLS
  tests would need a synthetic `auth.users` row (branches clone no data) + a `workforce_profiles`
  row; no existing test simulates a session role.
- **`DEFAULT_HOURS_PER_DAY` carry:** three hard-coded 8s, not two — `map.ts:365/373/377`,
  `jobs/[jobNumber]/page.tsx:214`, and the DB default on `job_checklists.hours_per_day`.
  Natural home for the constant: `map.ts`.
- **`action_path` fix:** `open_category_overrun_alert` (`20260826150000:73`) → append `/costs`;
  `mark_job_reconciliation_required` (`20260819151000:499`) has the same self-link shape —
  decide whether it is in scope. `create or replace` preserves ACLs; open alert rows keep the old
  path unless data-fixed.
- **`crew-night-before` selects `status_v2 = 'scheduled'` AND `start_date = tomorrow`**, so a
  job moved to `in_progress` drops out of the digest; multi-day jobs are announced once, before
  day 1. Day-N reminders would be new logic.
- **`jobs` has no `updated_at` trigger** — writers set it by hand; and
  `trigger_push_to_airtable_on_archive`'s body runs on every `jobs` UPDATE (HTTP gated on the
  legacy `status` column) — never write legacy `status`.
