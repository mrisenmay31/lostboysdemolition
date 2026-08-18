# Lost Boys Demolition — Profitability System Build Plan

> **This is the official plan.** Confirmed by Matt on 2026-07-30. Where any other document
> disagrees — including `OPS_ROADMAP.md` (2026-07-15), which this supersedes — this file wins.
> Amend this file rather than starting a new plan document.
>
> ## ⚠️ AMENDED 2026-07-31 — read `DISCOVERY_2026-07-31.md` first
>
> A full discovery pass against the *business* (Matt's workflow overview, 45 answered questions,
> and four exported datasets — Stripe, BILL, Gusto payroll, GHL invoices) invalidated several
> assumptions below. **The 0–9 phase numbering is retired and replaced by the A–G + Track B
> structure in "Revised phases (2026-07-31)".** Sections below that predate the amendment are kept
> for provenance and are marked where superseded.
>
> **The single most important finding:** a deliberate dump-fee pad (~$221k/yr) has been almost
> exactly financing a labor estimating shortfall (~$246k/yr). Every number in the pricing engine is
> wrong; they cancel. **No pricing input may be corrected in isolation, and no quoted price may
> move.** See `DISCOVERY_2026-07-31.md` §7.

## ⚠️ AMENDED 2026-08-18 — Profitability Program v2 ratified

