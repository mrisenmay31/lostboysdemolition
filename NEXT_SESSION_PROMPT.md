Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md, then
`docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` (the ratified
program — **Phase 3 in progress: Task 8 is SPLIT 8a/8b; 8a + Task 9 are BUILT AND REVIEWED on a
branch, NOT merged — this session runs the gate sequence**). Session-14 implementation plan:
`docs/superpowers/plans/2026-08-27-v2-task8a-owner-auth-task9-forecast-overrides.md`. The gate
script is `docs/runbooks/owner-promotion.md` (**on the branch**, not yet on main).

## What just happened — Session 14 (2026-08-27): 8a + Task 9 BUILT, review-clean, awaiting gates

Full record: the 2026-08-27 Session 14 `BUILD_LOG.md` entry.

- **Matt's scoping rulings:** Task 8 split — **8a** = owner auth (email magic link,
  `shouldCreateUser: false` invite-only), owner-gate every `/jobs/*` financial route, `/` flip;
  **8b** (next build session) = foreman mobile checklist area + the Phase 3 gate + the backlogged
  alert `action_path` migration. **Owner = Matt now, Dane later.**
- **Built on branch `claude/v2-task8a-owner-auth`** (11 commits `654d4c4..1b0527a`, worktree
  `.claude/worktrees/task8a`): @supabase/ssr foundation (server-verified `getUser()`, fail-closed
  `workforce_profiles` reader over `workforce_self_read`), `/auth/sign-in` + `/auth/confirm`
  (token_hash + `safeNextPath` open-redirect guard), `web/src/proxy.ts` (registration verified in
  the build manifest), `(app)/jobs/layout.tsx` owner gate + `/` flip, owner-promotion runbook,
  and Task 9 end to end: locked Zod validation (z.number() only; crew-days zero-divisor guard),
  append-only `job_forecast_overrides` writes (first non-null `created_by`), the first
  authenticated-owner-gated server action, ForecastOverridePanel on job detail (replaced the old
  static overrides block — ruled consolidation, field-parity verified).
- **Review record:** 7 tasks Sonnet-built + adversarially reviewed; 2 fix rounds; final
  whole-branch review READY TO MERGE (0 Critical, 18 minors OK-TO-DEFER, 0 rulings contested) +
  a verified 4-item polish wave. Suites: web 811/811 (+53), deno 411/411 (golden intact), lint 0
  errors, build green. **Zero migrations; picker surface + `supabase/` diffs byte-empty.**
- **Critical config finding (review-caught):** Supabase's DEFAULT email templates never carry
  `token_hash` — with defaults, EVERY sign-in dead-ends. The runbook mandates customized
  **Magic Link AND Invite** templates. Sign-in cannot work until that dashboard step is done.

## ▶️ THIS SESSION OPENS HERE — the 8a gate sequence (each step on Matt's explicit go)

Script: `docs/runbooks/owner-promotion.md` (read it from the branch/worktree first).

1. **Supabase Auth config (dashboard):** Site URL `https://lostboysdemolition.vercel.app`;
   redirect URLs (`…/auth/confirm` + localhost); **both email templates — REQUIRED**; confirm
   `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` exist in Vercel PRODUCTION env
   (absent ⇒ the proxy 500s `/` for everyone).
2. **Owner promotion** (runbook §2): service-role UPDATE flipping Matt's `workforce_profiles`
   row (`pending`/inactive → `owner`/active) — the deferred Task 0B step. Via MCP, Matt watching.
3. **Merge + push:** normal (non-FF) merge — main's Session-14 docs commit advanced past the
   branch point; the plan doc is committed identically on both sides and auto-resolves. Then
   push, per Matt's approval.
4. **Deploy verify:** `/` 307→`/estimates` (anonymous), `/jobs` 307→`/auth/sign-in?next=/jobs`,
   deep-link probe `/jobs/JOB-1108/costs` → Location carries `next=/jobs/JOB-1108/costs`
   (proves the proxy, not just the layout), `/estimates` 200, `/auth/sign-in` 200.
5. **Matt's phone smoke (read-only, runbook §3):** magic-link sign-in → `/` lands `/jobs`;
   incognito checks; sign out. Any WRITE smoke (e.g. a real override on JOB-1108) is a separate
   per-item ask.
6. **Close docs:** CLAUDE.md's "no login / network-open" language gains the 8a posture
   (`/estimates` open + picker; `/jobs/*` owner-gated; anon key now load-bearing); BUILD_LOG
   entry; regenerate this file toward 8b.

**Restate to Matt at the gate (ruled boundary):** `/jobs` PAGES become owner-only, but the
pre-existing cost/revenue/schedule/cancel WRITES stay picker-gated and network-invocable —
unchanged posture, 8b hardening candidate. Only the new forecast-override action is owner-gated.

## Standing items

**BL-8 (Matt-only):** Slack bot invitations to Crew 1–4 (until done, real jobs' crew-Slack legs
dead-letter loudly); rest of the phone smoke + one real estimate (**≥1431**); authenticated
JOB-1104 re-drag + re-cancel; calendar eyeballs 2026-12-15/16 + 2026-12-28/29. **Backlogged gate
findings:** alert `action_path` self-link (RPC migration → attaches to 8b's migration window);
costs-edit discoverability (UX). **Carries for 8b** (from Session-14 reviews): action-level
auth-branch tests; `DEFAULT_HOURS_PER_DAY` shared constant (map.ts + job detail both hard-code 8);
custom SMTP before foreman onboarding; picker-gated-writes hardening decision. **Cleanup pending
Matt's per-item OK:** worktree `.claude/worktrees/task8a` + branch (after merge), its SDD
workspace ledger, the GHL TEST opportunity `UuTLn5Xg2Bb9EEj4UUBv`. BL-6 echo-guard design draft
still awaiting Matt's review. JOB-1107/1108 residue KEPT permanently (do not re-ask). Dane's
dashboard-prototype feedback still not received — reconcile into the v2 plan whenever it lands.

## State

**Production UNCHANGED this session** — Vercel serves main's pre-Session-14 code at
https://lostboysdemolition.vercel.app (estimate builder + Phase 1 surface + dashboard + ledger +
audit rendering; NO login; `/` 307→`/estimates`). Live functions unchanged: `ghl-job-webhook` v25
(flag=false permanent), `crew-night-before` v11 line, `airtable-client-sync` v29 line,
`integration-dispatcher` v1 (cron `*/5`), `google-calendar-webhook` v2 (cron `7,37`). **Migration
head `20260826180811` (39 applied — zero migrations Session 14).** `jobs` = 6 cancelled TEST rows;
0 open alerts/exceptions; outbox drained; 5 calendar channels active; `SLACK_TEST_CHANNEL_OVERRIDE`
ABSENT. **Branch `claude/v2-task8a-owner-auth` at `1b0527a` (worktree `.claude/worktrees/task8a`)
holds the entire 8a+9 build — suites there: web 811/811, deno 411/411 golden intact.** Matt's
`workforce_profiles` row is still `pending`/inactive (promotion = gate step 2). First real
estimate ≥1431.

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
