# Lost Boys Demolition — Ops System

**Client:** Lost Boys Demolition and Junk Removal LLC (Wasatch Front, Utah)
**Managed by:** Matt Risenmay, contracted CFO at CTA Integrity

---

## START HERE — read these first

| File | What it is |
|---|---|
| `SYSTEM_AUDIT_2026-07-30.md` | **Ground truth.** Live state of Airtable, Supabase, and this repo. Read before trusting any other doc. |
| `BUILD_PLAN.md` | **THE OFFICIAL PLAN.** Greenfield Postgres rebuild, phased 0–9. Confirmed by Matt 2026-07-30. Where any other document disagrees, this one wins. Amend it rather than starting a new plan doc. |

Several older docs in this repo describe a system that does not exist. `schema_overview.md`
contains no Airtable schema despite being cited elsewhere as the schema reference. The
15-function `stageN-*` build sequence is a superseded plan, not a backlog.
`SCHEMA_AUDIT_REPORT.md` predates significant base drift and has errors.

**`OPS_ROADMAP.md` (2026-07-15) is superseded** by `BUILD_PLAN.md` and its 0–10 phase numbering is
retired. It is untracked and slated for deletion in a future planning session. Do not plan from
it. It did lock several decisions this plan never covered — QuickBooks Online as the books via
Synder, the GHL number port and A2P registration, client sign-off, callback tracking, and Stripe
native invoice reminders — which are preserved verbatim in the "Carried over from OPS_ROADMAP.md"
section of `BUILD_PLAN.md`, along with a ClockShark-vs-in-house-clock-in conflict that was never
explicitly resolved.

---

## Where the project actually stands (2026-07-30)

**The system was never started, not broken.** Live: Estimates 296 records, Clients 989,
Jobs **9** (5 named "Test Job"), zero actuals anywhere — Expenses 0, Change Orders 0,
`time_entries` 0, `labor_actuals` 0, `expense_actuals` 0. Every variance field reads −100%.
The pricing engine has never computed a number (see audit §2).

**What runs daily:** Fillout (bid calculator + 3 foreman checklists), Google Calendar, Slack
crew channels, GHL (estimates sometimes, payments), Stripe via GHL, Gusto for payroll. The
Airtable Jobs pipeline and the Supabase stage functions are scaffolding.

**The one thing that genuinely works:** bidirectional client sync (`airtable-client-sync` +
`ghl-contact-sync`). 668 rows in `sync_log`, processing traffic daily, no errors since May 2.

---

## Direction — decisions Matt has made

- **Supabase Postgres becomes the source of truth.** Dane and Jackson work in GHL, not Airtable.
  All data they need should be reachable from a GHL opportunity or job record.
- **Direct Stripe invoicing**, with the invoice link surfaced in GHL. (Today they invoice
  through GHL's payment system, while the deployed `airtable-job-completed` creates invoices
  directly in Stripe — those were two different flows.)
- **Fillout may be replaced**, provided the replacement is mobile-friendly.
- **GHL needs edit capability** for scope changes, change orders, and pricing.
- **An internal estimate is always created**, even when no formal proposal is sent. This is
  Path B, and it means every job has a variance baseline.
- **Time tracking:** crews already clock in/out in the Gusto app daily. The friction is manual
  project creation and selection, so it doesn't get done. Feeding Gusto for payroll is a
  benefit, not a requirement — manual entry is acceptable.

## Open decisions blocking work

| # | Decision | Blocks |
|---|---|---|
| 1 | **Credit-card fee: cost line or pass-through?** Currently a 25% target reports as 27.25%. | Phase 2 — affects every margin number |
| 2 | **Dump Fee Buffer: priced in or informational?** Computed, referenced by nothing. | Phase 2 |
| 3 | Deposit policy — percentage or fixed, and threshold | Phase 3 |
| 4 | Scope calibration rules — sample size, median vs trimmed mean, Path B inclusion | Phase 8 |
| 5 | Drop the Gusto time-tracking add-on once crew clock-in ships? | Phase 4 (cost offset) |

Also pending: whether to add the missing `x-webhook-secret` check to `receive-airtable-webhook`
(live endpoint, currently unauthenticated).

## Outstanding tasks carried over from May

