Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md (official plan, phases A–G + Track B).

## What just happened — BL-4 SHIPPED (2026-08-17)

The approved BL-4 brief was executed, reviewed, deployed, live-verified, and merged to `main`.
**There is no build brief waiting for you this time.** Read the `2026-08-17` entry in `BUILD_LOG.md`
before planning anything.

Live now: **`ghl-job-webhook` v13**, **`crew-night-before` v10**, **`airtable-client-sync` v28**.
Three migrations applied. `deno task test` → **312 passing** (golden-321 gate intact).

**The estimate→job promotion now exists.** `estimates.job_number` had zero writers before this
session. Quote Accepted back-writes it and flips the estimate to `accepted`, non-fatally.

**Both crew messages use the new format** — client, business, phone, date, time, address, scope —
with a `———` divider between job blocks in the night-before digest.

### The single most important thing to understand about the promotion

It pivots on the **chain**, not the row, and that distinction is the whole feature. The first
implementation resolved a row and therefore **silently produced nothing on the ordinary quote
cycle**: revising an estimate supersedes v1, the GHL push is a manual button so v2 often has no
`ghl_push_state` row, leaving only a superseded v1 to match → `not_found` → no `job_number` → all
scope tiers empty. If you touch this code, keep the chain pivot: identify `estimate_number` from the
push-state row (**deliberately not filtering superseded**, because a superseded row still names its
chain), then resolve that chain's current version.

Live-proven: chain read `1424 v1 superseded job=- | 1424 v2 accepted job=JOB-1104`.

### 🚨 The rule BL-4 established

**No pricing may reach a crew channel.** No total bid, quoted price, markup %, true margin %, hours,
or dump counts. GHL `Scope Notes` (`PdNTCRzIpYi3IANr71eh`) must never be read — it carries all of
them. `scope_summary` has one source that *can* contain money (`estimates.job_details`, free text), so
it is currency-stripped. **Crew Google Calendars still show `Estimate: $X` — that is BL-5, and the
inconsistency is KNOWN AND DELIBERATE until then.** Do not "fix" either side blind.

## 🔴 Still owed before Dane/Jackson use the estimate builder for real

**Matt's phone smoke + the one-real-bid Fillout parallel check.** Outstanding since 2026-08-14 and
untouched by the last three sessions. Nothing blocks them.

Also quick: **eyeball the BL-4 message rendering in #ops-test** (`C0BPPG8997Z`) — one was posted
2026-08-17 for JOB-1104.

## Backlog captured 2026-08-17 — all unblocked, none started

See `BUILD_PLAN.md` → "Backlog — captured, not scheduled".

- **BL-5** — strip `Estimate: $X` from **crew** calendar events, keep it on main. Decision already
  made. Non-trivial because one `eventBody` is built once and posted to both targets, so it needs two
  descriptions without disturbing the per-target event-ID idempotency that took two Phase A fix rounds.
- **BL-6** — close the `airtable-client-sync` data-loss item. The **code** is fixed (v28); the gap is
  that the Airtable automation fires on `recordCreated` **only**, so edits never invoke the function.
  ⚠️ **Design the echo guard first** — `ghl-contact-sync` → Airtable → `airtable-client-sync` → GHL →
  `ghl-contact-sync` terminates today *only* because the trigger is create-only.
