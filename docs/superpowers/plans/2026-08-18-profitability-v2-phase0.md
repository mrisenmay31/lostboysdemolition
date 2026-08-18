# Profitability v2 Phase 0 (Tasks 0A + 0B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Profitability Program v2 Phase 0 — the schema-validation runbook and deploy-invariant documentation (Task 0A), and the implemented, branch-verified, **production-applied** BL-7 `workforce_profiles` authentication boundary (Task 0B).

**Architecture:** Docs-only lane (runbook + CLAUDE.md/BUILD_PLAN corrections) runs concurrently with a SQL-authoring lane (one migration + one pgTAP test file — the repo's first SQL test). Validation runs on a disposable Supabase branch (fidelity-probed first), then, after adversarial review, the migration is applied to production with plain-SQL post-apply assertions. Matt approved prod application this session (2026-08-18): the Phase 0 gate literally requires only clone verification, but applying now closes BL-7 for real and avoids a committed-but-unapplied migration.

**Tech Stack:** Supabase Postgres 17.6 (project `eiqqqwajmcpcwhvxxnhx`), pgTAP 1.3.3 (available, not installed — install on branch only, never on prod), Supabase MCP (`apply_migration`, `execute_sql`, `create_branch`/`delete_branch`, `get_advisors`), git.

**Spec:** `docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` — Tasks 0A (lines 140–186) and 0B (lines 188–264) + the Phase 0 gate (line 266). Background: `BUILD_PLAN.md` § "BL-7 — Decide `handle_new_auth_user()`'s fate".

## Context

v2 was ratified and landed 2026-08-18 (commit `8949eff`) as docs only. The Phase 0 gate requires **both** 0A and 0B. State found this session:

- **0A Step 1 (decision ledger) already landed 2026-08-18** — BUILD_PLAN.md lines 20–62, CLAUDE.md direction bullet + roadmap rows, and the design spec's supersession header all exist. Remaining 0A work: the runbook (`docs/runbooks/` does not exist), the exact two-command deploy-invariant block (CLAUDE.md has only prose at line 371; `supabase functions list` appears nowhere), and doc corrections found this session.
- **0B is entirely unbuilt.** No `supabase/tests/`, no pgTAP usage anywhere, no `workforce_profiles`.

### Verified live facts (queried read-only this session — trust over docs)

- Trigger `on_auth_user_created` on `auth.users` → `public.handle_new_auth_user()`, enabled.
- `handle_new_auth_user()`: SECURITY DEFINER, **proconfig NULL** (unpinned — the deliberate BL-7 posture), body `INSERT INTO users (id, email) … ON CONFLICT (id) DO NOTHING` (unqualified → resolves to `auth.users` under GoTrue → silent no-op forever). ACL: postgres, service_role, supabase_auth_admin.
- `get_my_role()` / `get_my_crew_id()`: EXECUTE only postgres + service_role.
- `auth.users` = 1 row; `public.users` = 0; `workforce_profiles` absent.
- **12 RLS policies** on `users`/`crews`/`time_entries`, not the documented 7: the 7 calling `get_my_role()`/`get_my_crew_id()` PLUS 5 `auth.uid()`-based (`users_select_own`; `employees_insert_own`/`employees_select_own`/`employees_update_own_open`; `authenticated_select_crews`). Doc correction owed (Task 1).
- pgTAP 1.3.3 available, not installed. Zero branches. Branch cost **$0.01344/hour** (org `nhzbxchbcjjhvdloflip`) — `confirm_cost` at execution.
- Repo migrations **cannot replay from empty**: 5 live-only SECURITY DEFINER functions + the auth.users trigger exist only live, and `20260817130000` ALTERs functions that wouldn't exist — replay would abort mid-history. This drives the branch-fidelity probe below.

## Global Constraints

- `ghl-job-webhook` deploys must pass `--no-verify-jwt` with readback (v2 global constraint; no function deploys are expected this session, but the runbook records it).
- Never `supabase db reset` / `db push`; never claim empty-database reproducibility (v2 global constraint).
- Schema work validates on a disposable live-schema branch first, then applies through `mcp apply_migration` (the repo's established workflow).
- Do NOT re-grant `get_my_role()`/`get_my_crew_id()`; do NOT touch legacy `public.users`/`crews`/`time_entries` or their 12 policies.
- RLS enabled on every new table; service-role access server-only.
- Delete nothing without Matt's express per-item approval; never `git add -A`.
- Every build-sized task gets an adversarial Opus review before production application (standing rule).
- pgTAP is installed on the disposable branch only — never left installed on production.
- Migration filename/style conventions: `YYYYMMDDHHMMSS_snake_case.sql`, heavy prose header citing decisions + dates, numbered section markers, idempotency guards.

## Spec deviations (approved via this plan)

The v2 plan's Task 0B text is refined in eight ways — each necessary or strictly safer:

1. **`drop trigger if exists` + `create trigger`** instead of "keep the existing attachment": identical end-state on prod and any branch; atomic (one transaction); makes the trigger assertion environment-independent.
2. **`public.is_workforce_owner()` helper added**: an owner policy subquerying `workforce_profiles` from a policy on `workforce_profiles` is a hard Postgres error (42P17 infinite recursion). SECURITY DEFINER owned by postgres (table owner bypasses RLS; no FORCE), search_path pinned `public, pg_temp`, EXECUTE granted to `authenticated` (RLS quals evaluate as the querying role — the 2026-08-17 "Fix 3" lesson), nothing to anon. This is the only way to implement the spec's "server-maintained owner profile lookup" without a second table. `policies_are` assertion unchanged.
3. **`role` gets `not null default 'pending'`; `active`/timestamps `not null`**: blocks NULL-role rows from direct service inserts.
4. **FK is `on delete cascade`**: a plain FK would block auth-user deletion from the dashboard; a profile without its auth user is meaningless.
5. **Backfill insert for the 1 existing `auth.users` row**: the trigger only covers future signups; without backfill the existing user never gets a profile and `workforce_owner_all` can never bootstrap.
6. **Test extends plan(7) → plan(17)**: the spec's 7 assertions all pass **even if `handle_new_auth_user()`'s body is never replaced** — the core BL-7 fix was untested. Assertions 4–6 (legacy-revoke pins + trigger existence) already pass today and are kept as regression pins, labeled as such.
7. **No `updated_at` trigger**: repo convention is app-maintained `updated_at` (zero such triggers in `supabase/migrations/`); Task 8's activation action sets it explicitly.
8. **Explicit table grants + anon revoke**: Supabase default privileges would grant anon table rights (RLS-gated to 0 rows); explicit revoke yields permission-denied instead, and makes the migration branch-independent.

### Execution amendments (2026-08-18, recorded during the build — see SDD ledger + BUILD_LOG)

- Deviation 1 amended: Section 6 uses a single `create or replace trigger` instead of drop+create — DROP TRIGGER requires auth.users ownership, which postgres lacks on production (42501); the branch masked this. Intent of deviation 1 unchanged.
- Deviation 9 (new): the v2 spec's verbatim assertions for has_table/has_column/policy_cmd_is omit description args and resolve to wrong pgTAP overloads (can never pass); descriptions added.
- Deviation 10 (new): display_name expressions made total (NULL-email/blank-metadata safe) in trigger + backfill — a NULL would have aborted real signups.
- Test extended plan(17) → plan(19): table-privilege assertions pin the deviation-8 ACL posture.
- Task 3's "Expected: 13 fail, 3 pass" was an arithmetic slip: 14 fail / 3 pass (17-assertion file); with 19 assertions the pre-migration expectation is 16 fail / 3 pass.

## Concurrency map

Per Matt's standing directive, lanes are designed in up front:

| Lane | Tasks | Files owned | Can run alongside |
|---|---|---|---|
| A (docs) | Task 1 | `docs/runbooks/profitability-schema-validation.md`, `CLAUDE.md`, `BUILD_PLAN.md`, plan copy | Lane B entirely |
| B (SQL) | Task 2 → 3 | `supabase/migrations/20260818143000_*.sql`, `supabase/tests/workforce_auth_boundary_test.sql` | Lane A entirely |
| Review | Task 4 | none (read-only) | May start on Lane B's files while Task 3's branch validation runs; must complete before Task 5 |
| Serial tail | Task 5 → 6 | prod DB; `BUILD_LOG.md`, `NEXT_SESSION_PROMPT.md` | nothing (integrity boundary: prod write + session landing) |

File ownership is disjoint; one shared worktree on a working branch `v2-phase0` is sufficient (BL-4 precedent). Merge to `main` after the final review in Task 6.

---

### Task 0: Land this plan in the repo

**Files:**
- Create: `docs/superpowers/plans/2026-08-18-profitability-v2-phase0.md`

- [ ] **Step 1:** Create branch `v2-phase0` from `main`. Copy this approved plan verbatim to `docs/superpowers/plans/2026-08-18-profitability-v2-phase0.md` (skill-standard location). Commit:

```bash
git checkout -b v2-phase0 main
git add docs/superpowers/plans/2026-08-18-profitability-v2-phase0.md
git commit -m "docs: land approved v2 Phase 0 implementation plan"
```

---

### Task 1 (Lane A — Task 0A): Schema-validation runbook, deploy invariant, doc corrections

**Files:**
- Create: `docs/runbooks/profitability-schema-validation.md`
- Modify: `CLAUDE.md` (deploy-invariant block near the `ghl-job-webhook` row ~line 371, or a new "Deploy invariants" subsection under Edge Functions; 12-policy correction in the `users`/`crews`/`time_entries` table-note and the BL-7 paragraph)
- Modify: `BUILD_PLAN.md` (12-policy correction in the BL-7 section)

**Interfaces:**
- Consumes: the branch-fidelity decision tree (Task 3 references it), the v2 Task 0A Step 2 sequence, `BUILD_LOG.md:162`'s verify_jwt incident.
- Produces: the documented validation workflow every v2 schema task (Tasks 1, 2, 4, 5, 8, 10, 11, 13, 16) must follow; the recorded deploy invariant.

- [ ] **Step 1: Write the runbook.** `docs/runbooks/profitability-schema-validation.md` must contain, in this order:

1. **Purpose + scope** — required for every v2 schema task; cites the v2 plan and this plan.
2. **The 8-step sequence** from v2 Task 0A Step 2, verbatim: (1) create/refresh disposable branch from live schema; (2) record migration-table head (`list_migrations`) + row counts for touched tables; (3) apply the exact migration SQL to the branch via Supabase migration tooling/MCP; (4) run the task's transactional SQL assertions on the branch; (5) run all web and Edge Function unit tests; (6) commit the identical SQL that passed; (7) apply to production only during the phase rollout window (or with explicit Matt approval, as granted for Task 0B on 2026-08-18); (8) re-run read-only assertions and row counts; never attempt down-migration data deletion.
3. **Branch-fidelity decision tree** (the Phase-0 discovery this runbook exists to encode):
   - Branch creation costs $0.01344/hr (org `nhzbxchbcjjhvdloflip`); `confirm_cost` first; delete the branch when done.
   - **Probe before trusting** (read-only on the branch): (a) branch healthy and `supabase_migrations.schema_migrations` contains every migration through the current head — if replay aborted mid-history the branch is unusable evidence, delete it; (b) the 5 live-only definers (`handle_new_auth_user`, `get_my_role`, `get_my_crew_id`, `calculate_duration_and_cost`, `notify_airtable_on_archive`) exist with live-matching `proacl`/`proconfig`; (c) trigger `on_auth_user_created` exists on `auth.users`; (d) 12 policies on `users`/`crews`/`time_entries`.
   - **If faithful:** `create extension pgtap` on the branch → red → apply migration → green. pgTAP lives on branches only, never production.
   - **If NOT faithful:** delete the branch (do NOT hand-seed it — false fidelity confidence); fall back to a **production single-transaction dry-run**: one `execute_sql` script `begin; create extension if not exists pgtap; <migration SQL>; <assertions>; rollback;` — DDL, extension, and assertions all roll back atomically.
   - **Record verbatim** in the executing session's BUILD_LOG entry: branch id, probe output, migration-table head, before/after row counts, red output, green output, post-apply `get_advisors` (security) result.
4. **Production post-apply verification** uses plain-SQL catalog assertions (no pgTAP install on prod).
5. **The `ghl-job-webhook` deploy invariant** — the exact two-command block from Step 2 below, plus: any deployment lacking the explicit flag is a failed deployment and must not receive production traffic.
6. **Standing prohibitions:** no `supabase db reset`/`db push`; no empty-replay claims until the five live-only functions are in a verified harness.

- [ ] **Step 2: Add the deploy-invariant command block to CLAUDE.md.** Adjacent to the existing prose warning (the `ghl-job-webhook` table row), add:

````markdown
**Deploy invariant (recorded per v2 Task 0A):**

```bash
supabase functions deploy ghl-job-webhook --project-ref eiqqqwajmcpcwhvxxnhx --no-verify-jwt
supabase functions list --project-ref eiqqqwajmcpcwhvxxnhx
```

Expected: the readback reports `ghl-job-webhook` with JWT verification disabled. Any deployment
lacking the explicit flag is a failed deployment and must not receive production traffic.
Full workflow: `docs/runbooks/profitability-schema-validation.md`.
````

- [ ] **Step 3: Correct the policy count in both docs.** In CLAUDE.md's `users`/`crews`/`time_entries` notes and BUILD_PLAN.md's BL-7 section, amend "7 live RLS policies … all calling `get_my_role()`/`get_my_crew_id()`" to record the live truth (verified 2026-08-18): **12 policies total — 7 calling the revoked functions (broken for anon/authenticated since the 2026-08-17 revoke) plus 5 plain `auth.uid()`-based ones (`users_select_own`; `employees_insert_own`/`employees_select_own`/`employees_update_own_open`; `authenticated_select_crews`) that still function.** Task 0B does not touch any of them.

- [ ] **Step 4: Verify Task 0A Step-1 completeness** (expected already done): grep `BUILD_PLAN.md`/`CLAUDE.md` for any statement asserting Quote Accepted *will remain* the job-creation authority or GHL invoice authority — descriptive statements about currently-live Phase A behavior are correct and stay. Confirm the design spec header still carries the supersession marker. No edits expected.

- [ ] **Step 5: Commit** (spec-prescribed message):

```bash
git add BUILD_PLAN.md CLAUDE.md docs/runbooks/profitability-schema-validation.md
git commit -m "docs: align profitability v2 decisions and validation workflow"
```

---

### Task 2 (Lane B — Task 0B authoring): pgTAP test + workforce_profiles migration

**Files:**
- Create: `supabase/tests/workforce_auth_boundary_test.sql` (first file in a new `supabase/tests/` directory)
- Create: `supabase/migrations/20260818143000_workforce_auth_boundary.sql`

**Interfaces:**
- Consumes: live-only `handle_new_auth_user()`, `get_my_role()`, `get_my_crew_id()`, the `on_auth_user_created` trigger, `auth.users`.
- Produces: `public.workforce_profiles` (columns: `auth_user_id uuid PK → auth.users on delete cascade`, `display_name text not null`, `role text not null default 'pending' check in ('pending','owner','foreman')`, `crew_external_id text`, `active boolean not null default false`, `created_at`/`updated_at timestamptz not null default now()`); `public.is_workforce_owner() returns boolean`; policies `workforce_self_read` (SELECT) and `workforce_owner_all` (ALL). v2 Task 8 builds on exactly these names.

- [ ] **Step 1: Write the test file first** — `supabase/tests/workforce_auth_boundary_test.sql`, exactly:

```sql
-- BL-7 assertions (v2 Task 0B). Assertions 1-7 are the v2 spec's original
-- seven, verbatim. 4, 5, 6 pass PRE-migration on a faithful live clone:
-- they are regression pins (no re-grant of the legacy definers; trigger
-- not lost), not red/green targets. 8-17 are the red-phase teeth: they
-- fail until the migration lands, and 8-9 specifically prove the
-- handle_new_auth_user() body/search_path actually changed -- which 1-7
-- alone cannot detect.
begin;
create extension if not exists pgtap;
select plan(17);

-- 1-7: spec assertions, verbatim
select has_table('public', 'workforce_profiles');
select has_column('public', 'workforce_profiles', 'auth_user_id');
select has_column('public', 'workforce_profiles', 'role');
select function_privs_are(
  'public', 'get_my_role', array[]::text[], 'authenticated', array[]::text[]
);
select function_privs_are(
  'public', 'get_my_crew_id', array[]::text[], 'authenticated', array[]::text[]
);
select isnt_empty(
  $$select 1 from pg_trigger where tgname = 'on_auth_user_created' and not tgisinternal$$
);
select policies_are('public', 'workforce_profiles',
  array['workforce_self_read','workforce_owner_all']);

-- 8-9: the actual BL-7 fix (red pre-migration even on production)
select ok(
  (select array_to_string(p.proconfig, ';') like '%search_path=public, pg_temp%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'handle_new_auth_user'),
  'handle_new_auth_user() has search_path pinned to public, pg_temp'
);
select ok(
  (select p.prosrc like '%workforce_profiles%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'handle_new_auth_user'),
  'handle_new_auth_user() inserts into workforce_profiles, not legacy users'
);

-- 10: RLS actually enabled
select ok(
  (select c.relrowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'workforce_profiles'),
  'RLS is enabled on workforce_profiles'
);

-- 11-15: the recursion-breaking helper's full contract
select has_function('public', 'is_workforce_owner', array[]::name[]);
select is_definer('public', 'is_workforce_owner', array[]::name[]);
select function_privs_are(
  'public', 'is_workforce_owner', array[]::text[], 'authenticated', array['EXECUTE']
);
select function_privs_are(
  'public', 'is_workforce_owner', array[]::text[], 'anon', array[]::text[]
);
select ok(
  (select array_to_string(p.proconfig, ';') like '%search_path=public, pg_temp%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_workforce_owner'),
  'is_workforce_owner() has search_path pinned to public, pg_temp'
);

-- 16-17: policy commands, not just names
select policy_cmd_is('public', 'workforce_profiles', 'workforce_self_read', 'SELECT');
select policy_cmd_is('public', 'workforce_profiles', 'workforce_owner_all', 'ALL');

select * from finish();
rollback;
```

- [ ] **Step 2: Write the migration** — `supabase/migrations/20260818143000_workforce_auth_boundary.sql`. Prepend a repo-convention prose header (why; BL-7 evidence citing `20260817130000_security_revoke_legacy_definers.sql` "Fix 1"; Matt's 2026-08-18 decisions — Task 0B ratified, prod apply approved; blast radius: new isolated table, zero legacy-table changes, zero code reads it yet). Body:

```sql
-- 1. Table ------------------------------------------------------------
create table if not exists public.workforce_profiles (
  auth_user_id     uuid primary key references auth.users (id) on delete cascade,
  display_name     text not null,
  role             text not null default 'pending'
                     check (role in ('pending','owner','foreman')),
  crew_external_id text,
  active           boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on column public.workforce_profiles.crew_external_id is
  'Opaque external crew key. NOT a FK to legacy public.crews -- BL-7 forbids '
  'coupling to the legacy tables. Set by the Task 8 owner-activation action; '
  'null until assigned.';

alter table public.workforce_profiles enable row level security;

-- 2. Table ACL. Supabase default privileges grant table rights to anon/
-- authenticated/service_role on new public tables; make the intended state
-- explicit and branch-independent. anon has no policy here, so remove its
-- grants entirely (permission denied, not silent 0 rows).
revoke all on table public.workforce_profiles from public, anon;
grant select, insert, update, delete on table public.workforce_profiles to authenticated;
grant all on table public.workforce_profiles to service_role;

-- 3. Owner-lookup helper. A policy on workforce_profiles cannot subquery
-- workforce_profiles (42P17 infinite recursion). SECURITY DEFINER owned by
-- postgres (table owner bypasses RLS; no FORCE on this table) breaks the
-- cycle. search_path pinned, everything schema-qualified, pg_temp last --
-- the full anti-BL-7 treatment.
create or replace function public.is_workforce_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select wp.role = 'owner' and wp.active
       from public.workforce_profiles wp
      where wp.auth_user_id = auth.uid()),
    false
  );
$$;

-- authenticated MUST hold EXECUTE: RLS quals evaluate as the querying role
-- (the 20260817130000 "Fix 3" lesson). anon gets nothing.
revoke all on function public.is_workforce_owner() from public, anon, authenticated;
grant execute on function public.is_workforce_owner() to authenticated, service_role;

-- 4. Policies (the repo's first create policy statements -- deliberate:
-- Task 8 foreman auth consumes exactly these) -------------------------
drop policy if exists workforce_self_read on public.workforce_profiles;
create policy workforce_self_read on public.workforce_profiles
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

drop policy if exists workforce_owner_all on public.workforce_profiles;
create policy workforce_owner_all on public.workforce_profiles
  for all to authenticated
  using ((select public.is_workforce_owner()))
  with check ((select public.is_workforce_owner()));
-- ((select ...)) wrappers -> initplan, evaluated once per statement.

-- 5. Replace handle_new_auth_user() (body per the v2 spec, verbatim).
-- CREATE OR REPLACE keeps the live ACL and trigger attachment on prod;
-- sets proconfig (the search_path pin BL-7 deliberately deferred).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.workforce_profiles (auth_user_id, display_name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    'pending',
    false
  )
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

-- Load-bearing on a fresh branch (fresh CREATE grants PUBLIC execute);
-- belt-and-braces on prod (live ACL is already exactly this).
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
grant execute on function public.handle_new_auth_user() to supabase_auth_admin, service_role;

-- 6. Trigger: recreate for identical end-state everywhere (prod has it; a
-- replayed branch would not). Single transaction -> no window without the
-- trigger. Standard Supabase pattern; runs as postgres.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 7. Backfill: the 1 existing auth.users row predates the fixed trigger and
-- would otherwise never get a profile. Inserted as pending/inactive; the
-- first-owner promotion is a service_role action (bypasses RLS), which
-- bootstraps workforce_owner_all.
insert into public.workforce_profiles (auth_user_id, display_name, role, active)
select u.id,
       coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1)),
       'pending', false
from auth.users u
on conflict (auth_user_id) do nothing;
```

- [ ] **Step 3: Do NOT commit yet** — commit happens in Task 3 after the identical SQL passes on the branch (runbook step 6).

---

### Task 3 (Lane B — Task 0B validation): disposable branch red/green

**Interfaces:**
- Consumes: Task 2's two files; the fidelity probe + runner mechanics below.
- Produces: verbatim red and green outputs, the GoTrue-simulation proof, and the committed SQL — the Phase 0 gate evidence for 0B.

- [ ] **Step 1: Record baseline.** `list_migrations` head; row counts: `select (select count(*) from auth.users), (select count(*) from public.users);` on production. Save outputs for the BUILD_LOG entry.

- [ ] **Step 2: Create the branch.** `get_cost(branch)` → `confirm_cost` → `create_branch` (name `phase0-bl7-validation`). Cost known: $0.01344/hour.

- [ ] **Step 3: Probe fidelity** (read-only, on the branch):

```sql
select version_count from (select count(*) as version_count from supabase_migrations.schema_migrations) s;  -- expect >= 18
select p.proname, p.proacl::text, p.proconfig from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname in
  ('handle_new_auth_user','get_my_role','get_my_crew_id','calculate_duration_and_cost','notify_airtable_on_archive');
select tgname from pg_trigger where tgname='on_auth_user_created' and not tgisinternal;
select count(*) from pg_policies where schemaname='public' and tablename in ('users','crews','time_entries');  -- expect 12
```

Faithful = all 5 functions with live-matching ACLs/proconfig, trigger present, 12 policies, full migration history. **If NOT faithful:** delete the branch and use the runbook's production `begin; … rollback;` dry-run fallback instead (Task 1 Step 1.3) — do not hand-seed the branch.

- [ ] **Step 4: RED.** On the branch: `create extension if not exists pgtap;` then run the test assertions. Runner mechanics for MCP `execute_sql` (which surfaces the last statement's result): on the branch, drop the file's `begin;`/`rollback;` wrapper and collect TAP lines in a temp table so all 17 results are visible in one result set:

```sql
create temp table tap_out(line text);
insert into tap_out select plan(17);
insert into tap_out select has_table('public','workforce_profiles');
-- ... one insert per assertion, in file order ...
insert into tap_out select * from finish();
select line from tap_out;
```

Expected: **13 fail, 3 pass** (assertions 4, 5, 6 — the pre-existing pins). If the temp-table pattern misbehaves under the MCP runner, fall back to running assertions in small batches and recording each batch's output.

- [ ] **Step 5: GREEN.** `apply_migration` (name `workforce_auth_boundary`) with the exact Task 2 SQL, on the branch. Re-run Step 4's runner. Expected: **17/17 pass**.

- [ ] **Step 6: GoTrue simulation** (branch only — never on production):

```sql
insert into auth.users (id, email) values (gen_random_uuid(), 'bl7-probe@example.com');
select count(*) from public.workforce_profiles;  -- expect 2 (backfilled row + probe)
select count(*) from public.users;               -- expect 0 (legacy stays empty)
select role, active from public.workforce_profiles order by created_at desc limit 1;  -- expect pending, false
```

(If `auth.users` NOT NULL constraints reject the minimal insert, add the minimum required columns — e.g. `instance_id`, `aud`, `role` — and record what was needed.)

- [ ] **Step 7: Delete the branch.** `delete_branch`. Record its id + all outputs.

- [ ] **Step 8: Run the full existing suites** (runbook step 5) — `deno task test` (expect 317) and `cd web && npx vitest run` (expect 261). Nothing here touches them; this is the regression gate.

- [ ] **Step 9: Commit the identical SQL that passed:**

```bash
git add supabase/migrations/20260818143000_workforce_auth_boundary.sql \
  supabase/tests/workforce_auth_boundary_test.sql
git commit -m "feat: implement BL-7 workforce authentication boundary"
```

---

### Task 4: Adversarial review (standing quality gate)

- [ ] **Step 1:** Dispatch an Opus adversarial review of the three deliverables (migration, test file, runbook) plus the CLAUDE.md/BUILD_PLAN edits. Reviewer brief: read-only; verify against live DB state; specifically attack — the RLS policy pair for privilege escalation or lockout; `is_workforce_owner()` for BL-7-class search_path/ACL hazards; the trigger drop/recreate for GoTrue interaction; the backfill for idempotency; the runbook against the v2 global constraints; the deviations ledger for unjustified drift from the ratified spec. May start while Task 3 runs (it does not need the branch), but MUST pass before Task 5.
- [ ] **Step 2:** Fix any findings; re-run Task 3's branch validation if the migration SQL changed (new branch or the prod dry-run fallback); amend commits.

---

### Task 5: Apply to production (Matt-approved 2026-08-18)

**Serial — after Task 3 green AND Task 4 pass.**

- [ ] **Step 1:** `apply_migration` (name `workforce_auth_boundary`) against production `eiqqqwajmcpcwhvxxnhx` with the committed SQL, byte-identical to what passed on the branch.
- [ ] **Step 2: Post-apply verification** — plain SQL (no pgTAP on prod), read-only:

```sql
-- the 17 assertions' substance, as booleans:
select
  to_regclass('public.workforce_profiles') is not null                                   as t1_table,
  (select count(*)=2 and bool_and(policyname in ('workforce_self_read','workforce_owner_all'))
     from pg_policies where schemaname='public' and tablename='workforce_profiles')      as t7_policies,
  (select array_to_string(proconfig,';') like '%search_path=public, pg_temp%'
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='handle_new_auth_user')                       as t8_searchpath,
  (select prosrc like '%workforce_profiles%'
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='handle_new_auth_user')                       as t9_body,
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='workforce_profiles')                         as t10_rls,
  (select count(*)=1 from pg_trigger
    where tgname='on_auth_user_created' and not tgisinternal)                            as t6_trigger,
  (select count(*) from public.workforce_profiles)                                       as backfill_rows,  -- expect 1
  (select count(*) from public.users)                                                    as legacy_users;   -- expect 0
```

Also re-check the legacy definers' ACLs are unchanged (`get_my_role`/`get_my_crew_id` still deny authenticated), and confirm the 12 legacy policies still count 12.
- [ ] **Step 3:** `get_advisors` (security). Expect no new findings attributable to this migration (the pre-existing advisor state is the baseline).
- [ ] **Step 4:** Record every output verbatim for the BUILD_LOG entry.

---

### Task 6: Land the session

- [ ] **Step 1:** Final whole-branch Opus review of `v2-phase0` (standing rule) — docs + SQL together, diff against `main`.
- [ ] **Step 2:** BUILD_LOG.md entry at the top of *Entries*: Phase 0 complete (0A runbook + deploy invariant + 12-policy correction; 0B implemented, branch-verified with red 13/green 17, prod-applied with Matt's approval, backfill=1 row, `public.users` still 0, BL-7 CLOSED); branch id + verification outputs; deviations ledger reference; what Task 8 consumes. Update CLAUDE.md's Phase-roadmap rows (Profitability v2 → Phase 0 complete; BL-7 → resolved/implemented) and the BL-7 paragraphs to reflect the pinned, rewritten function. Regenerate `NEXT_SESSION_PROMPT.md` (next: v2 Phase 1 Task 1 planning; Matt's phone smoke + first real estimate still outstanding before the Phase 1 gate).
- [ ] **Step 3:** Commit docs, merge `v2-phase0` → `main`, push:

```bash
git add BUILD_LOG.md CLAUDE.md NEXT_SESSION_PROMPT.md
git commit -m "docs: record v2 Phase 0 completion; BL-7 closed"
git checkout main && git merge --no-ff v2-phase0 -m "merge: v2 Phase 0 (Task 0A + 0B, BL-7 closed)"
git push
```

---

## Verification (end-to-end)

1. **Phase 0 gate, 0A half:** `docs/runbooks/profitability-schema-validation.md` exists with the 8-step sequence, fidelity tree, and deploy invariant; CLAUDE.md carries the exact two-command block; no conflicting job-creation/invoicing ownership statements.
2. **Phase 0 gate, 0B half:** red 13/green 17 on a fidelity-probed branch (or documented prod dry-run fallback), GoTrue simulation proves a new auth user gets a `workforce_profiles` row and zero `public.users` rows.
3. **Production:** post-apply booleans all true; `workforce_profiles` = 1 backfilled `pending/inactive` row; `public.users` = 0; legacy ACLs and 12 policies untouched; `get_advisors` clean vs baseline.
4. **Regression:** `deno task test` 317 passing; `cd web && npx vitest run` 261 passing; no edge function redeployed (versions unchanged via `list_edge_functions`).
5. **Repo:** migration + test committed byte-identical to what passed; BUILD_LOG entry present; merged to `main`.

## Explicitly out of scope

- Owner activation / promoting the existing auth user to `owner` (v2 Task 8's launch runbook does this, service-role, exactly once).
- Any change to legacy `users`/`crews`/`time_entries` or their 12 policies; any re-grant of `get_my_role()`/`get_my_crew_id()`.
- The estimator no-login picker (unchanged); `actor_assurance` enum (arrives with v2 Task 2's migration).
- Function deploys of any kind.