These are unblocked work items, not decisions. They predate the 2026-07-30 audit and survive it —
each one still applies to the currently deployed functions.

- **`airtable-job-created` v21 — GHL UI verification never done.** Deployed 2026-05-15 with full
  estimate field population, the Stage 3 fix, and `job_events` logging, but the session closed
  before anyone looked at GHL. Trigger on a test job with estimate fields populated, open the GHL
  opportunity, and confirm the custom fields show values and the opportunity landed in Stage 3
  (not Stage 4). If the fields are blank, suspect `id:` vs `key:` format — the function logs
  `[info] GHL customFields being sent:`.
- **4 Airtable source fields still missing.** The GHL custom fields exist, but the Jobs table has
  no field to feed them: Engagement Type (singleSelect), Estimated Materials (currency), Job Scope
  (multiSelect, 19 options), Scope Notes (multilineText). Create them, add each field ID to
  `JOB_FIELDS` in `airtable-job-created`, redeploy. Weigh this against Phase 1 — the rebuild may
  land these in Postgres instead.
- **Slack crew notifications in `airtable-job-scheduled`** are still `SLACK_PLACEHOLDER`. Needs
  `SLACK_CREW1_CHANNEL`–`SLACK_CREW4_CHANNEL` in Supabase secrets (`SLACK_BOT_TOKEN` is already
  set), then the notification logic.

## Resolved blockers (stalled since May, closed 2026-07-30)

- **Gusto has no public project-tracking read API.** Confirmed. It *does* publish
  `POST /v1/companies/{company_uuid}/time_tracking/time_sheets` for pushing classified hours in
  for payroll. → We own time capture and push to Gusto, rather than reading from it.
- **BILL Spend & Expense v3 API is fully capable**: `POST /v3/spend/custom-fields` (selector
  with `allowCustomValues: true`), `PUT /v3/spend/transactions/{id}/custom-fields`, and webhook
  subscriptions. → Job codes can be created automatically at scheduling time, which removes the
  manual-project friction on the expense side.

---

## Standing Instructions

### Build Planning Rule

Before writing any code for a **new build** (new edge function, new feature, significant
refactor), produce a plan covering step-by-step implementation, architecture decisions, risk
flags, and open questions. Present it to Matt and **wait for explicit approval** before writing
any code.

**Small changes** (targeted bug fixes, field ID swaps, minor edits to existing functions) do not
require this. If unsure whether something qualifies as a build, ask before proceeding.

### Repo/production parity

The repo drifted badly from production between May and July — three deployed functions existed
nowhere in git and a fourth was a generation stale, so redeploying from the repo would have
regressed live behavior. **Any function deployed to Supabase must be committed here in the same
session.** Verify with `mcp__Supabase__list_edge_functions` before assuming the repo is current.

---

## What This System Does

Closes the loop between estimates, actuals, and invoices. Every Closed Won job feeds back into
pricing accuracy.

- **Loop 1 — Profitability Intelligence:** Actuals → variance → Scope Library feedback → better estimates
- **Loop 2 — Revenue Cycle Automation:** Lead → invoice → payment, automated with human checkpoints only

---

## Tech Stack

### Target (per `BUILD_PLAN.md`)

| System | Role |
|---|---|
| Supabase Postgres | Source of truth |
| Next.js on Vercel (PWA) | Estimate builder, crew clock-in, foreman checklists, dashboard |
| GHL | Human surface for Dane/Jackson — headline numbers + links |
| Stripe | Direct invoicing and payments |
| Gusto | Payroll (we push timesheets in) |
| BILL Spend & Expense | Job-coded expenses via webhook |
| Google Calendar | Scheduling (retained) |
| Slack | Crew notifications (retained) |

**Being retired:** Airtable (post-migration), Fillout, Zapier, the 11 Airtable automations, and
edge functions `receive-airtable-webhook` / `push-to-airtable`.

### Current (live until replaced)

Airtable (9 tables), GHL, Supabase Edge Functions, Fillout, Gusto, BILL/Divvy, Stripe, Slack,
Google Calendar. **Zapier's actual role is unverified** — it is listed as retired below, but no
one has confirmed what, if anything, it still runs. Confirm before assuming it carries traffic.

---

## Repository Structure

