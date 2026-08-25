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

**Superseded docs now live in `docs/archive/`** (moved there 2026-08-14; see that directory's
`README.md` for what each one was and what replaced it). Nothing was deleted, and filenames are
unchanged — older BUILD_LOG entries citing them by name still resolve, just under a new path. Do
not plan from anything in there. In particular: `docs/archive/schema_overview.md` contains no
Airtable schema despite older docs citing it as *the* schema reference, and its 15-function
`stageN-*` build sequence is a superseded plan, not a backlog.

**`docs/archive/OPS_ROADMAP.md` (2026-07-15) is superseded** by `BUILD_PLAN.md` and its 0–10 phase
numbering is retired. It did lock several decisions this plan never covered — QuickBooks Online as
the books via Synder, the GHL number port and A2P registration, client sign-off, callback
tracking, and Stripe native invoice reminders — which are preserved verbatim in the "Carried over
from OPS_ROADMAP.md" section of `BUILD_PLAN.md`, along with a ClockShark-vs-in-house-clock-in
conflict that was never explicitly resolved. Read it there, not from the archived roadmap.

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
Job"; the new canonical Postgres `jobs` table is separate and holds 4 test rows,
JOB-1102/1104/1105/1106, all cancelled), zero
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
- **2026-08-18 — Profitability Program v2 ratified** (see `BUILD_PLAN.md` → 2026-08-18 amendment;
  canonical program: `docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md`):
  **app-side scheduling will mint `JOB-XXXX`** — Quote Accepted becomes pre-job; Phase A's GHL
  minting stays live until v2 Task 4 ships, then is flag-disabled permanently. **Two-way Google
  Calendar sync** is a requirement (full channel lifecycle specified). **Scoped Supabase Auth
  returns** for foremen + Dane's financial routes via an isolated `workforce_profiles` boundary
  (BL-7 resolved by v2 Task 0B); the estimator picker stays for estimates. **Direct Stripe +
  Synder→QBO reaffirmed** — GHL never becomes invoice authority. **Phase D decided** (D1/D2
  split — see Open decisions row 3).
- **2026-08-25 — the Job Dashboard is the web app's HOME surface** (see `BUILD_PLAN.md` →
  2026-08-25 amendment): estimates become a section within the dashboard app, per the reviewed
  prototype's header IA. **The `/` flip is deferred to v2 Task 8** — the deployment is
  network-open and the dashboard carries profitability data, so v2 Task 6 builds `/jobs` + an
  "Estimates" nav link while `/` keeps redirecting to `/estimates` until Task 8 owner-gates the
  financial routes.

## Open decisions blocking work

Updated 2026-07-31. Decisions 1 and 2 are **resolved**; a new blocker replaced them.

| # | Decision | Status |
|---|---|---|
| 1 | Credit-card fee | ✅ **Resolved** — 3.5%, booked as a cost line, prices held constant. The Airtable `Pricing Variables` row at 3% is stale and read by nothing. |
| 2 | Dump Fee Buffer | ✅ **Resolved** — $300/load is a **pricing rate**, not a cost; priced in as-is, real per-load cost tracked separately from BILL. The field never existed in the live base. |
| 3 | **Phase D — time tracking** | ✅ **Resolved 2026-08-18** — split **D1** (unblocked: canonical job-time schema, manual/CSV import, foreman approval, Dane override, labor-cost attribution, audit history, provider-neutral adapter contract) / **D2** (deferred: vendor evaluation + production connector; any vendor must auto-accept `JOB-XXXX` and return corrected/approved job-coded time). See `BUILD_PLAN.md` → 2026-08-18 amendment. |
| 4 | Deposit policy | ⚪ Open, now decidable — 39 jobs over $5,000 = **21% of jobs, 57% of revenue.** |
| 5 | Scope calibration rules | ⚪ Open — Phase G. Proposed: min 5 `measured`; median until n≥8 then trimmed mean. |
| 6 | Gusto add-on | ⚪ Parked until Phase D2 vendor evaluation (2026-08-18). Gusto remains payroll. |
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

### Parallel agent execution — required, not just the default

**Matt's directive (2026-08-17, strengthened 2026-08-18): code quality and integrity are priority
one, always. Efficiency is priority two. Running agents concurrently is a must — REQUIRED whenever
it does not impact quality or integrity.** The two priorities are ordered, not traded off —
parallelism buys speed by removing *idle waiting*, never by removing a review or a test gate.
Serializing work is legitimate **only** for the quality/integrity boundaries listed below; any other
reason for serial dispatch violates this directive.

**Write plans for concurrency (2026-08-18).** Concurrency is designed in at plan-writing time, not
discovered at dispatch time. Every implementation plan must structure its tasks so multiple agents
can be deployed concurrently where it makes sense: disjoint file ownership per task, shared
interfaces built first so lanes can fan out against them, and a per-task note naming which other
tasks it can run alongside. A plan whose tasks could have been made independent but weren't is a
defective plan.

**Default to concurrent.** Before dispatching anything, ask "what else could be running right now?"
and launch all of it in a single message with multiple tool calls. Serial dispatch of independent
work is a defect in the plan, not a safe choice. What made this work in practice:

- **Isolated worktrees per lane.** `git worktree add .claude/worktrees/<lane> -b <branch> main`.
  Independent lanes build, review, and merge on their own clock; each merges to `main` as soon as
  its own review passes, rather than waiting for a big-bang merge at the end.
- **Explicit file ownership in every prompt.** When two agents share one worktree, name the exact
  files each one owns and state that everything else is off-limits, including the other agent's
  directory. Disjoint file sets make same-worktree concurrency safe.
- **Scoped test runs while siblings are mid-flight.** Tell each agent to run only its own
  directory's tests (`deno test supabase/functions/<fn>/`), because a sibling's transient broken
  state produces phantom failures that agents then "helpfully" try to fix. The orchestrator runs
  the full suite once, at the end, as the real gate.
- **Reviews parallelize with unrelated implementation.** An adversarial review reads logic and
  queries the live DB read-only; it does not need a green test run. So a reviewer for function A can
  run while an agent edits function B's tests — just tell the reviewer not to run the suite and not
  to report findings about files it doesn't own.
- **Fix rounds parallelize too.** Two independent review-fix rounds are two lanes, not a queue.

**Serialize ONLY at these quality/integrity boundaries** (the exhaustive list — nothing else
justifies serial dispatch):
- One task's output *defines the other's interface.* Wiring against a shared module that is still
  being written wastes both agents' work. Build the interface, then fan out against it.
- Two agents would edit the same file. There is no safe version of this.
- The second task only exists if the first one's findings say so.

**Never parallelize away a quality gate.** Every build-sized task still gets its own adversarial
Opus review before deploy, plus a final whole-branch review. Reviews caught a name-erasing GHL PUT,
a `sync_log` insert that had been silently rejected for 3.5 months, a migration that would have
flipped a lifelong no-op into a live write, and a divider glyph that contradicted the approved
brief — none of which any test would have caught. Speed comes from running those reviews
concurrently, never from skipping one.

