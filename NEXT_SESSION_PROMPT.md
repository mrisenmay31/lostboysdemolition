Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md (official plan, phases A–G + Track B). The **2026-08-14 (late)** and
**2026-08-14 (night)** entries in BUILD_LOG.md describe exactly where things stand.

## Where the last session left off (2026-08-14, late) — repo file/doc hygiene, merged to main

**Docs-only session. No code changed, no function deployed, no Supabase change, nothing live
touched.** Branch `chore/repo-hygiene` (5 commits) merged to `main` as `a73c009` and pushed. Local
and origin are in sync. `deno task test` 18/18 and `cd web && npx vitest run` 261/261, both
unchanged — verified before and after.

### What moved — read this before hunting for a doc that "disappeared"

**`docs/archive/` is new.** Eight superseded documents were moved there as **git renames**
(nothing was deleted, history follows them, filenames unchanged so older BUILD_LOG citations still
resolve — only the directory changed):

`OPS_ROADMAP.md` · `SCHEMA_AUDIT_REPORT.md` · `schema_audit.json` · `schema_overview.md` ·
`LostBoys_PricingEngine_ProjectBrief.md` · `prompt.md` · `jobs_schema_prompt.txt` ·
`lostboys_demolition_airtable_prompt.txt`

**`docs/archive/README.md` is the map** — per file: what it was, what superseded it, why. Read that
before concluding any archived doc is authoritative. It also records the four things deliberately
*not* archived and why.

Root went from 26 files to 18. `OPS_ROADMAP.md` and `prompt.md` were untracked before this pass and
are now tracked (in the archive). **`OPS_ROADMAP.md` is no longer "slated for deletion"** — CLAUDE.md
said that for weeks; it's archived and settled.

### Other changes this session

- **`.gitignore` gaps closed:** `supabase/.temp/` (CLI scratch — was the only untracked noise),
  `.claude/` (previously hidden *only* by Matt's machine-global excludes file — a portability gap,
  not a leak), plus `*.tsbuildinfo` / `*.log` / `coverage/` hoisted from `web/.gitignore`.
- **`CLAUDE.md` repointed** — START HERE preamble and the Repository Structure tree. Also now lists
  `WORKFLOW_OVERVIEW_2026-07-31.md`, which the tree had **never** included; it is *not* stale, it's
  Matt's raw source prose and DISCOVERY was built from it.
- **`web/README.md` replaced** — was still verbatim `create-next-app` boilerplate.
- **`INTEGRATION_DESIGN.md`** — its two relative links were broken by the move; fixed. Its
  description of `schema_overview.md` as "Canonical Airtable schema" was wrong when written and is
  corrected in place.