```
/
├── BUILD_PLAN.md                # THE OFFICIAL PLAN — read this
├── SYSTEM_AUDIT_2026-07-30.md   # GROUND TRUTH — read this
├── BUILD_LOG.md                 # Deploy + session history — append an entry every session
├── NEXT_SESSION_PROMPT.md       # Ephemeral copy-paste handoff; regenerate each session
├── supabase/
│   ├── functions/               # Deno/TypeScript edge functions (all 7, reconciled 2026-07-30)
│   │   ├── airtable-client-sync/      # Airtable Clients → GHL Contacts  [LIVE, healthy]
│   │   ├── ghl-contact-sync/          # GHL Contacts → Airtable Clients  [LIVE, healthy]
│   │   ├── airtable-job-created/      # Airtable Jobs → GHL Opportunity (v21, Stage 3)
│   │   ├── airtable-job-scheduled/    # Stage 6 + Google Calendar + job_events
│   │   ├── airtable-job-completed/    # Stage 8 → Stripe draft invoice
│   │   ├── receive-airtable-webhook/  # writes Supabase jobs mirror  [UNAUTHENTICATED]
│   │   └── push-to-airtable/          # time_entries → Airtable actuals  [dormant, latent bug]
│   └── migrations/              # RLS + view hardening (2026-07-30)
├── airtable-automations/        # Airtable Scripting automations (live in base; edit in UI)
│   ├── create-line-items.js     # Fires on job creation → creates Invoice Line Item child records
│   ├── update-line-items.js     # Fires on job LI field edits → upserts/soft-deletes child records
│   ├── README.md                # What the scripts do; how to edit them safely
│   └── SETUP_INSTRUCTIONS.md    # Manual setup guide for the Airtable Automations UI
├── field_mapping.md             # ★ Consolidated reference: Airtable field IDs ↔ GHL custom field IDs
├── ghl_field_mapping.md         # 19 GHL opportunity custom field IDs (generated by create-ghl-fields.js)
├── create-ghl-fields.js         # One-time script: creates GHL opportunity custom fields (idempotent)
├── setup_airtable.js            # Admin script: initial Airtable schema setup
├── setup_airtable_v2.js         # Admin script: v2 schema setup
├── audit_schema.js              # Schema audit utility
├── schema_overview.md           # Supabase integration notes — NOT the Airtable schema
├── INTEGRATION_DESIGN.md        # BILL/Gusto integration research + edge-case rules
├── LostBoys_PricingEngine_ProjectBrief.md
├── SCHEMA_AUDIT_REPORT.md       # April audit — superseded, has errors
└── schema_audit.json            # April schema dump — STALE, base has drifted
```

---

## Edge Functions

All self-contained Deno/TypeScript. No shared utility library — helpers are inline per function.
Supabase project: `eiqqqwajmcpcwhvxxnhx`.

| Function | Deploy ver | Purpose |
|---|---|---|
| `airtable-client-sync` | 19 | Airtable Clients → GHL Contacts. Handles GHL duplicate-blocked 400 via `meta.contactId`. |
| `ghl-contact-sync` | 20 | GHL Contacts → Airtable Clients (reverse). |
| `airtable-job-created` | 21 | Jobs → GHL Opportunity at **Stage 3 only**. 15 custom fields via `buildCustomFields()` using `id:` format. Logs `job_events`. |
| `airtable-job-scheduled` | 16 | Advances to Stage 6, creates Google Calendar events (main + crew). Slack still a placeholder. |
| `airtable-job-completed` | 14 | Stage 8 → Stripe **draft** invoice, GHL Stage 9, task for Dane. Slack paused via `SLACK_NOTIFICATIONS_ENABLED = false`. |
| `receive-airtable-webhook` | 11 | Writes Supabase `jobs` mirror. **No auth.** Only handles `Scheduled`/`Invoiced` — never `Completed`, so the mirror is permanently stale. |
| `push-to-airtable` | 11 | Aggregates `time_entries` → Airtable actuals. Never run. Latent bug: PATCHes a formula field. |

**Line items (v7 behaviour):** each named item renders at its actual amount, including $0. If the
sum is below Total Bid, a "Project Total" line is appended for the difference. Fallback with no
line items: one "Demolition Services" line at Total Bid.

**Stripe rendering (critical):** For each line item, `POST /products` first, then
`POST /invoiceitems` with `price_data[product]` = the product ID. **Never** use
`price_data[product_data]` on `/invoiceitems` — Stripe rejects it.