See also the build execution model: orchestrator advises and reviews, Sonnet implements, Opus
reviews every task plus the whole branch.

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
├── deno.json                    # Repo-root `deno task test` — runs the whole `_shared` suite; excludes web/
├── docs/
│   ├── superpowers/
│   │   └── plans/                # Implementation plans + frozen session ledgers
│   └── archive/                  # SUPERSEDED docs — provenance only, do not plan from these
│       ├── README.md             # What each archived file was + what replaced it. START HERE
│       ├── OPS_ROADMAP.md        # 2026-07-15 roadmap — superseded by BUILD_PLAN.md
│       ├── schema_overview.md    # Supabase notes — NOT the Airtable schema, despite citations
│       ├── SCHEMA_AUDIT_REPORT.md      # April audit — predates base drift, has errors
│       ├── schema_audit.json           # April schema dump — base has drifted since
│       ├── LostBoys_PricingEngine_ProjectBrief.md  # April brief — superseded by DISCOVERY
│       ├── prompt.md                   # May session prompt — shipped as job-created v21
│       ├── jobs_schema_prompt.txt      # April build scaffolding
│       └── lostboys_demolition_airtable_prompt.txt  # the original Airtable build prompt
├── supabase/
│   ├── functions/               # Deno/TypeScript edge functions (9 + _shared; Phase A additions 2026-08-13)
│   │   ├── airtable-client-sync/      # Airtable Clients → GHL Contacts  [LIVE, healthy]
│   │   ├── ghl-contact-sync/          # GHL Contacts → Airtable Clients  [LIVE, known defect — see Edge Functions]
│   │   ├── airtable-job-created/      # Airtable Jobs → GHL Opportunity (v21, Stage 3)
│   │   ├── airtable-job-scheduled/    # Stage 6 + Google Calendar + job_events
│   │   ├── airtable-job-completed/    # Stage 8 → Stripe draft invoice
│   │   ├── receive-airtable-webhook/  # writes Supabase jobs mirror  [UNAUTHENTICATED]
│   │   ├── push-to-airtable/          # time_entries → Airtable actuals  [dormant, latent bug]
│   │   ├── _shared/                   # job naming/validation + Google auth + log writers + pricing.ts (+ 3 test files: job_test, pricing_test, pricing_golden_test, + fixtures/), unit-tested
│   │   ├── ghl-job-webhook/           # Phase A: GHL workflow → job record + scheduling  [LIVE v7]
│   │   └── crew-night-before/         # nightly crew digest, pg_cron  [LIVE v4]
│   └── migrations/              # RLS + view hardening (2026-07-30) + Phase A schema/cron (4 files, 2026-08-13) + Phase B estimates schema/fixups/seeds/fixups2 (4 files, 2026-08-14) + Phase B slice-2 estimator columns/RPCs+audit/RPCs-fixups/ghl_push_state/is_path_b (5 files, 2026-08-14)
├── web/                          # Phase B slice-2: Next 16 App Router estimate builder + GHL push (own package.json) — see "No-login estimate tool" below
├── airtable-automations/        # Airtable Scripting automations (live in base; edit in UI)
│   ├── create-line-items.js     # Fires on job creation → creates Invoice Line Item child records
│   ├── update-line-items.js     # Fires on job LI field edits → upserts/soft-deletes child records
│   ├── README.md                # What the scripts do; how to edit them safely
│   └── SETUP_INSTRUCTIONS.md    # Manual setup guide for the Airtable Automations UI
├── field_mapping.md             # ★ Consolidated reference: Airtable field IDs ↔ GHL custom field IDs
├── ghl_field_mapping.md         # 19 GHL opportunity custom field IDs (generated by create-ghl-fields.js)
├── WORKFLOW_OVERVIEW_2026-07-31.md  # Matt's raw source prose — DISCOVERY was built FROM this
├── INTEGRATION_DESIGN.md        # BILL/Gusto integration research + edge-case rules (cited by ghl-job-webhook)
├── create-ghl-fields.js         # One-time script: creates GHL opportunity custom fields (idempotent)
├── setup_airtable.js            # ⚠️ Admin script: initial Airtable schema setup — DO NOT RUN
├── setup_airtable_v2.js         # ⚠️ Admin script: v2 schema setup — DO NOT RUN
├── audit_schema.js              # Schema audit utility — writes docs/archive/schema_audit.json
└── package.json / package-lock.json / node_modules/   # dotenv only, exists solely for the 4 scripts above
```

`field_mapping.md` and `ghl_field_mapping.md` are **load-bearing** — live code in
`web/src/lib/ghl/estimateFields.ts`, `supabase/functions/ghl-job-webhook/handlers.ts`, and
`supabase/functions/airtable-job-created/index.ts` cites them by filename as the sole authority
for every hard-coded GHL custom field ID. Do not move or rename them.

⚠️ The two `setup_airtable*.js` scripts are April one-shots that target a base which has since
drifted; **re-running either would be actively harmful.** They are orphaned (nothing imports them,
`package.json` declares no script for them) and are retirement candidates, tracked in
`docs/archive/README.md`. `create-ghl-fields.js` is the exception worth keeping: it targets GHL, a
retained system, is idempotent, and regenerates `ghl_field_mapping.md`.

---

## Edge Functions

All self-contained Deno/TypeScript. The 5 Airtable-era functions keep helpers inline; as of
2026-08-13, `ghl-job-webhook` and `crew-night-before` share `supabase/functions/_shared/`
(job-name/city parsing, Google Calendar auth lifted from `airtable-job-scheduled`, and
`sync_log`/`job_events` writers that check and log `supabase-js` errors). Supabase project:
`eiqqqwajmcpcwhvxxnhx`.

**`_shared/slack.ts`** (added 2026-08-17, BL-4) is the crew-message module, consolidating what had been
three copies of `postSlackMessage`, two crew→channel maps, and two date formatters. Exports
`postSlackMessage(botToken, channel, text)` (token is a **parameter**, not module-scope env),
`resolveCrewEnvKey`, `resolveCrewChannelEnvVar`, `formatDateLabel`, `formatPhone`, `buildCrewJobBlock`,
`BLOCK_DIVIDER` (`———`, 3× U+2014 — matches the approved brief; it briefly shipped as U+2500 and no test
caught it because the assertion compared against the constant), and `joinCrewJobBlocks`. The crew maps
are built on `Object.create(null)` so a prototype key like `"constructor"` can't resolve to a function.
`formatDateLabel` **throws `RangeError`** on an unparseable date (both live callers are protected).
**`buildCrewJobBlock` carries no pricing field by construction** — the invariant's weak point is whatever
the caller puts in `scopeSummary`, which is why `ghl-job-webhook` strips currency from `job_details`.

**`_shared/pricing.ts`** (added 2026-08-14, Phase B slice-1) is the estimating engine — an exact
TypeScript port of the live Fillout calculator chain (`computeEstimate()`), not yet wired into any
deployed function. True half-up cent rounding (`roundToCent`) and `requireRates` input validation
(all rates finite ≥ 0, `ccFeeRate < 1`) were added by the Task 1 review fix. `pricing_test.ts` (12
unit tests) and `pricing_golden_test.ts` (2 tests, backed by `fixtures/estimates-golden-321.json`)
prove it reproduces all 321 live Airtable estimates to the cent — 309 exact, 11 legacy two-sided
pinned deltas, 1 penny-tolerance — under the corrected rounding, i.e. the rounding fix moved no
quoted price. **Run the whole `_shared` suite with `deno task test`** — the canonical form, via the
repo-root `deno.json` task (the older `deno test --allow-all supabase/functions/_shared/` form
still works but `deno task test` is what future sessions should reach for).

**⚠️ The "18/18" figure was misleading and the task was widened 2026-08-17.** It ran
`supabase/functions/_shared/` only, so it reported 18/18 while **139 real tests** in
`ghl-job-webhook/handlers_test.ts` and `crew-night-before/handlers_test.ts` were never collected by it —
those suites had never been gated by the canonical task since they were written. The task now runs
`supabase/functions/`, and the count is **312 passing** as of 2026-08-17 (golden-321 gate intact). Through the end of Phase B slice 2, the engine changed by
exactly one word — a `requireRates` export added for the web app's rates loader to import — so the
golden gate held throughout. The engine still snapshots `DEFAULT_RATES` internally (the golden test
depends on that); the **web app** reads rates from `pricing_variables` live at request time via
`loadRatesConfig()` (`web/src/lib/rates.ts`), never falling back to `DEFAULT_RATES`.

Legacy function version numbers in the table below may read higher than last documented here —
the Supabase CLI's deploy tooling bumps version counters on unrelated already-deployed functions
as a side effect of any deploy; their `sha256` is unchanged, so this is cosmetic, not a redeploy.

| Function | Deploy ver | Purpose |
|---|---|---|
| `airtable-client-sync` | **29** | Airtable Clients → GHL Contacts. Search leg repaired + duplicate path now updates + name-erasure guarded (2026-08-17). Data-loss item open → BL-6. |
| `ghl-contact-sync` | 27 | GHL Contacts → Airtable Clients (reverse). **Tags defect FIXED 2026-08-14** (commit `65cae85`): GHL workflow webhooks send `tags` as a comma-separated string; now normalized, and payload extraction moved inside the try so parse errors log to `sync_log` instead of escaping as unlogged 500s. Live-verified same day. Review found contacts with tags had *never* synced client type before this fix (all 590 logged payloads carried string tags). |
| `airtable-job-created` | 21 | Jobs → GHL Opportunity at **Stage 3 only**. 15 custom fields via `buildCustomFields()` using `id:` format. Logs `job_events`. |
| `airtable-job-scheduled` | 16 | Advances to Stage 6, creates Google Calendar events (main + crew). Slack still a placeholder. |
| `airtable-job-completed` | 14 | Stage 8 → Stripe **draft** invoice, GHL Stage 9, task for Dane. Slack paused via `SLACK_NOTIFICATIONS_ENABLED = false`. |
| `receive-airtable-webhook` | 11 | Writes Supabase `jobs` mirror. **No auth.** Only handles `Scheduled`/`Invoiced` — never `Completed`, so the mirror is permanently stale. Retirement queued. |
| `push-to-airtable` | 11 | Aggregates `time_entries` → Airtable actuals. Never run. Latent bug: PATCHes a formula field. |
| `ghl-job-webhook` | **25** | GHL workflow webhook → mints JOB-XXXX at Quote Accepted (Postgres jobs), schedules at Job Scheduled (Calendar main+crew, Slack crew notify, gated BILL). Accepts top-level or customData body. **BL-4 (2026-08-17):** persists contact fields, builds the estimate→job promotion, resolves a 4-tier `scope_summary`, posts the new crew format via `_shared/slack.ts`. **BL-5 (2026-08-20):** calendar builders take a required `audience: "main" \| "crew"` param — crew calendar events carry NO `Estimate:` line, main keeps it. ⚠️ CLI deploys of this function MUST pass `--no-verify-jwt` and read back `verify_jwt` after (a bare deploy silently flips it to true → 401s every GHL call). **v2 Task 4 (2026-08-19, v20):** Quote Accepted minting is flag-gated behind `ENABLE_GHL_ACCEPTANCE_JOB_CREATION` — the flag is UNSET in prod, and absent/anything-but-literal-`"false"` means the legacy minting path runs byte-identically (fail-safe; only the literal string `"false"` disables it, responding `quote_accepted_awaiting_schedule`); Job Scheduled has an UNCONDITIONAL compat check — a job with `launch_workflow=true` (app-minted via `schedule_estimate`) gets `app_is_schedule_authority` with zero side effects. **THE PERMANENT FLIP IS DONE — 2026-08-25 (Session 10, Task 7 Step 3): `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false` is SET in prod and `ghl-job-webhook` v25 is deployed via the invariant. Quote Accepted responds `quote_accepted_awaiting_schedule`, writes sync_log/job_events skipped rows, and mints NOTHING — live-verified through the real GHL workflow. App scheduling (`schedule_estimate`) is the SOLE job-minting path. This never re-enables (ratified decision 1); `postponed` resolutions are now probe-safe.** |
| `crew-night-before` | **11** | Nightly 16:00 America/Denver crew digest (pg_cron 22:30+23:30 UTC, self-gating). Slack per-crew. **BL-4 (2026-08-17):** new format + `———` divider between job blocks, shared module, `client_name` fallback. Discharges the owed redeploy. |
| `integration-dispatcher` | **1** | **v2 Task 5A (2026-08-20): outbound outbox consumer, LIVE.** pg_cron `*/5 * * * *` POSTs with `x-webhook-secret` (=`GHL_WEBHOOK_SECRET`); claims via `claim_integration_events` RPC. Handles `job.scheduled` (main+crew all-day Calendar events w/ `extendedProperties.private.managedBy="lostboys-estimator"`, inclusive→exclusive end date, BL-5 boundary: crew description never carries pricing; one crew Slack message via `_shared/slack.ts`), `ghl.stage.requested` (pipeline-membership asserted, stage needles use pipeline.ts's parenthetical-stripping strategy, PUT `{pipelineStageId}` only, sync_log `app_to_ghl`), `job.cancelled` (deletes managed Calendar events, clears gcal ids). Retry `min(60,2**attempts)` min; dead-letter at attempt 5 + `job_alerts` `integration:<id>`. Missing required-leg config (crew outside Crew 1–4, unset calendar/channel) THROWS → dead-letters loudly. Deployed `--no-verify-jwt` (cron POST carries no JWT) — same readback invariant as `ghl-job-webhook`. Outbox producers: `schedule_estimate`, `cancel_scheduled_job`. |
| `google-calendar-webhook` | **2** | **v2 Task 5B Step 2 — the full inbound Calendar sync, DEPLOYED 2026-08-25** (replaces the Step-1 spike; `verify_jwt=false` read back, siblings sha-undisturbed). Token-hash (SHA-256) notification auth accepting `active|superseded` channels; the notification route **always returns 200** (a non-2xx makes Google retry then kill the channel) — internal errors go to `sync_log` (`direction='google_to_supabase'`) + console; admin actions (`ping`/`maintain`/`register`/`stop`) are `x-webhook-secret`-gated. One shared push/poll code path (`reconcileCalendar`): fetch each scheduled job's stored event by id (notification bodies are empty), classify with `classifyManagedEvent` (`deleted` checked BEFORE `unmanaged`), act through the three locked RPCs (`apply_calendar_date_change` — date-only, echo-terminating, revision-guarded; `open_calendar_deletion_exception`; `resolve_schedule_exception`). Channel lifecycle: 7-day TTL, renew <24h-to-expiry, register-before-stop, dedup marks keyed on `calendar_id` (resource_id is reassigned on renewal), 30-day mark prune; cron `calendar-sync-maintenance @ 7,37 * * * *`. **FULLY LIVE-PROVEN 2026-08-25 (Sessions 8–9, probe JOB-1106, all six legs):** 5 active channels + handshakes; inbound date apply (rev guard, `job_events`, rev-scoped outbox) with dispatcher mirror proving update-not-create idempotency; deletion → exception + `at_risk` alert with job untouched → `dismiss` recreating the event; `closed_lost` teardown incl. M7 rev-share and re-cancel raise; echo termination held every round (one `dates_unchanged` bounce, then quiet). ⚠️ A mirrored inbound date change re-posts the crew Slack message (R7 semantics — by design). |

**Deploy invariant (recorded per v2 Task 0A):**

```bash
supabase functions deploy ghl-job-webhook --project-ref eiqqqwajmcpcwhvxxnhx --no-verify-jwt
supabase functions list --project-ref eiqqqwajmcpcwhvxxnhx
```

Expected: the readback reports `ghl-job-webhook` with JWT verification disabled. Any deployment
lacking the explicit flag is a failed deployment and must not receive production traffic.

**Three functions now carry this invariant** — `ghl-job-webhook`, `integration-dispatcher`, and
`google-calendar-webhook` (added 2026-08-20). The readback is not optional for any of them, and it
should also confirm the OTHER two were not disturbed: the CLI has previously bumped version
counters on unrelated already-deployed functions as a side effect (cosmetic when `sha256` is
unchanged — check it).
Full workflow: `docs/runbooks/profitability-schema-validation.md`.

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
  `'supabase_to_slack'`, `'app_to_ghl'` — the middle two were added by migration
  `phase_a_audit_write_fixups` for `ghl-job-webhook` and `crew-night-before`; the constraint
  originally allowed only the two Airtable directions and rejected Phase A's writes with a live
  400 until widened. `app_to_ghl` was added by migration `20260814220000_phase_b2_ghl_push_state`
  for the estimate builder's GHL push (Phase B slice 2, T12) — **live and in use** (24 rows as of
  slice-2 close, one per push target attempt).
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

### GHL API facts learned building the estimate builder's push (Phase B slice 2)

These were live-proven during Task 9/10/12 and matter beyond the web app — anything that PUTs a
GHL opportunity (including the Phase A `airtable-job-created`/`ghl-job-webhook` functions) is
affected by the first one:

- **`PUT /opportunities/{id}` MERGES `customFields`, it does not replace the set.** Retired as an
  open unknown (CV-2) by live proof during T12: pushing a subset of fields left every other field
  (including ones Phase A wrote — Crew, dates) untouched. This was previously an assumption
  ("Phase A implies merge"), not a proven fact.
- **GHL estimate-doc `meta` keys come back CAMELCASED** (`lbdEstimateId`, not `lbd_estimate_id`)
  even though the push writes them snake_case-adjacent — read-back code must match on the
  camelCase form or it will silently treat every doc as new and duplicate drafts.
- **Estimate-doc `name` is capped at 40 characters** and truncates lossily — the full job name
  belongs in the line-item description or an opportunity custom field, not relied on in the doc
  title.
- **`GET /invoices/estimate/list` defaults to `limit=10`.** `listEstimateDocs()` in
  `web/src/lib/ghl/client.ts` now auto-paginates at `AUTO_PAGE_SIZE=100` when no explicit `limit`
  is passed (live-verified: GHL honors `limit=100` — 100 of 511 docs returned per page, HTTP 200;
  auto-pagination sweeps the rest) — the earlier
  10-row default meant a contact with more than 10 historical docs could silently miss its current
  draft and have push logic overwrite/duplicate it. Explicit-`limit` callers are unaffected.
- **`searchContactByEmail` was broken against the live API** (`GET /contacts/?email=` now 422s —
  the endpoint contract changed since `airtable-client-sync` was written against it). Fixed in
  `web/src/lib/ghl/client.ts` (T9f, commit range `a01a178..0579169`) to use
  `POST /contacts/search` with an `eq` filter, live-verified. **The same broken shape is still live
  in `airtable-client-sync` v19's `searchGhlByEmail()`** — it never checks `res.ok` before
  `res.json()`, so the search leg is dead code today; the function survives only because the
  GHL-side duplicate-contact 400 exposes `meta.contactId` as a fallback match.
  **⚠️ Consequence established 2026-08-14 (planning pass), worse than previously recorded: because
  the search always returns `null`, the update-in-place branch (`index.ts:132-136`) is
  *unreachable*, so every existing contact takes the duplicate-400 fallback — which matches the
  contact and writes its ID back to Airtable but never PUTs the new field values. Airtable edits
  have therefore never propagated to existing GHL contacts.** That is data loss, not just a
  misleading `match_method`. Repairing the search alone is not sufficient; the duplicate-400 path
  needs its own `updateGhlContact` call.

  **✅ CODE FIXED 2026-08-17 (v29), and the claim above is OVERSTATED — read this before repeating it.**
  Live `sync_log` shows **313** rows of `match_method='ghl_contact_id'` / `action_taken='updated'`, so
  once a contact's GHL ID is cached back into Airtable, every *later* edit genuinely does propagate.
  The drop was **one-time per contact**, on the first sync of a contact that existed in GHL without an
  ID in Airtable. 404 of 405 `client_sync_state` rows are already past that window.

  **⚠️ But the data-loss item is NOT closed, and no code change to this function can close it → BL-6.**
  The Airtable automation that invokes it (`wflSSK2Twr9Tqwgpq`, base `apptzp0IclCaAtOk2`) fires on
  **`recordCreated` ONLY**. There is no `recordUpdated` automation on the Clients table, so the function
  is never invoked when someone edits a client. All 1045 Clients rows already carry a GHL ID, so the two
  repaired branches now only ever run for brand-new rows. Adding `recordUpdated` requires an **echo
  guard first**: `ghl-contact-sync` writes to Airtable → `recordCreated` → `airtable-client-sync` → PUT
  to GHL → GHL workflow → `ghl-contact-sync` → … which terminates today *only* because the trigger is
  create-only.

  Also fixed in v29, and worse than previously recorded: `ghlFields` sent `firstName`/`lastName`
  unguarded, and they default to `''` which `JSON.stringify` keeps — so a blank Airtable name **erased
  the name on the GHL contact** (87 of 1045 rows have a blank first name, 203 a blank last name).
  And the duplicate path wrote `match_method='email_duplicate'` / `action_taken='matched_existing'`,
  **both illegal** under the live CHECKs, so that `sync_log` insert had been **silently rejected for
  3.5 months** — zero such rows exist. Migration `widen_sync_log_match_method` now allows
  `'email_duplicate'` so the two match paths stay distinguishable. **Verify the repaired search leg
  from edge-function console logs, never from `sync_log`.**

---

## Supabase Tables

| Table | Rows | Purpose |
|---|---|---|
| `sync_log` | 918+ | Audit trail of all sync operations. Every function writes here — no exceptions. |
| `client_sync_state` | 280 | Email, Airtable record ID, GHL contact/company IDs, last sync direction/time |
| `job_events` | growing | Stage-transition audit log |
| `jobs` | 4 (JOB-1102, JOB-1104, JOB-1105, JOB-1106 — all cancelled test rows; 1105/1106 minted by the 5A/5B probes via `schedule_estimate`) | **Canonical Phase A job record** as of 2026-08-13 (migration `phase_a_jobs_keystone`). `job_number` (`JOB-XXXX`, minted via `next_job_number()`/`job_number_seq`, starting 1100) is the canonical key going forward — see Key Rules. Columns: `job_number`, `client_name`, `client_type`, `job_address`, `city`, `ghl_opportunity_id`, `ghl_contact_id`, `estimate_value`, `crew`, `start_date`, `end_date`, `status_v2` (`job_lifecycle` enum: accepted/scheduled/in_progress/completed/invoiced/paid/cancelled), `gcal_main_event_id`, `gcal_crew_event_id`, `slack_notified_at`, `night_before_sent_on`, `bill_job_code`, `updated_at`. **BL-4 added 5 nullable text columns 2026-08-17** (migration `bl4_job_crew_fields`): `client_contact_name`, `business_name`, `client_phone`, `start_time`, `scope_summary`. `client_contact_name` is deliberately **not** redundant with `client_name` — `_shared/job.ts`'s `clientLabel()` collapses a contact to `companyName || lastName || firstName`, so for a company contact `client_name` IS the business name and the person's name is lost; both crew messages fall back to `client_name` when `client_contact_name` is null. `start_time` is free text mirroring GHL's TEXT field and is GHL-authoritative (overwritten every fire). **`scope_summary` MUST NOT contain pricing**, and unlike the others it is *not* overwritten when a scope lookup errors, so a transient failure can't wipe it. Legacy columns (`airtable_job_id`, `airtable_status`, `estimated_hours`, `job_start_date`, `archived_at`, and the old `status` enum) are kept, nullable, for legacy readers during parallel running. RLS enabled, no policies by design (two stale clock-in-era policies were dropped in the fixups migration to restore that posture). |
| `jobs_legacy_backup` | 7 | Archived copy of the pre-Phase-A `jobs` rows (May-2026 test mirrors), created before `jobs` was reset. RLS enabled, no policies. |
| `users`, `crews`, `time_entries` | 0 | Complete clock-in schema, never used |
| `workforce_profiles` | 1 | **Profitability v2 Task 0B / BL-7, migration `20260818143000_workforce_auth_boundary.sql`, APPLIED TO PRODUCTION 2026-08-18.** The new, isolated scoped-auth boundary for foremen + Dane's financial routes — deliberately a separate table from the legacy `users` schema, not a rehab of it. Columns: `auth_user_id` (PK, FK → `auth.users` `on delete cascade`), `display_name`, `role` (`not null default 'pending'`), `crew_external_id`, `active` (`not null default false`), `created_at`, `updated_at`. Trigger-fed: `handle_new_auth_user()` (rewritten this migration, `search_path` pinned) inserts a row on every new `auth.users` signup via `on_auth_user_created`, with a total `display_name` expression so a NULL-email/phone-only signup can't abort the insert. RLS enabled with **2 policies — the system's first policies on any new-schema table**: `workforce_self_read` (SELECT, own row) and `workforce_owner_all` (ALL, gated by the `SECURITY DEFINER` helper `is_workforce_owner()` — subquerying the table from its own policy would be infinite recursion, so the helper exists specifically to break that cycle; `search_path` pinned, `authenticated` EXECUTE granted because RLS quals evaluate as the querying role). One live row: the backfilled pre-existing `auth.users` user (Matt), `role='pending'`, `active=false`. **Owner promotion (flipping that row to an active owner role) is deliberately deferred to v2 Task 8's launch runbook** — nothing in Task 0B activates it. Does not touch the legacy `users`/`crews`/`time_entries` tables or their 12 policies. |
| `labor_actuals`, `expense_actuals`, `invoice_reminders` | 0 | Empty scaffolding (created by migration 002) |
| `estimates` | 16 | **Phase B slice-1 schema, LIVE 2026-08-14; slice-2 write path + UI LIVE same day.** Canonical versioned estimate header — inputs, rate snapshot, and `computeEstimate()` outputs (`labor_cost`, `dump_fees`, `total_direct`, `overhead`, `profit`, `cc_fee`, `total_bid`, `true_margin_pct`), plus `quoted_price`/`quote_override_reason` for when Dane discounts off the calculated number. `dump_count` is `numeric(6,2)` (widened from `numeric(5,1)` by `fixups2` so real fractional loads like 0.25/0.35/1.25 store exactly instead of rounding). `estimate_number` (`estimate_number_seq`, starting 1400; 1001–1321 reserved for the deferred Airtable backfill) + `version` are unique together; `supersedes_estimate_id` chains corrections, and a `version_chain` check constraint (added by `fixups2`) enforces the writer contract — any row with `version > 1` must set `supersedes_estimate_id` to the parent row's id (and must supply the parent's `estimate_number` explicitly, since the `nextval` default is only correct for new version-1 rows). **Immutable by trigger** (`enforce_estimate_immutability`, `search_path` pinned): the trigger is a **watched-column blacklist**, not a mutable-column whitelist — it raises if any column on its list changes, and the four columns deliberately left off that list (`status`, `quoted_price`, `quote_override_reason`, `job_number`) are the only ones the mutation RPCs are allowed to touch after insert. `is_path_b` (added by slice-2's `phase_b2_path_b_flag` migration) is **on the watched list, DB-enforced immutable after insert** — the same class as `created_by`/`created_by_name`, not a fifth mutable column; a mis-set flag needs a new version row, same as any other correction. (An earlier draft of this migration left `is_path_b` off the watched list on the reasoning that it was "immutable in practice" because no RPC writes it post-insert — rejected in review: that reasoning applies equally to `created_by`/`created_by_name`, which get the stronger DB-level guarantee instead, so `is_path_b` does too.) **DELETE is also blocked** (`enforce_estimate_no_delete`, added by the fixups migration) — there is no delete path, by design. RLS enabled, no policies. **Phase B slice-2** added `created_by uuid → auth.users` + `created_by_name text` (both immutable, in the guard list) and the write path: all inserts/mutations go through service-role-only RPCs — `create_estimate_with_items(p_estimate jsonb, p_line_items jsonb)` (one transaction, honors the writer contract, flips parent to superseded), `update_estimate_status`, `update_estimate_quote` (insert-path override-reason enforced by the `quote_override_reason_required` CHECK from the fixups migration), `update_estimate_job_number` — each takes `p_actor`/`p_actor_name` feeding `estimate_mutations_audit`. **No login gates these RPCs or the server actions in front of them** — see "No-login estimate tool" below; `created_by` is `NULL` on every row created under the no-login model, `created_by_name` carries the self-declared picker name. **One exception, not zero:** estimate 1416 v1 (the T11 first-real-create smoke) was created *before* the no-login scope change merged and still carries a real `auth.users` id in `created_by` — that one row is FK-pinned (`ON DELETE NO ACTION`) to a real auth user; every row created after the scope change has `created_by IS NULL`. **Live rows (16, all TEST-labeled, all `declined` or `superseded`):** `estimate_number` 1414 (v1+v2, the permanent test chain, live), 1416 (T11 first-real-create smoke), 1417–1420 (T12 E2E), 1421–1423 (T12 fix-round E2E), 1424 (v1 `is_path_b=true` smoke, superseded by v2), 1425 (v1 override/revise smoke, superseded by v2) — **first real estimate will be ≥ 1426.** 1400–1413 were burned earlier by dev rollbacks; 1415 was burned by a negative-CHECK test. |
| `estimate_line_items` | — | Child rows of `estimates` (FK `on delete cascade`, though the parent can't be deleted). Snapshots a Scope Library item's name/hours/dump/materials onto the estimate at creation time. **Fully immutable by trigger** (`enforce_estimate_line_item_immutability`, added by the fixups migration) — UPDATE and DELETE both raise unconditionally; a correction means a new estimate version with new line item rows. RLS enabled, no policies. |
| `scope_library` | 19 | Controlled vocabulary of biddable scope items (seeded 2026-08-14 from live Airtable data, `airtable_record_id` preserved for provenance). Default labor hours/dump count per item; `default_materials_cost` left NULL for Phase G to seed from actuals. Mutable — not versioned like estimates. RLS enabled, no policies. |
| `pricing_variables` | 6 | Key/value rate table (seeded 2026-08-14): `labor_rate_per_hour` 26, `overhead_rate_per_hour` 23, `dump_rate_per_load` 300, `cc_fee_rate` 0.0350, `default_markup_pct` 25, `markup_floor_pct` 15 — the corrected 3.5% CC fee, not the stale Airtable 3% row. **Read at runtime** by the web app's `loadRatesConfig()` (`web/src/lib/rates.ts`, Phase B slice-2) which throws if any key is missing and never falls back to `DEFAULT_RATES`. The Deno engine still defaults to `DEFAULT_RATES` in code so the golden test is untouched. RLS enabled, no policies. |
| `estimate_mutations_audit` | 27 | **Phase B slice-2** (migration `20260814210000_phase_b2_rpcs_audit`), **live and populated.** Append-only audit of the four mutable `estimates` columns (`status`, `quoted_price`, `quote_override_reason`, `job_number`) — old/new pairs + `actor_id`/`actor_name`/`changed_at`. Written by an AFTER-UPDATE trigger that reads `current_setting('app.actor_id'/'app.actor_name', true)`, which the mutation RPCs set transaction-local. Under the no-login picker, new mutations set `actor_id` NULL and `actor_name` to the picked name — but the table isn't all-NULL: **9 of the 27 live rows carry a non-null `actor_id`**, from mutation calls made before the no-login scope change merged (when RPCs could still be passed a real `auth.users` id, as with pre-scope-change estimate 1416). Itself immutable (UPDATE/DELETE guarded). RLS enabled, no policies. This is the "discount by estimator" dataset. |
| `ghl_push_state` | 10 | **Phase B slice-2** (migration `20260814220000_phase_b2_ghl_push_state`), **now written** by T12's push orchestration (`web/src/lib/ghl/push.ts`). One row per estimate version (PK `estimate_id` → estimates): `ghl_contact_id`, `ghl_opportunity_id`, `ghl_estimate_id`, `ghl_estimate_number`, `fields_pushed_at`, `doc_pushed_at`, `last_error`, `attempts`, `updated_at`. Mutable sync-bookkeeping for the GHL push (kept OFF the immutable `estimates` table by design). App sets `updated_at` on upsert (no trigger). RLS enabled, no policies. **Known limitation:** no arbitrating constraint against two simultaneous first-pushes of the same estimate — a push race can create duplicate GHL opportunities (search-before-create is not atomic); low likelihood at 3 users, recovery is deleting the duplicate opportunity in GHL. |

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

**⚠️ `jobs` is not trigger-free.** `trigger_push_to_airtable_on_archive` is **live and enabled** on
the table and calls `notify_airtable_on_archive()`, which POSTs to the dormant, latently-buggy
`push-to-airtable` edge function. Verified via `pg_get_functiondef` (2026-08-14) that it fires only
when the **legacy** `status` enum transitions to `'archived'` — so it is inert for ordinary writes
to Phase A columns. Do not assume the table is trigger-free when adding writes, and do not write the
legacy `status` column without expecting this to fire.

**Legacy `SECURITY DEFINER` functions — the live count is 5, not 6** (verified 2026-08-14;
`SYSTEM_AUDIT_2026-07-30.md` was right, `BUILD_LOG.md`/`NEXT_SESSION_PROMPT.md` were wrong before
this date). They predate the migrations directory and exist only in the live database — nothing in
the repo defined them until 2026-08-18, when `handle_new_auth_user` gained a repo definition via
`20260818143000_workforce_auth_boundary.sql` (rewritten, pinned); the other 4 remain live-only and
cannot be enumerated from git. Live:
`calculate_duration_and_cost`, `get_my_crew_id`, `get_my_role`, `handle_new_auth_user`,
`notify_airtable_on_archive`. None pin `search_path`; all are `anon`-EXECUTE-able. **Three are
trigger functions**; only `get_my_role`/`get_my_crew_id` are genuinely callable RPCs, and both read
a 0-row `users` table keyed by `auth.uid()` (NULL for anon), so **real data exposure today is
none** — the risk is the unpinned `search_path`, not a leak.

**✅ HARDENED 2026-08-17** (migration `security_revoke_legacy_definers`). `search_path` is now pinned
as `public, pg_temp` — **`pg_temp` last, deliberately**: Postgres searches the temp schema *first* for
relation names when `pg_temp` is unlisted, and `anon`/`authenticated` both hold TEMP on this database,
so an unpinned definer referencing `users` unqualified was a genuine escalation vector (not reachable
through PostgREST alone, since that surface offers no arbitrary DDL). EXECUTE is revoked from
`public, anon, authenticated` on **10** functions — the 5 definers, `next_job_number()`,
`get_pay_period(date)`, and 3 Phase B trigger functions that had the same posture. Verified live: all
10 deny anon and authenticated; `service_role` and `postgres` retain EXECUTE, so
`next_job_number()` still mints. Triggers keep firing because **EXECUTE is checked at `CREATE TRIGGER`
time, not at fire time** (*not* "triggers run as the table owner" — that is false in general). No drops.

**✅ RESOLVED 2026-08-18 — BL-7 is CLOSED.** `handle_new_auth_user()` was deliberately left unpinned
from 2026-08-17 through 2026-08-18 while BL-7 was an open decision. Historical mechanism, preserved
for the record: GoTrue connects as `supabase_auth_admin`, whose `search_path` is `auth`, so the
function's unqualified `INSERT INTO users` resolved to **`auth.users`**, collided with the row that
just landed, and was swallowed by `ON CONFLICT DO NOTHING` — **it was always a silent no-op**. Live
proof at the time: `auth.users` had 1 row, `public.users` had 0 — *that*, not "the clock-in schema
was never used", was why `public.users` was empty.

**Migration `20260818143000_workforce_auth_boundary.sql` (v2 Task 0B, applied to production
2026-08-18) rewrote the function.** It is now `search_path`-pinned (`public, pg_temp`) and inserts
into the new, isolated `workforce_profiles` table instead of the legacy `users` table — a total
`display_name` expression (nullif/coalesce chain, final fallback `'user-'||left(id,8)`) means a
NULL-email/phone-only signup can no longer abort the insert. A one-time backfill covered the 1
pre-existing `auth.users` row. Live-verified post-apply: all 6 catalog booleans TRUE,
`backfill_rows=1` (role `pending`, `active=false`, name `Matt`), `public.users` still 0 (the legacy
table remains untouched and still empty — this migration does not touch it), 12 legacy policies on
`users`/`crews`/`time_entries` untouched. Owner promotion (flipping the backfilled row from
`pending`/`inactive` to an active owner role) is deliberately deferred to v2 Task 8's launch
runbook — not done by this migration. See the 2026-08-18 "Profitability v2 Phase 0 SHIPPED"
`BUILD_LOG.md` entry for the full red/green validation chain.

**⚠️ CORRECTED 2026-08-17 — `users`, `crews` and `time_entries` are NOT policy-free.** They carry
**7 live RLS policies** between them, all calling `get_my_role()`/`get_my_crew_id()`: `users` →
`foremen_select_crew`, `admins_all`; `time_entries` → `foremen_select_crew_entries`,
`admins_select_all_entries`, `foremen_update_crew_entries`, `admins_all_entries`; `crews` →
`admins_manage_crews`. The 2026-08-17 revoke means an `anon`/`authenticated` query against those three
tables now raises `permission denied for function get_my_role` instead of returning zero rows. That is
correct while there is no login — but **Phase D clock-in is specced against `time_entries`** and must
either re-grant EXECUTE on those two functions to `authenticated` (with `pg_temp` pinned) or replace
the policies. Tracked as part of BL-7.

**⚠️ CORRECTED AGAIN 2026-08-18 (v2 Task 0A branch-fidelity probe) — the "7 live RLS policies" count
above was incomplete, not wrong: it covered only the `get_my_role()`/`get_my_crew_id()` policies.**
The three tables actually carry **12 policies total**: the 7 above (broken for `anon`/`authenticated`
since the 2026-08-17 revoke, as described) **plus 5 plain `auth.uid()`-based policies that still
function** — `users_select_own`; `employees_insert_own`, `employees_select_own`,
`employees_update_own_open`; `authenticated_select_crews`. **Task 0B (applied to production
2026-08-18) did not touch any of the 12** — it added its own isolated `workforce_profiles` table
with 2 new policies instead of modifying these; see the `workforce_profiles` row below and the
`handle_new_auth_user()` paragraph above.

RLS is enabled on all of the above with **no policies by design** (except the three tables just
noted) — `service_role` has
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
`C0ABF4XMKDE` (Cade). Used by `ghl-job-webhook`'s schedule leg, `crew-night-before`, and
`integration-dispatcher`.

`SLACK_TEST_CHANNEL_OVERRIDE` — **UNSET and confirmed absent 2026-08-25 (last: Session 10, at
Task 7 gate-E2E close; BL-4 precedent readback).** Set to #ops-test only for probe windows (5B
probe, then the Task 7 gate E2E — Matt's BL-8 decision keeps ALL Slack testing in #ops-test until
the bot is invited to the crew channels). While set it redirects ALL crew Slack posts from all
three functions (including `crew-night-before`'s nightly digest); it must never be set in normal
operation.

🔴 **THE SLACK BOT IS NOT A MEMBER OF THE CREW CHANNELS — discovered live 2026-08-20, OPEN.
Backlogged → BL-8 per Matt's decision 2026-08-25 (Session 10): no longer blocks the Phase 1
gate; until the invite happens, every real scheduled job's crew-Slack leg dead-letters loudly
(alert raised, calendars unaffected) and crews get no Slack notification.** The 5A live probe failed with `Slack post failed: not_in_channel` on Crew 4.
That error is diagnostic: **not** `channel_not_found` (so the channel IDs above are valid) and
**not** `missing_scope` (so `SLACK_BOT_TOKEN` and its scopes are fine) — the bot was simply never
invited. Scope is wider than one crew: `sync_log direction='supabase_to_slack'` holds **10 rows for
the system's entire history — 9 "no jobs" skips and exactly ONE real post, to Crew 1 on
2026-08-13.** Crews 2/3/4 have never received a message in production and are presumed to share
Crew 4's state. **Fix = invite the bot to all four channels in Slack (Matt only — the Slack MCP
available in-session is CTA Integrity's workspace, not Lost Boys).**

**Why no test could catch this, and the lesson:** the dispatcher's unit tests inject a fake
`postSlackMessage`, and `crew-night-before` has taken the "no jobs tomorrow" skip branch every
night since 2026-08-14, so its Slack leg has not run since the Phase A test. A green suite proves
nothing about channel membership. Note the two functions degrade differently and the difference
matters: `crew-night-before` writes a `sync_log` error row and does NOT stamp
`night_before_sent_on` (so it retries next night) but **alerts nobody** — it would have failed
quietly for months; `integration-dispatcher` retries then dead-letters into `job_alerts`, which is
why this surfaced within minutes of the first real attempt.

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
| **B — Estimate builder** | 🟢 **Slices 1 AND 2 MERGED TO MAIN and LIVE, 2026-08-14. Slice 2 merged as `dd6cc87` (Matt's explicit instruction, same session) and deployed to production, now at **https://lostboysdemolition.vercel.app** (Vercel project `lostboysdemolition` — project renamed and URL switched from `lbd-estimates` by Matt 2026-08-18; the old `lbd-estimates.vercel.app` domain is **deleted and 404s, no redirect**. Root `web`, include-outside-root ON, prod branch `main`). All 14 build tasks + a mid-session no-login scope change + a final whole-branch review + fix wave done and reviewed. Matt's phone smoke + the one-real-bid Fillout parallel check were still outstanding at session close — confirm before treating the builder as validated for daily use. Slice 1 = pricing engine + schema + seeds (golden-verified to the cent). Slice 2 shipped the first Next.js app in `web/`: a mobile-first estimate builder (`/estimates/new`, live client-side recalc, quick/itemized modes, Path B toggle), a list + detail + revise flow with lifecycle actions (sent/accepted/declined, quote override with required reason, version chains, audit history), and GHL push (per-target idempotent via `ghl_push_state`, opportunity fields + draft estimate doc). **There is no login** — see "No-login estimate tool" below. Vercel deploy: see BUILD_LOG. Golden gate held throughout (engine changed by one word). |
| **C — Expenses + dump counts (BILL)** | Not started. One transaction = one dump load, so this delivers cost *and* count. |
| **D — Time tracking** | ✅ **Decided 2026-08-18, split D1/D2** — D1 unblocked (manual/CSV-first + provider-neutral adapter contract; v2 Task 13), D2 deferred (vendor evaluation against that contract). |
| **E — Invoicing** | Not started. Direct Stripe, `stripe-webhook`, AR digest, Synder→QBO. |
| **F — Profitability** | Not started. Variance, job report on the GHL opportunity, change orders, callbacks. |
| **G — Feedback loop & reporting** | Not started. Seeds `default_materials_cost` here, from actuals. |
| **Track B — Lead intake** | Config only, runs in parallel, **start now.** |
| **Profitability Program v2** | 🟢 **Phase 0 (Tasks 0A + 0B) COMPLETE 2026-08-18.** Canonical program `docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (Tasks 0A/0B + 1–17, phases 0–6) — absorbs/re-specifies C, E, F, G and Phase D1. Version 1 archived. Task 0A: `docs/runbooks/profitability-schema-validation.md` written + CLAUDE.md/BUILD_PLAN.md doc corrections landed. Task 0B: `workforce_profiles` BL-7 boundary migration **APPLIED TO PRODUCTION** (branch red/green → production dry-run red/green → real apply, all live-verified). **BL-7 is CLOSED.** **Phase 1 Sessions 1–3 SHIPPED 2026-08-19** on branch `claude/last-session-review-f7tqxw` (NOT merged to main — Matt decides when): v2 Task 1 schema (14 enums, 16 tables, 12 `jobs` columns), Task 2 economics + commercial lifecycle (`create_estimate_with_items_v2`, identity links/presentations/acceptance events+state, deviation-12 `accepted_price` pinned at acceptance), and Task 4 `schedule_estimate` (the canonical app-side job-minting RPC) are **ALL APPLIED TO PRODUCTION** (migration head `20260819191046`, 32 applied). Task 3 forecast engine + the Task 2/4 web work (economics inputs, present/accept/reverse lifecycle UI, `/estimates/[id]/schedule`) are on the branch, NOT yet on production Vercel. `ghl-job-webhook` v20 deployed with the cutover flag UNSET — legacy minting unchanged; the permanent `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false` flip happens ONLY at the Phase 1 gate. **Session 4 SHIPPED 2026-08-20:** Task 5A (outbound dispatcher) — `claim_integration_events` + `cancel_scheduled_job` + `*/5` cron **APPLIED TO PRODUCTION** (head `20260820152300`, 35 applied), `integration-dispatcher` v1 **DEPLOYED** (`verify_jwt=false` read back), `scheduleActions.ts` on the branch; branch-validated pgTAP 65/65, suites deno 371 + web 556. **Session 5 SHIPPED 2026-08-20 (no migrations, no prod applies):** (a) the **Task 5A live TEST-job probe ran** — estimate 1427 → JOB-1105 → dispatcher → Calendar + GHL both directions → cancel → cleanup, all verified; it found the 🔴 Slack bot-membership defect (see Environment Variables) and proved, unprompted, that **Task 4's `app_is_schedule_authority` compat check works in production** (the real GHL Job Scheduled workflow fired into `ghl-job-webhook` and was correctly skipped) — which retires the "two minting paths coexist" risk flag; (b) **Task 5B Step 1, the watch-channel spike, PASSED** — Google push to a Supabase edge function works, no domain verification needed, so 5B does NOT degrade to polling-only. **Sessions 6–8: Task 5B Step 2 built + fully reviewed (2026-08-24), then SHIPPED TO PRODUCTION 2026-08-25** — 3 migrations applied (head `20260825171051`, 38 applied), `google-calendar-webhook` **v2 deployed** via the invariant, cron `calendar-sync-maintenance` live at `7,37 * * * *`. Probe legs 1/2 + echo termination PROVEN LIVE (estimate 1428 → **JOB-1106**, Crew 4, 2026-12-22→23; **first-ever successful dispatcher Slack delivery**, to #ops-test via `SLACK_TEST_CHANNEL_OVERRIDE`). **Session 9 (2026-08-25, same day): probe legs 3/5/6 COMPLETE — all six legs proven live, Task 5B is DONE.** Inbound date apply → rev 2 → dispatcher mirror (update-not-create idempotency proven, R7 re-notify); deletion → exception + alert, job untouched → `dismiss` via RPC → rev 3, crew event recreated; `closed_lost` teardown (M7 rev-share observed live, zero GHL artifacts, re-cancel raise verbatim, both events deleted, echo silent); **override UNSET + confirmed absent.** No estimate burned. **Next = Task 7, the Phase 1 gate. Step 1 (whole-branch adversarial review) DONE 2026-08-25 Session 10 — MERGE-READY after fix round `604ddc5` (0 blocking; repo↔prod proven functionally identical; deferral ledger in the Session 10 BUILD_LOG entry).** **Gate preconditions AMENDED by Matt same session: the phone smoke + real estimate (**first real now ≥1429**; 1426 burned by a failed CHECK, 1427 by the 5A probe, 1428 by the 5B probe), the authenticated JOB-1104 webhook fire, the Slack bot invitations, and the calendar eyeballs (2026-12-15/16, 2026-12-28/29) are ALL BACKLOGGED → BL-8; the gate proceeds without them, and the Step 2 E2E runs Slack via `SLACK_TEST_CHANNEL_OVERRIDE=#ops-test` (unset at close).** **Steps 2+3 DONE same session — THE PHASE 1 GATE IS PASSED: the E2E ran clean (estimate 1429 v1→v2 → JOB-1107, Crew 2; deviation-12 pin verified live; dispatcher attempt-1 everywhere; echo `dates_unchanged` both calendars; reactivation FIRST-PROVEN — cancel → re-schedule new dates → same job, rev 2, no second budget; teardown clean, first real estimate now ≥1430) and the PERMANENT CUTOVER IS LIVE (`ghl-job-webhook` v25, flag=`false`; Quote Accepted mints nothing, live-verified through the real workflow on the 5A TEST opportunity, restored to Closed Lost after). Remaining Task 7 item: merge branch `claude/last-session-review-f7tqxw` per Matt's instruction.** See the 2026-08-25 Session 10/9/8, two 2026-08-20, and three 2026-08-19 `BUILD_LOG.md` entries and the phase plan's live checkboxes. |
| **BL-4 — crew Slack message format** | 🟢 **SHIPPED and merged to main 2026-08-17.** Both crew messages reformatted; 5 new `jobs` columns; the **estimate→job promotion now exists and is live-proven** (it had zero writers before). 4-tier scope source. 2 of 3 repo fixes done — the third became BL-6. Suite 312. See the 2026-08-17 `BUILD_LOG.md` entry. |
| **BL-5** | 🟢 **SHIPPED 2026-08-20** (`ghl-job-webhook` v19). Crew calendar events no longer carry `Estimate: $X`; main calendar keeps it. Live-probed on JOB-1104, Matt eyeballed both events. The no-pricing-to-crew-channels rule now holds on Slack AND crew calendars. Residual, consciously accepted: legacy `airtable-job-scheduled` still emits `Estimated Revenue` to crew calendars (retirement-bound path). |
| **BL-6 / BL-7** | BL-6 ⚪ **Not scheduled.** Close the `airtable-client-sync` data loss — **design draft ready for Matt's review**: `docs/superpowers/plans/2026-08-18-bl6-echo-guard-design-DRAFT.md` (echo loop live-proven: 100% of A→G syncs echo back G→A in ~2–5s; whole-tuple hash guard would loop forever because `tags` arrives empty in 620/624 payloads). BL-7 🟢 **RESOLVED AND IMPLEMENTED 2026-08-18** — `workforce_profiles` migration applied to production (v2 Task 0B); `handle_new_auth_user()` rewritten and pinned, no longer a silent no-op. Owner promotion still deferred to v2 Task 8. See the `workforce_profiles` Supabase Tables entry and the `handle_new_auth_user()` paragraph above. |
| **Backlog (BL-1/2/3)** | ⚪ Captured 2026-07-31, **not scheduled.** Equipment maintenance, tool inventory, crew-level P&L + foreman incentive comp. See `BUILD_PLAN.md` → "Backlog — captured, not scheduled". |

