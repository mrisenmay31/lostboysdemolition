# Lost Boys Demolition — Ops System

**Client:** Lost Boys Demolition and Junk Removal LLC (Wasatch Front, Utah)
**Managed by:** Matt Risenmay, contracted CFO at CTA Integrity

---

## START HERE — read these first

| File | What it is |
|---|---|
| `DISCOVERY_2026-07-31.md` | **READ FIRST. Business ground truth.** Real pricing formulas, and the financial analysis of Stripe, BILL, Gusto payroll, and GHL invoices. Supersedes the audit wherever they conflict. |
| `SYSTEM_AUDIT_2026-07-30.md` | **Systems ground truth.** Live state of Airtable, Supabase, and this repo. **§2 is materially wrong** — it describes `Jobs (old)`, not the live base. See discovery §8. |
| `BUILD_PLAN.md` | **THE OFFICIAL PLAN**, amended 2026-07-31. Phase numbering is now **A–G + Track B**; the 0–9 sequence is retired. Amend it rather than starting a new plan doc. |

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

## Where the project actually stands (2026-07-30 / updated 2026-08-13)

**The system was never started, not broken** — as of 2026-07-30. **As of 2026-08-13, Phase A
(the job record keystone) has shipped and is live**: `ghl-job-webhook` mints a canonical
`JOB-XXXX` Postgres job record when Dane/Jackson move a GHL opportunity to Quote Accepted, and
schedules Google Calendar + Slack crew notifications at Job Scheduled. **Verification is complete
as of 2026-08-14:** both paths were verified by Matt dragging real opportunities through the actual
GHL UI — Quote Accepted minted JOB-1104, Job Scheduled drove both calendars + Slack, a real-workflow
re-drag proved idempotency AND that GHL allows workflow re-entry, and the loud no-job-record error
guard fired correctly when Job Scheduled was hit before Quote Accepted. GHL DATE custom fields
arrive ISO-parseable through the real workflow (the epoch-ms risk did not materialize). See the
2026-08-13 Phase A entry and the 2026-08-14 entry in `BUILD_LOG.md`; the Airtable/Fillout counts
below still describe the pre-Phase-A world.

Live: Estimates 296 records, Clients 989, Jobs **9** in the old Airtable pipeline (5 named "Test
Job"; the new canonical Postgres `jobs` table is separate and holds 2 test rows, JOB-1102 and
JOB-1104, both cancelled), zero
actuals anywhere — Expenses 0, Change Orders 0, `time_entries` 0, `labor_actuals` 0,
`expense_actuals` 0. Every variance field reads −100%. The pricing engine has never computed a
number (see audit §2).

**What runs daily:** Fillout (bid calculator + 3 foreman checklists), Google Calendar, Slack
crew channels, GHL (estimates sometimes, payments), Stripe via GHL, Gusto for payroll. The
Airtable Jobs pipeline and the Supabase stage functions are scaffolding.

**The one thing that genuinely works:** bidirectional client sync (`airtable-client-sync` +
`ghl-contact-sync`). 918 rows in `sync_log`, processing traffic daily. One transient error burst
2026-08-11 (14 Airtable-create failures under bulk load, all self-healed within 5 minutes, no data
loss); no retry/backoff exists, so treat bulk imports with care.

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

Updated 2026-07-31. Decisions 1 and 2 are **resolved**; a new blocker replaced them.