**`sync_log` constraint:** `action_taken` must be one of `'created'`, `'updated'`, `'skipped'`,
`'error'`. Anything else is rejected by the check constraint.

### `airtable-job-created` — detail

Resolves GHL pipeline/stage/user IDs at cold start. Creates or updates the GHL opportunity at
**Stage 3 (Estimate in Progress)**, assigns to estimator, writes back the GHL Opp ID to Airtable.
Logs to both `sync_log` and `job_events`.

Custom fields sent at creation (using `id:` format, **not** `key:` format):
- Integration: Airtable Job ID (e.g. JOB-1042), Airtable Record ID
- Job info: Job Address, Job Type, Estimator
- Estimate: Labor Hours, Labor Cost, Dump Fees, Overhead, Profit, Profit Margin
- Scheduling fields (Crew, dates): intentionally omitted — set later by `airtable-job-scheduled`

**Future-slot fields** (wired but inactive until the Airtable fields exist): Engagement Type,
Estimated Materials, Job Scope, Scope Notes. To activate, fill the empty string in the
`JOB_FIELDS` constant with the Airtable field ID and redeploy.

**`buildCustomFields()`** omits any field that is null, empty, or a zero-length array. Monetary
values are sent as numbers. All field IDs live in the `GHL_CUSTOM_FIELDS` const at the top of the
file, sourced from `field_mapping.md`.

**Idempotency:** checks `GHL Opportunity ID` on the Airtable record first; if present, PUTs
directly. Otherwise searches GHL by contact + Airtable Job ID, matching on
`cf.id === GHL_CUSTOM_FIELDS.airtableJobId` OR the legacy `cf.key === 'job_id'`.

### `airtable-job-scheduled` — detail

Triggered by an Airtable Scripting automation when job status is set to "Scheduled". Google
Calendar is live: an all-day event is created on the main calendar **and** the crew calendar, and
the event ID is written back to Airtable `fldry3k8ZNGGbm1aJ`. Calendar failure is non-fatal — the
stage advance still succeeds. Writes `job_events` (stage 5→6).

**Event format:** all-day, title = Job Name, description mirrors the legacy Zapier layout — Name
of Client, Estimated Revenue, Crew, Address, Job Start Time, Phone Number, Client Type, then a JOB
SCOPE section listing all line items (no include-on-invoice filter — the crew needs full scope).
Both calendars are posted via `Promise.allSettled`.

**Crew → calendar mapping** (Airtable single-select value → Supabase secret):
- "Crew 1" → `GOOGLE_CALENDAR_CREW1` (Nick)
- "Crew 2" → `GOOGLE_CALENDAR_CREW2` (Alex)
- "Crew 3" → `GOOGLE_CALENDAR_CREW3` (Brady)
- "Crew 4" → `GOOGLE_CALENDAR_CREW4` (Cade)
- "Jackson" / "Other" → main calendar only

**Idempotency:** checks `fldry3k8ZNGGbm1aJ` (Google Calendar Event ID) before creating — skips if
already populated.

**Airtable automation guard:** the script checks that Crew and Start Date are populated before
firing. It does *not* check `status === 'Scheduled'` — that guard was removed because it blocked
retriggers.