Matt reconciled two Codex-authored program documents against this plan and ratified the result.
**The canonical implementation program for the profitability build is now
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md`** (landed with
five approved adjustments folded in; Version 1 is archived at
`docs/archive/2026-08-18-live-job-profitability-health-dashboard.md`). The design spec it cites
(`docs/superpowers/specs/2026-08-18-live-job-profitability-health-dashboard-design.md`) is input,
superseded by the v2 decision ledger where they conflict. The v2 program absorbs and re-specifies
Phases C, E, F, and G below, and Phase D per the decision that follows. Decisions ratified today:

1. **Job-creation authority moves to app-side scheduling.** Quote Accepted becomes pre-job;
   scheduling in the estimator app mints `JOB-XXXX` and freezes budget v1. Phase A's GHL
   Quote-Accepted minting stays **live** until v2 Task 4 ships, then is flag-disabled
   (`ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false`) and never re-enabled, including during rollback.
   Precondition on the v2 Phase 1 gate: Matt's phone smoke + one real estimate through the builder.
2. **Two-way Google Calendar sync is a real requirement** (not descoped). It ships with a full
   channel lifecycle — registry, expiration timestamps, renewal before expiry, overlap
   deduplication, renewal-failure alerts, periodic reconciliation fallback — as its own gated
   sub-slice of v2 Phase 1.
3. **Phase D is DECIDED — split D1/D2** (verbatim wording below; closes the last 🔴 blocking
   decision).
4. **Scoped auth returns.** Real Supabase Auth for foremen + Dane's financial routes via an
   isolated `workforce_profiles` boundary (BL-7 resolved by v2 Task 0B before any account
   exists); the estimate tool keeps the no-login picker; `actor_assurance` records which kind of
   identity performed each action.
5. **Direct Stripe invoicing + Synder→QBO reaffirmed.** GHL receives pipeline stages and deep
   links only — never invoice authority. Stripe native auto-reminders + the weekly AR digest are
   **deferred, not dropped**: owner Matt (CFO — chases AR personally today); activation once
   `stripe-webhook` is live with real invoices flowing (v2 Phase 5 gate).

### Phase D decision (Matt, 2026-08-18, verbatim)

> Phase D1 — Unblocked: canonical job-time schema, manual/CSV import, foreman approval, Dane
> override, labor-cost attribution, audit history, and provider-neutral adapter contract.
> Phase D2 — Deferred: vendor evaluation and production connector.
> Any future vendor must automatically accept JOB-XXXX and return corrected/approved job-coded
> time. ClockShark, busybusy, a custom application, and other providers may be evaluated against
> the same contract. Gusto remains payroll, while the Gusto timekeeping/add-on question stays
> parked until vendor evaluation.

The 2026-08-18 landing pass executed only the documentation portion (this amendment, the v2 plan
landing, CLAUDE.md updates). **v2 Task 0A is not yet complete** (its runbook is unwritten) **and
Task 0B — the BL-7 auth migration — is not implemented or verified.** No production migration or
application code shipped in that pass.

## Context

Lost Boys wants a closed loop: accurate estimate → tracked actuals → job-level profitability → calibrated back into pricing. Today none of that exists in software.

The audit found the current system is **not a broken build — it's an unstarted one**:

- **Real work happens outside the repo.** Daily operations run on Fillout (bid calculator + 3 foreman checklists), Google Calendar, Slack crew channels, and GHL/Stripe for payments. The Airtable Jobs pipeline and Supabase stage functions are scaffolding.
- **Live data:** Estimates 296 records, Clients 989, Jobs **9** (5 named "Test Job"). The `Estimates` table holds all real volume and has *zero link* to Jobs.
- **Zero actuals exist anywhere.** Airtable `Expenses` 0 rows, `Change Orders` 0 rows, actual cost fields empty. Supabase `labor_actuals` 0, `expense_actuals` 0, `time_entries` 0. Every variance field reads −100%.
- **The estimate chain has never computed.** 5 pricing defaults were never set, so `IF({Target Margin Percent}, …)` returns blank on every record. That is why code bills off `Total Bid` — `Final Estimated Price` is empty.
- **Two variance formulas are hard-broken** (`isValid: false`, referencing deleted fields).
- Time tracking fails for one specific reason: Gusto projects must be created by hand and selected from a list, so crews skip it.

Because there is almost nothing to preserve, this is a **greenfield rebuild on Postgres** carrying forward only data: 989 clients, 296 estimates (pricing history), 51 legacy jobs (scope calibration), 19 scope definitions, 5 pricing variables.

### Decisions already made by Matt
- Supabase Postgres is source of truth. Dane/Jackson work in GHL, not Airtable.
- Direct Stripe invoicing, with the invoice link surfaced in GHL.
- Fillout may be replaced, provided the replacement is mobile-friendly.
- GHL needs edit capability for scope changes, change orders, and pricing.
- An internal estimate is **always** created, even when no formal proposal is sent (this is Path B — it means every job has a variance baseline).

### Resolved blockers (previously open since May)
- **Gusto has no public project-tracking read API.** It *does* publish `POST /v1/companies/{company_uuid}/time_tracking/time_sheets` for pushing classified hours in. → We own time capture; we push to Gusto for payroll.
- **BILL Spend & Expense v3 API is fully capable**: `POST /v3/spend/custom-fields` (selector with `allowCustomValues: true`), `PUT /v3/spend/transactions/{id}/custom-fields`, and webhook subscriptions. → Job codes are created automatically at scheduling time.

---

## Target architecture

| Layer | Choice |
|---|---|
| Source of truth | Supabase Postgres (`eiqqqwajmcpcwhvxxnhx`) |
| App | Next.js on Vercel, PWA — mobile-first for field use |
| Auth | Supabase Auth (employees, foremen, admins) |
| Estimators/office | GHL opportunity = headline numbers + links; deep work in the app |
| Field | PWA: crew clock-in + 3 job checklists |
| Owner/CFO | Profitability dashboard |
| Payments | Stripe direct; link surfaced on GHL opportunity |
| Payroll | Push timesheets → Gusto |
| Expenses | BILL Spend & Expense webhooks → auto job-coded |
| Scheduling | Google Calendar (retain) |
| Notifications | Slack crew channels (retain) |

**Retired:** Airtable (post-migration), Fillout, Zapier, the 11 Airtable automations, and edge functions `receive-airtable-webhook` / `push-to-airtable`.

### Three design decisions that fix root causes

1. **Estimates are immutable versioned snapshots.** `estimates` rows are never updated; a change order writes a new version. Variance always compares actuals to the *accepted* version. This permanently removes the `Total Bid` vs `Final Estimated Price` ambiguity.
2. **All money math lives in TypeScript, not formula fields** — unit-tested, one implementation, no silent breakage.
3. **Actual labor cost uses real per-employee pay rates** (`users.hourly_rate`), not the standard $26. Yields both an efficiency variance and a rate variance. Standard rates remain for *estimating* only.

---

## Data model (new schema, `app` namespace)

Core: `clients` · `jobs` · `job_scopes` · `scope_library` · `scope_library_versions` · `estimates` · `estimate_line_items` · `change_orders` · `invoices` · `invoice_line_items` · `time_entries` · `expenses` · `users` · `crews` · `pricing_variables` · `job_events`

Key points:
- `jobs.job_number` — `JOB-XXXX`, the universal key across Stripe/GHL/BILL/Gusto/Slack. **One key format everywhere** (today `job_events.job_id` stores record IDs while `jobs.airtable_job_id` stores `JOB-1005` — nothing joins).
- `job_scopes` is the join enabling **per-scope attribution** — the missing substrate for the feedback loop.
- `time_entries` carries an optional `job_scope_id`. When absent on a multi-scope job, hours allocate pro-rata by estimated hours and are marked `attribution: 'derived'` vs `'measured'`. **Calibration only trusts `measured`.**
- Existing Supabase `users`/`crews`/`time_entries` (0 rows, well-designed) are reused as the starting point rather than rebuilt.

---

## Phases 0–9 — ⚠️ SUPERSEDED 2026-07-31

> **Retired by "Revised phases (2026-07-31)" above.** Kept for provenance. Do not plan from this
> numbering. Known defects found during discovery:
> - Phase 1's "seed `scope_library.default_materials_cost`" **is not doable** — no reference list
>   exists, materials are estimated from experience, and the field is empty on all 19 scopes. It is
>   a Phase G *output*, not a migration input.
> - Phase 2's two blocking decisions were framed around a `Dump Fee Buffer` field and a broken
>   formula chain that **do not exist in the live base** (both belong to `Jobs (old)`).
> - Phase 4's crew clock-in PWA was premised on crews not clocking in. **They do, reliably** — the
>   failure is Gusto project creation, which has no API.
> - The "GHL opportunity = headline numbers + links" premise is **false today**; GHL is not used for
>   pipeline tracking at all.

Each phase ends in something usable. Phases 1–4 are the critical path to a real profitability number.

### Phase 0 — Foundation & safety
- Reconcile repo with production: commit missing `airtable-client-sync`, the true `airtable-job-created` v21, and the Airtable automation scripts. **The repo is currently a liability — redeploying from it regresses production.**
- Design RLS policies and enable RLS on `sync_log`, `client_sync_state`, `job_events`, and the actuals tables. Currently 989 client records are readable by anyone with the anon key, and all 7 edge functions run `verify_jwt: false`.
- Stand up Next.js + Vercel skeleton, Supabase Auth, provision first admin.

### Phase 1 — Core schema + data migration
- Build the schema above via `mcp__Supabase__apply_migration`.
- Migrate 989 clients (dedupe against `client_sync_state`), 296 estimates as historical pricing data, 51 legacy jobs, 19 scopes, 5 pricing variables.
- Legacy mapping traps to handle: old `Lead / Request` vs new `Lead-Request`; crew names (`Nick (Crew 1)`) vs `Crew 1`; `Line Item 1–5` multiline text → normalized rows.
- Seed `scope_library.default_materials_cost` (empty on all 19 today).

### Phase 2 — Estimating (replaces Fillout calculator)
- Mobile-friendly estimate builder: pick scopes → defaults prefill hours/materials/dump count → adjust → live price preview.
- Pricing engine in TypeScript with the corrected chain. **Resolve before building:** whether the 3% CC fee is a cost line or pass-through (today it makes a 25% target report as 27.25%), and whether `Dump Fee Buffer` enters price or is informational.
- Estimate versioning + accept/decline. Path B = estimate recorded, not sent.
- Push headline numbers + estimate link to the GHL opportunity.

### Phase 3 — Scheduling
- Job scheduling UI → Google Calendar (main + per-crew), reusing the working service-account JWT logic in `supabase/functions/airtable-job-scheduled/index.ts:164` (`getGoogleAccessToken`).
- Crew assignment (deadline 4pm day before) with an explicit *scheduled-but-unassigned* state.
- Night-before Slack message to the crew channel.
- **Create the BILL job code** at scheduling time so expenses can be coded from day one.

### Phase 4 — Field capture (the biggest unlock)
- **Crew clock-in PWA.** Foreman opens it; today's assigned job is already there — nothing to create, nothing to search. Clock whole crew in/out. Offline-tolerant. Optional per-scope tagging.
- **Three foreman checklists** (Job Started / In Progress / Completed) replacing Fillout, with photo upload → Slack crew channel, preserving current behavior.
- Dump load count captured on Job Completed (largest variable cost after labor).
- **Push approved hours to Gusto** via `POST /v1/companies/{company_uuid}/time_tracking/time_sheets` for payroll.

### Phase 5 — Expenses
- BILL Spend & Expense: create `Lost Boys Job ID` custom field (`CUSTOM_SELECTOR`, `allowCustomValues: true`); job codes auto-created in Phase 3.
- Webhook subscription → ingest transactions. Rules already specified in `INTEGRATION_DESIGN.md`: filter to `transactionType = CLEAR` only (avoid double-count with `AUTHORIZATION`), skip split parents, refunds as negative rows, untagged → review queue.
- Untagged-expense review UI.

### Phase 6 — Invoicing
- Direct Stripe draft invoice on job completion. Port the proven two-step rendering from `supabase/functions/airtable-job-completed/index.ts:337` — `POST /products` then `POST /invoiceitems` with `price_data[product]`. **Never** `price_data[product_data]`; Stripe rejects it.
- Line items generated from job scopes + change orders; review/edit screen for Dane.
- Surface invoice link on the GHL opportunity.
- **Build `stripe-webhook`** (never built): `invoice.sent` → Sent, `invoice.paid` → Paid, capturing real payment dates.
- **Go-live gate:** `STRIPE_SECRET_KEY` is currently a *test* key. Confirm the Lost Boys live account (the Stripe MCP in session is CTA Integrity's) before real invoicing.

### Phase 7 — Profitability
- Variance engine in TypeScript: labor hours/cost (efficiency + rate), materials, dump, revenue, profit — always vs. the accepted estimate version.
- **Job report page** — the link surfaced in GHL. Estimate vs actual, line items, time entries, expenses, change orders.
- Sync headline numbers to GHL opportunity custom fields (19 already exist; mapping in `ghl_field_mapping.md`).
- Margin alerts to Slack.

### Phase 8 — Feedback loop
- Aggregate `measured` per-scope actuals into proposed `scope_library` defaults.
- **Human review queue** — proposals surface with sample size and spread; nothing auto-writes. Accepted changes write a new `scope_library_versions` row so historical estimates stay reproducible.
- Rules to set with Matt: minimum sample size, median vs trimmed mean, and Path B inclusion.
- Quarterly labor/overhead rate review against real payroll (guardrail: true all-in is $27–29/hr vs the $26 standard).

### Phase 9 — Reporting
- Dashboard: job profitability, estimate accuracy trend by scope, crew productivity, margin by client type and job type.
- Reconcile the two conflicting margin targets (25% engine target vs 40–60% company benchmark — different denominators, never reconciled).

---

## Critical files

**Reuse:**
- `supabase/functions/airtable-job-scheduled/index.ts` — Google Calendar service-account JWT signing (working, verified)
- `supabase/functions/airtable-job-completed/index.ts` — Stripe product+invoiceitem rendering (working, verified)
- `ghl_field_mapping.md` — 19 GHL custom field IDs
- `INTEGRATION_DESIGN.md` — BILL edge-case rules

**Retire after migration:** `setup_airtable*.js`, `audit_schema.js`, `airtable-automations/`, `receive-airtable-webhook`, `push-to-airtable`.

---

## Verification

- **Pricing engine:** unit tests on the formula chain, including the CC-fee and dump-buffer decisions. Recompute the 296 historical estimates and compare against stored values.
- **Time → payroll:** clock a test crew, verify `time_entries` cost math against real pay rates, push to Gusto demo (`api.gusto-demo.com`), confirm the timesheet lands.
- **Expenses:** swipe a real BILL card coded to a test job; confirm webhook → `expenses` row, correct job, `CLEAR` only.
- **Invoicing:** end-to-end on a test job in Stripe test mode — draft → review → send → pay → confirm `invoice.paid` advances state and stamps the payment date.
- **Full loop:** run one real job end to end — estimate → schedule → clock in → expenses → complete → invoice → paid — then confirm the job report shows a correct, non-zero variance. **This has never once happened in this system.**
- **Migration:** row-count reconciliation per table; spot-check 10 clients and 10 legacy jobs.

---

## Revised phases (2026-07-31) — CANONICAL

Two tracks. **Track B is configuration only and runs in parallel** — it does not compete for build
capacity. Rationale and evidence for every item: `DISCOVERY_2026-07-31.md`.

### Phase A — The job record (the keystone) ⭐ START HERE
Nothing downstream works without it, and it makes automation **already built and paid for** finally
fire. The recurring theme of discovery: working automation exists (Calendar creation, Stripe invoice
rendering, client sync) but receives no traffic because no job record exists early enough to
trigger it.
- Postgres `jobs` with `JOB-XXXX` and a **standardised job name format**. Matt: standardising the
  job name "would be very important" — crews currently cannot tell which job is theirs, which is a
  direct cause of missing time attribution.
- Created at estimate acceptance / scheduling; propagates one key to Google Calendar, Slack, BILL,
  Gusto, Stripe, GHL. Today `job_events.job_id` holds record IDs while `jobs.airtable_job_id` holds
  `JOB-1005` — nothing joins.
- Reuse `airtable-job-scheduled/index.ts:164` (`getGoogleAccessToken`) — proven and verified.
- Finish the Slack crew notification (`SLACK_PLACEHOLDER`; secrets already provisioned). Today the
  night-before message is typed by hand.

### Phase B — Estimate builder (kill the rekeying)
- Reproduce today's math **exactly**: markup (not margin divisor), CC fee **3.5%**, dump **$300/load
  as a pricing rate**, labor `$26 × hrs` or `$26 × emp × 8 × days`, overhead `$23 ×` same basis.
- Per-job markup override, default 25%, floor 15%.
- **Push the estimate into GHL with line items** — removes the rekeying Dane independently named as
  a huge friction point on 2026-07-31. Nearly everything is retyped today, daily.
- **Source line-item names from `Scope Library`.** Free-text names are why scope-mix data does not
  exist ("Interior Demolition" 114 vs. "Interior Demo" 30; "Commerical Demo" typo).
- Report *true margin* alongside the markup. Capture guideline price vs. quoted price — the discount
  by estimator and client type is data that does not exist today.

### Phase C — Expenses + dump counts (BILL)
- BILL `Lost Boys Job ID` custom field (`CUSTOM_SELECTOR`, `allowCustomValues: true`); codes created
  in Phase A. Webhook → `expenses`. Filter `transactionType = CLEAR` only, skip split parents,
  refunds negative, untagged → review queue (rules in `INTEGRATION_DESIGN.md`).
- **One transaction = one dump load (confirmed)** — this single integration delivers dump *cost* and
  dump *count* together. No foreman form change needed.
- **Make Job Name required** on job-cost budgets. Currently 35.5% fill; Matt confirms coding gets
  skipped even when a code exists, so availability alone will not fix it.
- Split hauling services (Blue Collar, Chew It Up, Local Dumpster, Intermountain Dumpsters) out of
  `Dump Fees` — *pending Dane's confirmation of what those vendors do.*

### Phase D — Time tracking ✅ DECIDED 2026-08-18, split D1/D2
**Gusto has no project-creation API** — `POST /time_tracking/time_sheets` requires a pre-existing
`job_uuid`. Crews already clock in reliably; the failure is that the project must exist and cannot
be created programmatically. **Resolved 2026-08-18** (see the amendment above for the verbatim
decision): **Phase D1 (unblocked)** — canonical job-time schema, manual/CSV import, foreman
approval, Dane override, labor-cost attribution, audit history, provider-neutral adapter contract
(v2 Task 13). **Phase D2 (deferred)** — vendor evaluation and production connector against that
contract; Gusto add-on question parked until then.

### Phase E — Invoicing
- Direct Stripe draft on completion; port the proven two-step rendering from
  `airtable-job-completed/index.ts:337` — `POST /products` then `POST /invoiceitems` with
  `price_data[product]`. **Never** `price_data[product_data]`.
- Build `stripe-webhook` (never built): `invoice.sent` → Sent, `invoice.paid` → Paid.
- Stripe native auto-reminders (config) + weekly Slack AR digest. **$61,150 currently sits overdue
  across 18 invoices**; Matt personally chases AR; contractors run net 30, large commercial net 60.
- **Synder → QBO.** Priority raised: invoice-level detail never reaches QuickBooks today, so books
  are reconciled from bank activity and there is no job- or client-level revenue in the ledger.
- **Go-live gate:** `STRIPE_SECRET_KEY` is a *test* key. Confirm the Lost Boys live account.
- **2026-08-18:** this phase's Stripe scope is absorbed by v2 Task 15 (Stripe + Synder→QBO
  reaffirmed; GHL never becomes invoice authority). Auto-reminders + AR digest deferred, not
  dropped — owner Matt; activate once `stripe-webhook` is live with real invoices (v2 Phase 5 gate).

### Phase F — Profitability
- Variance vs. the accepted estimate: labor (efficiency + rate, using real `users.hourly_rate`),
  dump loads, materials, revenue, profit.
- **Job report page surfaced on the GHL opportunity.**
- Change-order capture — ~35% of jobs, typically thousands of dollars. Leakage is low (<10%), so
  this is *attribution*, not revenue recovery: an untracked $3k change order makes estimate-vs-actual
  meaningless on that job.
- Callbacks table — rework hours hit job profitability.

### Phase G — Feedback loop & reporting
- Per-scope calibration from `measured` actuals; human review queue; versioned `scope_library`.
- **`default_materials_cost` is seeded here, from actuals** — not during migration (see below).
- **Dump variance must be two separate numbers:** load-count variance (feeds calibration, never
  touches price) and dump-cost variance (feeds margin reporting). Because the pad absorbs load-count
  error, nobody ever *feels* a bad estimate — so the signal must be measured deliberately.

### Track B — Lead intake (config only, parallel, start now)
Confirmed the biggest business pain. No system tracks leads — "it's all done by memory" — and no
record exists until an estimate does, which is also why there is no win-rate or turnaround data.
- **Grasshopper already handles voice *and* SMS**, is the publicly listed number, and routes to
  Jackson's phone (~6 months). **A port may be unnecessary** — decide: route Grasshopper into GHL,
  or port it.
- Inbound contact → auto-create opportunity at Stage 1. Stale-lead alarm at 24h.
- Website form currently → Slack via **Zapier**. **Live dependency — do not retire Zapier blindly.**
- **Denial reason and scope mix** are the only two metrics Matt named as decision-changing.
  **One tap, or it will not happen.**

---

## Backlog — captured, not scheduled

Raised by Dane on 2026-07-31. **None of these are in the A–G critical path and none should be
started now.** They are recorded here so the schema decisions they depend on get made early —
each one is cheap to accommodate in the initial Postgres design and expensive to retrofit, in the
same way `callbacks` was.

### BL-1 — Equipment maintenance tracking
Track service and repair against each piece of equipment (trucks, trailers, skid steers, small
machines) rather than letting it disappear into card spend.

- **Why it's backlogged, not dropped:** equipment repair already flows through BILL card spend
  (~$572k/yr total) with no equipment dimension, so nobody can see cost-per-machine, spot a unit
  that is failing, or plan replacement. It is a reporting gap, not an operational failure.
- **Schema hook to reserve now:** an `equipment` table (unit, class, acquisition date/cost,
  assigned crew) and an optional `expenses.equipment_id`. Adding the column later means recoding
  historical transactions by hand.
- **Capture surface:** the foreman completion checklist rebuilt in Phase A/D is the only field
  form with a reliable habit behind it. Hour meters, damage reports, and "this unit needs service"
  belong there — one tap — not in a separate app.
- **Depends on:** Phase C (BILL expense ingestion) for the cost side.
- **Open questions:** is there an existing equipment list anywhere, and who owns the maintenance
  schedule today? Assume neither exists until confirmed.

### BL-2 — Tool inventory
Know what tools exist, which crew has them, and what is being lost or replaced.

- **Why it's backlogged:** tool attrition is a real recurring cost buried in card spend, and it is
  also a crew-accountability signal — which makes it a natural input to BL-3.
- **Schema hook to reserve now:** `tools` (or a `class = 'tool'` partition of `equipment`) plus a
  `tool_assignments` ledger keyed to `crew_id`. Assignment is per-crew, not per-employee — crews
  are the unit that already exists everywhere else in this system.
- **Capture surface:** same as BL-1 — the foreman checklists, at job start and job completion.
  A separate check-in/check-out app will not get used; the checklists already do.
- **Design constraint:** anything requiring a foreman to enumerate a full tool list per job will
  fail. Scope this to exceptions only — what left, what came back short, what broke.
- **Depends on:** nothing hard. Could be built any time after Phase A, at low cost.

### BL-3 — Crew-level P&L and foreman incentive comp
Run each crew as a business unit: allocate the foreman's cost to their crew, produce a per-crew
P&L visible in near-real-time, and bonus foremen on their crew's financial performance.

- **Why Dane wants it:** it converts profitability from a back-office number into something the
  four foremen (Nick, Alex, Brady, Cade) can see and act on daily.
- **This is mostly free once Phase F lands.** Crew is already a first-class dimension throughout
  the system — `crews`, per-crew Google Calendars, per-crew Slack channels, `Crew 1–4` on the job
  record. Phase F computes job-level revenue, labor, dump, and materials variance; a per-crew P&L
  is that same data grouped by `jobs.crew_id`. The *reporting* is a small increment.
- **What is genuinely new work:** allocating costs that are not job-level — foreman salary,
  truck/equipment cost (BL-1), tool replacement (BL-2), and an overhead share. The allocation
  basis has to be decided deliberately (per productive hour, per job, per revenue dollar) because
  it determines who looks profitable.
- **Depends on:** Phase D (time tracking — without per-crew hours there is no labor actual, and
  therefore no crew P&L) and Phase F (variance engine). **Phase D is currently blocking**, so
  BL-3 cannot start regardless of priority.

> ⚠️ **Do not bonus on absolute crew margin.** The discovery finding in
> `DISCOVERY_2026-07-31.md` §7 makes this a live hazard: a dump-fee pad (~+$221k/yr) is financing
> a labor estimating shortfall (~−$246k/yr). Crew margin therefore moves with **how a job was
> priced** — dump-heavy jobs carry the pad, labor-heavy jobs carry the shortfall — far more than
> with how well the crew ran it. Bonusing on absolute margin would pay foremen for the estimator's
> mix, and would give them an incentive to prefer dump-heavy work.
>
> The defensible basis is **variance against the accepted estimate** — hours vs. estimated hours,
> loads vs. estimated loads — which is what the crew actually controls, plus a quality gate
> (callbacks, rework hours). Confirm the pricing distortion is corrected or explicitly neutralised
> in the allocation before any dollar is attached to these numbers.

### BL-4 — Crew Slack notification message format (Matt, 2026-08-14)

The schedule-leg crew Slack message (`ghl-job-webhook`) should be reformatted to:

```
Client Name
Business Name (if applicable)
Client Phone Number

