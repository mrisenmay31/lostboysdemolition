Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then the two Profitability v2 execution docs:
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — the complete technical contract) and
`docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md` (the approved Phase 1 execution
plan — **live checkboxes, deviations 1–12, and the review-handoff blocks are current; work from
this file**).

## What just happened — v2 Phase 1 Session 3 SHIPPED (2026-08-19, local session)

Branch: **`claude/last-session-review-f7tqxw`** (still NOT merged to main — Matt decides when).
Read the three 2026-08-19 entries at the top of `BUILD_LOG.md`. Headlines:

- **v2 Task 4 — `schedule_estimate` RPC LIVE ON PRODUCTION** (head `20260819191046`, 32 applied).
  Family-locked eligibility (acceptance currency ONLY from `estimate_acceptance_state`), deviation-12
  budget v1 (`approved_revenue` = pinned `accepted_price`; profit RECOMPUTED at mint; pct clamped),
  `launch_workflow=true` mint, GHL ids written at mint from `estimate_identity_links`,
  `scope_summary` from line-item NAMES only, F2 version-mismatch hard-error on idempotent AND
  reactivation branches, revision-scoped outbox keys, `ghl.stage.requested` only when linked,
  PLAIN INVOKER. Branch runbook: probes FAITHFUL, RED 15/15 not-ok, **GREEN 82/82 first execution**.
- **`ghl-job-webhook` v20 DEPLOYED** via the two-command `--no-verify-jwt` invariant
  (`verify_jwt=false` read back). `ENABLE_GHL_ACCEPTANCE_JOB_CREATION` **confirmed ABSENT** from
  prod secrets ⇒ legacy Quote-Accepted minting runs byte-identically (fail-safe: only the literal
  `"false"` disables). Job Scheduled has an UNCONDITIONAL `launch_workflow` compat check →
  `app_is_schedule_authority`, zero side effects. Deploy probed secret-less (function-level 401 +
  clean logs); the authenticated live fire is Matt's to-do.
- **Web scheduling shipped to the branch** (NOT on production Vercel): `/estimates/[id]/schedule`
  gated by the acceptance projection via pure `canScheduleThisVersion()` (rendered OUTSIDE
  `canRevise` — review caught the superseded-but-accepted trap), server-side crew enum (Crew 1–4),
  raise-text error classifier verified against the live RPC texts.
- Review chain: 4a two rounds + micro (SECURITY DEFINER reversed — BL-7 rationale; F2/F3/R1/R2),
  4b one round (MAJOR link-nesting), 4c one round — all APPROVE. **deno.json canonical task gained
  `--allow-env=ENABLE_GHL_ACCEPTANCE_JOB_CREATION`** (the missing grant failed all 29
  handleQuoteAccepted tests under the canonical task while scoped --allow-all runs passed).
- Suites at close: deno **331/331** (canonical task), web **537/537**, build green, golden-321
  intact. Commits `d72878c`, `51ad5fb`, `7028b63`, `2b019e3` + the deploy-record docs commit.

## 🚨 Hard-won facts — don't rediscover these

- **The Supabase MCP SQL runner executes a multi-statement batch as ONE implicit transaction and
  returns only the LAST statement's result.** A pgTAP suite's own `rollback` therefore discards any
  TAP-capture temp table. Branch-run recipe: strip `begin;`/`rollback;` (branch is disposable),
  wrap every TAP-emitting `select` as `insert into tap_out(line) select …`, final statement
  `select line from tap_out order by ln`. RED runs that hit a hard error return only the error
  (documented-abort pattern).
- **plpgsql enforces a variable's declared typmod at EVERY assignment** — a `numeric(7,2)` variable
  overflows on the computing assignment before any clamp line runs. Clamp into a plain `numeric`
  variable, bound before the column write.
- **`GHL_WEBHOOK_SECRET`'s value is not readable from any sanctioned store** (Airtable Secrets table
  is a name registry; `.env` is permission-blocked; CLI shows digests). Authenticated webhook fires
  = GHL UI re-drag (BL-5 procedure) or Matt supplies the secret. Re-drags REVIVE job rows —
  re-cancel as cleanup, every time.
- Raise texts are a cross-lane API: `web/src/lib/jobs/repo.ts` `classifyScheduleError` substring-
  matches three `schedule_estimate` raise texts (byte-pinned in the migration header). Any new
  raise must avoid "already"/"accept"/"supersed"/"financial"/"not presented" or it misclassifies.