**`stripe-webhook` (Stages 9–11) is NOT BUILT.** Sandbox endpoint is configured for
`invoice.sent` and `invoice.paid`. `STRIPE_SECRET_KEY` is currently a **test** key — confirm the
Lost Boys live account before real invoicing (the Stripe MCP in-session is CTA Integrity's).

---

## Supabase Tables

| Table | Rows | Purpose |
|---|---|---|
| `sync_log` | 668 | Audit trail of all sync operations. Every function writes here — no exceptions. |
| `client_sync_state` | 280 | Email, Airtable record ID, GHL contact/company IDs, last sync direction/time |
| `job_events` | 8 | Stage-transition audit log |
| `jobs` | 7 | Stale mirror of Airtable Jobs — exists only so `time_entries` has an FK target |
| `users`, `crews`, `time_entries` | 0 | Complete clock-in schema, never used |
| `labor_actuals`, `expense_actuals`, `invoice_reminders` | 0 | Empty scaffolding (created by migration 002) |

`job_events` columns: `stage_from`, `stage_to`, `function_name`, `trigger_source`,
`action_summary`, `status`, `error_message`, `payload_in`.

The three empty tables were provisioned ahead of use: `labor_actuals` for per-job labor hours,
`expense_actuals` for per-job card expenses, `invoice_reminders` for invoice follow-ups. Note that
the rebuild sources labor from our own clock-in (pushed *to* Gusto) and expenses from BILL Spend &
Expense — not from the Gusto/Divvy reads these tables were originally shaped for.

RLS is enabled on all of the above with **no policies by design** — `service_role` has
`rolbypassrls = true`, so edge functions are unaffected and anon is denied. The views
`recent_sync_activity` and `sync_errors` are `security_invoker = on` for the same reason.

---

## Environment Variables

```
AIRTABLE_API_KEY              GHL_API_KEY              STRIPE_SECRET_KEY
AIRTABLE_BASE_ID              GHL_LOCATION_ID          STRIPE_WEBHOOK_SECRET
AIRTABLE_WEBHOOK_SECRET       GHL_WEBHOOK_SECRET       SLACK_BOT_TOKEN
SUPABASE_URL                  SUPABASE_SERVICE_ROLE_KEY
GOOGLE_SERVICE_ACCOUNT_KEY    GOOGLE_CALENDAR_MAIN     GOOGLE_CALENDAR_CREW1..4
```

`.env` is stale — `AIRTABLE_WEBHOOK_SECRET` does not match Supabase. **Use the Supabase secret
as authoritative.**

`GOOGLE_SERVICE_ACCOUNT_KEY` holds the full service account JSON as a single string (GCP project
`lost-boys-demo`). The calendar vars map main + one per crew: CREW1 Nick, CREW2 Alex, CREW3 Brady,
CREW4 Cade.

**Google Calendar service account:** `lost-boys-calendar@lost-boys-demo.iam.gserviceaccount.com` — must have "Make changes to events" sharing permission on all 5 calendars.

---

## Architecture Decisions

- **Fillout → Airtable is a native Fillout integration, not Zapier.** Zapier is not involved in
  the job-creation path. Confirmed by Matt 2026-05-22. Older docs and session prompts say
  "Fillout → Zapier" — they are wrong, and designing around a Zapier step will produce incorrect
  architecture decisions.
- **Airtable field IDs are hardcoded** in each edge function for schema stability. Field *names*
  have drifted; IDs have not. Always address by ID, never by name.
- **Webhook pattern:** validate `x-webhook-secret`, return structured JSON, 200 or 500.
- **Cold-start ID resolution:** GHL pipeline, stage, and user IDs resolve once at init, not
  per-request.
- **One function per trigger.** No shared routing logic.
- **Every function writes to `sync_log`** — success, error, and skipped.
- Formula, rollup, lookup, linked-record and autonumber fields **cannot be created via the
  Airtable API** — always flag MANUAL SETUP REQUIRED.
- **Calculation ownership is split, and the split is deliberate.** Fillout owns *estimate* math
  and renders it as a live preview; Airtable stores the estimate outputs as **plain fields with
  no formulas**. Airtable formula fields own *actuals* and variance only. So an estimate number
  in Airtable is a value someone else computed — editing it recomputes nothing. This is why the
  pricing engine can hold 296 Estimates and still never have computed anything (audit §2), and
  it is the boundary Phase 2 moves into Postgres when Fillout is replaced.

---

## 13-Stage GHL Pipeline

| # | Stage | Exit Owner |
|---|---|---|
| 1 | New Lead | Estimator |
| 2 | Intake / Qualification | Estimator |
| 3 | Estimate in Progress | Estimator |
| 4 | Quote Sent | Client / Dane |
| 5 | Quote Accepted / Pending Schedule | Dane / Jackson |
| 6 | Job Scheduled | Dane |
| 7 | Job in Progress | Foreman |
| 8 | Job Completed | Automated |
| 9 | Invoice Review | Dane |
| 10 | Invoice Sent | Client / Dane |
| 11 | Paid / Closed Won | Automated |
| 12 | Closed Lost / Declined | Dane |
| 13 | Closed Lost / Cancelled | Dane |

Stages 12 and 13 are distinct — financially different (declined vs. cancelled after acceptance).
Rescheduled jobs return to Stage 5, not a separate hold stage.

---

## Key Rules

- **No "10 and 10" markup logic** — pricing is margin-divisor: `Base / (1 − margin)`
- **Field crew leaders = foremen** (not "crew leaders")
- **Dump-related costs = "Dump Fee"** (not "Disposal Charge") — note the live base still uses
  "Disposal" in five field names
- **Path A** = estimate-first; **Path B** = trusted contractor, invoice at completion. Both
  always produce an internal estimate.
- **Job ID format:** `JOB-XXXX` — universal key across all systems. Use one key format
  everywhere; today Postgres stores three different things in `job_id` columns.

---

## Pricing Benchmarks

Labor rate $26/hr · Overhead $23/hr · Target margin 25% floor · CC fee 3% · Dump fee $300/load

True all-in labor cost is $27–29/hr — $26 is conservative, so actual profit is structurally
overstated by $1–3 per labor hour wherever standard costing is used. The rebuild uses **real
per-employee pay rates** for actuals, keeping standard rates for estimating only.

Company benchmarks (Project Brief): labor ~63% of revenue, gross margin 40–60%, net 8–15%. Note
the 40–60% benchmark and the 25% engine target use different denominators and have never been
reconciled.

---

## Key Personnel

| Person | Role |
|---|---|
| Matt Risenmay | CFO (CTA Integrity) — architecture + financial oversight |
| Dane | Estimator/Office — owns GHL, invoice review, scheduling |
| Jackson | Estimator |
| Nick | Foreman, Crew 1 |
| Alex | Foreman, Crew 2 |
| Brady | Foreman, Crew 3 |
| Cade | Foreman, Crew 4 |

---

## Phase Roadmap

Per `BUILD_PLAN.md`, the official plan — this 0–9 numbering is canonical, and the retired
`OPS_ROADMAP.md` 0–10 numbering must not be used. Phases 0–4 are the critical path; nothing
produces a real profitability number until Phase 4, when labor actuals begin to exist.

| Phase | Status |
|---|---|
| 0 — Foundation & safety | **Repo reconciliation and RLS hardening DONE 2026-07-30.** Next.js/Vercel skeleton not started. |
| 1 — Core schema + data migration | Not started. Does not depend on the open decisions — safe to begin. |
| 2 — Estimating (replaces Fillout calculator) | **Blocked** on decisions 1 and 2 |
| 3 — Scheduling (Calendar, Slack, BILL job codes) | Not started |
| 4 — Field capture (crew clock-in, checklists, Gusto push) | Not started |
| 5 — Expenses (BILL webhooks) | Not started |
| 6 — Invoicing (direct Stripe, `stripe-webhook`) | Not started |
| 7 — Profitability (variance engine, job report page) | Not started |
| 8 — Feedback loop (scope calibration) | Not started |
| 9 — Reporting dashboard | Not started |

**Parallel running throughout.** Airtable and Fillout keep working until each phase replaces
them. No big-bang cutover.

---

## Build Log — Standing Instructions

### STANDING RULE — required at the end of every session

`BUILD_LOG.md` in this repo is the build log. Before closing any session that deployed a function,
changed the system, or changed its documentation, you MUST add an entry at the top of its
*Entries* section: what shipped, deploy version and URL if applicable, defects found but not
fixed, decisions taken, and what the next session needs to know. Update the
*Current status at a glance* table if a function's status changed.

Not optional, and not limited to deploys — a documentation-only session still changes what a
future session needs to know. If a session ends without this, the log goes stale and the next
session starts with an incomplete picture.

Keep it in the repo and commit it with the work it describes. That is the point: the log lives
under version control alongside the code it documents, so the two cannot drift apart.

### Pipeline Reference Base (Airtable) — partially retired

**Base ID:** `appA7uj7FhnPp9Bvg` — still the system of record for **Field Registry**,
**Secrets & Credentials**, and **People & IDs**. Update those tables when you create or discover
Airtable field IDs, add Supabase secrets, or learn new team member IDs.

Its **`Build Log` table (`tbl3pCxGn0xqC1Qvu`) is superseded** as of 2026-07-30. All 8 records were
migrated into `BUILD_LOG.md`. Do not write to that table and do not read it as current.