Job Start Date
Job Start Time
Job Address

Job Scope description
```

- **When:** at the **end of Phase B** (Matt's explicit call, 2026-08-14) — Phase B's estimate
  line items are what make a real "Job Scope description" available to the message, and the
  client phone/business fields may ride along on the estimate→job promotion path.
- **Scope:** the `ghl-job-webhook` schedule-leg Slack post; review `crew-night-before`'s digest
  for consistency at the same time. Note the current job record has no `client_phone`,
  `business_name`, `start_time`, or scope-description fields — populating them is part of the
  work, not just formatting.

**BL-4 was built and shipped 2026-08-17.** See `BUILD_LOG.md` for that entry.

### BL-5 — Strip pricing from crew Google Calendar events (Matt, 2026-08-17)

**Backlogged by Matt during the BL-4 build.** Decided but deliberately not built in that session.

BL-4 established a hard rule that **no pricing may reach a crew channel** — no total bid, quoted
price, markup %, true margin %, hours, or dump counts. The crew Slack message honours it by
construction. The crew **Google Calendar** does not: `buildCalendarDescription`
(`ghl-job-webhook/handlers.ts`) emits an `Estimate: $X` line, and that same event body is posted to
`GOOGLE_CALENDAR_CREW1`–`CREW4` as well as the main calendar. So the rule BL-4 wrote down is
violated one channel over, by code that predates it.

- **Decision already made:** strip the estimate value from **crew** calendar events only; keep it on
  the **main** calendar, which Dane and Jackson use. Do not strip it from both — Dane may be relying
  on the at-a-glance number.
- **The actual work:** today one `eventBody` is built once and posted to both targets via
  `Promise.allSettled`. This needs two descriptions — a main one that keeps the estimate line and a
  crew one that omits it — without disturbing the per-target event-ID idempotency, which was
  hard-won across two Phase A fix rounds.
- **Why it's backlogged, not dropped:** it is a pre-existing behaviour, not a BL-4 regression, and
  the calendar leg is the most idempotency-sensitive code in the function. It deserves its own
  session rather than being tacked onto a build that was already mid-flight.
- **⚠️ Until it lands, the inconsistency is KNOWN AND DELIBERATE.** Crew Slack carries no money;
  crew calendars do. Do not "fix" either side blind, and do not treat the calendar line as evidence
  that the Slack rule is negotiable.
- **Depends on:** nothing. Can be picked up any time.

**BL-5 was built and shipped 2026-08-20** (`ghl-job-webhook` v19, live-probed on JOB-1104: main
event carried `Estimate: $4,200.00`, crew event carried none — Matt eyeballed both). The
crew-channel no-pricing rule now holds on Slack AND crew calendars. One residual, consciously
accepted: the legacy `airtable-job-scheduled` (Airtable-era path, retirement-bound) still emits
`Estimated Revenue` to crew calendars — flagged in the BL-5 plan's Global Constraints as a
decision, not an oversight. See `BUILD_LOG.md`.

### BL-6 — Close the `airtable-client-sync` data-loss item (Matt, 2026-08-17)

**Backlogged by Matt during the BL-4 build.** The *code* fix shipped 2026-08-17 (v27): the repaired
`POST /contacts/search`, an `updateGhlContact` call on the duplicate-400 path, and a guard that
stopped blank names erasing GHL contact names. **But the data-loss item is NOT closed**, and the
reason is not in the code at all.

The Airtable automation that invokes this function (`wflSSK2Twr9Tqwgpq`, base `apptzp0IclCaAtOk2`)
triggers on **`recordCreated` only**. There is no `recordUpdated` automation on the Clients table.
So the function is never invoked when someone edits a client, and no code change to it can alter
that. All 1045 Clients rows already carry a GHL Contact ID, so the two branches the fix repaired now
only ever run for brand-new rows.

- **⚠️ The hard part is an echo loop, not the trigger.** `ghl-contact-sync` writes to Airtable →
  `recordCreated` → `airtable-client-sync` → PUT to GHL → GHL workflow → `ghl-contact-sync` → … It
  terminates **only** because the Airtable trigger is create-only. Daily traffic fits this exactly
  (`ghl_to_airtable` runs ~2–3× `airtable_to_ghl`). Adding `recordUpdated` without a guard creates a
  live infinite sync loop on a daily-traffic integration.
- **What the work actually is:** an echo guard first — compare incoming values against
  `client_sync_state`, or skip when the payload matches what was last synced within N seconds — and
  only then add the `recordUpdated` trigger with `watchFields` limited to firstName, lastName, email,
  phone, companyName, clientType.
- **Verification note:** the repaired search leg cannot be verified from `sync_log` alone. Read the
  edge-function console logs for `[ghl] contact search FAILED`. The
  `20260817140000_widen_sync_log_match_method` migration added `'email_duplicate'` specifically so a
  search-match and a duplicate-fallback stay distinguishable, but a *failing* search still needs the
  logs. Also unconfirmed: whether the Supabase `GHL_API_KEY` is the same token/scopes the web app's
  live-verified search was proven against.
- **Depends on:** nothing. Blocked only on designing the echo guard deliberately.

### BL-7 — Decide `handle_new_auth_user()`'s fate (Matt, 2026-08-17)

**Backlogged by Matt during the BL-4 build.** Inert today; needs a decision before Phase D.

The 2026-08-17 hardening pass pinned `search_path` on every legacy `SECURITY DEFINER` function
**except this one**, deliberately. GoTrue connects as `supabase_auth_admin`, whose `search_path` is
`auth`, so the function's unqualified `INSERT INTO users` resolves to **`auth.users`**, collides with
the row that just landed, and is swallowed by `ON CONFLICT DO NOTHING`. It has **always** been a
silent no-op. Live proof: `auth.users` has 1 row, `public.users` has 0 — that, not "the clock-in
schema was never used", is why `public.users` is empty.

- **The decision:** pin it (making it actually insert into `public.users`), or leave it inert, or
  drop the trigger. Pinning is a **behaviour change**, not hardening: the next auth user created
  would gain a `public.users` row with `role='employee'`, which activates the live
  `get_my_role()`-based RLS policies. That is why it was not done as a side effect of a security pass.
- **Related, and the reason this matters before Phase D:** `get_my_role()`/`get_my_crew_id()` are
  load-bearing in **7 live RLS policies** on `users`, `crews` and `time_entries` — contradicting
  CLAUDE.md's "RLS enabled, no policies by design" for those three tables. The hardening pass revoked
  EXECUTE from `anon`/`authenticated`, which turns "0 rows" into "permission denied" for those roles.
  Correct while there is no login, but **Phase D clock-in is specced against `time_entries`** and must
  either re-grant EXECUTE to `authenticated` (with `pg_temp` pinned) or replace those policies.
  ⚠️ **CORRECTED 2026-08-18 (v2 Task 0A branch-fidelity probe):** the "7 live RLS policies" figure
  above was incomplete, not wrong — it counted only the `get_my_role()`/`get_my_crew_id()` policies.
  The three tables actually carry **12 policies total**: those 7 (broken for `anon`/`authenticated`
  since the 2026-08-17 revoke) plus **5 plain `auth.uid()`-based policies that still function**
  (`users_select_own`; `employees_insert_own`/`employees_select_own`/`employees_update_own_open`;
  `authenticated_select_crews`). Task 0B does not touch any of the 12.
- **Depends on:** nothing. Should be settled as part of Phase D's design, not before.

**Sequencing:** BL-1 and BL-2 are independent and could be picked up opportunistically after
Phase A. BL-3 should not be attempted before Phase F, and paying against it should not happen
until Phase G has enough `measured` history to make the variance numbers trustworthy. BL-4 shipped
2026-08-17. BL-5 shipped 2026-08-20. BL-6 has a design draft awaiting Matt's review
(`docs/superpowers/plans/2026-08-18-bl6-echo-guard-design-DRAFT.md`) — the echo loop it guards
against is now live-proven, not hypothetical.

---

## The one open decision — Phase D ✅ RESOLVED 2026-08-18

**Resolved as the D1/D2 split** (see the 2026-08-18 amendment for the verbatim decision):
manual/import-first with a provider-neutral adapter contract now; vendor evaluation deferred to
D2, with ClockShark, busybusy, a custom application, and others judged against the same contract.
The four options below are kept for provenance.

1. **Foreman confirms crew + hours on the existing Job Completed form.** Near-zero build, no new
   app, no subscription, no habit change. Job-level hours × real pay rates, cross-checked against
   Gusto's clocked payroll totals — automating the manual reconciliation that "was extremely
   valuable" before the VA left. *Buys most of the value; real data can later prove whether the rest
   is worth paying for.*
2. **ClockShark** — API auto-creates jobs at scheduling and syncs to Gusto for payroll.
   Budget approved, but realistically $180–250/mo at ~20–22 seats. Risks a clock-in habit that
   currently works.
3. **Build our own clock-in PWA** — largest build; payroll path unresolved because the Gusto
   timesheet endpoint also requires a pre-existing `job_uuid`.
4. **Standardise Gusto project names + assign an owner** — zero build, but re-creates exactly the
   human dependency that already failed once.

## Open decisions — status as of 2026-07-31

| # | Decision | Status |
|---|---|---|
| 1 | Credit card fee | ✅ **Resolved** — 3.5%, booked as a cost line. Hold prices constant. The Airtable `Pricing Variables` row at 3% is stale and read by nothing. |
| 2 | Dump Fee Buffer | ✅ **Resolved** — $300/load is a **pricing rate**, not a cost. Priced in as-is; real per-load cost tracked separately from BILL. The field never existed in the base. |
| 3 | Deposit policy | ⚪ Open, now decidable — 39 jobs over $5,000 = **21% of jobs but 57% of revenue.** A $5k threshold would be well-targeted. |
| 4 | Scope calibration rules | ⚪ Open — proposed defaults: min 5 `measured` jobs; median until n≥8 then trimmed mean; exclude Path B initially. Phase G. |
| 5 | Gusto add-on | ⚪ Parked until Phase D2 vendor evaluation (2026-08-18). |
| 6 | **Phase D — time tracking** | ✅ **Resolved 2026-08-18** — D1/D2 split (see amendment above) |
| 7 | Lead intake — Grasshopper vs. port into GHL | ⚪ Open (Track B) |

---

## Carried over from OPS_ROADMAP.md — unreconciled

`OPS_ROADMAP.md` (2026-07-15) is superseded by this plan, but it locked decisions that this plan
never addressed. They are recorded here so that retiring that document does not discard them.
None are yet reflected in the phases above.

**Direct conflicts — this plan currently wins by default, but the call was never explicitly revisited:**

| Topic | OPS_ROADMAP (2026-07-15) | This plan |
|---|---|---|
| Crew time tracking | ClockShark, ~$100–170/mo, budget approved | Build clock-in in-house (Phase 4), push timesheets to Gusto |
| Source of truth | Airtable-centric | Supabase Postgres; Airtable retired |
| Expenses | Weekly Divvy CSV import + BILL API spike | BILL Spend & Expense v3 webhooks (Phase 5) |

Note the ClockShark conflict interacts with open decision 5 above — if ClockShark is reinstated,
the Gusto add-on question changes shape.

**Decisions with no counterpart anywhere in this plan.** These are unowned by any phase:

- **QuickBooks Online is the books.** Invoices and payments must land in QBO, via Synder
  (~$20–50/mo, Stripe→QBO). This plan's Phase 6 stops at Stripe and never reaches bookkeeping.
- **Port the business number into GHL**, with A2P 10DLC registration. Front-of-funnel lead
  capture — leads currently live in Dane and Jackson's phones and get lost, which the 2026-07-15
  session identified as the single biggest pain. No phase here covers lead intake at all.
- **Client sign-off at completion** — non-blocking, fires simultaneously with the invoice.
- **Callback tracking** — a callbacks record, as one of the four quality signals (with
  before/after photos, the foreman completion checklist gating Status=Completed, and sign-off).
- **Invoice reminders** — use Stripe native auto-reminders; the `invoice_reminders` table stays
  dormant. AR visibility and collections were a named pain; Phase 6 does not mention them.

**Action:** fold each of these into a phase, or record an explicit decision to drop it. Until
then this section is the only record that they were ever decided.

### Status after discovery, 2026-07-31

| Item | Resolution |
|---|---|
| **QuickBooks Online via Synder** | ✅ **Keep — priority raised.** QBO exists but invoice-level detail never reaches it; books are reconciled from bank activity. Folded into **Phase E**. |
| **Port the number into GHL / A2P** | ⚪ **Reshaped.** A **Grasshopper** number already exists (~6 months, publicly listed, voice *and* SMS, routes to Jackson). A port may be unnecessary. Now owned by **Track B**. |
| **Client sign-off at completion** | ⚪ Still wanted (Matt). A client-approval checkbox already exists on the Job Completed form. Answer was ambiguous — **needs clarification.** Folded into Phase A/E. |
| **Callback tracking** | ✅ **Keep.** Not tracked today; happens often enough to matter to job profitability. Folded into **Phase F**, and a `callbacks` table must be in the initial schema — cheap now, expensive to retrofit. |
| **Stripe native invoice reminders** | ✅ **Keep, plus AR digest.** $61,150 currently overdue across 18 invoices. Folded into **Phase E**. |
| **ClockShark vs. in-house clock-in** | ✅ **Resolved 2026-08-18** — Phase D1/D2 split. Neither is chosen up front: D1 ships manual/CSV-first behind a provider-neutral adapter contract; ClockShark (and busybusy, a custom app, others) are evaluated against that contract in D2. |
| **Airtable-centric source of truth** | ✅ Superseded — Postgres, unchanged. |
| **Weekly Divvy CSV import** | ✅ Superseded — BILL v3 webhooks (Phase C), unchanged. |

**Lead intake, which no phase covered, is now Track B.** Confirmed as the biggest business pain:
no system tracks leads, and no record exists until an estimate does.

## Risks

- **Scope.** This is a genuine application build, not an integration. Phases 0–4 are the critical path; 5–9 deliver compounding value but the system is not useful until Phase 4 lands.
- **Field adoption.** The loop's accuracy is capped by whether foremen clock in and code expenses. Mitigated by pre-populating the job, but it is behavior change for Nick and Alex.
- **Estimate discipline.** Every job needs a recorded estimate. Matt confirms one is always created internally — the system must make recording it the path of least resistance.
- **Parallel running.** Airtable/Fillout must keep working until each phase replaces them. No big-bang cutover.
