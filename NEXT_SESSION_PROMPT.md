Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — **Phase 3 in progress: Tasks 8a + 9 are SHIPPED AND LIVE; this session builds Task 8b**:
the foreman mobile checklist area + the Phase 3 gate + the backlogged `action_path` RPC
migration). Session-14 build plan (context for what 8a/9 are):
`docs/superpowers/plans/2026-08-27-v2-task8a-owner-auth-task9-forecast-overrides.md`. Owner auth
operations: `docs/runbooks/owner-promotion.md` (now on main, corrected).

## What just happened — Session 15 (2026-08-27): the 8a gate sequence ran clean; 8a + Task 9 LIVE

Full record: the 2026-08-27 Session 15 `BUILD_LOG.md` entry.

- **Merged to main non-FF `8cfe920..34ab995` and deployed** — merged `web/`+`supabase/` trees
  proven byte-identical to the reviewed branch head before push. Zero migrations, zero
  edge-function changes.
- **Production posture now:** `/estimates/*` open + estimator picker (unchanged, by design);
  **`/jobs/*` owner-gated** (magic link, `shouldCreateUser:false` invite-only; proxy + layout
  defense in depth — deep-link probe proved the proxy registered); `/` routes an active owner to
  `/jobs`, everyone else 307→`/estimates`. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is now load-bearing.
- **Matt is the promoted, smoke-tested owner.** Supabase Auth configured (Site URL, redirect
  URLs, **both token_hash email templates** — the review's 100%-dead-end config finding closed).
  Phone smoke passed all four runbook §3 checks.
- **Two execution findings, both recorded in the runbook:** (1) the live profile
  `display_name` is lowercase `matt` — promotion had to key on `auth_user_id` (the runbook's
  original `display_name='Matt'` would have zero-row no-opped; fixed `d19566d`); (2) **the owner
  sign-in email is `matt@lostboysdemolition.com`, NOT matt@ctaintegrity.com** — the sole
  auth.users row is the 2026-05-05 May test user; the CTA address was rejected by
  `shouldCreateUser:false` (working as designed). **Matt ruled: the lostboysdemolition address
  stays.** Dane's later invite = runbook §4.
- **Ruled boundary (unchanged):** `/jobs` PAGES owner-only; pre-existing
  cost/revenue/schedule/cancel WRITES stay picker-gated + network-invocable — 8b hardening
  candidate. Only the Task 9 forecast-override action is owner-gated.

## ▶️ THIS SESSION OPENS HERE — v2 Task 8b (a build session: plan → Matt's approval → lanes)

Scope per Matt's Session-14 split ruling (v2 plan amendment + Session 14 BUILD_LOG entry):

1. **Foreman mobile checklist area** — offline queue, service worker, photo bucket,
   `submit_job_checklist` RPC, GHL lifecycle, `activateWorkforceProfile`, migration
   `20260818160000` (numbering per the Session-14 entry — re-derive the real timestamp at
   write time).
2. **The backlogged alert `action_path` migration** — overrun alerts should link
   `/jobs/<job>/costs`, not self-link (one-line RPC change; attach to 8b's migration window).
3. **The Phase 3 gate** at the end.
4. **Session-14/15 carries to fold into the 8b plan:** action-level auth-branch tests;
   `DEFAULT_HOURS_PER_DAY` shared constant (map.ts + job detail both hard-code 8); **custom SMTP
   BEFORE foreman onboarding** (built-in sender is a few emails/hour — fine for 1–2 owners, not
   for 4 foremen); the picker-gated-writes hardening decision (Matt's call: harden in 8b or
   defer); costs-edit discoverability (UX, from the Phase 2 gate).
5. **Phase-3 obligation (standing):** build the dispatcher's `slack_reconciliation_required`
   handler at the first dispatcher touch this phase.

This is a **build**: produce the implementation plan (written for concurrent lanes), get Matt's
explicit approval, then execute with per-task adversarial reviews + final whole-branch review.

## Standing items

**BL-8 (Matt-only):** Slack bot invitations to Crew 1–4 (until done, real jobs' crew-Slack legs
dead-letter loudly); rest of the phone smoke + one real estimate (**≥1431**); authenticated
JOB-1104 re-drag + re-cancel; calendar eyeballs 2026-12-15/16 + 2026-12-28/29. **Cleanup pending
Matt's per-item OK:** branch `claude/v2-task8a-owner-auth` + worktree `.claude/worktrees/task8a`
(now merged), its SDD workspace ledger, the GHL TEST opportunity `UuTLn5Xg2Bb9EEj4UUBv`. BL-6
echo-guard design draft still awaiting Matt's review. JOB-1107/1108 residue KEPT permanently (do
not re-ask). Dane's dashboard-prototype feedback still not received — reconcile into the v2 plan
whenever it lands. Dane's owner invite = deferred (runbook §4).

## State

**Production = main (`34ab995` line) at https://lostboysdemolition.vercel.app, serving the 8a
posture** (verified: `/` 307→`/estimates` anon; `/jobs`+`/jobs/exceptions`+deep links
307→`/auth/sign-in` with full `next=`; `/estimates` + `/auth/sign-in` 200). Live functions
unchanged: `ghl-job-webhook` v25 (flag=false permanent), `crew-night-before` v11 line,
`airtable-client-sync` v29 line, `integration-dispatcher` v1 (cron `*/5`),
`google-calendar-webhook` v2 (cron `7,37`). **Migration head `20260826180811` (39 applied — zero
migrations Sessions 14–15).** `jobs` = 6 cancelled TEST rows; 0 open alerts/exceptions; outbox
drained; 5 calendar channels active; `SLACK_TEST_CHANNEL_OVERRIDE` ABSENT. Matt's
`workforce_profiles` row = `owner`/active (`matt@lostboysdemolition.com`). Suites at merge: web
811/811, deno 411/411 (golden intact). First real estimate ≥1431.

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
