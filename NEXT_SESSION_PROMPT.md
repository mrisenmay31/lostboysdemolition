Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md (official plan, phases A–G + Track B).

## What just happened — BL-5 SHIPPED (2026-08-20) + BL-6 design draft ready

BL-5 (strip pricing from crew calendar events) was planned, approved, built, opus-reviewed
(0 findings), deployed, live-probed, verified by Matt, and merged to `main` (`ac58673`,
fast-forward). Read the `2026-08-20` entry in `BUILD_LOG.md` before planning anything.

Live now: **`ghl-job-webhook` v19** (sha `024cc198…`). The calendar builders take a **required**
`audience: "main" | "crew"` param — crew calendar events carry NO `Estimate:` line, main keeps it,
byte-identical to before. Suite: **317 passing** (`deno task test`), golden-321 gate intact.

**The no-pricing-to-crew-channels rule now holds on crew Slack AND crew calendars.** One residual,
consciously accepted: legacy `airtable-job-scheduled` (retirement-bound) still emits
`Estimated Revenue` to crew calendars. Deferred by recorded decision, not missed.

## 🚨 Hard-won facts from 2026-08-18/20 — don't rediscover these

- **A bare `supabase functions deploy` silently flips `verify_jwt` to TRUE** — which 401s every GHL
  webhook call. Always pass `--no-verify-jwt` for the webhook functions and ALWAYS read back
  `verify_jwt` via `list_edge_functions` after any CLI deploy. (Caught live on v17; corrected v19.)
- **Test re-drags revive job rows.** `handleJobScheduled` writes `status_v2='scheduled'`
  unconditionally, no cancelled-guard. JOB-1104 had drifted back to scheduled from BL-4's E2E and
  was one evening from pinging the REAL Crew 1 channel with TEST data via the night-before digest.
  It is re-cancelled now. **Any future probe: re-cancel the test job as part of cleanup, every time.**
- **The A→G→A sync echo loop is live-proven, not hypothetical** (BL-6 draft): 100% of
  `airtable_to_ghl` syncs since June are followed by a `ghl_to_airtable` sync of the same email
  (p50 1.68s). GHL fires its workflow even on no-op PUTs. Only the create-only Airtable trigger
  breaks the chain today.
- **`tags` arrives empty in 620/624 logged GHL payloads** → a whole-tuple hash echo guard would
  mismatch permanently and CAUSE the infinite loop. The draft's claim that a CLAUDE.md tags line
  needs correcting is **unverified** — verify before editing docs.

## ⚡ Standing directive STRENGTHENED 2026-08-18 (in CLAUDE.md)

Quality/integrity #1 always; efficiency #2. **Concurrency is REQUIRED when it doesn't impact
quality** — serializing is legitimate only at the three integrity boundaries (shared file,
interface dependency, contingent task). **Write plans structured for concurrent agents up front**:
disjoint file ownership per task, interfaces first, per-task notes on what runs alongside.

## 🔴 Still owed

- **Matt's phone smoke + the one-real-bid Fillout parallel check** on
  https://lbd-estimates.vercel.app — outstanding since 2026-08-14. First real estimate ≥ 1426.
- Eyeball the BL-4 message rendering in #ops-test (`C0BPPG8997Z`) — still unverified; the session
  Slack MCP is on the wrong workspace (CTA Integrity), so this is Matt's 30-second look.
- Dane habit items: populate GHL **Job Start Time** and **Job Scope**.

## Next work (none blocked)

1. **BL-6 — review the echo-guard design draft**:
   `docs/superpowers/plans/2026-08-18-bl6-echo-guard-design-DRAFT.md`. Recommends a field-wise
   `last_synced_values` jsonb snapshot on `client_sync_state`, guard in `ghl-contact-sync` FIRST
   (that side is the real loop-breaker), 120s window, fail-open, hop-rate breaker; guard is
   verifiable against today's existing echo BEFORE the `recordUpdated` trigger is ever created.
   Open questions OQ-1/OQ-2 need live verification; bundled prereq fixes (`res.ok` checks in
   `ghl-contact-sync`) are non-optional. Matt's review turns this into a build brief.
2. **Phase C — Expenses + dump counts (BILL)**. Needs BILL credentials from Matt to build;
   planning can start any time.
3. **Track B — Lead intake.** Config-only, "start now" since July; needs the Grasshopper-vs-port
   decision (open decision #7).
4. **BL-7** — decide `handle_new_auth_user()` + the 7 RLS policies before Phase D.
5. **Phase D — time tracking**: still the one 🔴 blocking decision.
6. Historical import of 321 Airtable estimates: Matt **declined** 2026-08-14; don't re-propose.

## State that hasn't changed

Phase B slice 2 LIVE at https://lbd-estimates.vercel.app, no login (estimator picker),
network-layer open. Two known limitations: superseded-version protection is UI-only; no concurrency
guard on the GHL push. Test residue: estimates ≤1425 TEST-labeled; JOB-1102/JOB-1104 cancelled TEST
jobs. **No test artifacts remain on any calendar** (Matt deleted the two BL-5 probe events
2026-08-20); both jobs' gcal ID columns stay stamped, pointing at deleted events by design, so a
re-fire can't create duplicates.

## Standing instructions (unchanged unless noted)

Delete nothing without Matt's express per-item approval; never `git add -A`. Plan + explicit
approval before any new build (small fixes exempt). Anything deployed/applied to Supabase committed
same session. BUILD_LOG entry at every session close. Sonnet implements, opus reviews every task +
whole branch. Live-probe every deploy (mocks can't see the DB — and now: nor the deploy flags).
Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field Registry / Secrets & Credentials / People & IDs
only (note: it stores secret NAMES, not values — calendar IDs are unreadable in-session by design).
