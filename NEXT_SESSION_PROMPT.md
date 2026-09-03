Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md (the `AMENDED 2026-09-02` block records every Session 17 ruling), then
**`docs/superpowers/specs/2026-09-02-estimate-builder-redesign-design.md`** (the APPROVED design) and
**`docs/superpowers/plans/2026-09-02-estimate-builder-redesign.md`** (the APPROVED implementation plan —
lanes, waves, file ownership, locked interfaces, gates). Open the approved mockup
`docs/prototypes/2026-09-02-estimate-builder-approved.html` in a browser before dispatching UI lanes.

## ▶️ THIS SESSION = BUILD THE ESTIMATE BUILDER REDESIGN (approved by Matt 2026-09-02)

Matt approved the plan in Session 17 and ruled the build starts here. No re-brainstorming; the Build
Planning Rule is satisfied. Sequence:

1. **Worktree:** `git worktree add .claude/worktrees/estimate-redesign -b claude/estimate-redesign main`.
2. **Docs check (X1):** spec, plan, BUILD_PLAN amendment, prototypes are on main — confirm, don't rewrite.
3. **Wave 0 — dispatch 5 lanes concurrently in ONE message** (Sonnet implements, each with its owned files
   only, scoped tests only): **S1** migration + pgTAP on a disposable Supabase branch (runbook RED→GREEN;
   `confirm_cost` first) · **D1→D2** tokens/fonts/shell then `components/ui` primitives + `lib/format.ts` ·
   **L1→L2→L3** types/validate/map → `wizard.ts` → drafts repo + actions/repo changes · **A1** auth
   dormancy (`OWNER_AUTH_ENABLED`, default off; dual-mode forecast action) · the orchestrator writes nothing
   in the codebase. Adversarial review (strongest model) per task as each lands; fix rounds in parallel.
4. **Wave 1 (after D2 + L2 land):** **W1→W4** wizard (Job/Client/Financial/Review, drafts resume, revise) ∥
   **G1,G2** GHL doc/notes on `customer_price` + schedule prefill ∥ **P1,P2** list + detail ∥ **J1** `/jobs`
   reskin (className-only; reviewer asserts the non-className diff is empty).
5. **Wave 2:** full suites (`cd web && npx vitest run` ≥811 → higher; `deno task test` 411 golden intact;
   `npm run lint && npm run build`), whole-branch adversarial review + fix round, then **STOP for Matt's
   gates, each on his explicit go:** migration → production (runbook; catalog asserts; `get_advisors`) →
   merge (tree byte-identity check) → Vercel deploy verify (`/` 307→`/jobs` anon, `/jobs` 200 anon,
   `/estimates` + `/estimates/new` 200) → **Matt's phone smoke on ONE REAL estimate (≥1431)** incl. draft
   save/resume, a line-price edit with a reason chip, Save and send → GHL fields + draft doc show the
   per-line prices as typed → BUILD_LOG/CLAUDE.md/NEXT_SESSION_PROMPT close.

**Locked design points (do not re-decide):** scope names the customer lines; hours + dumps entered once;
line prices start as an even cent split of the total and each is editable; **line sum = quoted price**,
reason chip required when it differs (the `quote_override_reason_required` table CHECK fires on INSERT);
one "Other job costs" lump (→ `other_direct_cost`) with an optional breakdown; "Profit margin" chips
20/25/30/35 + Other…, true margin shown in the band; days×crew removed from the UI (schema/engine keep it);
business name only for Contractor; estimate + requested start dates on Job; Record only switch on Review;
**Save as draft on every step → `estimate_drafts` (server-side), promoted on finish**; no currency in line
names/descriptions (crew-visible scope summary); GHL doc + Scope Notes use stored `customer_price`
(`allocation.ts` kept, uncalled); the pricing engine is untouched; Inter replaces the never-applied Geist;
tokens = the dashboard prototype's ink/orange set as swappable placeholders + `BrandMark` logo slot; `/jobs`
styling only; owner auth dormant. Deletions: none — `EstimateBuilder.tsx`, `LineItemCard.tsx`,
`ScopePickerSheet.tsx`, `StickyTotalBar.tsx`, `allocation.ts` become unreferenced → list for Matt.

**After this build:** 8b as the status action + engine manual-phase rules —
`docs/superpowers/plans/2026-09-02-v2-task8b-status-action-staged.md` (design locked; re-present the task
list at dispatch). Adoption checklist (Matt-owned):
`docs/superpowers/plans/2026-09-02-adoption-sprint-checklist.md`.

## Standing items (unchanged)

**BL-8 (Matt-only):** Slack bot invitations to Crew 1–4; calendar eyeballs 2026-12-15/16 + 2026-12-28/29;
authenticated JOB-1104 re-drag. **Cleanup pending Matt's per-item OK:** branch `claude/v2-task8a-owner-auth`
+ worktree `.claude/worktrees/task8a` (merged), its SDD ledger, GHL TEST opportunity `UuTLn5Xg2Bb9EEj4UUBv`.
BL-6 echo-guard design draft awaiting Matt's review. JOB-1107/1108 residue KEPT permanently (do not
re-ask). Dane's owner invite deferred (auth dormant). Session-open metric: Airtable `Estimates` last ID
(baseline 360) vs app estimates (first real ≥1431).

## State

**Production = main at https://lostboysdemolition.vercel.app, still the 8a posture** (`/` 307→`/estimates`
anon; `/jobs/*` owner-gated; `/estimates` open with the picker). Live functions unchanged: `ghl-job-webhook`
v25 (flag=false permanent), `crew-night-before` v11, `airtable-client-sync` v29, `integration-dispatcher` v1
(cron `*/5`), `google-calendar-webhook` v2 (cron `7,37`). **Migration head `20260826180811` (39 applied —
zero migrations Sessions 14–17).** `jobs` = 6 cancelled TEST rows; 0 open alerts; `SLACK_TEST_CHANNEL_OVERRIDE`
ABSENT. Matt = `workforce_profiles` owner/active (sign-in `matt@lostboysdemolition.com`). Suites at last merge:
web 811/811, deno 411/411 (golden intact). First real estimate ≥1431.

## Standing instructions (unchanged)

Delete nothing without Matt's express per-item approval; never `git add -A`. Every build task gates on
adversarial review (+ runbook cycle for any migration) + Matt's per-task prod-apply/merge yes. Anything
applied to Supabase committed same session. BUILD_LOG entry at every session close. Sonnet implements, the
strongest available model adversarially reviews. Concurrency REQUIRED where it doesn't impact
quality/integrity; plans are written for concurrent lanes up front. **Three functions deploy ONLY via the
`--no-verify-jwt` + readback invariant: `ghl-job-webhook`, `integration-dispatcher`, `google-calendar-webhook`.**
Pipeline Reference base `appA7uj7FhnPp9Bvg` = Field Registry / Secrets (names only) / People & IDs.
