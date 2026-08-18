Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md (official plan — note the 2026-08-18 amendment), then
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
Profitability Program v2).

## What just happened — Profitability v2 Phase 0 SHIPPED; BL-7 CLOSED (2026-08-18)

Executed `docs/superpowers/plans/2026-08-18-profitability-v2-phase0.md` on branch `v2-phase0`.
**Both Phase 0 tasks are done, and Task 0B's migration is applied to production** — Matt approved
the prod apply this session rather than leaving it committed-but-unapplied. Read the 2026-08-18
"Profitability v2 Phase 0 SHIPPED" entry in `BUILD_LOG.md` before touching anything schema-related.
Headlines:

- **Task 0A** — `docs/runbooks/profitability-schema-validation.md` written: the 8-step validation
  sequence, a branch-fidelity decision tree, the auth-schema dry-run caveat (below), and the exact
  `ghl-job-webhook --no-verify-jwt` deploy-invariant block. CLAUDE.md/BUILD_PLAN.md got the 7→12
  RLS policy-count correction.
- **Task 0B** — migration `20260818143000_workforce_auth_boundary.sql` + the repo's first pgTAP
  test (`supabase/tests/workforce_auth_boundary_test.sql`, 19 assertions), validated on a
  disposable branch, then a **mandatory production single-transaction dry-run** (branches can't
  reproduce `auth.users` ownership), then applied for real. `workforce_profiles` now exists on
  production: RLS, 2 policies, 1 backfilled row (Matt, `pending`/`inactive`).
- **BL-7 IS CLOSED.** `handle_new_auth_user()` is pinned and rewritten — it inserts into the
  isolated `workforce_profiles` table instead of being a silent no-op. Owner promotion (Matt's row
  from pending/inactive to an active owner role) is deliberately deferred to v2 Task 8's launch
  runbook — not done this session.
- Suites at validation time: `deno task test` 317/317, `cd web && npx vitest run` 261/261.
- Branch `v2-phase0` is **not yet merged to `main`** — commits `27f95c3..c50a5d6` plus this
  session's docs commit. Confirm the whole-branch review landed and merge before starting new work
  if it hasn't already happened by the time you read this.

## 🚨 Hard-won facts — don't rediscover these

- **A bare `supabase functions deploy` silently flips `verify_jwt` to TRUE** → 401s every GHL
  call. Always `--no-verify-jwt` for webhook functions; always read back via
  `list_edge_functions`. Now documented as the deploy invariant in
  `docs/runbooks/profitability-schema-validation.md`.
- **Auth-schema DDL is branch-blind — the new standing rule.** A migration touching any
  `auth.*` object (trigger, function owned by `auth.users`, etc.) can pass green on a disposable
  branch and still fail on production, because branches don't reproduce `postgres`'s real
  ownership gaps against `auth.users` (`postgres` holds TRIGGER privilege there, not ownership —
  `DROP TRIGGER` 42501s on prod, passes on a branch). **Any such migration REQUIRES the production
  single-transaction dry-run regardless of branch results.** Runbook: `docs/runbooks/profitability-schema-validation.md`.
- **pgTAP assertions need explicit description args or they resolve to the wrong overload.**
  `has_table('public', 'x')` without a third/fourth description string silently resolves to
  `has_table(table, description)` and checks for a table literally named `public`. Always pass
  the description argument on `has_table`/`has_column`/`policy_cmd_is` and similar multi-overload
  pgTAP functions.
- **Supabase default privileges pre-grant `authenticated` more than expected — including
  TRUNCATE, which RLS does not gate.** Any new-table revoke list must name `authenticated`
  explicitly, not just `anon`.
- **Test re-drags revive job rows** (`handleJobScheduled` writes `status_v2='scheduled'`
  unconditionally). Re-cancel test jobs as part of every probe cleanup.
- **No `supabase db reset`/`db push`** — the 5 live-only legacy functions can't replay from empty.
  Schema work validates on a disposable live-schema branch, then the established migration
  workflow (now formalized in the runbook above).
- **The A→G→A sync echo loop is live-proven** (BL-6 draft); `tags` arrives empty in 620/624
  payloads, so a whole-tuple hash guard would loop forever.

## 🔴 Still owed

- **Matt's phone smoke + one-real-bid Fillout parallel check** on
  https://lostboysdemolition.vercel.app — outstanding since 2026-08-14 and a **hard precondition
  of the v2 Phase 1 gate**. First real estimate ≥ 1426.
- BL-6 echo-guard design draft still awaits Matt's review
  (`docs/superpowers/plans/2026-08-18-bl6-echo-guard-design-DRAFT.md`).
- Eyeball the BL-4 message rendering in #ops-test (Matt's 30-second look).
- Dane habit items: populate GHL **Job Start Time** and **Job Scope**.
- Owner promotion for `workforce_profiles` (Matt's row, pending → active owner) — explicitly
  deferred to v2 Task 8's launch runbook, not a Phase 1 task.

## Next work

1. **v2 Phase 1 planning (Tasks 1–5)**, starting with Task 1 (schema). Every schema task in this
   phase MUST follow `docs/runbooks/profitability-schema-validation.md` — read it before writing
   any migration.
2. Confirm the Phase 1 gate precondition (Matt's phone smoke + first real estimate) before
   treating Phase 1 as clear to start, per the v2 ratification decision.
3. BL-6 echo-guard draft still awaits Matt's review — weigh its priority against the shortened
   Airtable-sync horizon under v2.
4. Track B — lead intake (Grasshopper-vs-port, open decision #7) remains config-only, parallel.
5. Historical import of 321 Airtable estimates: Matt **declined** 2026-08-14; don't re-propose.

## State that hasn't changed

Phase B slice 2 LIVE at https://lostboysdemolition.vercel.app, no login (estimator picker),
network-layer open. `ghl-job-webhook` v19 (BL-5: crew calendars carry no pricing),
`crew-night-before` v11, `airtable-client-sync` v29. Suite: 317 via `deno task test`, golden-321
gate intact; web 261/261. Test residue: estimates ≤1425 TEST-labeled; JOB-1102/JOB-1104 cancelled;
no test artifacts on any calendar. No edge function was touched by the Phase 0 session — all
function versions unchanged.

## Standing instructions (unchanged)

Delete nothing without Matt's express per-item approval; never `git add -A`. Plan + explicit
approval before any new build (the v2 plan is approved as the program plan; each phase still
gates on adversarial review + live-probe + sign-off). Anything deployed/applied to Supabase
committed same session. BUILD_LOG entry at every session close. Sonnet implements, opus (or the
strongest available reviewer) reviews every task + whole branch. Concurrency is REQUIRED where it
doesn't impact quality/integrity; plans are written for concurrent execution. Pipeline Reference
base `appA7uj7FhnPp9Bvg` = Field Registry / Secrets & Credentials / People & IDs only.