- **Two supersession banners:** on `docs/superpowers/plans/2026-08-14-phase-b-slice-2-*.md` (whose
  Architecture/Tech Stack lines still advertised Supabase Auth + `@supabase/ssr`, and whose Task 6
  login gate was deleted mid-build — Manual Setup #2 is CANCELLED), and on
  `airtable-automations/README.md` (mirror-only code, unverified against the live base since
  2026-07-30, on the Phase B/E retirement path — do **not** delete while `airtable-job-completed`
  is still the invoicing path).

### ⚠️ Standing instruction from Matt, this session and forward

**Delete nothing without his specific, express, per-item approval.** This was the governing
constraint of the whole pass and nothing was deleted under it. A deletion checklist is open and
waiting in the BUILD_LOG "2026-08-14 (late)" entry: `.DS_Store` × 3; empty dirs `.claude/worktrees/`
and `node_modules/.vite-temp/`; the untracked 413 KB transcript `2026-07-31-150137-*.txt`
(recommend moving it *outside* the repo rather than committing it); the 5 unreferenced
`create-next-app` SVGs in `web/public/`; local branch `phase-b-slice-2` and remotes
`origin/phase-b-slice-2` + the two `origin/claude/*` (all verified fully merged into `main`);
`web/.next` 91 MB + `web/node_modules` 497 MB. **Do not action any line without asking.**

Operational corollary learned the hard way this session: **never `git add -A` in this repo.** Doing
so swept the 413 KB transcript — a pending-approval file — into a commit. Caught by the
`git diff main --stat` check, rewound with `git reset --mixed`, rebuilt from explicit paths. Stage
explicit paths, always.

### Owed, small, blocked on Matt

**`.env.example` still lists 2 of the 8 keys the real `.env` carries.** Missing *names* only:
`GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`, `AIRTABLE_WEBHOOK_SECRET`,
`FILLOUT_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Editing it is blocked by a local permission rule on
env files — Matt adds these by hand.

---

## The state that still matters most: Phase B slice 2 is SHIPPED and LIVE

Unchanged by this session. **https://lbd-estimates.vercel.app** (project `lbd-estimates`, root
`web`, outside-root ON, prod branch `main`, merged `dd6cc87`). The frozen slice-2 ledger is at
`docs/superpowers/plans/2026-08-14-phase-b-slice-2-ledger.md`; per-task history is in the gitignored
`.superpowers/sdd/2026-08-14-phase-b-slice-2-estimate-builder-ghl-push/progress.md`.

- **The estimate builder** (`/estimates/new`): mobile-first, live client-side recalc against
  server-supplied rates, quick/itemized modes, 19-item scope picker, Path B toggle (a real,
  persisted `is_path_b` column). First real estimate will be **≥ 1426** — 16 rows exist today, all
  `TEST`, all `declined`/`superseded`.
- **List + detail + lifecycle**: status actions (sent/accepted/declined only), quote override with a
  DB-enforced required reason, version chains, audit history via `estimate_mutations_audit`.
- **GHL push**: per-target idempotent via `ghl_push_state`, opportunity custom fields + a draft
  estimate doc whose line amounts sum exactly to the quoted price. **`PUT /opportunities` merges
  `customFields`** — settled live, and it matters to the Phase A functions too.
- **⚠️ THERE IS NO LOGIN.** Matt's explicit decision. Device-remembered "Who's estimating?" picker
  (Dane/Jackson/Matt), re-validated server-side against a fixed allowlist; `created_by` is NULL on
  every row created under this model (one pre-scope-change row, estimate 1416 v1, still carries a
  real `auth.users` id). Ships network-layer **open**. Read CLAUDE.md's "No-login estimate tool"
  section before touching anything auth-shaped — older session artifacts describing a Supabase-Auth
  gate are wrong, and the slice-2 plan now carries a banner saying so.

### 🔴 Still owed before Dane/Jackson use the builder for real

**Matt's phone smoke + the one-real-bid Fillout parallel check.** Outstanding since the night
session; this hygiene pass did not touch them. This is the gate before parallel daily use.

### Two known limitations to carry forward (not bugs to silently "fix")

1. Superseded-version protection is UI-only — the server actions don't re-check version status.
   Low risk, partly self-healing, deferred deliberately.
2. No concurrency guard on the GHL push — a push race can create a duplicate GHL opportunity. Low
   likelihood at 3 users, manual cleanup.

### Repo-level open items (not slice-2 scope)

- **`airtable-client-sync` v19 has a dead search leg** — the same broken `GET /contacts/?email=`
  shape T9f fixed in the web app; live-422s, silently absorbed by a fallback. Needs its own small
  edge-function fix task.
- **`crew-night-before` redeploy still owed** — closes the `_shared/package.json {"type":"module"}`
  deploy-safety question with an actual redeploy, not just static proof.
- **6 anon-callable `SECURITY DEFINER` clock-in-era functions** — re-weigh now that the estimate
  tool itself ships open. Repo-wide posture question.
- **Known code debt, deliberately out of scope** (recorded in the BUILD_LOG late entry):
  `airtable-job-scheduled/index.ts:141–240` still holds the ~100 lines of Google auth/calendar
  helpers `_shared/google.ts` was lifted *from*; `formatCurrency` exists a third time in
  `airtable-job-completed/index.ts:109`; ~14 raw `sync_log`/`job_events` inserts across five
  functions bypass `_shared/log.ts`. Every edit forces a same-session redeploy under the parity
  rule, and most of those functions are retiring — `airtable-job-scheduled` is the only one that
  survives past Airtable and the only one worth the risk. Also: a dead `allocateAmounts` re-export
  at `web/src/lib/ghl/estimateDoc.ts:135`, and `INTEGRATION_DESIGN.md` is archivable once someone
  can touch the comment in `ghl-job-webhook/index.ts` that cites it.

## What's next (roughly Matt's likely order; none blocked)

1. **Matt's phone smoke + one-real-bid Fillout parallel check** — the gate above.
2. **Historical import of the 321 Airtable estimates** — deferred from slice 2. `estimate_number`
   1001–1321 are reserved for it (`status='historical'`).
3. **BL-4 — crew Slack message format** — deferred to "end of Phase B (after this slice)" per Matt
   2026-08-14. Now is that point.
4. **Retiring Fillout** — only after Dane/Jackson are live on the builder day-to-day, not
   automatically once the code exists.
5. **Phase C — Expenses + dump counts (BILL)** and **Track B — Lead intake** are the next
   not-started phases; Track B was flagged "start now" back in July and still hasn't started.
6. The repo-level open items above, whenever convenient — none urgent.

Standing rules unchanged: (a) plan + explicit approval before any new build (small fixes exempt);
(b) anything deployed/applied to Supabase committed same session; (c) BUILD_LOG.md entry at every
session close, including docs-only ones; (d) subagent-driven with per-task opus review for anything
build-sized; (e) Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field Registry / Secrets &
Credentials / People & IDs only, its old Build Log table is superseded; (f) **delete nothing
without Matt's express per-item approval.**