Foundation work already done (2026-07-30): repo/production reconciliation and RLS hardening.

The Next.js/Vercel app **is built, merged to main, and LIVE at https://lostboysdemolition.vercel.app**
(URL changed 2026-08-18; the old `lbd-estimates.vercel.app` is deleted and 404s)
(Phase B slice-2, merged `dd6cc87` 2026-08-14): `web/` holds a Next 16 App Router + Tailwind 4 + vitest 4 app with its own `package.json`
(the root `package.json` still declares only `dotenv` and is untouched). It imports the
golden-tested `_shared/pricing.ts` via the re-export shim `web/src/lib/pricing.ts` (never forked);
needs `supabase/functions/_shared/package.json {"type":"module"}` for Turbopack. A `pricing_variables`
rates loader, a GHL client + estimate-doc builder + push orchestration, and the estimates data layer
(validate/map/repo + server actions) are done, live-verified, and reviewed. `web/.env.local` must be
hand-created before local dev (env-guard throws without it — vars in BUILD_LOG). Web tests: `cd web
&& npx vitest run` → **261/261** at slice-2 close. `deno task test` → 18/18 (golden 321 gate intact).

**No-login estimate tool (⚠️ corrected 2026-08-14, mid-session — this is the single most important
correction in this doc pass).** Earlier drafts of this file, and BUILD_LOG entries written before
the change, describe the web app as gated behind Supabase Auth with 3 provisioned users. **That is
false as of the merged branch.** Matt decided mid-session (plan-mode approved:
`docs/superpowers/plans/2026-08-14-no-login-estimator-picker.md`) that the estimate tool ships with
**no login at all** — the full Supabase Auth stack built in Task 6 (middleware, `/login`,
`requireUser()`, the SSR session client) was deleted outright. Identity is now a device-remembered
"Who's estimating?" picker (Dane / Jackson / Matt) rendered as a header chip
(`web/src/app/(app)/EstimatorChip.tsx`, `useEstimator()`); the picked name is passed as a plain
argument into each server action and re-validated server-side against a fixed 3-name allowlist
(`web/src/lib/estimator.ts`). `estimates.created_by` is `NULL` on every row created under this
model — there is no `auth.users` row to point at — and `created_by_name` carries the picker's name
as the durable attribution record (this is what feeds `estimate_mutations_audit`, the future
"discounts by estimator" dataset). One live row predates the change and breaks the absolute: 1416
v1 was created before the no-login scope change merged and still carries a real `auth.users` id in
`created_by` (see the `estimates` table entry above) — that row alone is FK-pinned to a real auth
user; nothing created since is. **The deployment ships network-layer OPEN**: anyone with the URL can use it;
protection (if wanted) was deliberately deferred past T13, not solved by it — revisit before this
tool handles anything more sensitive than internal estimate drafts. **Manual Setup #2 (provision 3
Supabase Auth users) is CANCELLED** — do not do it, and do not expect `auth.users` to gain rows from
this app. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is still set in env but is now unused by the app (harmless
to leave). The T6 auth work is not wasted — it's intact in git history (`git log --all`, commits
through `363f511`/merged range `34eb9b7..0d3470b`) as a previously-reviewed, working pattern if
login is ever reintroduced.

**Two known limitations, invisible from reading any single file, flagged by the final whole-branch
review and accepted as low-risk at 3 users (not fixed this session):**
1. **Superseded-version protection is UI-only.** The estimate detail page hides status/push controls
   once a version is superseded, but the server actions (`updateStatusAction`, `pushEstimateAction`)
   do not re-check version status themselves — a stale browser tab left open from before a `revise`
   can still mutate or push the now-superseded row. Partially self-healing (re-pushing the current
   version overwrites the GHL side) but **not a status fix** — the UI only ever offers
   sent/accepted/declined, so restoring a wrongly-set superseded marker requires a direct
   `update_estimate_status` RPC call or raw SQL, not a click anywhere in the app. A defense-in-depth
   server-side re-check is deferred, not forgotten.
2. **No concurrency guard on the GHL push** — see the `ghl_push_state` row above.

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