- `estimate_acceptance_events` has no monotonic ordering — current acceptance ONLY via
  `estimate_acceptance_state`. (Binds Task 5A's dispatcher reads too.)
- Legacy `ghl-job-webhook` v20 semantics: flag absent/garbage ⇒ mint (fail-safe); compat check is
  NOT flag-gated. The flip to `"false"` happens ONLY at the Phase 1 gate pass, never re-enabled.

## 🔴 Matt's to-dos (non-blocking for Session 4; REQUIRED before the Phase 1 gate/cutover)

- **Phone smoke + one real estimate (≥1426)** — on the branch preview
  https://lostboysdemolition-git-claude-la-f27ac4-matt-risenmays-projects.vercel.app (NOT the
  production URL: the old build's v1-RPC estimates can never be scheduled — no financial details,
  no acceptance lifecycle). Same prod DB either way.
- **Authenticated webhook live fire**: re-drag the TEST opportunity (JOB-1104) to Job Scheduled in
  GHL, confirm legacy behavior unchanged at v20, then RE-CANCEL JOB-1104.
- Vercel production deploy of the branch web work = merge decision (Matt's call, whole-branch
  review first per standing rule).
- Older items: BL-6 echo-guard draft review; BL-4 #ops-test eyeball; Dane habit items; owner
  promotion deferred to v2 Task 8.

## Decisions recorded this session (Matt, 2026-08-19)

- Prod apply + webhook deploy: approved and done. Phone smoke: to-do, not a blocker.
- **Crew vocabulary: "Jackson"/"Other" fifth option DROPPED — Crew 1–4 only** in the v2 schedule
  flow (4b review finding 3 resolved).
- Still flagged for explicit confirmation in the ledger (implemented, not yet Matt-confirmed):
  `scope_summary` at mint = line-item names only (F7); moved-acceptance families hard-error rather
  than reactivate (F2); `start_time` stays NULL on app-minted jobs (no source in the app flow).

## Next work — Session 4 (v2 Task 5A: outbound dispatcher)

1. Execute the phase plan's Task 5 (Session 4) row: `claim_integration_events` RPC migration
   (runbook cycle), `integration-dispatcher` edge function (Calendar create/update with inclusive→
   exclusive end-date conversion, `extendedProperties.private.managedBy`, main-vs-crew no-pricing
   boundary pinned by tests, GHL stage projection via the outbox, one crew-safe Slack message,
   retry `min(60, 2**attempts)`, dead-letter at 5 + `job_alerts`), 5-min self-gating cron with
   `x-webhook-secret`, `web/src/lib/jobs/scheduleActions.ts` (cancel/postpone/closed-lost).
   Deviation 6: dispatcher auth = `x-webhook-secret` (crew-night-before pattern); posture recorded
   at deploy.
2. Then Session 5 (Task 5B inbound calendar — OPENS WITH THE WATCH-CHANNEL SPIKE; degrade to
   reconciliation-polling if Google blocks edge-function URLs, flag to Matt before building
   channel machinery).
3. Phase 1 gate (Task 7) only after Matt's to-dos above are done: whole-branch review → E2E on
   live GHL with TEST records → permanent flag flip → land + merge per Matt.

## State that hasn't changed

Production Vercel still serves `main` (`4dd15cc`, pre-Session-2 build), no login, network-open.
`crew-night-before` v11, `airtable-client-sync` v29. Estimates ≤1425 TEST residue; JOB-1102/1104
cancelled (verify JOB-1104 still cancelled after any re-drag); 3 TEST identity-link rows
(1419/1420/1423). BL-6 draft awaits Matt. Test-fixture families 910101–910110 existed only on the
deleted validation branch — production carries NO Task 4 test residue (row counts verified
unchanged post-apply).

## Standing instructions (unchanged)

Delete nothing without Matt's express per-item approval; never `git add -A`. The Phase 1 plan IS
approved — execute from its checkboxes; every task still gates on adversarial review + runbook
cycle + Matt's per-task prod-apply yes. Anything applied to Supabase committed same session.
BUILD_LOG entry at every session close. Sonnet implements, the strongest available model
adversarially reviews every task + the whole branch. Concurrency is REQUIRED where it doesn't
impact quality/integrity. `ghl-job-webhook` deploys ONLY via the two-command `--no-verify-jwt`
invariant + readback. Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field Registry / Secrets
(names only) / People & IDs.
