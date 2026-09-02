Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then **`docs/superpowers/plans/2026-09-02-adoption-checkpoint-assessment.md`**
(Session 16's whole-build assessment + proposal + the open questions — READ THIS BEFORE ANYTHING
ELSE THIS SESSION), then the ratified program
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (Phase 3 in
progress: 8a + 9 shipped; **8b was NOT built — Session 16 paused it pending Matt's rulings**).

## ▶️ THIS SESSION OPENS HERE — Matt answers three questions, THEN we plan

Session 16 (2026-09-02) found the business has not started using any of the built system:
**0 real estimates in the app vs 64 real Fillout estimates since 2026-07-31** (Airtable IDs
297→360), 0 real jobs, Dane never invited, no foreman accounts, Slack bot not in the crew
channels. Matt ruled: **adoption sprint first; the profitability dashboard IS the product; bare
bones first, manual actuals acceptable, automate later, add features along the way.** He closed
before answering these — **ask them first, one at a time, and record the rulings in BUILD_PLAN
(2026-09-02 amendment) before writing any plan:**

1. **8b scope.** Replace the foreman checklist area with an owner-side **"Mark started / Mark
   completed"** action on the job detail page (status RPC + GHL stage projection via the existing
   dispatcher + optional crew-days fields) — recommended, ~1 day; OR keep 8b as specced (foreman
   auth, offline queue, photos, SMTP — session-plus, synthetic gate until real jobs exist); OR
   owner action now + foreman area as the next build after one real job.
2. **Who enters actuals** (labor hours, dump loads, card spend, invoice amount) per job during
   the manual phase: Matt/CTA bookkeeping weekly from Gusto + BILL exports (hours per job still
   need a source) / Dane at completion / foremen report crew + hours, Matt's team enters the rest.
3. **How does a quote reach the customer today** — GHL estimate document (the app's GHL push
   replaces real rekeying = the adoption pitch) / texted or emailed number (entry speed on a
   phone is the whole pitch) / mixed by client type.

Then, per the rulings: write the implementation plan for the chosen 8b shape (written for
concurrent lanes; Build Planning Rule applies — Matt approves before code), and draft the
adoption-sprint checklist (estimating cutover date + mandate, Jackson's timed side-by-side
Fillout-vs-app estimate, Dane's owner invite via runbook §4, Slack bot invites, what to do with
in-flight Fillout estimates that get scheduled after cutover = re-enter in quick mode). Proposal
also on the table: freeze v2 Phases 4–6 as backlog; milestone = 30 days of real jobs through the
manual loop; then automate the most painful step (bet: BILL/Task 14 first, then time/Task 13);
amend the v2 plan to own the scope gaps (Track B, calibration loop, Fillout/Airtable
retirement, deposit policy, callbacks, sign-off) or drop each deliberately.

**Exploration findings already gathered (assessment §9 — do not re-derive):** the dispatcher
needs NO change for "Job In Progress"/"Job Completed" (SQL-side enqueue with the
`ghl_opportunity_id is not null` guard + a non-`:rev` idempotency key; add the two stages to the
test fixture); `job_time_entries` does not exist until Task 13 (open-clock gate leg deferred);
`job.checklist.submitted` and `slack_reconciliation_required` both dead-letter today (no switch
arm; no ops Slack channel secret exists anywhere); INVOKER-vs-DEFINER is the open question for
any `authenticated`-callable RPC (house = INVOKER service-role-only; the owner action avoids it);
Storage is greenfield; three hard-coded hours-per-day 8s (`map.ts` ×3 sites, job detail page,
DB default); `action_path` self-link also in `mark_job_reconciliation_required`;
`crew-night-before` drops `in_progress` jobs; `jobs` has no `updated_at` trigger.

## Standing items (unchanged)

**BL-8 (Matt-only):** Slack bot invitations to Crew 1–4 (until done, real jobs' crew-Slack legs
dead-letter loudly); phone smoke + one real estimate (**≥1431**); authenticated JOB-1104 re-drag +
re-cancel; calendar eyeballs 2026-12-15/16 + 2026-12-28/29. **Cleanup pending Matt's per-item
OK:** branch `claude/v2-task8a-owner-auth` + worktree `.claude/worktrees/task8a` (merged), its
SDD ledger, GHL TEST opportunity `UuTLn5Xg2Bb9EEj4UUBv`. BL-6 echo-guard design draft awaiting
Matt's review. JOB-1107/1108 residue KEPT permanently (do not re-ask). Dane's
dashboard-prototype feedback never received (zero artifact comments). Dane's owner invite =
runbook §4, now part of the adoption sprint.

## State

**Production = main (`162f64a` + Session 16 docs) at https://lostboysdemolition.vercel.app,
serving the 8a posture** (`/` 307→`/estimates` anon; `/jobs/*` owner-gated with full `next=`;
`/estimates` + `/auth/sign-in` 200). Live functions unchanged: `ghl-job-webhook` v25
(flag=false permanent), `crew-night-before` v11 line, `airtable-client-sync` v29 line,
`integration-dispatcher` v1 (cron `*/5`), `google-calendar-webhook` v2 (cron `7,37`).
**Migration head `20260826180811` (39 applied — zero migrations Sessions 14–16).** `jobs` = 6
cancelled TEST rows; 0 open alerts/exceptions; outbox drained (16 succeeded); 5 calendar
channels active; `SLACK_TEST_CHANNEL_OVERRIDE` ABSENT. Matt = `workforce_profiles` owner/active,
sign-in `matt@lostboysdemolition.com` (ruled). Suites at last merge: web 811/811, deno 411/411
(golden intact). First real estimate ≥1431.

## Standing instructions (unchanged)

Delete nothing without Matt's express per-item approval; never `git add -A`. Every build task
gates on adversarial review (+ runbook cycle for any migration) + Matt's per-task prod-apply/merge
yes. Anything applied to Supabase committed same session. BUILD_LOG entry at every session close.
Sonnet implements, the strongest available model adversarially reviews. Concurrency REQUIRED
where it doesn't impact quality/integrity; plans are written for concurrent lanes up front.
**Three functions deploy ONLY via the `--no-verify-jwt` + readback invariant: `ghl-job-webhook`,
`integration-dispatcher`, `google-calendar-webhook`** — readback confirms the other two
undisturbed (by sha, not version counter). Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field
Registry / Secrets (names only) / People & IDs.
