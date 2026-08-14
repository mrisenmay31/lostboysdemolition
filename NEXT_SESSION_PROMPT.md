Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md (official plan, phases A–G + Track B).

## ⭐ START HERE — the next session has an approved build brief waiting

**`docs/superpowers/plans/2026-08-14-bl4-crew-slack-and-repo-fixes.md` is approved by Matt and not
yet built.** Read it and execute it as written. It is self-contained: context, findings, the format
decision, file-by-file changes, execution model, and verification. The three questions that would
otherwise block you were already answered by Matt during planning and are folded into the plan.

The previous session was **planning only** — no code written, no function deployed, no migration
applied, nothing live touched. See the `2026-08-14 (night, second)` entry in `BUILD_LOG.md`.

### What the brief covers

**BL-4 — the crew Slack message.** Crews today get four thin lines. Matt wants client name,
business name, phone, start date, start time, address, and scope. The gap is **data, not
formatting**: `jobs` has no `client_phone`, no business name, no time-of-day, no scope column.

Three decisions Matt made, already in the plan:
- **Scope source = hybrid** — render from the linked estimate's line items, falling back to the GHL
  `Job Scope` multi-select when no estimate is linked.
- **Both messages** get the new format — `ghl-job-webhook`'s schedule-leg post *and*
  `crew-night-before`'s digest.
- **GHL "Job Start Time" is not reliably populated.** Wire it so it lights up if adopted; omit the
  line when blank. Getting it filled in is a habit item for Dane, not a code item.

**Plus three repo-level fixes** — `airtable-client-sync`'s dead search leg, the owed
`crew-night-before` redeploy (which now falls out of BL-4 for free), and a revoke/`search_path`
pass over the legacy `SECURITY DEFINER` functions.

### Findings from the planning pass that you should not have to rediscover

- **Three of BL-4's four missing fields are already fetched and thrown away.** Quote Accepted
  already does `GET /contacts/{id}` and holds `phone` + `companyName`; the schedule leg already does
  `GET /opportunities/{id}` and reads 3 of its custom fields, discarding Job Start Time, Job Scope,
  and Scope Notes. **Net new GHL calls for BL-4: zero.**
- **The estimate→job link has never existed and has zero callers.** `estimates.job_number` says
  "job link set at promotion"; `update_estimate_job_number` says it's for "a *future* promotion";
  nothing calls it. No edge function queries `estimates` at all. Only latent join key:
  `jobs.ghl_opportunity_id` ↔ `ghl_push_state.ghl_opportunity_id`. The hybrid scope decision means
  BL-4 builds this promotion.
- **BL-4 is a restoration.** `airtable-job-scheduled/index.ts:241-271` already built this exact
  block. Phase A dropped it because the Postgres fields didn't exist.
- **⚠️ `airtable-client-sync` is worse than the log said.** The broken search makes the
  update-in-place branch unreachable, so **Airtable edits have never propagated to existing GHL
  contacts** — they're matched via the duplicate-400 fallback and the field changes are dropped.
  Data loss, not just bad logging. Fixing the search alone is not enough; the duplicate-400 path
  needs an `updateGhlContact` call too. Note this is a live behavior change on a daily-traffic
  function.
- **⚠️ `jobs` has a live enabled trigger.** `notify_airtable_on_archive` POSTs to the dormant,
  latently-buggy `push-to-airtable`. It fires only on `status → 'archived'` (verified), so it's
  inert for ordinary writes — but don't assume `jobs` is trigger-free.
- **`SECURITY DEFINER` count is 5, not 6** — `SYSTEM_AUDIT_2026-07-30.md` was right, this file and
  BUILD_LOG were wrong. Three of the five are triggers; only `get_my_role`/`get_my_crew_id` are
  callable RPCs, and both read a 0-row table keyed by `auth.uid()` (NULL for anon). **Real exposure
  today: none** — the issue is the unpinned `search_path`. Separately `next_job_number()` is
  anon-callable and could have its sequence burned.

### One thing to ask before the live test

The E2E posts to a **real crew Slack channel**. Ask Matt whether to use a real channel with a
clearly-labelled synthetic job (how Phase A handled it) or point at a scratch channel.

---

