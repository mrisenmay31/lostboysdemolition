Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — the complete technical contract; **Phase 2's BUILD is complete — Tasks 6 AND 7 shipped;
the Phase 2 gate E2E is the remaining Phase 2 item, then Phase 3 opens on Task 8**). Executed
implementation plans: `docs/superpowers/plans/2026-08-26-v2-task6-job-dashboard.md` (Task 6) and
`docs/superpowers/plans/2026-08-26-v2-task7-manual-ledger.md` (Task 7 — its Design decisions
section is the canonical record of the ledger's locked conventions).

## What just happened — Session 12 (2026-08-26): v2 TASK 7 SHIPPED — the manual ledger is LIVE

Full record: the 2026-08-26 Session 12 `BUILD_LOG.md` entry.

- **Migration `manual_ledger_rpcs` APPLIED TO PRODUCTION** (MCP version `20260826180811`, 39
  applied; repo file `supabase/migrations/20260826150000_manual_ledger_rpcs.sql` is the identical
  SQL — same cosmetic version-name mismatch class as prior MCP applies). Four service-role-only
  RPCs are the ONLY ledger write path (never bare inserts): `create_job_cost_entry`,
  `correct_job_cost_entry` (FOR UPDATE, whitelisted patch, same-transaction audit row,
  `source_revision`/`updated_at` bump, `source_system='manual'` only until Task 14),
  `create_job_revenue_entry`, `open_category_overrun_alert` (fingerprint
  `category_overrun:<category>`, watch, dedup, NO Slack — Task 12 owns Slack delivery).
- **Locked conventions (do not drift):** credit/refund amounts stored NEGATIVE (RPC-enforced;
  forms capture positive, repo negates — matches `map.ts`'s signed economic-revenue sum); cost
  amounts strictly positive (correction to adjust, void to remove; no delete path); dates are
  Denver business dates stored as Denver NOON; attribution = `metadata.entered_by` (`p_actor`
  always null); **RPC raise texts are a cross-lane API** matched by substring in
  `web/src/lib/ledger/repo.ts`'s `classifyLedgerError` — never reword one side alone; NO revenue
  correction path by design (offsetting credit/refund is the correction).
- **MERGED TO MAIN (fast-forward `a0a92a2..0e893aa`, 7 commits, Matt's approval) and production
  Vercel deploy VERIFIED:** `/jobs/[jobNumber]/costs` + `/jobs/[jobNumber]/revenue` are LIVE at
  https://lostboysdemolition.vercel.app (budget-vs-entered table with the locked
  payment_processing footnote, per-entry Correct/void on manual non-void entries, estimator-gated
  actions). `/` still 307→`/estimates` — the flip is Task 8's.
- **Live smoke on JOB-1107 proved every leg in production:** overrun alert opened live ($215 vs
  $195 dump budget, correct message), correction preserved the entry's note through a note-less
  patch (the review-caught fix, proven live), sign guard raised on a positive credit, voids
  excluded from all sums, reconcile hook correctly no-ops (no closure snapshots until Task 11),
  **snapshot invariant held** (0 `job_forecast_snapshots` rows — cancelled jobs never
  engine-scored). **Residue on JOB-1107 (permanent, Matt-flagged): 2 voided cost entries, 3 audit
  rows, 2 net-zero revenue rows, 1 resolved alert** — removal only with Matt's per-item OK.
- Review record: 5 concurrent-lane task reviews + whole-branch review (strongest model), two
  review-caught defects fixed (note-wiping correction `8686996`; missing `QUERY_ROW_CAP`
  truncation sentinel + misleading test comment `0e893aa`). Suites at merge: web **728/728**,
  lint 0 errors/1 pre-existing warning, build green, deno **411/411** (golden-321 intact).
- Gotcha recorded: a SELECT-only CTE wrapping one of these RPCs gets optimized away silently —
  probe RPCs with direct `select * from fn(...)`; the app's `.rpc()` transport is unaffected.
  Also: **Supabase disposable branches do NOT clone data** (schema only) — fixtures needing
  `auth.users` rows must create synthetic ones in-transaction.

## ▶️ THIS SESSION OPENS HERE — the Phase 2 gate E2E, then Phase 3

1. **The Phase 2 gate** (v2 doc, end of Task 7; run with Matt): stage a fresh TEST estimate
   (burns estimate ≥1430 → first real becomes ≥1431 — Matt's call to proceed), schedule it into
   a real scheduled job via the app, then enter manual labor/materials/rental/dump/subcontractor/
   other-direct/processing/invoice/credit/refund/payment facts through the new screens. Verify:
   Dane sees original/current/actual+committed/forecast in the comparison table, health/confidence
   + leading variance on the dashboard card and detail banner, full audit detail; existing quote
   golden tests unchanged. NOTE: scheduling a job enqueues real dispatcher work — crew-Slack will
   dead-letter loudly per BL-8 unless `SLACK_TEST_CHANNEL_OVERRIDE=#ops-test` is set for the
   window (Session 8/9 precedent; UNSET at close), and calendar events land on real calendars —
   plan the teardown (cancel → closed_lost) like the 5A/5B/gate probes did.
2. **Then v2 Phase 3:** Task 8 (owner auth via `workforce_profiles`, owner promotion runbook, the
   `/` flip to the dashboard) and Task 9 (forecast overrides UI — its brief MUST Zod-reject
   empty-string numerics and require positive `hours_per_day`/`expected_crew_size`; Tasks 9/13
   both need the crew-days zero-divisor guard). Standard model: plan → Matt approval → concurrent
   lanes → adversarial review per task → Matt's gates.
3. **Whenever Dane's dashboard feedback arrives** (artifact still has zero comments): reconcile it
   into the v2 plan first; it may amend the shipped Task 6/7 surfaces.

## Standing items

**BL-8 (unchanged, Matt-only):** Slack bot invitations to Crew 1–4 (until done, real jobs'
crew-Slack legs dead-letter loudly and crews get NO Slack; all Slack testing stays in #ops-test);
phone smoke + one real estimate (≥1430; the phone smoke also covers the dashboard's 390px eyeball
AND now the two ledger screens); authenticated JOB-1104 re-drag + re-cancel; calendar eyeballs
2026-12-15/16 + 2026-12-28/29. Per-item OKs pending: delete GHL TEST opportunity
`UuTLn5Xg2Bb9EEj4UUBv`; JOB-1107 smoke residue rows; merged branches
(`claude/v2-task6-job-dashboard`, `claude/v2-task7-manual-ledger`) + worktree
`.claude/worktrees/task7` + the two SDD scratch ledgers under `.superpowers/sdd/`. BL-6
echo-guard design draft still awaiting Matt's review. **Phase-3 obligation:** build the
dispatcher's `slack_reconciliation_required` handler at the first Phase-3 dispatcher touch.
**Accepted minors from Task 7's reviews** (ledgered in the SDD scratch): $0-budget categories
alert on their first entry (noise — revisit if annoying); stale-tab un-void via the correction
form's seeded `state`; no double-submit idempotency on manual create (void is the remedy);
overrun can under-fire under concurrent same-category inserts (self-heals).

## State

**main == production everywhere.** Production Vercel serves main (`0e893aa` + docs commit) at
https://lostboysdemolition.vercel.app — estimate builder + Phase 1 surface + Job Dashboard +
the Task 7 ledger screens, no login, network-open. Live functions unchanged this session
(nothing deployed to Supabase functions): `ghl-job-webhook` v25 (flag=false permanent),
`crew-night-before` v11 line, `airtable-client-sync` v29 line, `integration-dispatcher` v1 line
(cron `*/5`), `google-calendar-webhook` v2 line (cron `7,37`). **Migration head `20260826180811`
(39 applied).** Suites at close: web **728/728**, deno **411/411** (golden-321 intact), lint 0
errors/1 pre-existing warning, build green. `jobs` = 5 cancelled TEST rows; ledger:
`job_cost_entries` 2 (both void, JOB-1107 smoke), `job_cost_entry_audit` 3,
`job_revenue_entries` 2 (net $0.00, JOB-1107 smoke); `job_forecast_snapshots` 0 (by design);
0 open alerts/exceptions; first real estimate still ≥1430.

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