| # | Decision | Status |
|---|---|---|
| 1 | Credit-card fee | ✅ **Resolved** — 3.5%, booked as a cost line, prices held constant. The Airtable `Pricing Variables` row at 3% is stale and read by nothing. |
| 2 | Dump Fee Buffer | ✅ **Resolved** — $300/load is a **pricing rate**, not a cost; priced in as-is, real per-load cost tracked separately from BILL. The field never existed in the live base. |
| 3 | **Phase D — time tracking** | 🔴 **BLOCKING.** Gusto has **no project-creation API** (`time_tracking/time_sheets` requires a pre-existing `job_uuid`). Crews already clock in reliably; the project is what's missing. Four options in `BUILD_PLAN.md`. |
| 4 | Deposit policy | ⚪ Open, now decidable — 39 jobs over $5,000 = **21% of jobs, 57% of revenue.** |
| 5 | Scope calibration rules | ⚪ Open — Phase G. Proposed: min 5 `measured`; median until n≥8 then trimmed mean. |
| 6 | Gusto add-on | ⚪ Verify, don't decide — may be required to *accept* timesheet pushes. |
| 7 | Lead intake — route Grasshopper into GHL, or port it | ⚪ Open (Track B) |

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
- **Slack crew notifications in `airtable-job-scheduled`** are still `SLACK_PLACEHOLDER`.
  `SLACK_CREW1_CHANNEL`–`SLACK_CREW4_CHANNEL` secrets were **set 2026-08-13** for the Phase A build
  (`ghl-job-webhook` and `crew-night-before` already use them); only the notification logic inside
  `airtable-job-scheduled` itself remains a placeholder.

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
Google Calendar, **Grasshopper** (public business number, voice + SMS, ~6 months, routes to
Jackson's phone).

**Zapier's role is now confirmed (2026-07-31): it runs the website lead form → Slack.** That is a
**live dependency — do not retire Zapier blindly.** It previously also sent the night-before crew
Slack message; that was abandoned as unreliable and is typed by hand today.

---

## Repository Structure

```
/
├── DISCOVERY_2026-07-31.md      # BUSINESS GROUND TRUTH — read this FIRST
├── BUILD_PLAN.md                # THE OFFICIAL PLAN (amended 2026-07-31) — read this
├── SYSTEM_AUDIT_2026-07-30.md   # SYSTEMS ground truth — §2 is wrong, see discovery §8
├── BUILD_LOG.md                 # Deploy + session history — append an entry every session
├── NEXT_SESSION_PROMPT.md       # Ephemeral copy-paste handoff; regenerate each session
├── docs/
│   └── superpowers/
│       └── plans/                    # Implementation plans + frozen session ledgers
├── supabase/
│   ├── functions/               # Deno/TypeScript edge functions (9 + _shared; Phase A additions 2026-08-13)
│   │   ├── airtable-client-sync/      # Airtable Clients → GHL Contacts  [LIVE, healthy]
│   │   ├── ghl-contact-sync/          # GHL Contacts → Airtable Clients  [LIVE, known defect — see Edge Functions]
│   │   ├── airtable-job-created/      # Airtable Jobs → GHL Opportunity (v21, Stage 3)
│   │   ├── airtable-job-scheduled/    # Stage 6 + Google Calendar + job_events
│   │   ├── airtable-job-completed/    # Stage 8 → Stripe draft invoice
│   │   ├── receive-airtable-webhook/  # writes Supabase jobs mirror  [UNAUTHENTICATED]
│   │   ├── push-to-airtable/          # time_entries → Airtable actuals  [dormant, latent bug]
│   │   ├── _shared/                   # job naming/validation + Google auth + log writers + pricing.ts (+ 2 test files, fixtures/), unit-tested
│   │   ├── ghl-job-webhook/           # Phase A: GHL workflow → job record + scheduling  [LIVE v7]
│   │   └── crew-night-before/         # nightly crew digest, pg_cron  [LIVE v4]
│   └── migrations/              # RLS + view hardening (2026-07-30) + Phase A schema/cron (4 files, 2026-08-13) + Phase B estimates schema/fixups/seeds/fixups2 (4 files, 2026-08-14)
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

All self-contained Deno/TypeScript. The 5 Airtable-era functions keep helpers inline; as of
2026-08-13, `ghl-job-webhook` and `crew-night-before` share `supabase/functions/_shared/`
(job-name/city parsing, Google Calendar auth lifted from `airtable-job-scheduled`, and
`sync_log`/`job_events` writers that check and log `supabase-js` errors). Supabase project:
`eiqqqwajmcpcwhvxxnhx`.

**`_shared/pricing.ts`** (added 2026-08-14, Phase B slice-1) is the estimating engine — an exact
TypeScript port of the live Fillout calculator chain (`computeEstimate()`), not yet wired into any
deployed function. True half-up cent rounding (`roundToCent`) and `requireRates` input validation
(all rates finite ≥ 0, `ccFeeRate < 1`) were added by the Task 1 review fix. `pricing_test.ts` (12
unit tests) and `pricing_golden_test.ts` (2 tests, backed by `fixtures/estimates-golden-321.json`)
prove it reproduces all 321 live Airtable estimates to the cent — 309 exact, 11 legacy two-sided
pinned deltas, 1 penny-tolerance — under the corrected rounding, i.e. the rounding fix moved no
quoted price. Run the whole `_shared` suite with `deno test --allow-all supabase/functions/_shared/`
(18/18 passing as of 2026-08-14, including `job_test.ts`). The engine currently snapshots
`DEFAULT_RATES`; reading rates from `pricing_variables` at runtime arrives with the estimate
builder UI, the next Phase B slice.

Legacy function version numbers in the table below may read higher than last documented here —
the Supabase CLI's deploy tooling bumps version counters on unrelated already-deployed functions
as a side effect of any deploy; their `sha256` is unchanged, so this is cosmetic, not a redeploy.

| Function | Deploy ver | Purpose |
|---|---|---|
| `airtable-client-sync` | 19 | Airtable Clients → GHL Contacts. Handles GHL duplicate-blocked 400 via `meta.contactId`. |
| `ghl-contact-sync` | 27 | GHL Contacts → Airtable Clients (reverse). **Tags defect FIXED 2026-08-14** (commit `65cae85`): GHL workflow webhooks send `tags` as a comma-separated string; now normalized, and payload extraction moved inside the try so parse errors log to `sync_log` instead of escaping as unlogged 500s. Live-verified same day. Review found contacts with tags had *never* synced client type before this fix (all 590 logged payloads carried string tags). |
| `airtable-job-created` | 21 | Jobs → GHL Opportunity at **Stage 3 only**. 15 custom fields via `buildCustomFields()` using `id:` format. Logs `job_events`. |
| `airtable-job-scheduled` | 16 | Advances to Stage 6, creates Google Calendar events (main + crew). Slack still a placeholder. |
| `airtable-job-completed` | 14 | Stage 8 → Stripe **draft** invoice, GHL Stage 9, task for Dane. Slack paused via `SLACK_NOTIFICATIONS_ENABLED = false`. |
| `receive-airtable-webhook` | 11 | Writes Supabase `jobs` mirror. **No auth.** Only handles `Scheduled`/`Invoiced` — never `Completed`, so the mirror is permanently stale. Retirement queued. |
| `push-to-airtable` | 11 | Aggregates `time_entries` → Airtable actuals. Never run. Latent bug: PATCHes a formula field. |
| `ghl-job-webhook` | 6 | GHL workflow webhook → mints JOB-XXXX at Quote Accepted (Postgres jobs), schedules at Job Scheduled (Calendar main+crew, Slack crew notify, gated BILL). Accepts top-level or customData body. |
| `crew-night-before` | 4 | Nightly 16:00 America/Denver crew digest (pg_cron 22:30+23:30 UTC, self-gating). Slack per-crew. |

**Line items (v7 behaviour):** each named item renders at its actual amount, including $0. If the
sum is below Total Bid, a "Project Total" line is appended for the difference. Fallback with no
line items: one "Demolition Services" line at Total Bid.

**Stripe rendering (critical):** For each line item, `POST /products` first, then
`POST /invoiceitems` with `price_data[product]` = the product ID. **Never** use
`price_data[product_data]` on `/invoiceitems` — Stripe rejects it.

**`sync_log` constraints (all discovered/documented 2026-08-13 — CLAUDE.md previously recorded only
the first):**
- `action_taken` must be one of `'created'`, `'updated'`, `'skipped'`, `'error'`.
- `direction` must be one of `'ghl_to_airtable'`, `'airtable_to_ghl'`, `'ghl_to_supabase'`,
  `'supabase_to_slack'` — the latter two were added by migration `phase_a_audit_write_fixups` for
  `ghl-job-webhook` and `crew-night-before`; the constraint originally allowed only the two
  Airtable directions and rejected Phase A's writes with a live 400 until widened.
- `match_method` and `status` also carry check constraints — these predate the repo migration set
  (live-verified 2026-08-13); `job_events.status` check allows `success`|`error`|`skipped`
  (live-verified).
Anything outside these is rejected by the check constraint.

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
| `sync_log` | 918+ | Audit trail of all sync operations. Every function writes here — no exceptions. |
| `client_sync_state` | 280 | Email, Airtable record ID, GHL contact/company IDs, last sync direction/time |
| `job_events` | growing | Stage-transition audit log |
| `jobs` | 2 (JOB-1102, JOB-1104 — both cancelled test rows) | **Canonical Phase A job record** as of 2026-08-13 (migration `phase_a_jobs_keystone`). `job_number` (`JOB-XXXX`, minted via `next_job_number()`/`job_number_seq`, starting 1100) is the canonical key going forward — see Key Rules. Columns: `job_number`, `client_name`, `client_type`, `job_address`, `city`, `ghl_opportunity_id`, `ghl_contact_id`, `estimate_value`, `crew`, `start_date`, `end_date`, `status_v2` (`job_lifecycle` enum: accepted/scheduled/in_progress/completed/invoiced/paid/cancelled), `gcal_main_event_id`, `gcal_crew_event_id`, `slack_notified_at`, `night_before_sent_on`, `bill_job_code`, `updated_at`. Legacy columns (`airtable_job_id`, `airtable_status`, `estimated_hours`, `job_start_date`, `archived_at`, and the old `status` enum) are kept, nullable, for legacy readers during parallel running. RLS enabled, no policies by design (two stale clock-in-era policies were dropped in the fixups migration to restore that posture). |
| `jobs_legacy_backup` | 7 | Archived copy of the pre-Phase-A `jobs` rows (May-2026 test mirrors), created before `jobs` was reset. RLS enabled, no policies. |
| `users`, `crews`, `time_entries` | 0 | Complete clock-in schema, never used |
| `labor_actuals`, `expense_actuals`, `invoice_reminders` | 0 | Empty scaffolding (created by migration 002) |
| `estimates` | 0 | **Phase B slice-1, LIVE 2026-08-14** (migrations `phase_b_estimates_schema` + `phase_b_estimates_fixups` + `phase_b_estimates_fixups2`). Canonical versioned estimate header — inputs, rate snapshot, and `computeEstimate()` outputs (`labor_cost`, `dump_fees`, `total_direct`, `overhead`, `profit`, `cc_fee`, `total_bid`, `true_margin_pct`), plus `quoted_price`/`quote_override_reason` for when Dane discounts off the calculated number. `dump_count` is `numeric(6,2)` (widened from `numeric(5,1)` by `fixups2` so real fractional loads like 0.25/0.35/1.25 store exactly instead of rounding). `estimate_number` (`estimate_number_seq`, starting 1400; 1001–1321 reserved for the deferred Airtable backfill) + `version` are unique together; `supersedes_estimate_id` chains corrections, and a `version_chain` check constraint (added by `fixups2`) enforces the writer contract — any row with `version > 1` must set `supersedes_estimate_id` to the parent row's id (and must supply the parent's `estimate_number` explicitly, since the `nextval` default is only correct for new version-1 rows). **Immutable by trigger** (`enforce_estimate_immutability`, `search_path` pinned): after insert, only `status`, `quoted_price`, `quote_override_reason`, and `job_number` may change — any other column edit raises; a correction is a new version row, not an update. **DELETE is also blocked** (`enforce_estimate_no_delete`, added by the fixups migration) — there is no delete path, by design. RLS enabled, no policies. |
| `estimate_line_items` | 0 | Child rows of `estimates` (FK `on delete cascade`, though the parent can't be deleted). Snapshots a Scope Library item's name/hours/dump/materials onto the estimate at creation time. **Fully immutable by trigger** (`enforce_estimate_line_item_immutability`, added by the fixups migration) — UPDATE and DELETE both raise unconditionally; a correction means a new estimate version with new line item rows. RLS enabled, no policies. |
| `scope_library` | 19 | Controlled vocabulary of biddable scope items (seeded 2026-08-14 from live Airtable data, `airtable_record_id` preserved for provenance). Default labor hours/dump count per item; `default_materials_cost` left NULL for Phase G to seed from actuals. Mutable — not versioned like estimates. RLS enabled, no policies. |
| `pricing_variables` | 6 | Key/value rate table (seeded 2026-08-14): `labor_rate_per_hour` 26, `overhead_rate_per_hour` 23, `dump_rate_per_load` 300, `cc_fee_rate` 0.0350, `default_markup_pct` 25, `markup_floor_pct` 15 — the corrected 3.5% CC fee, not the stale Airtable 3% row. Not yet read at runtime; the engine still snapshots `DEFAULT_RATES` in code (see Edge Functions). RLS enabled, no policies. |

JOB-1102 (2026-08-13) and JOB-1104 (2026-08-14) were minted from real GHL opportunities during
live E2E verification; both are `status_v2='cancelled'`, so no night-before digest will fire for
them. Their four test calendar events were manually deleted by Matt 2026-08-14 — no test
artifacts remain on any calendar.

`job_events` columns: `stage_from`, `stage_to`, `function_name`, `trigger_source`,
`action_summary`, `status`, `error_message`, `payload_in`, plus `job_number` and
`ghl_opportunity_id` (present on the live schema but omitted from this list before 2026-08-13 —
Task 2's review caught the gap; the writers were already correct). `job_id` is the **legacy**
column, holding Airtable `recXXX` IDs written by the `airtable-*` functions; it was `NOT NULL`
until the `phase_a_audit_write_fixups` migration dropped that constraint, because new Phase A code
(`ghl-job-webhook`, `crew-night-before`) intentionally writes `job_number` only and omits it.

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
SLACK_CREW1_CHANNEL..4        BILL_API_TOKEN (absent by design)
```

`.env` is stale — `AIRTABLE_WEBHOOK_SECRET` does not match Supabase. **Use the Supabase secret
as authoritative.**

`GOOGLE_SERVICE_ACCOUNT_KEY` holds the full service account JSON as a single string (GCP project
`lost-boys-demo`). The calendar vars map main + one per crew: CREW1 Nick, CREW2 Alex, CREW3 Brady,
CREW4 Cade.

**Google Calendar service account:** `lost-boys-calendar@lost-boys-demo.iam.gserviceaccount.com` — must have "Make changes to events" sharing permission on all 5 calendars.

`SLACK_CREW1_CHANNEL`–`SLACK_CREW4_CHANNEL` — **set 2026-08-13** for the Phase A build. Crew1
`C087S6M0Q4Q` (Nick), Crew2 `C087S6G3248` (Alex), Crew3 `C0ABF44937A` (Brady), Crew4
`C0ABF4XMKDE` (Cade). Used by both `ghl-job-webhook`'s schedule leg and `crew-night-before`.

`BILL_API_TOKEN` — **absent in every environment, by design.** No BILL credentials exist yet;
`ghl-job-webhook`'s BILL job-code leg is gated on this variable and no-ops cleanly while it's
unset. Supply it to turn the leg on (Phase A) or wait for Phase C.

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

## 12-Stage GHL Pipeline

⚠️ **Corrected 2026-08-13.** This table previously listed 13 stages including a separate
"Closed Lost / Cancelled". Live verification during the Phase A build (`ghl-job-webhook`'s
cold-start pipeline resolution, which fetches and logs every stage name on the real "Job
Pipeline") found the live pipeline has **12 stages, not 13** — there is no "Closed Lost
(Cancelled)" stage in GHL. "Quote Accepted" and "Job Scheduled" — the two stages
`ghl-job-webhook` triggers on — were confirmed present and resolved by substring match.

| # | Stage | Exit Owner |
|---|---|---|
| 1 | New Lead | Estimator |
| 2 | Intake / Qualification | Estimator |
| 3 | Estimate in Progress | Estimator |
| 4 | Quote Sent | Client / Dane |
| 5 | Quote Accepted | Dane / Jackson |
| 6 | Job Scheduled | Dane |
| 7 | Job In Progress | Foreman |
| 8 | Job Completed | Automated |
| 9 | Invoice Review | Dane |
| 10 | Invoice Sent | Client / Dane |
| 11 | Paid / Closed Won | Automated |
| 12 | Closed Lost / Declined | Dane |

Rescheduled jobs return to Stage 5, not a separate hold stage. The former stage-13 distinction
(declined vs. cancelled after acceptance) does not exist as a separate pipeline stage live — if
that distinction still matters financially, it needs another representation (e.g. a field), not a
stage.

---

## Key Rules

- **Pricing is cost-plus MARKUP, not a margin divisor.** ⚠️ Corrected 2026-07-31. The rule here used
  to say margin-divisor `Base / (1 − margin)`; that chain was specified and **never implemented**.
  The live Fillout calculator computes `(Total Direct + Overhead) × (Profit % / 100)` and adds it —
  so an entered 25% realises **19.3%** of revenue and the "15% floor" is really 12.6%. **Dane and
  Jackson intend cost-plus**, so this is a labeling problem: rename the field, report true margin
  alongside, change no prices.
- **Field crew leaders = foremen** (not "crew leaders")
- **Dump-related costs = "Dump Fee"** (not "Disposal Charge") — note the live base still uses
  "Disposal" in five field names
- **Path A** = estimate-first; **Path B** = trusted contractor, invoice at completion. Both
  always produce an internal estimate.
- **Job ID format:** `JOB-XXXX` — universal key across all systems. Use one key format
  everywhere; today Postgres stores three different things in `job_id` columns.

---

## Pricing Benchmarks

Labor rate $26/hr · Overhead $23/hr · **Markup** 25% (per-job, floor 15%) · CC fee **3.5%** ·
Dump **$300/load charged**

**Corrected 2026-07-31 from real payroll — the previous entry here was backwards.** True all-in
field labor is **$23.13/hr** (25 crew, 15,613 productive hours, $361,188 employer cost, Jan–Jul
2026). The $26 standard sits **$2.87/hr *above* cost**, so profit is *understated*, not overstated.
*Caveat: Gusto's employer cost excludes workers' comp; at ~10% of payroll true cost is nearer
$25.30 — confirm from the policy before treating the gap as real.* The rebuild still uses **real
per-employee pay rates** for actuals.

**The 25% vs. 40–60% margin conflict is now reconciled** — it was four pads running in opposite
directions: dump (+$221k/yr), CC fee (+$15k), labor rate (+$41k), against a labor-hours shortfall
(−$246k/yr). **The dump pad has been financing the labor shortfall.** Net ≈ +$31k. Full derivation
in `DISCOVERY_2026-07-31.md` §7.

⚠️ **No pricing input may be corrected in isolation, and no quoted price may move.** Correcting the
dump rate alone would strip out the buffer covering a ~$246k annual gap. Every fix is a *reporting*
change; repricing is Dane's separate decision, made once, on real data.

Measured scale (annualized): **~$1,315k invoiced / ~$1,169k paid**; field payroll ~$619k; BILL card
spend ~$572k; ~712 dump loads at a **$65 median actual cost** against a ~$388 effective charge.

---

## Key Personnel

| Person | Role |
|---|---|
| Matt Risenmay | CFO (CTA Integrity) — architecture + financial oversight; chases AR |
| Dane | **Owner, founder, president** — estimates, invoice review/send, scheduling, on-site QA |
| Jackson | **Sales / estimator** — estimates, sells, picks up website leads, review requests |
| Nick | Foreman, Crew 1 |
| Alex | Foreman, Crew 2 |
| Brady | Foreman, Crew 3 |
| Cade | Foreman, Crew 4 |

---

## Phase Roadmap

⚠️ **The 0–9 numbering below is RETIRED as of 2026-07-31**, along with `OPS_ROADMAP.md`'s 0–10.
The canonical structure is now **A–G + Track B** in `BUILD_PLAN.md` → "Revised phases (2026-07-31)".

| Phase | Status |
|---|---|
| **A — The job record (keystone)** | 🟢 **Substantially complete 2026-08-13** — job record + GHL workflows + calendar/Slack live; BILL leg gated; night-before digest live. See `BUILD_LOG.md`. |
| **B — Estimate builder** | 🟡 **Slice 1 MERGED to main 2026-08-14** — pricing engine (`_shared/pricing.ts`) + estimates schema + seeds live and merged; verified to the cent against all 321 live estimates (golden master). **Slice 2 next:** estimate builder UI (first Next.js/Vercel app code) + GHL push. Kills the Fillout→GHL rekeying Dane named as a huge friction point. Must reproduce today's prices to the cent. |
| **C — Expenses + dump counts (BILL)** | Not started. One transaction = one dump load, so this delivers cost *and* count. |
| **D — Time tracking** | 🔴 **Blocked** on the open decision. |
| **E — Invoicing** | Not started. Direct Stripe, `stripe-webhook`, AR digest, Synder→QBO. |
| **F — Profitability** | Not started. Variance, job report on the GHL opportunity, change orders, callbacks. |
| **G — Feedback loop & reporting** | Not started. Seeds `default_materials_cost` here, from actuals. |
| **Track B — Lead intake** | Config only, runs in parallel, **start now.** |
| **Backlog (BL-1/2/3)** | ⚪ Captured 2026-07-31, **not scheduled.** Equipment maintenance, tool inventory, crew-level P&L + foreman incentive comp. See `BUILD_PLAN.md` → "Backlog — captured, not scheduled". |

Foundation work already done (2026-07-30): repo/production reconciliation and RLS hardening. The
Next.js/Vercel skeleton is **not** started — `package.json` declares only `dotenv`.

### Superseded 0–9 numbering (provenance only)

Phases 0–4 were the critical path; nothing produced a real profitability number until Phase 4.

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