## 🔴 Still owed before Dane/Jackson use the estimate builder for real

**Matt's phone smoke + the one-real-bid Fillout parallel check.** Outstanding since the 2026-08-14
night session; neither the hygiene pass nor the planning pass touched them.

Good news: **the BL-4 plan's verification step 2 doubles as this test.** Creating a TEST estimate,
pushing it to GHL, and dragging the opportunity Quote Accepted → Job Scheduled exercises the full
Phase B → Phase A chain — which has never once been run end to end. Matt asked to test the estimate
tool and workflow after these two work items, so the two line up.

## State that hasn't changed

**Phase B slice 2 is SHIPPED and LIVE** at **https://lbd-estimates.vercel.app** (project
`lbd-estimates`, root `web`, outside-root ON, prod branch `main`, merged `dd6cc87`). Phase A is
live and verified. `deno task test` 18/18, `cd web && npx vitest run` 261/261.

- **The estimate builder** (`/estimates/new`): mobile-first, live recalc, quick/itemized modes,
  19-item scope picker, Path B toggle. 16 rows exist, all `TEST`, all `declined`/`superseded` —
  **first real estimate will be ≥ 1426.**
- **⚠️ THERE IS NO LOGIN.** Matt's explicit decision. Device-remembered "Who's estimating?" picker
  (Dane/Jackson/Matt), re-validated server-side against a fixed allowlist; `created_by` is NULL on
  every row created under this model (one pre-scope-change row, estimate 1416 v1, still carries a
  real `auth.users` id). Ships network-layer **open**. Read CLAUDE.md's "No-login estimate tool"
  section before touching anything auth-shaped — older artifacts describing a Supabase-Auth gate are
  wrong.
- **`docs/archive/`** holds 8 superseded docs (moved as git renames 2026-08-14, nothing deleted).
  `docs/archive/README.md` is the map. Do not plan from anything in there.

### Two known limitations to carry forward (not bugs to silently "fix")

1. Superseded-version protection is UI-only — the server actions don't re-check version status.
2. No concurrency guard on the GHL push — a race can create a duplicate GHL opportunity.

## ⚠️ Standing instruction from Matt

**Delete nothing without his specific, express, per-item approval.** The deletion checklist is still
open and untouched in the BUILD_LOG `2026-08-14 (late)` entry: 3 `.DS_Store`; empty dirs
`.claude/worktrees/` and `node_modules/.vite-temp/`; the untracked 413 KB transcript
`2026-07-31-150137-*.txt` (recommend moving it *outside* the repo); the 5 unreferenced
`create-next-app` SVGs in `web/public/`; local branch `phase-b-slice-2` and remotes
`origin/phase-b-slice-2` + the two `origin/claude/*`; `web/.next` 91 MB + `web/node_modules` 497 MB.
**Do not action any line without asking.**

Operational corollary: **never `git add -A` in this repo** — it swept a pending-approval file into a
commit once already. Stage explicit paths.

## Owed, small, blocked on Matt

**`.env.example` still lists 2 of the 8 keys the real `.env` carries.** Missing *names* only:
`GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`, `AIRTABLE_WEBHOOK_SECRET`,
`FILLOUT_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Editing it is blocked by a local permission rule on
env files — Matt adds these by hand.

## After BL-4 (none blocked)

1. **Historical import of the 321 Airtable estimates** — Matt **declined** this on 2026-08-14 when
   offered. `estimate_number` 1001–1321 stay reserved. Don't re-propose without a reason.
2. **Retiring Fillout** — only after Dane/Jackson are live on the builder day to day.
3. **Phase C — Expenses + dump counts (BILL)** and **Track B — Lead intake**. Track B was flagged
   "start now" back in July and still hasn't started.
4. **Phase D — time tracking** remains the one 🔴 blocking decision. Unchanged.

Standing rules unchanged: (a) plan + explicit approval before any new build (small fixes exempt);
(b) anything deployed/applied to Supabase committed same session; (c) BUILD_LOG.md entry at every
session close, including docs-only ones; (d) subagent-driven with per-task opus review for anything
build-sized; (e) Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field Registry / Secrets &
Credentials / People & IDs only; (f) **delete nothing without Matt's express per-item approval.**