- **BL-7** — decide `handle_new_auth_user()`'s fate, and settle the 7 RLS policies **before Phase D**.
  That function has always been a silent no-op (its unqualified `INSERT INTO users` resolves to
  `auth.users` under GoTrue's `search_path=auth`); pinning it would flip it into a real insert and
  activate policies on `users`/`crews`/`time_entries`. Phase D is specced against `time_entries`.

## Hard-won facts from 2026-08-17 — don't rediscover these

- **`ghl_push_state` has no `created_at` column** (it has `updated_at`). Ordering on it makes
  PostgREST reject the whole query. This broke promotion *and* scope on the first live fire and **no
  unit test could catch it** — the mocks don't validate column names. **Live-probe every deploy.**
- **`deno task test` used to lie.** It ran `_shared/` only and reported 18/18 while **139 real tests
  were never collected**. Now runs `supabase/functions/`.
- **`/opportunities/{id}` and `/opportunities/search` return different custom-field shapes.** By ID
  gives `{id, fieldValue}`; search gives `{id, fieldValueString|fieldValueDate, type}` with dates as
  **epoch milliseconds**. Phase A is safe only because it fetches by ID.
- **`sync_log` CHECKs are narrower than they look.** `match_method IN ('ghl_contact_id','email','none',
  'email_duplicate')` (last one added 2026-08-17), `action_taken IN ('created','updated','skipped',
  'error')`, `status IN ('success','error')`. The old client-sync code wrote two illegal values, so
  that insert was **silently rejected for 3.5 months**.
- **`users`/`crews`/`time_entries` carry 7 live RLS policies**, contradicting CLAUDE.md's former "no
  policies by design". EXECUTE on `get_my_role`/`get_my_crew_id` is now revoked from anon/authenticated.
- **`Job Scope` is populated on zero live opportunities**, and **12 of 16 estimates have zero line
  items** — quick mode is the common shape, which is why `job_details` became a scope tier.
- **Dane habit items** (not code): populate GHL **Job Start Time** and **Job Scope**.

## State that hasn't changed

**Phase B slice 2 is LIVE** at **https://lbd-estimates.vercel.app** (project `lbd-estimates`, root
`web`, prod branch `main`). **There is no login** — device-remembered estimator picker, re-validated
server-side; ships network-layer **open**. Read CLAUDE.md's "No-login estimate tool" section before
touching anything auth-shaped. First real estimate will be **≥ 1426**.

Two known limitations carried forward: superseded-version protection is UI-only, and there is no
concurrency guard on the GHL push.

**Test residue left live deliberately:** estimate 1424 v2 is `accepted` with `job_number = JOB-1104`
(real promotion evidence on a TEST estimate); JOB-1104 carries `TEST`-prefixed identity values.
`SLACK_TEST_CHANNEL_OVERRIDE` was unset and confirmed absent.

## ⚠️ Standing instructions from Matt

**Delete nothing without his specific, express, per-item approval.** The deletion checklist is still
open and untouched in the BUILD_LOG `2026-08-14 (late)` entry. **Never `git add -A`** in this repo —
stage explicit paths.

**⚡ Run agents in parallel as much as possible. Quality first, efficiency second — ordered, not
traded off.** Now a Standing Instruction in CLAUDE.md. Isolated worktrees per lane, explicit disjoint
file ownership in every prompt, directory-scoped test runs for agents with the orchestrator running
the full suite once as the real gate, and reviews run concurrently with unrelated implementation.
Never parallelize away a gate — on 2026-08-17 reviews caught a GHL PUT that erased contact names, a
log insert silently rejected for 3.5 months, a migration that would have flipped a lifelong no-op
into a live write, and a divider glyph contradicting the approved brief. No test would have caught any
of them.

Also unchanged: (a) plan + explicit approval before any new build (small fixes exempt); (b) anything
deployed/applied to Supabase committed the same session; (c) `BUILD_LOG.md` entry at every session
close, including docs-only ones; (d) subagent-driven with per-task Opus review for build-sized work;
(e) Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field Registry / Secrets & Credentials / People & IDs
only.

**Process lesson worth keeping:** one deploy this session went out while 2 tests were red, because the
suite's exit code was masked by `| tail`. Check `PIPESTATUS` when gating a deploy on a piped test run.

## After BL-4 (none blocked)

1. **Phase C — Expenses + dump counts (BILL)**. One transaction = one dump load, so it delivers cost
   *and* count.
2. **Track B — Lead intake.** Flagged "start now" back in July; still hasn't started.
3. **BL-5 / BL-6 / BL-7** above.
4. **Phase D — time tracking** remains the one 🔴 blocking decision. Unchanged. Note BL-7 now
   intersects it.
5. Historical import of the 321 Airtable estimates — Matt **declined** this 2026-08-14.
   `estimate_number` 1001–1321 stay reserved. Don't re-propose without a reason.
