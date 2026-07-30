# Lost Boys Demolition — Profitability System Build Plan

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

## Phases

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

## Open decisions needed from Matt

1. **Credit card fee** — cost line or pass-through? (Affects every reported margin.)
2. **Dump Fee Buffer** — priced in, or informational? (Currently computed and used nowhere.)
3. **Deposit policy** — percentage or fixed, and the threshold. (Deferred since May; blocks deposit automation.)
4. **Scope calibration rules** — minimum sample size, median vs trimmed mean, Path B inclusion.
5. **Gusto add-on** — drop the time-tracking/project add-on once Phase 4 ships? (Offsets build cost.)

## Risks

- **Scope.** This is a genuine application build, not an integration. Phases 0–4 are the critical path; 5–9 deliver compounding value but the system is not useful until Phase 4 lands.
- **Field adoption.** The loop's accuracy is capped by whether foremen clock in and code expenses. Mitigated by pre-populating the job, but it is behavior change for Nick and Alex.
- **Estimate discipline.** Every job needs a recorded estimate. Matt confirms one is always created internally — the system must make recording it the path of least resistance.
- **Parallel running.** Airtable/Fillout must keep working until each phase replaces them. No big-bang cutover.
