Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then the two Profitability v2 execution docs:
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — the complete technical contract) and
`docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md` (the approved Phase 1 execution
plan — **live checkboxes, deviations 1–12, and the review-handoff blocks are all current; work
from this file**).

## What just happened — v2 Phase 1 Sessions 1+2 SHIPPED (2026-08-19, remote session)

Branch: **`claude/last-session-review-f7tqxw`** (NOT yet merged to main — Matt decides when).
Read the two 2026-08-19 entries at the top of `BUILD_LOG.md` before touching anything. Headlines:

- **v2 Task 1 (canonical profitability schema) — LIVE ON PRODUCTION.** 14 enums, 12 new `jobs`
  columns, 16 tables, `mark_job_reconciliation_required()` (outbox keyed `alert:<uuid>` of the
  newly-opened alert), 7 immutability triggers, full RLS + revoke posture. pgTAP 102/102.
- **v2 Task 2 (economics + commercial lifecycle) — migrations LIVE ON PRODUCTION** (head
  `20260819141318`, 31 applied): `create_estimate_with_items_v2` (v1 untouched, all 3 args
  required), `estimated_dump_cost_per_load=65` seed, `estimate_identity_links` /
  `estimate_presentations` / `estimate_acceptance_events` / `estimate_acceptance_state`,
  `record_estimate_acceptance_event`. **Deviation 12 is live:** `accepted_price` is pinned
  server-side at acceptance from `coalesce(quoted_price, total_bid)`. Identity backfill seeded
  exactly 3 TEST families (1419/1420/1423). pgTAP 78/78.
- **v2 Task 3 (forecast engine)** + **Task 2 web integration** merged to the branch: economics
  module, GHL pipeline authority + prefill/contact-match, builder category cost inputs,
  present/accept/reverse lifecycle UI. **The web app is NOT yet deployed to Vercel** — that is a
  separate Matt decision (the deploy-order invariant is satisfied; the rates key is live).
- Every task went through adversarial Opus review + fix rounds (2 rounds each for the schema
  lanes; 3 for the 2d integration — the re-review's "Attack C" catch matters, see BUILD_LOG).
- Suites at close: web **471/471**, deno **317/317** (golden-321 intact), build green.

## 🚨 Hard-won facts — don't rediscover these

- **`estimate_acceptance_events` has no monotonic ordering** — same-transaction events share
  `created_at`. Any "current acceptance" read MUST use
  `estimate_acceptance_state.current_acceptance_event_id` / `current_estimate_id`, never
  `order by created_at`. **This binds Task 4's `schedule_estimate` directly.**
- **The superseded marker must survive a reversal.** `reverseEstimateAcceptance` deliberately
  skips the status mirror when the target is superseded — mirroring would clear the marker and
  re-arm stale-price acceptance (re-review Attack C). Don't "fix" that skip.
- **Live GHL Job Pipeline stage names are dumped and verified** (pipeline `OMDtCf2eHWQ1GQrEcJA1`):
  stage 7 "Job In Progress", stage 11 "Paid / Closed Won". The location's SECOND pipeline
  ("Contractor Pipeline") has its own "Job Scheduled" stage — the pipeline-membership assertion
  before any stage move is live-proven load-bearing, not boilerplate.
- **pgTAP:** description args on every multi-overload assertion; `col_default_is` takes the plain
  VALUE ('not_ready'), never the rendered `'x'::type` expression (22P02 otherwise).
- The live `quote_override_reason_required` CHECK rejects any `quoted_price` without a reason —
  test fixtures included.
- `import "server-only"` poisons client-component import paths — pure helpers consumed by client
  components live in untagged modules (`acceptancePresentation.ts` pattern).
- supabase-js `.upsert(..., { ignoreDuplicates: true })` = ON CONFLICT DO NOTHING; safe against
  immutability triggers.
- Runbook (`docs/runbooks/profitability-schema-validation.md`) is mandatory for every schema
  task; per-task prod applies with Matt's explicit yes each time (his 2026-08-19 decision).

## 🔴 Still owed / gates

- **Matt's phone smoke + one real estimate (≥1426) through https://lostboysdemolition.vercel.app**
  — outstanding since 2026-08-14, and a **HARD STOP before v2 Task 4's cutover work and the
  Phase 1 gate** (Matt's 2026-08-19 decision: Tasks 1–3 could proceed, Task 4 cutover cannot).
  Note the live Vercel deployment still runs the pre-Session-2 build until the branch is deployed.
- **Vercel deploy of the Session 2 web work** — separate Matt ask (changes live builder behavior:
  new cost inputs + lifecycle actions).
- **GHL minting cutover** (`ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false`, permanent) happens at
  Phase 1 gate pass, NOT at Task 4 deploy (Matt's decision 1; flag absent ⇒ legacy ON).
- Accepted limitations recorded in BUILD_LOG (GHL-lag has no in-app retry for accept/reverse;
  `/estimates/new?ghlOpportunityId=` prefill is an accepted-risk read on the network-open
  surface; identity panel is creation-only for opportunities).
- 3 TEST identity-link rows (1419/1420/1423) + estimates ≤1425 TEST residue — deletable only with
  Matt's per-item approval.
- Older items: BL-6 echo-guard draft awaits Matt; BL-4 #ops-test eyeball; Dane habit items;
  owner promotion deferred to v2 Task 8.

## Next work — Session 3 (v2 Task 4: atomic schedule-to-job promotion)

1. Confirm the gate precondition above FIRST (phone smoke + real estimate).
2. Execute the phase plan's Session 3: lanes 4a (schedule_estimate RPC migration — runbook cycle;
   **sources `approved_revenue` from the acceptance's `accepted_price`, deviation 12**; consumes
   `estimate_acceptance_state` + `isSchedulingEligible` semantics), 4b (web scheduling lib/UI),
   4c (`ghl-job-webhook` flag gate — deploy ONLY via the `--no-verify-jwt` two-command invariant;
   139-test suite must stay green; flag left UNSET in prod until the gate).
3. Then Session 4 (Task 5A outbound dispatcher) and Session 5 (Task 5B inbound calendar — opens
   with the watch-channel spike).

## Standing instructions (unchanged)

Delete nothing without Matt's express per-item approval; never `git add -A`. Plan + explicit
approval before any new build (the Phase 1 plan IS approved — execute from its checkboxes; each
task still gates on adversarial review + live-probe + Matt sign-off for prod applies). Anything
applied to Supabase committed same session. BUILD_LOG entry at every session close. Sonnet
implements, the strongest available model adversarially reviews every task + the whole branch.
Concurrency is REQUIRED where it doesn't impact quality/integrity. Pipeline Reference base
(`appA7uj7FhnPp9Bvg`) still holds Field Registry / Secrets / People & IDs.
