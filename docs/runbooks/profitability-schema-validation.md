# Profitability v2 — Schema Validation Runbook

## 1. Purpose + scope

This runbook is **required for every v2 schema task** — Tasks 1, 2, 4, 5, 8, 10, 11, 13, and 16 of
the Profitability Program v2 build (`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md`).
It exists because a migration that looks correct against a hand-seeded or partially-replayed
Supabase branch is not evidence of anything — the branch has to be proven faithful to production
*before* it can be trusted to validate a migration. This document is the record of that discovery
(v2 Task 0A) and the workflow every future schema-touching task must follow, produced by this plan:
`docs/superpowers/plans/2026-08-18-profitability-v2-phase0.md`.

Any task that adds, alters, or drops a table, column, constraint, trigger, function, or RLS policy
in the live Supabase project (`eiqqqwajmcpcwhvxxnhx`) is a "schema task" for the purposes of this
runbook, regardless of which phase or lane it belongs to.

## 2. The 8-step sequence

This is the canonical sequence, carried verbatim from v2 Task 0A Step 2. Every schema task follows
these eight steps in order:

1. Create/refresh a disposable branch from the live schema.
2. Record the migration-table head (`list_migrations`) and row counts for every table the task
   touches.
3. Apply the exact migration SQL to the branch via Supabase migration tooling/MCP.
4. Run the task's transactional SQL assertions on the branch.
5. Run all web and Edge Function unit tests.
6. Commit the identical SQL that passed.
7. Apply to production **only** during the phase rollout window, or with explicit Matt approval —
   as was granted for Task 0B on 2026-08-18.
8. Re-run read-only assertions and row counts against production; **never** attempt down-migration
   data deletion.

## 3. Branch-fidelity decision tree

This is the Phase-0 discovery this runbook exists to encode: a Supabase branch is not automatically
a faithful copy of production, and using an unfaithful branch as a test bed produces false
confidence rather than a caught bug.

**Cost.** Branch creation costs $0.01344/hr (org `nhzbxchbcjjhvdloflip`) as of 2026-08-18 —
Supabase pricing can drift, so treat `confirm_cost` at branch-creation time as the run-time
authority, not this figure. Call `confirm_cost` before creating a branch, and delete the branch
when the task's validation is done.

**Probe before trusting.** Once the branch exists, run these checks read-only against it, in
order, before relying on it for anything:

- (a) **Migration-table completeness.** The branch is healthy and
  `supabase_migrations.schema_migrations` contains every migration through the current head. If
  the replay aborted mid-history, the branch is unusable as evidence — delete it and fall back to
  the production dry-run path below. Do not attempt to patch or hand-complete a partial replay.
- (b) **Legacy definer parity.** The 5 live-only `SECURITY DEFINER` functions
  (`handle_new_auth_user`, `get_my_role`, `get_my_crew_id`, `calculate_duration_and_cost`,
  `notify_airtable_on_archive`) exist on the branch with live-matching `proacl`/`proconfig`. These
  functions predate the migrations directory and exist only in the live database, so a branch
  replay has no source-of-truth definition to recreate them from — their presence and ACL/config
  must be checked directly, not assumed from a clean replay.
- (c) **Trigger parity.** Trigger `on_auth_user_created` exists on `auth.users`.
- (d) **Policy count.** 12 policies exist across `users`, `crews`, and `time_entries` (see the
  2026-08-18 correction in `CLAUDE.md` and `BUILD_PLAN.md` BL-7 for the breakdown: 7 policies
  calling `get_my_role()`/`get_my_crew_id()`, currently broken for `anon`/`authenticated` since the
  2026-08-17 EXECUTE revoke, plus 5 plain `auth.uid()`-based policies that still function).

**If faithful** (all four probes pass): run `create extension pgtap` on the branch, write the
task's assertions, confirm they fail red against the pre-migration schema, apply the migration,
confirm they pass green. **pgTAP lives on branches only — it is never installed on production.**

**If NOT faithful** (any probe fails): delete the branch. Do **not** hand-seed it to paper over the
gap — a hand-seeded branch produces false fidelity confidence, which is worse than no branch at
all, because it looks like evidence. Fall back to a **production single-transaction dry-run**
instead: one `execute_sql` script of the form

```sql
begin;
create extension if not exists pgtap;
<migration SQL>;
<assertions>;
rollback;
```

The DDL, the extension install, and the assertions all roll back atomically, so this is safe to run
directly against production — nothing it does is retained.

**Record verbatim**, in the executing session's `BUILD_LOG.md` entry: the branch id, the probe
output (pass/fail for each of a–d), the migration-table head, before/after row counts for every
touched table, the red pgTAP output, the green pgTAP output, and the post-apply `get_advisors`
(security) result.

## 4. Production post-apply verification

Because pgTAP is never installed on production, post-apply verification against production (Step 8
of the sequence, and the closing step of the production dry-run fallback) uses **plain-SQL catalog
assertions** — direct queries against `information_schema`/`pg_catalog` and the task's own row
counts — not pgTAP.

## 5. The `ghl-job-webhook` deploy invariant

**Deploy invariant (recorded per v2 Task 0A):**

```bash
supabase functions deploy ghl-job-webhook --project-ref eiqqqwajmcpcwhvxxnhx --no-verify-jwt
supabase functions list --project-ref eiqqqwajmcpcwhvxxnhx
```

Expected: the readback reports `ghl-job-webhook` with JWT verification disabled. **Any deployment
lacking the explicit flag is a failed deployment and must not receive production traffic.** This is
recorded because a bare `supabase functions deploy ghl-job-webhook` (no flag) silently flips
`verify_jwt` to `true`, which 401s every GHL call — see `BUILD_LOG.md:162` for the incident this
invariant was written to prevent.

## 6. Standing prohibitions

- **No `supabase db reset` and no `supabase db push`** against this project. Migrations are applied
  via the branch/dry-run workflow above and committed as SQL, not pushed from a local shadow
  database.
- **No empty-replay claims** — i.e., no session may assert "the branch replayed cleanly, therefore
  it's faithful" — until the five live-only functions listed in §3(b) are covered by a verified
  harness. A clean replay proves the migrations directory replayed; it does not prove parity with
  objects that live only in production.
