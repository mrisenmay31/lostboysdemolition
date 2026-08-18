Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md (official plan — note the **2026-08-18 amendment**), then
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
Profitability Program v2).

## What just happened — Profitability Program v2 RATIFIED and LANDED (2026-08-18, docs only)

Matt reconciled two Codex-authored program docs against BUILD_PLAN.md and ratified Version 2 with
four decisions and five adjustments. Read the 2026-08-18 "Profitability Program v2" entry in
`BUILD_LOG.md` before planning anything. Headlines:

- **Job authority moves to app-side scheduling** — Quote Accepted becomes pre-job; scheduling in
  the app will mint `JOB-XXXX`. **Phase A's GHL minting is UNCHANGED AND LIVE until v2 Task 4
  ships**, then flag-disabled permanently. After launch, every job requires an app-created
  estimate — no GHL-only/Fillout-only jobs.
- **Phase D is RESOLVED** (was the last 🔴 blocker): D1 unblocked (job-time schema, manual/CSV
  import, foreman approval, Dane override, provider-neutral adapter = v2 Task 13); D2 deferred
  (vendor evaluation against the adapter contract; Gusto stays payroll; add-on question parked).
- **Scoped auth returns** for foremen + Dane's financial routes via isolated `workforce_profiles`
  (BL-7 resolved by v2 Task 0B); estimator picker stays for estimates.
- **Stripe direct + Synder→QBO reaffirmed; GHL never becomes invoice authority** (the design
  spec's §2 said otherwise and is flagged inline). Two-way Calendar sync confirmed as a real
  requirement, full channel lifecycle specified.
- v1 of the plan is archived at `docs/archive/2026-08-18-live-job-profitability-health-dashboard.md`.

**Docs only — nothing was built.** v2 Task 0A is incomplete (the schema-validation runbook is
unwritten); **Task 0B (BL-7 `workforce_profiles` migration) is NOT implemented or verified**; no
migrations, code, or deploys happened. Phase A/BL-5 behavior is live and untouched.

## 🚨 Hard-won facts — don't rediscover these

- **A bare `supabase functions deploy` silently flips `verify_jwt` to TRUE** → 401s every GHL
  call. Always `--no-verify-jwt` for webhook functions; always read back via
  `list_edge_functions`. (Now also a v2 global constraint.)
- **Test re-drags revive job rows** (`handleJobScheduled` writes `status_v2='scheduled'`
  unconditionally). Re-cancel test jobs as part of every probe cleanup.
- **No `supabase db reset`/`db push`** — the 5 live-only legacy functions can't replay from empty.
  Schema work validates on a disposable live-schema branch, then the established migration
  workflow. (v2 global constraint.)
- **The A→G→A sync echo loop is live-proven** (BL-6 draft); `tags` arrives empty in 620/624
  payloads, so a whole-tuple hash guard would loop forever.

## 🔴 Still owed

- **Matt's phone smoke + one-real-bid Fillout parallel check** on
  https://lostboysdemolition.vercel.app — outstanding since 2026-08-14 and now a **hard
  precondition of the v2 Phase 1 gate**. First real estimate ≥ 1426.
- Eyeball the BL-4 message rendering in #ops-test (Matt's 30-second look).
- Dane habit items: populate GHL **Job Start Time** and **Job Scope**.

## Next work

1. **v2 Task 0A remainder** — write `docs/runbooks/profitability-schema-validation.md` (the plan
   documentation half landed 2026-08-18).
2. **v2 Task 0B — BL-7 auth boundary** (`workforce_profiles` migration + assertions on a
   live-schema branch). First code of the program; full build rules apply.
3. Then v2 Phase 1 (Tasks 1–5) per the plan's gates.
4. **BL-6 echo-guard draft** still awaits Matt's review
   (`docs/superpowers/plans/2026-08-18-bl6-echo-guard-design-DRAFT.md`). Weigh its priority
   against the shortened Airtable-sync horizon under v2.
5. Track B — lead intake (Grasshopper-vs-port, open decision #7) remains config-only, parallel.
6. Historical import of 321 Airtable estimates: Matt **declined** 2026-08-14; don't re-propose.

## State that hasn't changed

Phase B slice 2 LIVE at https://lostboysdemolition.vercel.app, no login (estimator picker),
network-layer open. `ghl-job-webhook` v19 (BL-5: crew calendars carry no pricing), 
`crew-night-before` v11, `airtable-client-sync` v29. Suite: 317 via `deno task test`, golden-321
gate intact; web 261/261. Test residue: estimates ≤1425 TEST-labeled; JOB-1102/JOB-1104 cancelled;
no test artifacts on any calendar.

## Standing instructions (unchanged)

Delete nothing without Matt's express per-item approval; never `git add -A`. Plan + explicit
approval before any new build (the v2 plan is approved as the program plan; each phase still
gates on adversarial review + live-probe + sign-off). Anything deployed/applied to Supabase
committed same session. BUILD_LOG entry at every session close. Sonnet implements, opus reviews
every task + whole branch. Concurrency is REQUIRED where it doesn't impact quality/integrity;
plans are written for concurrent execution. Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field
Registry / Secrets & Credentials / People & IDs only.
