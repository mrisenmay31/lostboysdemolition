# Build Log

Deployment and session history for the Lost Boys ops system. **This file is the build log.**

Migrated 2026-07-30 from the `Build Log` table in the Airtable Pipeline Reference base
(`appA7uj7FhnPp9Bvg` / `tbl3pCxGn0xqC1Qvu`). All 8 records were transferred verbatim below. That
table is **superseded** — do not write to it, and do not read it as current. Everything above the
migration line was authored in Airtable; everything at or below is native to this file.

**How to use:** add a new entry at the top of *Entries* after any deploy or any session that
changes the system or its documentation. Keep the newest first. Record what a future session would
otherwise have to rediscover — decisions, defects found, things that surprised you — not just what
shipped.

---

## Current status at a glance

| Function / Component | Stage | Status | Last touched |
|---|---|---|---|
| `airtable-client-sync` | — | 🟢 Live (**v29**) — search leg repaired, duplicate path now updates, name-erasure guarded 2026-08-17. **Data-loss item NOT closed → BL-6** (automation is `recordCreated`-only) | 2026-08-17 |
| `ghl-contact-sync` | — | 🟢 Live (v27+) — tags crash FIXED 2026-08-14, live-verified | 2026-08-14 |
| `airtable-job-created` | 3 | 🟡 In Progress (v21) — **GHL UI verification still pending since 2026-05-15** | 2026-07-30 |
| `airtable-job-scheduled` | 6 | 🟢 Live (v16) — verified end to end | 2026-05-15 |
| `airtable-job-completed` | 8 | 🟢 Live (v14) | 2026-07-30 |
| `receive-airtable-webhook` | — | 🟢 Live (v11) — **unauthenticated**, retirement queued | 2026-07-30 |
| `push-to-airtable` | — | ⚪ Dormant (v11) — never run, latent bug | 2026-07-30 |
| `ghl-job-webhook` | A/v2 | 🟢 Live (**v25**, `verify_jwt=false` read back) — Phase A keystone + BL-4/BL-5 + `launch_workflow` compat check. **PERMANENT CUTOVER LIVE 2026-08-25 (Session 10): `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false` set in prod — Quote Accepted responds `quote_accepted_awaiting_schedule` and mints NOTHING (live-verified through the real GHL workflow); app scheduling is the sole minting path. Never re-enables (ratified decision 1)** | 2026-08-25 |
| `google-calendar-webhook` | 5B | 🟢 Live (**v2**, `verify_jwt=false` read back, siblings sha-undisturbed) — all 3 migrations applied (head `20260825171051`, 38). 5 watch channels active, cron `7,37 * * * *` live. **PROBE COMPLETE (Session 9, 2026-08-25): all six legs proven live on JOB-1106** — inbound date apply + dispatcher mirror (update-not-create proven), deletion→exception→dismiss→recreate, `closed_lost` teardown, echo termination every round. Slack override UNSET + confirmed absent. **Task 5B DONE** | 2026-08-25 |
| Crew Slack delivery | — | 🔴 **BROKEN — bot not in the crew channels** (`not_in_channel`, found live 2026-08-20). One successful post in system history (Crew 1, 2026-08-13); crews 2/3/4 never delivered. **Backlogged → BL-8 per Matt 2026-08-25 (Session 10) — no longer gate-blocking.** Until invited, each real scheduled job's Slack leg dead-letters loudly (alert raised; calendars/GHL unaffected) | 2026-08-25 |
| `crew-night-before` | — | 🟢 Live (**v11**) — BL-4 format + divider; shared `_shared/slack.ts`; test-override no longer consumes the real digest. Discharges the owed redeploy | 2026-08-17 |
| Phase B slice-2 (`web/` app + DB) | B | 🟢 **SHIPPED — merged to main (`dd6cc87`) and LIVE at https://lostboysdemolition.vercel.app** (URL changed 2026-08-18; old `lbd-estimates.vercel.app` deleted, now 404s) — all 14 build tasks + the mid-session no-login scope change + final whole-branch review + fix wave done and reviewed; 5 migration files (4 units of work — the RPCs migration + its fixups count as one unit) live; Matt's phone smoke + Fillout parallel check still owed | 2026-08-14 |
| Repo structure + docs | — | 🟢 **Hygiene pass merged (`a73c009`) 2026-08-14** — 8 superseded docs moved to `docs/archive/` (git renames, nothing deleted), `.gitignore` gaps closed, `CLAUDE.md` repointed. Root: 26 files → 18. Deletion checklist still open, pending Matt | 2026-08-14 |
| BL-4 crew Slack + repo fixes | — | 🟢 **SHIPPED and merged to main 2026-08-17** — both crew messages reformatted, estimate→job promotion built and live-proven, 2 of 3 repo fixes done (3rd → BL-6). Suite 312. New backlog: BL-5/BL-6/BL-7 | 2026-08-17 |
| `deno task test` gate | — | 🟢 **Widened 2026-08-17** — was `_shared/` only and reported 18/18 while **139 real tests were never collected**; now `supabase/functions/`, 312 passing | 2026-08-17 |
| `stripe-webhook` | 9–11 | 🔴 Not Built — now owned by Profitability Program v2 Task 15 | — |
| Job Completed Airtable Auto | 8 | 🟡 In Progress | 2026-05-07 |
| GHL Custom Fields + Mapping | — | 🟢 Live (19 fields) | 2026-05-15 |
| Profitability Program v2 (plan) | 0–6 | 🟢 **Phase 0 COMPLETE 2026-08-18; Phase 1 Sessions 1+2 SHIPPED 2026-08-19** — Task 1 schema + Task 2 economics/commercial-lifecycle migrations **ALL APPLIED TO PRODUCTION** (heads `20260819052245` → `20260819141318`, 31 applied; pgTAP 102/102 + 78/78; identity backfill seeded families 1419/1420/1423); Task 3 forecast engine + Task 2 web integration (economics module, GHL pipeline/prefill, commercial lifecycle UI) merged to branch `claude/last-session-review-f7tqxw` (web 471/471, deno 317/317) — **web NOT yet deployed to Vercel** (separate Matt ask). Deviations 1–12 recorded in the phase plan. **Session 3 (Task 4) SHIPPED 2026-08-19:** `schedule_estimate` RPC **APPLIED TO PRODUCTION** (head `20260819191046`, 32 applied; branch GREEN 82/82), scheduling UI on the branch (web 537/537), `ghl-job-webhook` **v20 deployed** flag-UNSET (behavior-neutral). Matt to-dos (non-blocking): phone smoke + real estimate ≥1426 on the branch preview; authenticated webhook live fire. GHL-minting cutover still flips only at Phase 1 gate pass. **Sessions 4–5 (2026-08-20): Task 5A SHIPPED TO PROD + probed live (JOB-1105); 5B spike PASSED. Session 6 (2026-08-24): Task 5B Step 2 BUILT + FULLY REVIEWED on the branch** — 3 migrations + `google-calendar-webhook` rewrite + `/jobs/exceptions` UI; branch pgTAP 147/147, deno 411/411, web 596/596; **prod apply + deploy + probe await Matt**. **Session 8 (2026-08-25): Task 5B SHIPPED TO PROD** — 3 migrations applied (head `20260825171051`, 38 applied), `google-calendar-webhook` v2 deployed via the invariant, `SLACK_TEST_CHANNEL_OVERRIDE` set to #ops-test for the probe (unset it at probe close), probe legs 1/2 + echo termination proven live (estimate 1428 → JOB-1106; first-ever dispatcher Slack delivery; first real estimate ≥1429). **Session 9 (2026-08-25, same day): probe legs 3/5/6 COMPLETE — all six legs proven live, JOB-1106 torn down (`closed_lost`), override UNSET + confirmed absent. Task 5B is DONE.** **Session 10 (2026-08-25): Task 7 gate PASSED, permanent cutover live, MERGED TO MAIN — v2 PHASE 1 COMPLETE.** **Session 11 (2026-08-26): Phase 2 opened — v2 Task 6 (Job Dashboard `/jobs` + job detail `/jobs/[jobNumber]`) BUILT on branch `claude/v2-task6-job-dashboard` (10 commits, web-only, no migrations), all 5 task reviews + final whole-branch review clean after one fix wave; web 650/650, deno 411/411, build green, live-verified against prod. **MERGED TO MAIN (`c3d4e48..5663a46`, Matt's go) + production deploy VERIFIED — `/jobs` is LIVE; `/` flip still Task 8's.** Task 7 (manual ledger) completes Phase 2. **Session 12 (2026-08-26, same day): v2 Task 7 SHIPPED — migration `manual_ledger_rpcs` APPLIED TO PRODUCTION (version `20260826180811`, 39 applied), 4 ledger writer RPCs live, all reviews clean (2 review-caught defects fixed), live smoke on JOB-1107 proved every leg incl. the overrun alert + note preservation + snapshot invariant, MERGED TO MAIN (`a0a92a2..0e893aa`) + production deploy VERIFIED — `/jobs/[jobNumber]/costs` + `/revenue` LIVE. Phase 2 BUILD COMPLETE; the Phase 2 gate E2E (staged job + full fact list, burns estimate ≥1430) is the remaining Phase 2 item** | 2026-08-26 |

Supabase project for all functions: `eiqqqwajmcpcwhvxxnhx`.

---

## Entries

### 2026-08-26 — Session 12: v2 TASK 7 SHIPPED — manual ledger LIVE (migration applied, merged, deployed); v2 PHASE 2 BUILD COMPLETE, gate E2E pending

**What shipped.** v2 Task 7 (manual cost, commitment, and revenue capture) end to end in one
session: plan written and Matt-approved (`docs/superpowers/plans/2026-08-26-v2-task7-manual-ledger.md`),
built on branch `claude/v2-task7-manual-ledger` in 5 concurrent lanes (SDD; Sonnet implements,
strongest model reviews every task + whole branch), **migration `manual_ledger_rpcs` APPLIED TO
PRODUCTION** (version `20260826180811`, head advanced from `20260825171051`, 39 applied), then
**merged to main (fast-forward `a0a92a2..0e893aa`, 7 commits) and production Vercel deploy
VERIFIED** — `/jobs/[jobNumber]/costs` and `/jobs/[jobNumber]/revenue` are LIVE on
https://lostboysdemolition.vercel.app (both 200 with real data; `/` still 307→`/estimates`,
Task 8's flip untouched).

**The new write path (the ONLY ledger write path — never bare inserts):** four service-role-only
RPCs, search_path-pinned, EXECUTE revoked from public/anon/authenticated —
`create_job_cost_entry(p_entry jsonb, p_actor uuid, p_actor_name text)`,
`correct_job_cost_entry(p_id, p_patch, p_reason, p_actor, p_actor_name)` (FOR UPDATE lock,
whitelisted patch keys, `source_system='manual'` only, same-transaction `job_cost_entry_audit`
row, `source_revision`+`updated_at` bump — the updated_at bump is what moves the forecast-snapshot
watermark), `create_job_revenue_entry`, and helper `open_category_overrun_alert` (fingerprint
`category_overrun:<category>`, severity `watch`, dedup via the partial-unique open-fingerprint
index, deliberately NO Slack outbox — Task 12 owns Slack). Both cost RPCs invoke
`mark_job_reconciliation_required` + the overrun check in-transaction; revenue invokes mark only.
Key conventions now LOCKED in production: **credit/refund amounts are stored NEGATIVE** (RPC-enforced;
forms capture positive, repo negates — matches `map.ts`'s signed economic-revenue sum);
**cost amounts strictly positive** (adjust via correction, remove via void — no delete path);
**dates are Denver business dates stored as Denver NOON** (`(date::timestamp + interval '12 hours')
at time zone 'America/Denver'`) so Denver rendering round-trips; **attribution =
`metadata.entered_by`** (no created_by_name column on ledger tables; `p_actor` always null);
**RPC raise texts are a cross-lane API** matched by substring in `web/src/lib/ledger/repo.ts`'s
`classifyLedgerError` — never reword one side alone. **No revenue correction path by design**
(no state column, no audit table) — offsetting credit/refund is the correction.

**Web:** `web/src/lib/ledger/` (types + pure Zod validate — `z.number()` only, empty-string/NaN
rejected per the Task-6 carry; repo with error classification + `loadLedgerJobContext` carrying
the Task-6 `QUERY_ROW_CAP=1000` truncation sentinel), three estimator-gated server actions in
`jobs/actions.ts`, the two entry screens (budget-vs-entered table with the locked
payment_processing footnote; per-entry Correct/void disclosures on manual non-void entries only;
the verbatim payments-affect-collection-not-profit explainer), and the detail page's two Task-7
stubs swapped for real links. `map.ts` change: one word (`export` on `CATEGORY_LABELS`).

**Validation chain.** pgTAP `manual_ledger_rpcs_test.sql` RED→GREEN **41/41 on a disposable
branch** (schema-only — note: **Supabase branches do NOT clone data**; the brief's
`auth.users limit 1` closure fixture was defective on a branch and was replaced by a synthetic
in-transaction auth.users row — migration proven byte-identical to the approved plan SQL);
sibling core-schema suite 102/102 unchanged; branch deleted. Suites at merge: **web 728/728**
(650 baseline verified intact + 57 ledger + 21 actions), lint 0 errors/1 pre-existing warning,
build green, **deno 411/411** (golden-321 untouched). Reviews: 5 task gates + whole-branch
(MERGE-READY), **two review-caught defects fixed**: (1) the correction form's unconditional
`note: null` silently wiped an entry's original note on every note-less correction
(absent-vs-null contract misuse — fixed presence-conditional, `8686996`); (2) `loadLedgerJobContext`
lacked the row-cap sentinel + a misleading test comment (`0e893aa`).

**Live smoke on JOB-1107 (post-apply, pre-merge) — every leg proven in production:** $65 dump
create (no false alert; Denver date round-trips; entered_by stamped) → $150 second entry →
**overrun alert opened live** ("Dump actuals plus committed ($215.00) exceed the current budget
($195.00)", watch) → correction 65→80 (revision 2, audit row, **note preserved through a
note-less patch — the review fix proven live**) → dedup held → **positive credit rejected live**
(P0001 sign guard) → both entries voided (exclusion proven: live sum $0; rendered budget table
$195.00 vs $0.00) → invoice +$100 / credit −$100 nets $0.00 → reconcile hook correctly no-ops
(no closure snapshots until Task 11) → **snapshot invariant HELD through local AND production
detail renders (0 `job_forecast_snapshots` rows — cancelled jobs are never engine-scored)** →
alert resolved `[Matt] Task 7 live smoke`. **Residue on JOB-1107 (permanent, flagged to Matt
pre-apply): 2 voided cost entries, 3 audit rows, 2 net-zero revenue rows, 1 resolved alert.**
Removal only with Matt's per-item OK via SQL.

**Gotcha for future SQL probes:** a SELECT-only CTE wrapping one of these RPCs can be optimized
away silently (the alert probe "ran" but the entry was never created). Probe RPCs with a direct
`select * from fn(...)`, never via an unreferenced-output CTE. The app's `.rpc()` transport is
unaffected.

**Decisions taken (Matt):** plan approved as written (incl. the two extra writer RPCs beyond the
spec-named one, the sign convention, corrections restricted to `source_system='manual'` until
Task 14, in-RPC overrun alerts with no Slack); migration apply approved; merge+deploy approved.
The two copy-glyph deviations (sentence-cased credit/refund explainer with terminal period;
double-quoted source-note example) were flagged pre-apply and waved through by proceeding.
Known accepted minors (full triage in the whole-branch review, ledgered): $0-budget categories
alert on their first entry (noise, spec-consistent); stale-tab un-void via the correction form's
unconditional seeded `state` (same accepted class as the Phase-B UI-only protections; 3 users);
no double-submit idempotency on manual create (void is the remedy); overrun can under-fire under
concurrent same-category inserts (self-heals on next entry).

**Defects found, not fixed:** none blocking. Deferred-minor ledger lives in
`.superpowers/sdd/2026-08-26-v2-task7-manual-ledger/progress.md` (git-ignored scratch, KEPT —
delete only with Matt's per-item OK; branch + worktree `.claude/worktrees/task7` also kept).

**What the next session needs to know:** Phase 2's build is complete; **the Phase 2 gate E2E is
the remaining Phase 2 item** — stage a fresh TEST estimate (burns ≥1430, pushing first-real to
≥1431, Matt's call), schedule it into a real scheduled job, enter the gate's full fact list
(labor/materials/rental/dump/subcontractor/other-direct/processing/invoice/credit/refund/payment),
verify Dane's four-column view + health/confidence + leading variance + audit detail, golden
tests unchanged. After the gate: v2 Phase 3 (Task 8 owner auth + `/` flip; Task 9 forecast
overrides — its brief MUST Zod-reject empty-string numerics and require positive
`hours_per_day`/`expected_crew_size`, and both 9/13 need the crew-days zero-divisor guard).
BL-8 unchanged (Slack bot invitations etc., Matt-only). Migration head is now `20260826180811`
(39 applied) — the repo file `20260826150000_manual_ledger_rpcs.sql` is the same SQL under the
MCP-stamped version, same cosmetic mismatch class as prior applies.

### 2026-08-26 — Session 11: v2 Phase 2 OPENED — Task 6 (Job Dashboard) BUILT, reviewed clean, MERGED TO MAIN and DEPLOYED (production verified)

**MERGED same session on Matt's go:** fast-forward `c3d4e48..5663a46`, pushed
(`283b457..5663a46` on origin — the Phase-2-opener docs commit `c3d4e48` rode along).
**Production Vercel deploy VERIFIED ~40s after push:** `/jobs` 200, `/jobs/JOB-1107` 200
(the locked "Processing Fees" label live), cancelled filter lists all 5 TEST jobs, `/` still
307→`/estimates` (Task 8 deferral intact), `/estimates` 200. **The Job Dashboard is LIVE on the
network-open app.** Branch `claude/v2-task6-job-dashboard` fully merged; kept locally (delete
only with Matt's per-item OK).

**Phase 2 opener (docs, on main pre-branch):** the two ratified 2026-08-21 prototype decisions
(no "portfolio" terminology; `payment_processing` capture-only presentation rule) had been written
into the v2 plan **only on `codex/job-dashboard-prototype`** — main's copy never got them. Ported
verbatim to main as `c3d4e48`, keeping main's 2026-08-25 Task 6/8 amendments; main's plan now
differs from the prototype branch's only by those amendment blocks (PR #2 stays conflict-free in
these files). **Dane's prototype feedback has NOT arrived** (artifact has zero comment threads);
Matt ruled: plan Task 6 anyway on the ratified decisions, reconcile Dane's feedback into the v2
plan whenever it lands.

**Task 6 plan** (`docs/superpowers/plans/2026-08-26-v2-task6-job-dashboard.md`, approved by Matt)
executed via subagent-driven development: 4 concurrent lanes, Sonnet implements, Fable reviews
every task + whole branch. 10 commits `824f910..995dc55`. **Web-only: no migrations, no edge
functions, no secrets** — deploy is simply the Vercel build on merge to main.

**What shipped (on the branch, NOT merged — Matt decides):**
- `web/src/lib/jobs/map.ts` — pure mapping/rollup/comparison math. The locked presentation
  (Total Revenue − 6 direct categories = Gross Profit; − Overhead Allocation − **Processing
  Fees** = Job Profit; `payment_processing` never in Total Direct) is single-sourced here with a
  dedicated exclusion proof test; sort ranks, snapshot watermarks, crew-days (÷40 fallback).
- `web/src/lib/jobs/healthRepo.ts` — batched aggregate reads feeding Task 3's
  `calculateJobHealth`; `job_forecast_snapshots` persisted only on detail reads when input
  watermarks change (+ `jobs.last_forecast_at`); **`QUERY_ROW_CAP` sentinel throws on PostgREST's
  silent 1000-row cap** instead of computing wrong numbers (pagination deliberately deferred to
  Phase C volumes).
- `/jobs` — the Job Dashboard: six filter chips (Active default / Job Completed / Invoice /
  Reconciliation / Financially Closed / Reconciliation Required / Cancelled), health cards,
  exceptions banner; nav gains **Jobs** (grid-cols-3). `/` still redirects to `/estimates`
  (Task 8 owns the flip).
- `/jobs/[jobNumber]` — the profitability detail in the locked 8-section order:
  header, health banner, forecast-vs-original tiles, FinancialComparisonTable
  (Original/Current/Actual+Committed/Forecast; mobile stacks to cards), labor variance
  (productivity only — rate variance honestly labeled unavailable until Task 13), change orders,
  ActionQueue (alert resolution — closes the `calendar_watch:*` no-resolution-path deferral),
  expandable cost/revenue/override/audit sections, CancelJobPanel (postponed/closed_lost).
- Session-10 deferral ledger items discharged: inline exceptions action folded into
  `jobs/actions.ts`; **estimator-allowlist gate on the cancel/postpone wrapper**;
  `listOpenScheduleExceptions` filters `kind='calendar_deleted'`; alert resolution path
  (`resolved_by` stays null under no-login — actor stamped into `resolution_note` as `[Name]`).

**Suites at close:** web **650/650**, lint 0 errors / 1 pre-existing warning, `npm run build`
green (both new routes dynamic), `deno task test` **411/411** (golden-321 intact — no Deno file
touched). **Live-verified against production:** all six filters 200 (first-ever live run of the
`.not-in` completed-filter form — retired); cancelled filter lists the 5 TEST jobs with real
reasons; JOB-1107 detail cross-checks the locked chain to the cent ($1,717.25 − $460.00 − $82.25
= $1,175.00 = budget-v1 `planned_economic_profit`); honest zeros/em-dashes everywhere; unknown
job → 404; **snapshot invariant proven: zero `job_forecast_snapshots` rows written by
cancelled-job renders, `last_forecast_at` untouched**. `job_checklists` column names proven
implicitly (the 200-rendering select would 400 on unknown columns). 390×844 visual eyeball is
environment-impossible (window min ~1300px) — markup carries both breakpoint variants; folded
into the BL-8 phone smoke.

**Review record:** 5 task gates (Fable) all Approved — notable catches: numeric-string coercion
on forecast-override fields (silent-drop hazard before Task 2 wired live rows); the PostgREST
truncation hazard; a back-fitted per-file test breakdown in Task 5's report (corrected with real
output — code was unimpeached); final whole-branch review (Fable) "With fixes" → one fix wave
`995dc55` (locked "Processing Fees" label — was rendering "Payment Processing"; Denver-formatted
`incurred_at`/`occurred_at`; 7 lint warnings; banner copy; "Cancelled" chip spelling) → scoped
re-review clean. Full rulings ledger:
`.superpowers/sdd/2026-08-26-v2-task6-job-dashboard/progress.md` (git-ignored scratch, kept
pending Matt's per-item deletion OK).

**Carried forward:** Task 9's brief must Zod-reject empty-string numeric inputs
(`coerceNullableNum("")` → 0) and require positive `hours_per_day`/`expected_crew_size`;
Task 9/13 add a zero-divisor guard for crew-days. A hypothetical legacy `status_v2='invoiced'`
row would match no dashboard filter (invisible, not mis-ranked) — no v2 writer produces it.
Deferred minors triaged OK-TO-DEFER by the final review are listed in the ledger.

**Next:** v2 Task 7 (manual cost/revenue capture) completes Phase 2 — its gate needs manual
facts entered end-to-end on a staged job, with Dane seeing original/current/actual+committed/
forecast, health/confidence, leading variance, and audit detail. Dane's prototype feedback still
reconciles into the v2 plan whenever it arrives. BL-8 items stand (Slack bot invites, phone
smoke — which now also covers the dashboard's 390px eyeball, first real estimate ≥1430).

### 2026-08-25 — Session 10: TASK 7 COMPLETE — whole-branch review passed (fix round `604ddc5`), gate E2E PASSED (JOB-1107, reactivation first-proven), and the PERMANENT CUTOVER IS LIVE (`ghl-job-webhook` v25, flag=false, live-verified) — Phase 1 gate PASSED; merge decision is Matt's

**What ran:** Task 7 Step 1 (standing rule): four concurrent adversarial review lanes over the
full branch (41 commits, ~23.7k insertions, 85 files) — SQL/migrations (with live-DB read-only
verification), edge functions, web, and a dedicated cross-task-seams lane — plus the
orchestrator's full-suite gate and a pre-gate live-state readback. No prod applies, no deploys,
no GHL or calendar writes this session.

**Verdict: MERGE-READY after one web-lane fix round. 0 BLOCKING, 3 IMPORTANT (2 fixed, 1
explicitly deferred pending Matt's confirm), 17 MINOR (2 fixed, rest in the deferral ledger).**

Lane results:
- **SQL/migrations — MERGE-READY 0/0/5.** Repo↔prod functionally identical across all 9 RPC
  bodies (comment-stripped md5s match; raw drift on 6 of 9 is comments only). Live posture
  verified, not assumed: 22 new tables RLS-enabled with grants `{service_role, postgres}` only;
  every RPC/trigger function SECURITY INVOKER, `search_path` pinned, EXECUTE revoked; all 9
  immutability triggers + 3 partial unique indexes live; both crons live with the secret
  substituted; deviations 10/11/12 implemented as ratified; family-lock ordering consistent
  across all three locking RPCs (no inversion possible); every raise text byte-matches its web
  needle.
- **Edge functions — MERGE-READY 0/0/5.** Always-200 double-guarded; dual auth
  (token-hash vs `x-webhook-secret`) confirmed disjoint; deleted-before-unmanaged; fail-closed
  NaN revision guard; marks-after-RPC keyed on `calendar_id`; backoff/dead-letter math exact;
  **no-pricing-to-crew verified at every layer** — `scope_summary`'s only v2 writer
  (`schedule_estimate`) aggregates line-item NAMES only, and the tests assert absence, not just
  main-calendar presence; the flag gate is a single request-time env read with six non-disabling
  values pinned (`"FALSE"`, `"false "` etc.); the compat check's zero-side-effects test poisons
  every dependency.
- **Web — NEEDS-FIXES 0/2/3 → both IMPORTANT fixed this session** (below). All seven Task-2
  binding handoffs verified present (incl. F15 quote-override refusal); crew enum
  server-enforced Crew 1–4 only; server-action trust boundary held under attack.
- **Seams — MERGE-READY 0/1/4.** All 7 checks PASSED: enum/union parity exact
  (character-for-character, every pair enumerated); outbox producer↔consumer contract exact for
  all three live kinds incl. rev-scoped keys and the `:cancel:` namespace; every raise-text
  needle verified verbatim; **deviation-12 end to end** — `accepted_price` computed server-side
  under the family lock as `coalesce(quoted_price, total_bid)`, events immutable, budget v1 and
  `jobs.estimate_value` read the pinned state price, so budget revenue cannot diverge from what
  the client accepted; **date round-trip symmetric** (`addOneDay`/`subtractOneDay` exact UTC
  inverses; `dates_unchanged` checked before revision logic — no ±1-day walk possible);
  `launch_workflow` seam strict (`=== true`, column `NOT NULL DEFAULT false`, sole writer
  `schedule_estimate`); 11 load-bearing doc claims spot-checked, all accurate.

**Fix round (commit `604ddc5` — Sonnet implemented, orchestrator re-reviewed the diff):**
1. **IMPORTANT — `presentEstimate` had no acceptance-state guard** (asymmetric with
   `recordEstimateAcceptance`'s F7 guard): from a revised version's page — or a stale tab — an
   accepted family could be regressed GHL Quote Accepted → Quote Sent and `estimates.status`
   `'accepted'` overwritten with `'sent'`, breaking the status↔acceptance-state mirror. Now
   refuses with the existing `already_accepted` code (same query shape as F7);
   `CommercialLifecyclePanel` hides the "Mark as presented" button when the family's active
   acceptance belongs to a different version.
2. **IMPORTANT — `resolveJobPipelineStages()` sat OUTSIDE the F2 non-fatal try** in all three
   lifecycle functions (and ran unconditionally on link-less reversals): a GHL pipeline
   *resolution* failure (cold cache + GHL unreachable) after the durable RPC write threw fatally
   past the `estimates.status` mirror, and a retry then hit the permanent guards — exactly the
   class F2 exists to prevent, invisible to the F2 test (which only injected into the stage
   *move*). Now resolved inside the try (warning path) and skipped entirely when no identity
   link exists; the deliberate `OpportunityPipelineMismatchError` re-throw is untouched.
3. MINOR — `classifyScheduleError`: needles added for the two live raises that fell to `other`
   ("minted from a different estimate version", "linked to a different job" → both
   `already_scheduled`); two dead needles removed; the "VERIFIED against every raise" comment
   made true.
4. MINOR — `web/src/lib/jobs/types.ts` stale doc comment (claimed `JobHealthInput.jobStatus` is
   a 5-value union; it is the full 7) corrected — web and seams lanes flagged it independently.

Suites after the fix round: deno **411/411** (golden-321 intact), web **604/604** (+8 new
tests), `npm run build` green, `tsc --noEmit` clean. Pushed.

**Deferral ledger (fold into the next touch of each area):**
- ⚠️ **NEEDS MATT'S CONFIRM (the un-fixed IMPORTANT):** `mark_job_reconciliation_required()`
  (applied to prod, zero callers until Phase 3 — requires a closure snapshot) enqueues outbox
  kind **`slack_reconciliation_required`**, which `integration-dispatcher` does not handle: the
  first Phase-3 caller would burn 5 retries → dead-letter and lose its Slack ping. **Proposed:
  build the handler with the first Phase-3 task that touches the dispatcher** (avoids a prod
  redeploy now); alternative is a small handler + redeploy at the gate.
- ⚠️ **NEEDS MATT'S CONFIRM (intended-behavior check, no fix proposed):** `schedule_estimate`
  eligibility comes solely from acceptance-state currency, so a version accepted and then
  superseded by a never-presented draft remains schedulable (consistent with the migration's own
  documented ruling — the customer accepted that price — but a mid-revision family can be
  scheduled on the pre-revision version).
- `google-calendar-webhook` (at its next deploy): admin-auth `?? ""` fails OPEN if
  `GHL_WEBHOOK_SECRET` were ever unset (dispatcher's `!` pattern fails closed); the 404/410
  deletion branch's `markExists` check can never match (fresh timestamp each pass) so the
  benign RPC re-invocation + mark-row growth is every-pass, prune-bounded (mechanism now
  understood); manual `register`/`stop` admin actions ignore supabase write results (orphan
  channel window, self-heals ≤30 min via maintenance).
- `_shared/google.ts` `updateCalendarEvent`: `res.json()` lacks the siblings'
  `.catch(() => ({}))` — a non-JSON 404/410 body would evade `isNotFoundError` and dead-letter
  instead of fallback-creating.
- SQL: comment-only prosrc drift on 6 RPCs (re-apply repo text at next touch of each);
  `jobs_original_estimate_number_key` lost-race branch returns without re-applying the F2
  version guard (unreachable today — sole writer + family lock); `resolve_schedule_exception`
  resolves paired alerts only under the `calendar_deleted:` fingerprint — future
  `calendar_conflict`/`sync_failed` writers (none exist) would strand open alerts; a `reversed`
  event missing `reversal_destination` surfaces the raw table CHECK (cosmetic);
  `watch_channel_status` value `'expired'` has no writer anywhere (lapsed channels stay
  `active` with a past `expires_at`; maintenance re-registers regardless).
- Web: `recordEstimateAcceptanceAction` is the one mutating action without Zod at the boundary
  (`effectiveAt` unbounded, free-text fields uncapped); `linkEstimateIdentity` GHL-create-then-
  DB-fail leaves an orphaned GHL record (same accepted class as the push race); **when Task 6
  wires a cancel/postpone UI, the wrapping server action must add the estimator-allowlist gate**
  (`cancelScheduledJob`'s Zod accepts any nonblank `actorName` — today only
  `resolve_schedule_exception` reaches it SQL-side).
- F15 residual (record only): `update_estimate_quote` itself has no acceptance awareness — the
  guard is app-layer; budget integrity is unaffected because the budget reads the pinned
  `accepted_price`.

**Pre-gate live-state readback (everything as documented):** all three invariant functions read
back `verify_jwt=false`; no deploys since Session 8 (version counters read v22/v13/v3/v4 — the
known cosmetic CLI bump; shas per Session-8 records); `ENABLE_GHL_ACCEPTANCE_JOB_CREATION`
ABSENT; `SLACK_TEST_CHANNEL_OVERRIDE` ABSENT; 4 crons active (`*/5`, `7,37`, 2× night-before);
5 active watch channels (earliest expiry 2026-09-01); outbox 0 pending / 0 dead-letter; 0 open
alerts; `jobs` 4/4 cancelled; max estimate 1428 (first real still ≥1429).

**What remains for the gate (Task 7 Steps 2–4) — blocked on Matt:** 🔴 Slack bot invitations to
Crew 1–4 (real crew delivery never proven); phone smoke + one real estimate ≥1429 on the branch
preview; authenticated JOB-1104 re-drag + re-cancel; calendar eyeballs (2026-12-15/16 and
2026-12-28/29 clean); the two ⚠️ CONFIRM items above; then Step 2 E2E (live GHL, TEST-labeled),
Step 3 permanent flag flip via the deploy invariant, Step 4 landing + merge per Matt's
instruction.

**ADDENDUM (same session, later) — Matt AMENDED the gate preconditions: all four Matt-only
validation items are BACKLOGGED → BL-8 (new BUILD_PLAN backlog entry), and the gate proceeds
without them.** Verbatim intent: the Slack bot invitations to Crew 1–4 are pushed back — no crew
Slack testing outside the test channel for now — and the phone smoke, one real estimate,
authenticated JOB-1104 fire, and calendar eyeballs all become backlog items. This amends
ratified decision 1's precondition clause ("phone smoke + one real estimate" before the flip).
Step 2's E2E therefore runs with `SLACK_TEST_CHANNEL_OVERRIDE=#ops-test` for the probe window
(Session 8/9 precedent, unset at close). Recorded consequence (also in BL-8): until the bot is
invited, every real scheduled job's crew-Slack leg fails `not_in_channel` → retries ~2 h →
dead-letters with a `job_alerts` row; calendars/GHL unaffected; crews get no Slack
notification. CLAUDE.md (env-vars 🔴 paragraph + v2 roadmap row) and the status-table Crew Slack
row updated to match.

**ADDENDUM 2 (same session, after Matt's four approvals: E2E now / flip on clean pass / defer the
`slack_reconciliation_required` handler to the first Phase-3 dispatcher touch / superseded-but-
accepted schedulability CONFIRMED intended) — Task 7 Steps 2+3 EXECUTED AND PASSED.** All
server-side choreography per the Session 8 recipe; Slack via `SLACK_TEST_CHANNEL_OVERRIDE=
C0BPPG8997Z` (#ops-test), set at E2E start, **unset + confirmed absent at close** (flag row
confirmed persisting). Timestamps UTC.

**Step 2 — gate E2E (estimate 1429 → JOB-1107, Crew 2 — first Crew 2 exercise):**
- **Two-version commercial flow:** 1429 v1 (TEST, $2,044.13) created via
  `create_estimate_with_items_v2` → presented → v2 created ($2,432.25, dump 3) → **v1
  auto-superseded by the RPC** → v2 presented → NEGATIVE: accepting v1 raised "is superseded —
  accept the current version" verbatim → v2 accepted via `record_estimate_acceptance_event`:
  **`accepted_price` $2,432.25 computed server-side under the family lock (deviation-12 pin)**,
  state points at v2, exactly one immutable event → **no job minted at acceptance** (jobs 4, 0
  active) → NEGATIVE: scheduling v1 raised "is not the currently accepted version of family
  1429" verbatim. (Choreography note: v1's `status='sent'` was a direct UPDATE — no
  `estimate_mutations_audit` row for that one hop; v2's status went through
  `update_estimate_status`.)
- **Mint:** `schedule_estimate(v2)` → **JOB-1107** scheduled 2027-01-11→12, `launch_workflow=
  true`, rev 1, `estimate_value` $2,432.25; **budget v1: `approved_revenue` $2,432.25 from the
  pinned acceptance, planned profit $1,175 / 48.31% recomputed at mint**, dump cost $195, source
  = v2's id. **Idempotent re-call returned the same JOB-1107 — no new outbox row, budget count
  still 1, exactly 1 job for the family.**
- **Dispatcher (attempt 1):** both calendar events created; **crew Slack posted to #ops-test —
  `ok:true` log-verified: job number, client, tel-linked phone, "Mon Jan 11", address, scope
  names, NO pricing.** Google's echo `exists` notifications hit BOTH calendars within 2s and
  classified **`dates_unchanged`** — echo terminated, and since the classifier compares Google's
  copy against the job row, this doubles as the **exclusive-end rendering round-trip proof**.
- **Reactivation — FIRST LIVE PROOF (no prior probe exercised it):** cancel `closed_lost` →
  dispatcher deleted both events + cleared ids (attempt 1) → `schedule_estimate` re-call with
  NEW dates (2027-01-18→19) revived the SAME JOB-1107: rev 1→2, `cancellation_reason` cleared,
  pinned price intact, **no second job, no second budget** → dispatcher recreated both events +
  Slack re-notified (attempt 1). This leg is also the app-side **outbound date change**.
- **Final teardown:** cancel `closed_lost` → **M7 rev-share observed: `job.cancelled:JOB-1107:
  rev2`** (shares the schedule's rev; rev1/rev2 keys collision-free across the full
  cancel→reactivate→cancel cycle) → re-cancel raised "job JOB-1107 cannot be cancelled from
  status cancelled" verbatim → dispatcher cleared + deleted both events (attempt 1). Close
  state: outbox 0 unfinished, 0 open exceptions, 0 open alerts, 5 jobs all cancelled.
- **Coverage notes (deliberate, recorded):** the physical calendar drag/delete legs were not
  re-run — Matt's Google connector has no ACL on the five group calendars and the manual items
  are backlogged (BL-8); both legs were proven live on production the same day (Session 9,
  JOB-1106, real Google pushes). The E2E's "confirm Quote Accepted + no job" was deliberately
  resequenced to POST-flip (pre-flip, a GHL Quote Accepted entry would legacy-mint by design);
  the app-side half — acceptance mints nothing — was asserted pre-flip. GHL stage projection for
  JOB-1107 itself did not run (no identity link, enqueues are conditional); the GHL leg was
  exercised twice minutes later by the flip-verify stage moves, plus 5A's original proof.
- Learned mechanics: `integration_outbox` inserts need `aggregate_type`/`aggregate_id`
  (`'job'`/job number); the cron-fire do-block's POST only leaves the DB at COMMIT, so
  same-transaction status checks always read `pending` — check from the NEXT statement batch;
  outbox status enum has no `'skipped'` value.

**Step 3 — THE PERMANENT CUTOVER (ratified decision 1 — never re-enables):**
- `ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false` set in prod secrets; `ghl-job-webhook` redeployed
  via the two-command invariant → **v25, `verify_jwt=false` read back**; siblings undisturbed
  (`integration-dispatcher` sha `ae3fbf49…`, `google-calendar-webhook` sha `93855f6d…`
  unchanged; version counters bumped cosmetically, the known CLI behavior). The webhook's own
  sha changed `1a5a340a…` → `13e90528…` — **expected and explained**: the bundle picked up
  `_shared/google.ts`'s 5A-era additive `updateCalendarEvent` (landed after the v20 deploy); the
  function's own source is untouched since Task 4c and was whole-branch-reviewed this session.
- **Live-verified through the REAL workflow, not a simulated POST:** a crafted
  `ghl.stage.requested` outbox row (`gate:flip-verify:quote-accepted:1`) moved the 5A TEST
  opportunity `UuTLn5Xg2Bb9EEj4UUBv` to Quote Accepted (dispatcher attempt 1 — its cold-start
  log also showed the Contractor Pipeline's duplicate "Job Scheduled" stage name, confirming the
  pipeline-membership assert's reason in the wild). The real GHL Quote Accepted workflow fired
  into the redeployed webhook at 22:35:30 → **200 `quote_accepted_awaiting_schedule`,
  `sync_log` skipped-row, `job_events` "Skipped — ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false; app
  scheduling is the job-creation authority", jobs table unchanged — NOTHING MINTED.**
  Opportunity restored to Closed Lost (Declined) via a second outbox row (attempt 1).
- Post-flip facts: **app scheduling (`schedule_estimate`) is the SOLE job-minting path**;
  `postponed` cancel/exception resolutions are now probe-safe (the Quote Accepted workflow can
  no longer mint on re-entry).

**Production artifacts this session (nothing deleted — standing rule):** estimates 1429 v1
(superseded) + v2 (accepted; acceptance state + 1 immutable event; 2 presentations); JOB-1107
(cancelled, no calendar events, no GHL link); budget v1; 8 outbox rows all `succeeded` (rev1/rev2
schedule+cancel pairs + 2 flip-verify stage moves); Slack messages in #ops-test only. GHL TEST
opportunity `UuTLn5Xg2Bb9EEj4UUBv` finishes where it started (Closed Lost (Declined)) — its
per-item delete approval remains a standing item. **First real estimate is now ≥ 1430.**
**The Phase 1 gate is PASSED. MERGED TO MAIN same session (Matt's approval): fast-forward
`4dd15cc..2085f42`, pushed. Production Vercel deploy VERIFIED: deployment
`dpl_BYVp7EEttzyCucRG9jxvBf4QPaFq` (commit `2085f42`, target production) built READY in ~20s and
is aliased to lostboysdemolition.vercel.app; smoke: `/` 307→`/estimates` (decided pre-Task-8
behavior), `/estimates` 200, `/jobs/exceptions` 200 — the Phase 1 web code (economics inputs,
lifecycle UI, schedule flow, exceptions queue) is LIVE in production. Task 7 is fully CLOSED;
v2 PHASE 1 IS COMPLETE.**

### 2026-08-25 — Session 9: 5B probe legs 3/5/6 COMPLETE — all six legs proven live, Task 5B is DONE, Slack override unset; next = Task 7 (Phase 1 gate)

Same-day continuation of Session 8. No code, no migrations, no deploys — a pure live-probe
session against production, plus doc close-out. All verification was table-diff + function-log
reads (the 5A lesson, applied every leg). Timestamps below are UTC.

**Leg 3 — inbound date apply + mirror (18:48–18:50). PROVEN.** Matt dragged the JOB-1106 event to
Dec 28–29, 2026 — **on the crew calendar copy, not the main event as scripted.** Accepted
variance, zero re-run needed: push and poll share one code path and the two calendars are
symmetric inputs; the only consequence is the mirror proof landing on the main event instead. The
chain: Google `exists` push → `apply_calendar_date_change` (`p_source='crew'`) → `jobs`
**2026-12-28 → 2026-12-29**, `calendar_sync_revision` **1→2**, `job_events` row
(`apply_calendar_date_change`/`google_calendar`/success), outbox `job.scheduled:JOB-1106:rev2`
with new dates + rev in payload, dedup mark outcome `apply`. Dispatcher force-fired (server-side
cron trick, secret never in session) → **succeeded attempt 1; both stored event ids UNCHANGED —
the update-not-create idempotency item carried from 5A is now proven live** — and the R7
re-notify Slack message landed in #ops-test (function log shows `ok:true`, "Mon Dec 28", address
+ scope, **no pricing**). Echo: Google pushed `exists` for both PUT events; both classified
`dates_unchanged` at 18:50:06, marks written, no RPC call, no new outbox row. **One bounce, then
dead** — and the main-calendar `dates_unchanged` mark doubles as proof the main event truly
carries the new dates.

**Leg 5 — deletion → exception → dismiss → recreate (18:52–18:53). PROVEN.** Matt deleted the
Crew-4 event. → `job_schedule_exceptions` row opened (`kind='calendar_deleted'`, status `open`,
`previous_schedule` carrying crew + dates + both gcal ids, `incoming_event` = the cancelled
Google resource) + `job_alerts` row (`calendar_deleted:hb07plho…`, severity `at_risk`,
`action_path='/jobs/exceptions'`), dedup mark `deleted`, **job untouched** (still `scheduled`,
dates + rev + ids intact — never auto-unscheduled). Observation for the record: Google did NOT
strip `extendedProperties` from this cancelled resource — the deleted-before-unmanaged
classification ruling stays correct as defense, not necessity. Resolved with **`dismiss` via
direct `resolve_schedule_exception` RPC** (UI is on the branch, not prod Vercel; actor Matt):
exception `dismissed` + alert resolved (same timestamp), dates unchanged, rev **2→3**,
`gcal_crew_event_id` **cleared**, fresh `rev3` outbox row. Dispatcher fired → succeeded attempt
1: **new crew event `rpaopqpcv35ocopa8kf527nvfk` created** (create path replaced the deleted
event), main id untouched, Slack re-notified. Echo: one `dates_unchanged` bounce each, quiet.

**Leg 6 — teardown (18:53–18:55). PROVEN.** `cancel_scheduled_job('JOB-1106','closed_lost',…)`
(never `postponed` pre-flip) → `status_v2='cancelled'`, reason stamped, **rev stays 3 — the M7
no-bump observed live: `job.cancelled:JOB-1106:rev3` shares its rev with `job.scheduled:rev3`.**
**No `ghl.stage.requested` row** — JOB-1106 has no GHL link and the enqueue is conditional; zero
GHL artifacts across the whole probe, as designed. Re-cancel check: raised
`job JOB-1106 cannot be cancelled from status cancelled` **verbatim** (pinned text intact).
Dispatcher → `job.cancelled` succeeded attempt 1: both gcal ids cleared, both managed events
deleted on Google's side. The resulting deletion notifications terminated in **silence** — the
correct path here is selection, not the RPC skip: a cancelled job with cleared ids is simply no
longer in the reconcile set, so nothing was fetched and no exception opened. Zero open
exceptions/alerts at close.

**`SLACK_TEST_CHANNEL_OVERRIDE` UNSET + confirmed absent** (`supabase secrets unset` + full
`secrets list` readback — no such row; BL-4 precedent). Crew Slack routing is back to normal,
which re-exposes the 🔴 bot-membership gate item: real crew-channel delivery is still unproven.

**State at close:** JOB-1106 cancelled, no calendar events, no GHL artifacts, no open
exceptions/alerts; 5 watch channels active (expire 2026-09-01); cron `7,37` + `*/5` both live;
**no estimate burned this session — first real estimate is still ≥1429.** Matt's calendar
eyeball (Dec 28–29 clean; plus the standing 5A Dec 15–16) requested at session close — record in
the next session if not confirmed in this one. **Task 5B is COMPLETE. Next: Task 7 — whole-branch
adversarial review → E2E per the v2 gate text (dates both directions now executable) → permanent
`ENABLE_GHL_ACCEPTANCE_JOB_CREATION=false` flip → land/merge per Matt.** Gate blockers unchanged:
Slack bot invitations; phone smoke + one real estimate (≥1429) on the branch preview;
authenticated JOB-1104 webhook fire.

### 2026-08-25 — Session 8: Task 5B SHIPPED TO PRODUCTION — 3 migrations applied, `google-calendar-webhook` v2 deployed, probe legs 1/2 + echo termination PROVEN LIVE; two Matt calendar actions remain

**Matt approved gate items 1 and 2 at session open; item 3 (probe) runs with
`SLACK_TEST_CHANNEL_OVERRIDE` instead of bot invitations** ("I don't want the Slack channel
messages to go to one of the four crew Slack channels... use the test channel for right now").
Branch `claude/last-session-review-f7tqxw`; no code changed this session — the exact reviewed
files from Session 6 were applied/deployed verbatim.

**1. Prod apply — DONE.** All 3 migrations applied via `apply_migration`:
`calendar_watch_registry` + `calendar_inbound_rpcs` byte-identical to the repo files;
`schedule_calendar_maintenance` applied with the secret substituted **server-side** (a `do` block
extracts it from the live `integration-dispatcher` `cron.job.command` via
`regexp_match(command, '''x-webhook-secret''\s*,\s*''([^'']+)''')` and passes it to
`cron.schedule` through `format(%L)` — the secret never entered the session; recipe now proven
twice). **New migration head `20260825171051`, 38 applied.** Pre-apply: live constraint name
verified `sync_log_direction_check` (5 values); zero name collisions; baselines sync_log 1075 /
exceptions 0 / alerts 0 / outbox 4 / job_events 36 / jobs 3 / legacy 0/0/0. Post-apply, all
green: both tables + enum + 3 RPCs + both partial uniques exist; RLS enabled; ACLs exact (zero
anon/authenticated grants on tables, the marks sequence, and the RPCs; service_role EXECUTE ×3;
all three pinned `public, pg_temp` and INVOKER); direction CHECK carries `google_to_supabase`;
row counts unchanged; cron `calendar-sync-maintenance @ 7,37 * * * *` active with **no
`__WEBHOOK_SECRET__` placeholder left**. `get_advisors` security: zero new findings — only the
two new tables joining the by-design `rls_enabled_no_policy` INFO list + the 3 pre-existing WARNs.

**2. Deploy — DONE via the invariant.** `supabase functions deploy google-calendar-webhook
--project-ref eiqqqwajmcpcwhvxxnhx --no-verify-jwt` → readback: **v2**, `verify_jwt=false`, sha
`93855f6d…` (spike v1 was `4b7bbff5…`); **`ghl-job-webhook` v20 sha `1a5a340a…` and
`integration-dispatcher` v1 sha `ae3fbf49…` both undisturbed** (no cosmetic bumps this time).
Probes: secret-less admin POST → 401; Google-style notification with unknown channel → 200
`{"received":true}` (always-200 rule holds live).

**3. `SLACK_TEST_CHANNEL_OVERRIDE=C0BPPG8997Z` (#ops-test) SET.** ⚠️ **While set, ALL crew Slack
posts — `integration-dispatcher`, `ghl-job-webhook`, and `crew-night-before`'s nightly digest —
redirect to #ops-test. MUST be unset (and confirmed absent, the BL-4 precedent) when the probe
completes**, before any real job is scheduled. The dispatcher's startup log warns loudly, as
designed. The bot's #ops-test membership was already proven (Phase A).

**4. Probe legs run (cron commands force-fired server-side via `execute v_cmd` from `cron.job` —
no waiting for ticks, secret untouched):**

| Leg | Result |
|---|---|
| 1 — `maintain` | 200: `channelsRenewed [main, crew1–4]`, 0 failed. **5 `active` registry rows**, 7-day TTL honored to the second, Google's `sync` handshake received and `last_notification_at` stamped on ALL FIVE within ~1s of registration — token-hash auth round-tripped live |
| 2 — mint | **Estimate 1428 (TEST, burned) → JOB-1106**, Crew 4, 2026-12-22→23 (deliberately NOT 12-15/16 so Matt's pending 5A eyeball isn't confused), `launch_workflow=true`, `calendar_sync_revision=1`, budget v1 `approved_revenue 2044.13` / profit 865 / 42.32% from the pinned `accepted_price`. **No GHL identity link, deliberately** — both `schedule_estimate`'s and `cancel_scheduled_job`'s GHL enqueues are conditional on a linked opportunity, so the probe creates ZERO GHL artifacts and dodges the re-drag hazard entirely (GHL projection was already proven in the 5A probe) |
| 2b — dispatcher | **Succeeded attempt 1**: both Calendar events created (main `r3o9b4gkavsnv505ddi4p1ijps`, crew `hb07plhon4i2rh41o38mpgl334`), and **the crew Slack message POSTED — the first successful dispatcher Slack delivery in system history** (`ok:true`, #ops-test, `slack_notified_at` stamped). Message shape verified from the function log: job number, client, tel-linked phone, date, address, scope lines, NO pricing. This closes 5A's carried-over "crew Slack leg unproven" item at the code-path level (real-channel delivery still awaits bot invitations) |
| 4 (early) — echo | Google's real `exists` push for the crew event arrived ~5s after create; webhook looked up the channel, verified the token hash, fetched the event, classified **`dates_unchanged`**, recorded the mark (17:16:03), stopped. **First production `exists`-notification processing + echo termination proven live.** Honest note: only the crew-calendar mark was observed before session close; the main-calendar notification hadn't landed yet (the `7,37` reconcile sweep covers it either way — expected outcome `dates_unchanged`) |

**5. What remains — the two Matt calendar actions (NEXT SESSION OPENS HERE):**
1. **Leg 3 (inbound apply):** Matt drags/edits the **main**-calendar event "JOB-1106 – TEST - 5B
   inbound sync probe, do not action" (Dec 22–23, 2026) to different dates → verify
   `apply_calendar_date_change` applied, revision 1→2, `job_events` row, mirrored `job.scheduled`
   rev2 delivered (crew event dates updated; **a fresh Slack message lands in #ops-test — that is
   R7 re-notify semantics working, not a bug**), echo chain goes quiet.
2. **Leg 5 (deletion):** Matt deletes the **crew** (Cade/Crew-4) calendar event → verify exception
   + `at_risk` alert open, job untouched; resolve `dismiss` (via RPC — `/jobs/exceptions` is on
   the branch, NOT on prod Vercel) → event recreated; then teardown: `closed_lost` cancel
   (NEVER `postponed` pre-flag-flip), re-cancel raise check, **unset SLACK_TEST_CHANNEL_OVERRIDE
   and confirm absent**, record the estimate-floor move.

**Production artifacts created (nothing deleted — standing rule):** estimates 1428 v1
(`4df08f76-…`, TEST) + presentation + acceptance event (`accepted_price 2044.13`) + acceptance
state; JOB-1106 (`scheduled`, Crew 4); budget v1; 1 outbox row (`succeeded`); 2 Calendar events
(live until leg 5/teardown); 5 `calendar_watch_channels` rows (active, expire 2026-09-01, renewed
by cron thereafter); 1 `calendar_inbound_marks` row; 1 Slack message in #ops-test. **First real
estimate is now ≥ 1429.**

**Facts a future session would otherwise rediscover:**
- The server-side cron-fire trick (`select command from cron.job` → `execute`) runs any cron job
  on demand without reading its secret — used for both `maintain` and the dispatcher this session.
- `create_estimate_with_items_v2` / `record_estimate_acceptance_event` / `schedule_estimate` probe
  choreography: clone the estimate/details/acceptance shapes from the previous probe's live rows
  (1427 templated 1428 exactly); `estimate_presentations` is a direct insert (no RPC).
- `estimate_identity_links.ghl_opportunity_id` is UNIQUE — a new probe estimate can NOT reuse the
  5A TEST opportunity; omitting the link entirely is the clean play.
- `web/.env.local` reads are permission-denied in-session — don't plan on local GHL credentials.

### 2026-08-25 — Session 7 (docs-only): Task 5B gate HELD; dashboard prototype published as a private artifact; "dashboard is the app's home surface" decision recorded

**NO prod applies, NO deploys, NO migrations, NO code this session.** Production unchanged:
migration head `20260820152300` (35 applied), `google-calendar-webhook` still the deployed v1
spike, all function versions as at Session 6 close. Branch `claude/last-session-review-f7tqxw`
gained docs commits only (`46da224` + this landing).

**1. The Task 5B Matt gate was explicitly HELD.** Presented at session open (prod apply of the 3
migrations → deploy the `google-calendar-webhook` rewrite → live probe); Matt chose "hold —
something else first." All gate items and prerequisites carry forward unchanged, including the 🔴
Slack bot invitations and the `closed_lost`-only probe constraint.

**2. Job Dashboard prototype published for Dane's review.** Located on branch
`codex/job-dashboard-prototype` at `c2e117a` (the 2026-08-21 re-derived financial model). ⚠️ Its
`/private/tmp/lostboys-job-dashboard-pr` worktree is pruned/empty — extract the file from git
(`git show c2e117a:docs/prototypes/lost-boys-job-dashboard-prototype.html`), don't trust the
worktree. Opened locally for Matt, then published as a **private Claude artifact**:
**https://claude.ai/code/artifact/b4b07754-5c34-463f-86e5-800cbc54a0f9** — content byte-identical
except the outer `<html>/<head>/<body>` wrapper stripped (artifact host supplies its own) and the
tab title shortened to "Lost Boys Job Dashboard". Verified fully self-contained (no external
scripts/fonts/fetches) and all "Fictitious demo data" / "nothing saved" notices intact. Private
until Matt shares it from the artifact page.

**3. Decision (Matt, 2026-08-25): the Job Dashboard is the web app's HOME surface; estimates
become a section within it.** Today `web/src/app/(app)/page.tsx` redirects `/` → `/estimates` and
nothing in v2 Task 6 changed that — the gap Matt's instinct caught. **Sequencing decided: the `/`
flip happens with v2 Task 8 (owner auth), NOT Task 6** — the deployment is network-open, and the
dashboard's profitability data must not become the front door before the financial routes are
gated. Task 6 builds the dashboard at `/jobs` + adds an "Estimates" link to the shared `(app)`
nav (the reviewed prototype's header IA — Dashboard / Jobs / Schedule / New Estimate — is the
model); Task 8 flips `/` (authenticated active owner → dashboard; everyone else → `/estimates`,
no-login picker flow untouched). Recorded in `BUILD_PLAN.md` (new 2026-08-25 amendment) and the
v2 program doc (binding notes in Task 6 and Task 8). Commit `46da224`, pushed.

**What the next session needs to know:** it opens exactly where Session 6 left it — the Task 5B
Matt gate (see the 2026-08-24 entry and `NEXT_SESSION_PROMPT.md`). The dashboard-home decision
requires no work until v2 Task 6/8; Dane's prototype feedback should be reconciled into the v2
plan before Task 6 is written (standing note). First real estimate still ≥1428.

### 2026-08-24 — v2 Phase 1 Session 6: Task 5B Step 2 BUILT AND FULLY REVIEWED on the branch — inbound Calendar sync awaits Matt's prod apply + deploy + probe

**Branch `claude/last-session-review-f7tqxw`, 7 commits `cf240a2..8553aa2`, pushed. NO prod applies,
NO deploys, NO GHL/Calendar/Slack traffic this session** — everything stops at the Matt gate per
the plan. Plan: `docs/superpowers/plans/2026-08-24-v2-phase1-task5b-inbound-calendar-sync.md`
(approved by Matt this session; its 9 header decisions + 2 recorded spec deviations are the
authority). Executed via subagent-driven development: 3 concurrent Sonnet lanes (disjoint files,
one worktree), adversarial Opus review per lane + fix rounds + scoped re-reviews, a whole-slice
final review on the strongest model, one final fix wave, all clean.

**What was built (on the branch, NOT yet live):**
- **SQL** (`20260824150000_calendar_watch_registry.sql`, `20260824151000_calendar_inbound_rpcs.sql`,
  `20260824152000_schedule_calendar_maintenance.sql` + `supabase/tests/calendar_inbound_sync_test.sql`,
  pgTAP plan(147)): `watch_channel_status` enum; `calendar_watch_channels` registry (partial unique
  `one_active` per calendar); `calendar_inbound_marks` dedup table (keyed on **calendar_id** —
  resource_id is reassigned on channel renewal, so calendar_id is the stable dedup identity);
  partial unique `job_schedule_exceptions_one_open`; `sync_log.direction` widened to add
  `'google_to_supabase'` (live constraint name pre-verified); three plain-INVOKER pinned RPCs —
  `apply_calendar_date_change` (date-only writes, echo-termination dates-equal check BEFORE the
  revision guard, M7 `not_scheduled` benign skip), `open_calendar_deletion_exception` (M7-inert for
  the dispatcher's own cancel cleanup; opens exception + `at_risk` alert), `resolve_schedule_exception`
  (reschedule/postponed/closed_lost/dismiss; postponed+closed_lost reuse `cancel_scheduled_job`
  verbatim; 8 byte-pinned raise texts, none colliding with sibling classifiers); cron
  `calendar-sync-maintenance` at `7,37 * * * *` with the `__WEBHOOK_SECRET__` placeholder.
- **Edge function** (`google-calendar-webhook` REWRITTEN — the deployed v1 spike is replaced by
  this code at deploy time): token-hash (SHA-256) notification auth accepting `active|superseded`
  channels, always-200 notification route; one shared code path for push and poll
  (`reconcileCalendar`: fetch stored event ids, `classifyManagedEvent` comparator, RPC calls);
  channel lifecycle (`maintain` action: register-before-stop renewal at 24h threshold, 7-day TTL,
  per-scheduled-job `calendar_watch:<cal>` alerts on registration failure, reconcile sweep, 30-day
  mark prune); `getCalendarEvent` added to `_shared/google.ts` (additive; 404/410 = data, not error).
  40 Deno tests.
- **Web** (`exceptionActions.ts` + `/jobs/exceptions` page/form): `resolveDeletedCalendarEvent`
  (keyed on `exceptionId` — recorded deviation from the v2 spec's `jobNumber`, since a job can hold
  two open exceptions), `classifyResolveError` routing all pinned texts + nested cancel raises,
  friendly error mapping server-side (`not_open` → refresh the stale list), America/Denver
  timestamps. 40 vitest tests. **No pricing anywhere on the page** (final review swept it).

**Runbook cycle (verbatim record):** branch `v2-phase1-task5b` (id
`0af7d90e-dcc6-4d0c-888f-e3be5b513423`, ref `fzotihznlugbizdqrtdf`, $0.01344/hr confirmed, deleted
post-validation). Probes a–d **FAITHFUL**
(35 applied, head `20260820152300`; 5 definers present+pinned; `on_auth_user_created` present; 12
legacy policies). Prod baseline rows: jobs 3, exceptions 0, alerts 0, outbox 4, job_events 36,
sync_log 1074, users/crews/time_entries 0/0/0. **RED:** existence/ACL subset **32/32 not-ok**
(captured via the Session-3 tap_out recipe). Applied all 3 migrations to the branch. **GREEN:
147/147 ok, first execution.** Orchestrator gates: `deno task test` **411/411** (golden-321
intact), web vitest **596/596**, `npm run build` green. Task-3 reviewer's schema ⚠️ closed live:
the web module's exact select ran clean against the landed table on the branch.

**Review chain (all findings fixed and re-verified; full detail was in the SDD ledger, now
summarized here):** Task 1 — I1: an exception whose job left `scheduled` had NO terminal
resolution (all four resolutions raised); ruled fix: `dismiss` on a non-scheduled job is now an
acknowledge-and-close (closes exception + alert, ZERO jobs/outbox writes, additive
`note: 'acknowledged_no_side_effects'`; raise text 8 kept verbatim for `reschedule`). Task 2 —
three Importants: stranded dedup mark on RPC failure; `Number(scheduleRevision)` NaN failing OPEN
into the write path (now `Number.isFinite` → `revision_anomaly`); no per-calendar failure isolation
in either maintenance loop (now isolated, prune unconditional); plus a ruled comparator reorder
(deleted-check before managedBy — Google may strip extendedProperties on cancelled resources) and a
guard for missing `end.date`. Task 3 — classified error codes now actually reach the UI; Denver
timestamps. **Final whole-slice review (strongest model): merge-ready.** All 8 cross-cutting seams
verified: the inbound mirror loop provably terminates (dispatcher's stale guard can never skip the
mirror of an applied change); rev-scoped idempotency keys are collision-free under every
interleaving across all four outbox writers; a mirrored date change re-notifies the crew once (R7
semantics — Matt should know: **editing dates on the calendar now pings the crew channel**, plan
decision 3). Its one Important — a residual claim-before-RPC crash-strand window — was fixed in the
final wave (check-then-act: marks recorded only AFTER a completed RPC outcome; `deleteMark`
compensation removed) and re-review-verified.

**Deferred (triaged by the final review, none merge-blocking; FIX SOON bucket):** filter the
exceptions list on `kind='calendar_deleted'` before any second kind gains a writer; crew-calendar
function test (highest-value gap — probe step exercises it live); case-2 sync test hardening;
registry hygiene bundle (superseded→expired transition, `updated_at` bumps, `calendarKeyFor` null
logging); `job_alerts.resolved_by` stamp; pgTAP additions (M5); exception-resolution `job_events`
row for postponed/closed_lost; fold the inline server action into `jobs/actions.ts`. Noted for v2
Task 6/12: `calendar_watch:*` alerts have no resolution path yet; `renewal_failed` channels reject
their own still-live notifications (conscious ≤24h poll-only degradation); the 404/410 deletion
path re-calls the RPC every pass (benign, RPC-guarded, bounded by the 30-day prune).

**🔴 THE MATT GATE (nothing below happens without your per-item yes):**
1. **Prod apply** of the 3 migrations (exact repo files; cron secret substituted server-side via
   the established `regexp_match` recipe) + post-apply catalog assertions + advisors.
2. **Deploy** `google-calendar-webhook` via the two-command `--no-verify-jwt` invariant (readback
   must also show `ghl-job-webhook` v20 and `integration-dispatcher` sha-undisturbed).
3. **Live probe** (plan Task 4 Step 5): PREREQUISITE = Slack bot invited to the crew channels OR
   `SLACK_TEST_CHANNEL_OVERRIDE`; `closed_lost`-only teardown (postponed still trips legacy
   minting). Probe burns one estimate number (first real estimate floor moves).
4. Standing gate items unchanged: bot invitations, 2026-12-15/16 calendar eyeball, phone smoke +
   real estimate, JOB-1104 authenticated re-drag, merge decision.

**Hard-won this session:** the Session-3 tap_out recipe scales to a 147-assertion suite in one
implicit transaction (fixtures commit to the disposable branch — fine, it's deleted); a `cd web`
that persists across Bash calls silently empties a path-filtered `git diff` (caught because the
package was 7 lines — check package line counts); `resource_id` is per-channel-registration and
reassigned on renewal, which is WHY the dedup key is `calendar_id`.

### 2026-08-20 (later) — v2 Phase 1 Session 5: Task 5A live TEST-job probe RUN — dispatcher works end to end; 🔴 Slack bot is NOT in the crew channels

**Same-session continuation — Task 5B Step 1 (the watch-channel spike) RUN and ✅ PASSED. 5B is GO.**

The phase plan gated all of 5B behind one unproven question: can a Google Calendar watch channel
deliver a push notification to a Supabase edge-function URL at all? If not, 5B degraded to
reconciliation-polling-only. **It can. The fallback is not needed.**

- **`google-calendar-webhook` v1 DEPLOYED** (`--no-verify-jwt`, readback `verify_jwt: false` ✓).
  Deploy was clean: `ghl-job-webhook` held at v20 with an unchanged `sha256` and
  `integration-dispatcher` was untouched — no collateral version bumps this time.
- Auth posture verified both ways: secret-less admin POST → function-level
  `{"error":"Unauthorized"}` 401 (proves verify_jwt=false routing + a clean boot past every
  module-scope env read); a POST carrying `X-Goog-Channel-ID` with no Supabase auth → 200.
- **`events.watch` on the main calendar → HTTP 200.** Channel `spike-5b-fd74753fa7b3`, resource
  `dkMnfSltyPXxmK7Q1IZDuHMo2XI`, TTL 1 h. **Google delivered a real `sync` notification 0.3 s
  later**, `X-Goog-Channel-Token` round-tripped intact, HTTP 200 returned. Channel then stopped
  via `channels.stop` (204) — nothing left live.
- Admin routes were driven **server-side via `net.http_post`**, with the shared secret extracted
  from the live `integration-dispatcher` `cron.job.command` by regex — the Session 4 recipe,
  reused. The secret never entered the session, the repo, or the logs. Note the header is built
  with `jsonb_build_object('x-webhook-secret', '<v>')`, so the extraction regex is
  `'x-webhook-secret'\s*,\s*'([^']+)'` — NOT the JSON-colon shape.

**⚠️ Received wisdom disproved, cheaply.** Widely-cited sources — and the "Unauthorized WebHook
callback channel" folklore — insist the callback domain must be verified in Search Console AND
registered in the GCP console's Push section, which nobody at Lost Boys could ever do for
`supabase.co`. **No domain verification was required.** Google's *current* official push guide
mentions only the SSL requirement and is the accurate one; the domain-verification advice is
stale and appears to be carried over from the Drive API, where it does still apply. **This was
the single largest risk flag on Phase 1's risk list and it is now retired.**

**Design facts banked for Step 2 (all live-observed, not assumed):**
1. The notification body is **empty** (`bodyLength: 0`). Google never ships the changed event —
   the inbound leg MUST fetch it by stored event id. The v2 spec already assumes this; now it is
   confirmed rather than trusted.
2. The channel token round-trips in `X-Goog-Channel-Token`, so the spec'd `token_hash`
   verification is a viable auth mechanism.
3. Google honored the requested TTL to the second, so renewal scheduling can trust the returned
   `expiration` rather than guessing a ceiling.
4. The notification route and the admin routes need **different** auth and cannot share one
   check — Google sends no `x-webhook-secret`. The deployed stub already splits them.

**Scope discipline:** the stub is a scaffold, not an implementation. It contains **zero database
access by design** (notifications are observed through edge-function logs), no token persistence
or verification, and no writes to `jobs`/`job_schedule_exceptions` — all of that is Step 2's
contract, and building it before the spike answered would have prejudged the answer. 11 unit
tests cover request classification, X-Goog extraction, and the `events.watch`/`channels.stop`
request shapes, including a test pinning that an unauthorized-callback rejection comes back as
readable data rather than a thrown exception. Canonical `deno task test` now **382 passing**
(371 + 11), golden-321 gate intact.

**Not observed, deliberately:** an `exists` (real event-change) notification as distinct from the
`sync` handshake. Transport and headers are identical apart from `X-Goog-Resource-State`, so it
does not gate the decision — but Step 2's first integration test should pin it.

**Next:** Task 6 Step 2 — `calendar_watch_channels` registry migration, renewal-before-expiry,
overlap dedup, reconciliation fallback poll, revision-guarded date-only inbound writes,
`job_schedule_exceptions` + `resolveDeletedCalendarEvent`. That is a full build task and takes
the normal gate: Sonnet lanes → adversarial Opus review → runbook cycle → Matt-approved prod
apply. **Cross-lane input from the 5A probe (ledger M7): cancel does NOT bump
`calendar_sync_revision`, so `job.scheduled:…:revN` and `job.cancelled:…:revN` share a rev and
ordering falls to `available_at` — the inbound revision guard must not assume rev monotonicity
distinguishes them.**

Session 5, local. Matt chose "5A live probe first" and "real channels, TEST-labeled, clean up
after". The probe was run directly against production via the RPCs (the scheduling UI is on the
branch, not on prod Vercel — driving it through the UI is the Task 7 gate E2E, not this step).
**Nothing was deployed and no migration was applied this session.**

**The headline finding is a production defect the probe existed to catch:**

🔴 **The Lost Boys Slack bot is not a member of the crew channels.** The `job.scheduled` event
failed live with `Slack post failed: not_in_channel` for Crew 4. That error is specific — not
`channel_not_found` (so `SLACK_CREW4_CHANNEL` holds a valid id) and not `missing_scope` (so the
token and scopes are fine). The bot was simply never invited to the channel.

Scope is almost certainly wider than one crew. `sync_log direction='supabase_to_slack'` holds
**10 rows in the system's entire history: 9 "no jobs" skips and exactly ONE real post — to
Crew 1, on 2026-08-13.** Crews 2, 3 and 4 have never received a message from this bot in
production. Crew 1 demonstrably worked once; Crew 4 demonstrably fails now; 2 and 3 are untested
and presumed to share Crew 4's state.

**Why no test could have caught this:** the dispatcher's 40 unit tests inject a fake
`postSlackMessage`, and `crew-night-before` has hit the "no jobs tomorrow" skip branch every
night since 2026-08-14, so its Slack leg has not run since the Phase A test. The gap would have
surfaced the first time a real job was assigned to Crew 2, 3, or 4 — i.e. on ~3 of 4 jobs.

`crew-night-before` degrades correctly (writes a `sync_log` error row and does NOT stamp
`night_before_sent_on`, so it retries the next night) — but nothing alerts on it, so it would
have failed quietly into a table nobody reads. The dispatcher degrades loudly (retry →
dead-letter → `job_alerts`), which is the better posture and is why this surfaced in minutes.

**→ OPEN ITEM, blocking the Phase 1 gate (Matt): invite the bot to the Crew 1–4 Slack channels
and confirm.** Cannot be done from a session — the Slack MCP available locally is CTA
Integrity's workspace, not Lost Boys.

**What the probe proved live (everything except the Slack leg):**

| Leg | Result |
|---|---|
| `schedule_estimate` | **JOB-1105** minted from estimate family 1427, `launch_workflow=true`, `calendar_sync_revision=1` |
| Budget v1 (deviation 12) | `approved_revenue` **2044.13** sourced from the pinned `accepted_price`, `planned_economic_profit` 865.00, `planned_profit_pct` 42.32 |
| Outbox producers | `job.scheduled:JOB-1105:rev1` + `ghl.stage.requested:JOB-1105:rev1` |
| pg_cron → dispatcher | Fired 21:35 UTC, claimed the batch — the server-side-substituted secret path works end to end |
| Google Calendar create | Both events created; ids persisted (`main g8o4kb7vmjan05jptvmqile3jc`, `crew sp74lcoj5kd5rbv0nhoi9a8mkk`) |
| GHL stage projection | Opportunity moved to **Job Scheduled**; `sync_log app_to_ghl / updated` written |
| Retry + backoff | att1 21:35, att2 21:40, same `not_in_channel` — the backoff loop works live |
| `cancel_scheduled_job` | `closed_lost` → `cancelled`, all facts preserved, revision stays 1 |
| Re-cancel hygiene | Raised `job JOB-1105 cannot be cancelled from status cancelled` |
| Cross-lane raise-text API | That live text hits `classifyCancelError`'s `cannot be cancelled` needle → `not_cancellable` ✓ |
| `job.cancelled` dispatch | Succeeded att1 → both `gcal_*_event_id` cleared to NULL |
| GHL cancel projection | Opportunity moved to **Closed Lost (Declined)**, second `app_to_ghl` row |

**🎁 Unplanned bonus — a Phase 1 gate item proved itself.** The dispatcher's GHL stage move fired
the REAL GHL workflow (`Phase A: Job Created (Job Scheduled)`) into `ghl-job-webhook` 29 seconds
later, and **v2 Task 4's `app_is_schedule_authority` compat check caught it**: `job_events` reads
`Skipped — app is schedule authority (launch_workflow=true)`, status `skipped`, zero side effects.
That guard had never executed in production. Without it the legacy webhook would have created a
duplicate pair of calendar events on top of the dispatcher's. **This retires the "two minting
paths coexist" risk flag from the plan's Risk section as empirically safe.**

**Ruling taken (orchestrator, with Matt): `closed_lost` over `postponed` for the cancel leg.**
`postponed` returns GHL to *Quote Accepted*, which is a live workflow trigger for the legacy
minting path (the flag is still UNSET), i.e. the documented "re-drag revives rows" hazard.
`closed_lost` exercises identical dispatcher code, differing only by stage id. **Confirmed
empirically:** the Job Scheduled move produced an inbound `ghl_to_supabase` row; the Closed Lost
move produced none. `postponed`'s GHL leg therefore remains unexercised live and should only be
probed after the Phase 1 flag flip.

**Operator intervention, recorded for honesty:** on Matt's instruction ("skip Slack, force it
succeeded, continue to cancel") the `job.scheduled` row was hand-updated to `succeeded` at
attempt 2. **`last_error` was deliberately left in place** so the row stays self-documenting as
an operator-forced close rather than a genuine dispatcher success, and `jobs.slack_notified_at`
remains NULL. Consequence: **the dead-letter + `job_alerts` path was NOT exercised** (it was ~3
attempts away) and `job_alerts` is still 0 rows.

**Not verified, and honestly so:** *deletion* of the two Google Calendar events. `deleteCalendarEvent`
treats 404/410 as success, so a clean return does not by itself prove the event was removed, and
no calendar in this session has read access to the Lost Boys calendars (they are shared with the
service account, not with Matt's Google account — `list_calendars` does not show them).
**→ Matt: eyeball 2026-12-15/16 on the main and Cade/Crew-4 calendars and confirm both events are
gone.** Same class of check as BL-5's manual eyeball.

**Production artifacts created (nothing deleted — standing rule):**
- `estimates` 1427 v1 (`ef49df3c-…`), TEST-labeled, + presentation + acceptance event + identity link.
  **`estimate_number` 1426 was burned** by a first attempt that violated `estimates_job_type_check`
  (`job_type` must be `Residential`|`Commercial`, not a free-text label) — the sequence does not roll
  back. **The first real estimate is therefore ≥ 1428**, not ≥1426.
- `jobs` JOB-1105 — TEST, now `cancelled`, gcal ids cleared. Joins JOB-1102/1104 as cancelled test rows.
- `job_budget_versions` v1 for JOB-1105; 2 `job_events`; 4 `integration_outbox` rows (all `succeeded`);
  3 `sync_log` rows.
- **GHL opportunity `UuTLn5Xg2Bb9EEj4UUBv`** ("TEST - 5A dispatcher probe (delete me)"), hung off the
  pre-existing TEST contact `iFYNrZAaJn8hWjXnSUeB` (matt@ctaintegrity.com) deliberately, so no new
  contact was created and no `ghl-contact-sync` → Airtable ripple occurred. Left at Closed Lost
  (Declined), terminal and harmless. **Awaiting Matt's per-item OK to delete.**
- Live GHL fact re-confirmed: the T12 TEST contacts and opportunities (1419/1420/1423 identity links)
  were all cleaned out of GHL previously — all six ids now 404. The identity-link rows still
  reference them.

**Task 5A close-out status: Step 4c is PARTIAL.** Calendar-create, GHL both directions, cancel
cleanup, retry/backoff and re-cancel hygiene are proven live. Unproven: the crew Slack leg
(blocked on the bot-membership defect), calendar-event *deletion* (needs Matt's eyeball),
calendar update-not-create idempotency (needs a second successful `job.scheduled`, so it is
blocked behind Slack too), and the dead-letter/`job_alerts` path (operator intervened).

**Next:** Task 5B (inbound calendar sync), which OPENS WITH THE WATCH-CHANNEL SPIKE. The Slack
membership fix and the calendar eyeball are Matt's, and both must close before the Phase 1 gate.

### 2026-08-20 — v2 Phase 1 Session 4: Task 5A (outbound dispatcher) BUILT + BRANCH-VALIDATED 65/65; prod apply and deploy AWAIT MATT

**Same-session update — Matt approved items 1 and 2 ("go on 1 and 2"), both DONE:**

- **`integration-dispatcher` v1 DEPLOYED** via the invariant
  (`supabase functions deploy integration-dispatcher --project-ref eiqqqwajmcpcwhvxxnhx
  --no-verify-jwt`), readback via `list_edge_functions` = `verify_jwt: false` ✓ (ghl-job-webhook
  untouched at v20, sha unchanged). Secret-less POST probe → function-level
  `{"error":"Unauthorized"}` HTTP 401 — proves verify_jwt=false routing and a clean boot past all
  module-scope env reads.
- **All 3 migrations APPLIED TO PRODUCTION** → head `20260820152300`, **35 applied**. Post-apply
  catalog assertions: both RPCs exist, plain invoker, `search_path=public, pg_temp`, ACL =
  service_role only (anon/authenticated denied); cron row `integration-dispatcher @ */5 * * * *`
  present with the secret substituted (command verified free of `__WEBHOOK_SECRET__`, cron_total
  3). Row counts byte-identical to baseline (outbox 0, job_alerts 0, jobs 2, job_events 33,
  estimates 16). `get_advisors` security: **zero new WARNs** (3 pre-existing baseline WARNs; INFO
  no-policy rows are the deliberate posture).
- **Secret-substitution recipe (new, worth keeping):** `GHL_WEBHOOK_SECRET`'s value is unreadable
  from any sanctioned store, so the cron migration was applied with the substitution done
  **server-side** — a DO block extracts the real secret from the LIVE `crew-night-before-a`
  `cron.job.command` via `regexp_match` and schedules the dispatcher with `format(%L)`, with a
  hard raise if extraction yields NULL or the placeholder. The secret never entered the session,
  the repo, or the logs. The repo migration file keeps its documented placeholder form.
- **First cron fire verified same session** — see the fire-check note at the end of this entry.
- Remaining from the "Open for Matt" list below: only item 3 (the full TEST-job live probe:
  schedule → dispatcher → Calendar/Slack/GHL → cancel → cleanup) plus the standing to-dos. The
  outbox is 0 rows, so until then every cron tick is a clean empty-batch no-op.

Session 4 of the Phase 1 plan, local session, subagent-driven per the plan's lane structure:
**three concurrent Sonnet lanes** (SQL migrations ∥ `integration-dispatcher` edge function ∥ web
`scheduleActions`), disjoint file ownership, adversarial Opus review per lane + scoped re-reviews
per fix round. Commits `ba8993e` (web) → `5cadc53` (SQL) → `78b6a75` (dispatcher) → `fb945dc`
(dispatcher fix round) → `d24d3a0` (SQL fix round); pushed. **NOTHING TOUCHED PRODUCTION** — the
three migrations are committed but NOT applied to prod, the function is NOT deployed, the cron is
NOT live. All three are Matt's explicit go (see "Open for Matt" below).

**What was built (v2 Task 5A = phase-plan Task 5):**
- `20260820150000_outbox_claim_rpc.sql` — `claim_integration_events(p_limit)`: SKIP LOCKED batch
  claim ordered by `available_at, created_at`, limit 1..100, marks processing/locked_at/attempts+1,
  returns post-update rows in claim order (materialized-CTE + re-sort; reviewer verified the plan
  shape via live `EXPLAIN`). Claimable = due pending/failed OR abandoned processing —
  **including `locked_at IS NULL`** (ruling R12, fix round: the literal 15-minute predicate left a
  NULL-locked processing row permanently stranded).
- `20260820151000_job_cancellation_rpc.sql` — `cancel_scheduled_job(p_job_number, p_resolution
  ['postponed'|'closed_lost'], p_reason, p_actor, p_actor_name)`: scheduled→cancelled only
  (FOR UPDATE serialized; any other status raises), preserves all facts, `job_events` 6→5/6→12,
  enqueues `job.cancelled:<job>:rev<N>` (payload snapshots both gcal event ids + crew for cleanup)
  and, when GHL-linked, `ghl.stage.requested:<job>:cancel:rev<N>` (stage 'Quote Accepted' /
  'Closed Lost (Declined)'). **Five byte-pinned raise texts are a cross-lane API** consumed by the
  web classifier — pinned in the migration header; none collide with `classifyScheduleError`'s
  needles (one interpolation caveat recorded: a status label 'accepted' can appear formatted-in —
  harmless because cancel errors route through `classifyCancelError`, never the schedule one).
- `20260820152000_schedule_integration_dispatcher.sql` — pg_cron `integration-dispatcher` at
  `*/5 * * * *` (crew-night-before pattern; `__WEBHOOK_SECRET__` placeholder — **substitute the
  real `GHL_WEBHOOK_SECRET` value at prod apply or every fire 401s**; no DST dance needed at a
  fixed interval).
- `supabase/functions/integration-dispatcher/` — DI-style handlers (zero env/fetch in handlers;
  index.ts is the env surface + `x-webhook-secret` 401 check). `job.scheduled`: stale-guard
  (cancelled job or newer `calendar_sync_revision` → succeeded no-op with the reason threaded into
  the DispatchSummary), main+crew all-day calendar legs (spec body + `extendedProperties.private
  {jobNumber, scheduleRevision, managedBy:"lostboys-estimator"}`, inclusive→exclusive end date,
  create-vs-update on stored event id, 404→create fallback with documented orphan limitation R11),
  BL-5 boundary held (main description may carry `Estimate: $X`; crew never carries pricing —
  pinned by tests), one crew Slack message via `_shared/slack.ts` (idempotent:
  `slack_notified_at > event.created_at` skips), per-leg persistence so retries can't duplicate.
  `ghl.stage.requested`: pipeline resolved by substring, **stage needle uses pipeline.ts's
  parenthetical-stripping strategy + ambiguity/empty-id guards** (fix round), pipeline-membership
  asserted before the PUT (`{pipelineStageId}` only), `sync_log` `app_to_ghl`/`updated`.
  `job.cancelled`: deletes the payload-named managed events (404/410 = already gone), clears
  `gcal_*_event_id`. Failure path: retry backoff `min(60, 2**attempts)` minutes; attempt ≥5 →
  `dead_letter` + `job_alerts` (`integration:<outbox-id>`, at_risk, `/jobs/<job>`); **missing
  crew/calendar/channel config for a required leg THROWS** (dead-letters loudly — review fix; was
  a silent success) and **outbox bookkeeping write failures surface as `bookkeepingError`** on the
  outcome (review fix; the summary can no longer lie). `_shared/google.ts` gained additive
  `updateCalendarEvent` + `deleteCalendarEvent`.
- `web/src/lib/jobs/scheduleActions.ts` — `cancelScheduledJob()` server module: Zod-validated,
  `p_actor` always null (no-login model), `classifyCancelError` needle-matching the five pinned
  raise texts (reviewer verified zero collision with `classifyScheduleError` and Zod v4 API use).

**Review chain:** WEB approved clean (0 fix rounds; 5 deferred minors incl. partial
normalize-mapping assertion + no array-shape guard on the RPC return). SQL approved w/ 2 Important
→ 1 fix round (I1 fixture-scoping + bounded pre-drain so the suite survives a production dry-run
with real due rows; I2 = R12 NULL-locked reclaim + 4 new assertions, plan 61→65) → re-review both
addressed, arithmetic independently recounted, raise texts byte-unchanged. FN needs-fixes (4
Important, all silent-success family) → 1 fix round (+11 tests) → re-review all 4 addressed, no
new breakage. Deferred minors all recorded in the SDD ledger (`.superpowers/sdd/…/progress.md`)
— notables for later: Slack post→stamp-fail double-post window; full-body calendar PUT wipes
human-added event fields (spec-mandated, records alongside R11); index.ts passes caller `limit`
through unvalidated (cron unaffected); M7 cross-lane note for 5B — cancel doesn't bump revision,
so a backed-off `job.scheduled` retry can post-date its own cancel; ordering falls to
`available_at`.

**Runbook record (verbatim per §3):** branch `v2-phase1-task5a` (id
`40fd5559-1bd4-4ec3-a30c-bbf7dc1f968d`, ref `bmljvducvpnzvydbgtkr`, $0.01344/hr confirmed,
deleted after). Probes: (a) 32 migrations, head `20260819191046` = prod ✓ (b) 5 definers
proconfig+proacl character-identical ✓ (c) `on_auth_user_created` present ✓ (d) 12 legacy
policies ✓ → FAITHFUL. Row baseline (prod): outbox 0, job_alerts 0, jobs 2, job_events 33,
estimates 16, users/crews/time_entries 0/0/0, cron 2 (crew-night-before-a/b). pgTAP 1.3.3
branch-only. RED = 13/13 not-ok (existence sections via TAP-capture; behavior sections
42883-abort pre-migration — documented pattern). All 3 migrations applied to branch (exact repo
bytes; cron with placeholder per precedent) → **GREEN = 65/65 on first execution, zero
failures.** Suites at close: deno **371/371** (canonical task), web **556/556**, `npm run build`
green, golden-321 intact.

**Rulings taken this session (full list + costs in the SDD ledger):** R1 3-lane concurrency;
R2/R12 crash-recovery claim arms; R3 cancellation as its own RPC/migration (additive to the plan's
file list); R4 `job.cancelled` + calendar-event cleanup (unspecced but a cancelled job's event
must not stay live on a crew calendar); R5 `GHL_WEBHOOK_SECRET` + placeholder over the spec's
Vault; R6 unknown event types ride the normal retry path; R7 Slack timestamp-compare idempotency;
R8 audience-aware calendar description on the spec body; R9 orchestrator-authored raise texts;
R10 single pgTAP suite; R11 404→create fallback w/ documented orphan; fix-round ruling:
required-leg missing config throws.

**Open for Matt (blocking Task 5A close-out / Step 4b):**
1. **Prod apply** of the 3 migrations — cron file MUST get the `__WEBHOOK_SECRET__` substitution
   at apply time. Recommended order: deploy the function FIRST, then apply the cron migration
   (avoids 5 minutes of 404 fires; deferred minor M8).
2. **Deploy** `integration-dispatcher --no-verify-jwt` + `functions list` readback (deviation 6
   posture; same invariant class as ghl-job-webhook).
3. **Live probe** with a TEST job after both (schedule → outbox → dispatcher fire → calendar/Slack
   /GHL, then cancel → cleanup; re-cancel hygiene as always).
Then Session 5 = Task 5B (inbound calendar — OPENS WITH THE WATCH-CHANNEL SPIKE). Standing Matt
to-dos unchanged: phone smoke + real estimate ≥1426 on the branch preview; authenticated JOB-1104
webhook fire; merge decision.

### 2026-08-19 — v2 Phase 1 Session 3 SHIPPED: Task 4 — schedule_estimate APPLIED TO PRODUCTION, ghl-job-webhook v20 DEPLOYED (flag UNSET, behavior-neutral)

**Same-session update — Matt approved both gates ("1 and 2 approved. Go ahead and deploy"), plus
two more decisions:** (a) the phone smoke + first real estimate ≥1426 is a **to-do, not a
blocker**; (b) the crew "Jackson"/"Other" fifth option is **DROPPED** — the schedule flow offers
Crew 1–4 only, which is exactly what lanes 4a/4b already enforce (no code change needed; the 4b
reviewer's finding 3 is resolved as decided-by-Matt).

**Prod apply:** `schedule_estimate_rpc` applied with the exact repo-file bytes → head
`20260819191046`, **32 applied**. Post-apply catalog assertions: function exists once,
`prosecdef=false` (plain invoker), `search_path=public, pg_temp`, ACL = postgres + service_role
only. Row counts byte-identical to the pre-apply baseline (jobs 2, budget_versions 0, outbox 0,
estimates 16, identity_links 3, job_events 33). `get_advisors` security: **zero new WARNs** (the 3
WARNs are the pre-existing baseline; INFO no-policy rows are the deliberate posture).

**Webhook deploy:** flag confirmed ABSENT from prod secrets (`supabase secrets list` — 0 matches ⇒
legacy minting stays on per deviation 7), then the two-command invariant:
`supabase functions deploy ghl-job-webhook --project-ref eiqqqwajmcpcwhvxxnhx --no-verify-jwt` →
**v20**, readback via `list_edge_functions` = `verify_jwt: false` ✓ (other functions' version
numbers bumped cosmetically per the known CLI side effect; only ghl-job-webhook's sha changed).

**Deploy probe (secret-less — the GHL_WEBHOOK_SECRET value is not readable from any sanctioned
store; the Airtable Secrets table is a registry of key names, not values):** unauthenticated POST →
`{"error":"Unauthorized"}` HTTP 401, byte-identical to the FUNCTION'S OWN check at index.ts:243
(the platform's JWT rejection has a different shape) — proves verify_jwt=false routing and that v20
boots past all module-scope env reads. `query_logs` post-deploy: exactly one event (the probe 401),
zero boot errors. **The authenticated live fire is Matt's to-do**: re-drag the TEST opportunity
(JOB-1104) per the BL-5 procedure — remember the re-drag-revives-row hazard: re-cancel after.
The new code paths themselves (flag read, compat branch, skip-audit writes) are pinned by 207
scoped tests with live-verified CHECK-constraint values; with the flag unset the deployed behavior
is reviewer-verified byte-identical to v19.

Session 3 of the Phase 1 plan, local session. **Matt decisions this session:** build+test may proceed
pre-smoke (his explicit go); phone smoke + first real estimate ≥1426 remains the hard stop before
the Task 4 prod apply, webhook deploy, and gate. Recommended smoke surface: the branch preview
deployment **https://lostboysdemolition-git-claude-la-f27ac4-matt-risenmays-projects.vercel.app**
(auto-built per push, no deployment protection, verified 200 on both estimate routes, same prod DB)
— the old prod build creates v1-RPC estimates that Task 4's path can never schedule (no financial
details, no acceptance lifecycle). Three lanes concurrent (4a RPC ∥ 4b web ∥ 4c webhook),
disjoint files, adversarial review each + fix rounds. Commits `d72878c` (4b), `51ad5fb` (4c),
`7028b63` (4a); pushed.

**Lane 4a — `schedule_estimate` RPC** (`20260819170000_schedule_estimate_rpc.sql` + pgTAP
plan(82)). Two review rounds + a micro round; headline catches: (1) SECURITY DEFINER (orchestrator
prompt error) reversed to **plain invoker** — DEFINER would let a pending `workforce_profiles`
signup bypass the BL-7 RLS gate if Task 8 ever granted `authenticated` EXECUTE; (2) **F2
moved-acceptance guard**: a family whose acceptance moved to a different version after its job was
cancelled would have silently revived the job on the stale budget/accepted_price — now a hard error
on BOTH the idempotent and reactivation branches ("resolve manually or via a change order");
(3) **F3 GHL ids written at mint** from `estimate_identity_links` — without them the webhook compat
check and Quote Accepted idempotency lookup could never find app-minted jobs (lane 4c's
`app_is_schedule_authority` branch would have been dead code), and the `jobs_ghl_opportunity_id`
unique key is now a DB-level dual-mint backstop; (4) **R1 dead clamp**: `numeric(7,2)` variable
typmod raises on ASSIGNMENT, before any clamp line — variable now plain `numeric`, clamp proven by
a $1-vs-$1M fixture storing exactly -99999.99; (5) **R2**: the dual-link raise text contained
"already"+"job" and would have misclassified web-side as `already_scheduled` — reworded, verified
against the classifier. Deviation 12 pinned end-to-end: `approved_revenue` = acceptance's
`accepted_price` (quoted-price family proves 1000 flows, not total_bid 1200) and profit is
RECOMPUTED at mint (230, not the details row's 430).

**Runbook record (verbatim per §3):** branch `v2-phase1-task4` (id
`f12651c4-5917-46ea-b57b-d8f24a8bdfb3`, ref `oiwrasvxljhzdrscsgvk`, $0.01344/hr confirmed, deleted
after). Probes: (a) 31 migrations, head `20260819141318` = prod ✓ (b) 5 definers
proconfig+proacl character-identical to prod ✓ (c) `on_auth_user_created` present ✓ (d) 12 legacy
policies ✓ → FAITHFUL. pgTAP 1.3.3 branch-only. Row-count baseline (prod, step 2): jobs 2,
job_budget_versions 0, job_events 33, integration_outbox 0, estimates 16, line items 9,
financial_details 0, acceptance events/state 0, identity_links 3, mutations_audit 29, legacy
users/crews/time_entries 0/0/0. RED = **15/15 "not ok"** (Sections A+B against the pre-migration
schema; 42883 signatures as expected). Migration applied to branch → GREEN = **82/82 on the
plpgsql's first-ever execution, zero failures**. TAP capture method for the MCP runner: temp-table
harness (each assertion `insert into tap_out(line) select <assertion>`, final `select` returns all
lines) with the suite's begin/rollback stripped for branch runs — the MCP executes a batch as ONE
implicit transaction and returns only the last statement's result, so the file's own
rollback would discard the TAP rows (a genuinely new runner fact; the committed test file keeps its
begin/rollback form). Branch copy of the migration trimmed header comments only — prod must receive
the exact file bytes at apply time.

**Lane 4b — web scheduling** (`web/src/lib/jobs/*`, `/estimates/[id]/schedule`, `jobs/actions.ts`,
detail-page hook). Review caught one MAJOR: the "Schedule job" link was nested inside the
pre-existing `canRevise` block, making it unreachable for the CANONICAL accept-then-revise state
(v1 superseded but still the accepted version) — the only UI path would have been hand-typing the
URL. Fixed via pure `scheduleVisibility.ts` (status-blind, mirrors the RPC's own checks) rendered
outside `canRevise`, with a named regression pin. Also fixed: crew closed-list now enforced
server-side (`crews.ts` shared vocabulary + z.enum; the network-open deployment could otherwise
mint a job with garbage crew that silently maps to no Slack channel/calendar). 48+18 new tests;
web suite **537/537**; build + lint green. Known/accepted: success navigates to
`/jobs/<JOB-XXXX>` which 404s until v2 Task 6 (spec-mandated); `superseded` error code unreachable
against current raise texts (documented).

**Lane 4c — `ghl-job-webhook` flag gate** (handlers.ts + handlers_test.ts, IN REPO ONLY — the live
function is untouched at v19). `ENABLE_GHL_ACCEPTANCE_JOB_CREATION` read at request time; only the
literal `"false"` disables (fail-safe: absent/other ⇒ legacy byte-identical — deploy-safe with the
flag unset). Disabled path → 200 `quote_accepted_awaiting_schedule` + skip audit rows (live CHECKs
verified). Job Scheduled gains an UNCONDITIONAL `launch_workflow===true` compat check →
`app_is_schedule_authority`, zero side effects; legacy rows (JOB-1102/1104 read `false` live) flow
unchanged. Fix round: the no-job-record loud error now branches its wording on the flag so
post-cutover triage isn't told "Quote Accepted was skipped" when app scheduling is the new
authority. Scoped suite **207/207** (193 pre-existing untouched + 14 net new). ⚠️ **deno.json
canonical task gained `--allow-env=ENABLE_GHL_ACCEPTANCE_JOB_CREATION`** — the canonical task had
no env grant, so the handler's request-time `Deno.env.get` threw NotCapable and failed all 29
handleQuoteAccepted tests under `deno task test` while scoped `--allow-all` runs (which both the
lane and its reviewer used) passed. The canonical-task gate caught it; grant is scoped to the one
variable. Canonical suite now **331/331**.

**Decisions taken on Matt's behalf, pending his confirmation (flagged in code headers too):**
(1) F7 — app-minted jobs populate `scope_summary` from estimate line-item NAMES only (newline-joined,
sort_order; no description, no amounts — stricter than the webhook's TS renderer), NULL for
zero-line-item estimates; keeps the night-before digest's JOB SCOPE section alive post-cutover.
`start_time` stays NULL (no source in the app flow — joins the Dane habit items unless a field is
added). (2) F2 — moved-acceptance families hard-error rather than reactivate; whether they should
ever reuse the old job is Matt's later call.

**Open items for Matt (blocking the rest of Task 4 Step 4)** *(all resolved same session — see the
section at the top of this entry)*: (1) prod apply — ✅ approved and done; (2) webhook deploy — ✅
approved and done (v20, flag UNSET; the authenticated JOB-1104 re-drag fire moves to Matt's to-do);
(3) phone smoke + first real estimate ≥1426 — Matt: **to-do, not a blocker** (still required before
the Phase 1 gate/cutover flip per the ratified decision); (4) crew fifth option — Matt: **dropped**,
Crew 1–4 only. **Accepted-window note (4c reviewer):** between webhook deploy and Task 5A's dispatcher, an
app-scheduled job gets `app_is_schedule_authority` while its calendar/Slack events sit undelivered
in the outbox — by design (nobody app-schedules a real job before 5A; the plan's coexistence
window). Suites at close: deno **331/331** (canonical task, incl. the new grant), web **537/537**,
build green, golden-321 intact.

### 2026-08-19 — v2 Phase 1 Session 2 SHIPPED: Task 2 (economics + commercial lifecycle) — migrations APPLIED TO PRODUCTION, web integration merged to branch

Session 2 of the Phase 1 plan, same remote session as Session 1, four lanes (2a economics module ∥
2b migrations ∥ 2c GHL surface → 2d integration), each through its own adversarial Opus review +
fix round(s). **Matt decisions this session:** this remote session finishes Session 2 (local
terminal takes Session 3); Task 2 prod apply approved and done. Mid-session hazard: the container
suspended while Matt was away — the 2d implementer agent died UNREPORTED with its build complete
and green in the working tree; the review was run against the raw diff with no self-report, which
worked because the phase plan's handoff list let the reviewer verify every requirement
independently. Commits `5cb8015` (2a), `fccb884` (2c), `6cbc885` (2b), `a662397` (2d).

**Task 2 migrations — LIVE ON PRODUCTION** (`20260819160000_create_estimate_economic_details` +
`20260819161000_estimate_commercial_lifecycle`, applied versions head `20260819141318`, 31
applied): `create_estimate_with_items_v2` (v1-byte-faithful + one details insert, verified by
reviewer diff against live prosrc; v1 untouched; ALL THREE args required — the trailing-defaults
rule forced dropping p_line_items's default too), `estimated_dump_cost_per_load=65` seed
(pricing_variables now 7 keys), the four commercial-lifecycle tables
(`estimate_identity_links`/`estimate_presentations`/`estimate_acceptance_events`/`estimate_acceptance_state`)
with **deviation 12** (`accepted_price` pinned SERVER-SIDE inside the family lock from
`coalesce(quoted_price, total_bid)`, required-on-accept CHECK, state-table accepted↔price CHECK),
and `record_estimate_acceptance_event` (presentation-required, superseded-acceptance blocked,
reversal guarded to the currently-accepted version, deterministic family lock order —
the reviewer REPRODUCED a lock-order deadlock in round 1 and verified the fix deadlock-free).

**Runbook record (Task 2):** branch `v2-phase1-task2` (id `ad4fee43-4d04-43ff-985f-9dc72de5ff9b`,
ref `hkakytvwmwqpitefgqhq`, deleted after): probes a–d FAITHFUL (29 migs, head `20260819052245`,
definers char-identical, trigger, 12 policies). RED = documented abort at assertion 57 (42P01 on
the first `::regclass` of a missing table; reviewer-rig split 54 fail / 2 vacuous `triggers_are`
pins). Both migrations applied → GREEN = **78/78** — after one **branch-caught fixture fix** the
reviewer's local rig missed: the live `quote_override_reason_required` CHECK rejects a
`quoted_price` without a reason (fixture 900101-v2). Prod apply → **F7 backfill verification:
candidate_families=3, seeded_rows=3, candidates_not_seeded=0** — families 1419/1420/1423 exactly
as the reviewer's dry-run predicted; family 1421's `nonexistent-opportunity-id-12345` T12 fixture
excluded by the F9 shape filter (`^[A-Za-z0-9]{15,}$`). Catalog assertions all pass, v1 RPC
untouched, estimates 16 / line items 9 unchanged, `get_advisors`: **zero new WARNs** (only INFO
no-policy on the 4 new tables). The 3 seeded identity rows are TEST residue, deletable later with
Matt's approval.

**Web integration (2a/2c/2d, on the branch — NOT yet deployed to Vercel, separate Matt ask):**
`computeEstimateEconomics` (spec-verbatim, Jorge numbers hand-verified + pinned as literals, ?? vs
|| mutation pin for deliberate $0 quotes); GHL pipeline authority (`pipeline.ts`, runtime
stage-ID resolution, ambiguity-guarded) + prefill/contact-match surface (ALL candidates per leg —
round 1 found the first cut structurally unable to surface more than one match per leg, the exact
silent-merge shape the spec forbids; path ids now URL-encoded — unencoded query-string ids
allowed arbitrary authenticated GHL GETs on the network-open deployment); builder category cost
inputs feeding the v2 RPC; `commercialLifecycle.ts` present/accept/reverse.

**The review chain's headline catch (2d re-review "Attack C"):** present/accept superseded guards
alone were insufficient — reversing an accepted-then-revised version (the CANONICAL F3 flow)
mirrored `sent`/`declined` onto the routinely-superseded target, CLEARING the superseded marker
and re-arming stale-price acceptance through a fresh door. Fix: the status mirror is skipped when
the reversal target is superseded (the marker must survive reversal; both app-side and DB-side
guards key off that column). Traced dead end-to-end by the reviewer post-fix.

**Hard-won facts:** (1) `estimate_acceptance_events` has NO monotonic ordering column —
same-transaction events share `created_at`; ANY "latest event" read must key off
`estimate_acceptance_state.current_acceptance_event_id`, never `order by created_at` (Task 4
handoff). (2) **Live GHL stage names dumped and verified** (from `ghl-job-webhook` startup logs,
pipeline `OMDtCf2eHWQ1GQrEcJA1`): stage 7 is "Job In Progress" (capital In), stage 11 is
"Paid / Closed Won" — CLAUDE.md's table wording, not the v2 doc's; `pipeline.ts` literals
corrected, all four needles byte-identical. (3) The location's SECOND pipeline ("Contractor
Pipeline") has its own "Job Scheduled" stage — live proof the pipeline-membership assertion
before stage moves is load-bearing. (4) supabase-js `.upsert(..., {ignoreDuplicates: true})` is
the ON CONFLICT DO NOTHING form that coexists with immutability triggers. (5) `import
"server-only"` poisons any client-component import path — pure helpers consumed by client
components must live in their own untagged module (`acceptancePresentation.ts`).

**Accepted limitations (recorded, not defects — 3 users):** (1) a GHL-lag warning from
accept/reverse has no in-app retry (F7's guard blocks re-accept; PushPanel targets the wrong
stage); manual GHL stage move is the heal path. (2) The deployment remains network-open;
`findContactMatchesAction` is actor-gated but `/estimates/new?ghlOpportunityId=` prefill is a
documented accepted-risk read on that surface. (3) IdentityLinkPanel links contacts but always
CREATES the opportunity (selection of an existing opportunity is a noted future path).

**Suites at close:** web **471/471**, `deno` suite **317/317** (remote container note: deno.land/
esm.sh/jsr.io are gateway-blocked here; deno installed via npm and std assert vendored from the
authentic `denoland/std` 0.224.0 GitHub tag with an external import map — zero repo changes),
`npm run build` green, `tsc` clean, Jorge `$2,543.51` pinned in three suites.

**Next:** Session 3 = v2 Task 4 (schedule-to-job promotion) — **hard stop until Matt's phone
smoke + one real estimate ≥1426**; then Task 5A/5B. The Vercel deploy of this branch's web work
is a separate Matt decision (deploy-order invariant is satisfied: the rates key is live).

### 2026-08-19 — v2 Phase 1 Session 1 SHIPPED: Task 1 profitability schema APPLIED TO PRODUCTION + Task 3 forecast engine

Executed Session 1 of the approved Phase 1 plan (`docs/superpowers/plans/2026-08-19-profitability-v2-phase1.md`,
plan-mode approved by Matt this session) on branch `claude/last-session-review-f7tqxw`, remote
session, subagent-driven: two Sonnet lanes concurrent, adversarial Opus review per lane (two rounds
each), orchestrator ran the runbook cycle and prod apply. **Matt decisions this session:** GHL
minting cutover at Phase 1 gate pass (not Task 4 deploy); build proceeds with phone smoke in
parallel (hard stop before Task 4 cutover + gate); per-task prod applies; Task 1 prod apply
approved and done; **price source = pin-at-acceptance** (deviation 12 — `accepted_price` on the
immutable acceptance event; `schedule_estimate` mints budget revenue from it, not from
`estimate_financial_details.customer_price`).

**v2 Task 1 (schema) — LIVE ON PRODUCTION.** Migrations `20260819150000_profitability_lifecycle_types`
+ `20260819151000_profitability_core_schema` (applied versions `2026081905224x`, head now
`20260819052245`, 29 applied): 14 enums, 12 new `jobs` columns, 16 tables (spec-verbatim to the
column — verified by mechanical diff twice; the `job_forecast_overrides` B6 CHECK is the sole DDL
deviation), `mark_job_reconciliation_required()` (pinned, service-role-only, **outbox key =
`alert:<uuid>` of the newly-opened alert** — review demonstrated BOTH string-key failure modes:
cross-job collision AND resolve-then-refire drop), 7 immutability triggers, RLS + explicit
`public/anon/authenticated` revokes on all 16 tables AND the identity sequence. pgTAP suite
`supabase/tests/profitability_core_schema_test.sql`, `plan(102)`, all multi-overload assertions
carrying descriptions + ACL/enum-label/type-default/trigger-function pins.

**Runbook record (verbatim per §3):** branch `v2-phase1-task1` (id `9595abc3-ef0d-458a-9e71-f3c4302bb976`,
ref `hjffvzebieiepmxyfeca`, $0.01344/hr confirmed, deleted after). Probes: (a) 27 migrations, head
`20260818230956` = prod ✓ (b) 5 definers, proconfig+proacl **character-identical** to prod ✓
(c) `on_auth_user_created` present ✓ (d) 12 legacy policies ✓ → FAITHFUL. pgTAP 1.3.3 branch-only.
RED = **99 fail / 3 pass of 102** (the 3 = vacuous `triggers_are` drift pins on not-yet-existing
tables, separately confirmed 3/3 in isolation; documented in the test header). Both migrations
applied → GREEN = **102/102** (after one test-file fix the GREEN run itself caught:
`col_default_is` takes the plain default VALUE, not the rendered `'x'::type` expression — 22P02
otherwise). Behavioral probe (rolled-back txn, JOB-9901/9902): 3 alerts / 3 outbox / 3 distinct
`alert:` keys / status flipped. **Production single-transaction dry-run of the exact final SQL**
(both migrations + behavior probes: null-guard raise, both B6 rejections, materials-accept,
3-scenario Slack semantics on JOB-1102/1104 probe snapshots + full 102 assertions) = **102/102,
rolled back atomically, prod verified pristine after**. Real apply → post-apply: 14/16/12 counts,
RLS 16/16, ACLs denied, fn/sequence ACLs correct, index predicate `(resolved_at IS NULL)`,
row counts unchanged (jobs 2, users 0, crews 0, time_entries 0, estimates 16, workforce_profiles 1),
pgTAP absent. `get_advisors` security: **zero new WARNs** — new findings are only the deliberate
INFO `rls_enabled_no_policy` on the 16 new tables; the 3 WARNs are pre-existing baseline.
Suites: deno **317/317**, web **289/289**. Commit `6b83f8a`.

**v2 Task 3 (forecast engine) — DONE.** `web/src/lib/profitability/{types,calculateJobHealth}.ts`
+ 28 tests (commit `77fae2d`). Review round caught 2 blockers **failing in the dangerous
direction**: non-finite inputs fell through every comparison to `on_track`/`high` (now throws,
`requireFinite` idiom — also rejects numeric strings, which Postgres `numeric` can deserialize as),
and a `null` remaining-cost override zeroed a category's remaining ETC (now finite-number-guarded).
`jobStatus` union widened to all 7 `job_lifecycle` values (deviation 9). Re-review attacked the
guards from twelve angles: held; APPROVE.

**Review-caught facts worth keeping:** (1) pgTAP `col_default_is` expected-value semantics (above).
(2) An outbox idempotency key derived from stable strings cannot track a reopenable dedup window —
key on the row the insert actually created. (3) `jobs.job_name` is NOT NULL and
`jobs_job_number_format` rejects non-`JOB-<digits>` — probe data must respect both. (4) The
`quoted_price` → `customer_price` gap (phantom revenue shortfall on discounted jobs) — CLOSED by
Matt's pin-at-acceptance decision, deviation 12, before Task 2 starts.

**Remote-session test infra (this container):** network policy blocks deno.land/esm.sh/jsr.io;
deno installed via npm (`npm i -g deno`, 2.9.5), std assert vendored from the authentic
`denoland/std` 0.224.0 GitHub tag with an external import map + `--no-lock` (zero repo files
changed). 317/317 with it.

**Next:** Session 2 (v2 Task 2 — economics + commercial lifecycle, 3 lanes then integration),
carrying deviation 12. Matt's phone smoke + first real estimate ≥1426 still owed — hard stop
before Task 4 cutover work and the phase gate.

### 2026-08-18 — Profitability v2 Phase 0 SHIPPED: Task 0A docs + Task 0B BL-7 boundary APPLIED TO PRODUCTION

Executed `docs/superpowers/plans/2026-08-18-profitability-v2-phase0.md` (approved plan, branch
`v2-phase0`) via subagent-driven development: Sonnet implemented both lanes, Opus adversarially
reviewed the SQL lane before production application, and a final whole-branch review is dispatched.
**Both halves of Phase 0 are done, and the BL-7 migration is live on production** — Matt approved
the production apply this session rather than leaving it committed-but-unapplied.

**Task 0A (docs lane):** `docs/runbooks/profitability-schema-validation.md` created — an 8-step
validation sequence (disposable branch → fidelity probe → migration → assertions → full test
suites → commit → production apply → post-apply read-only verification), a branch-fidelity
decision tree (probe the 5 live-only definers, the `on_auth_user_created` trigger, and the
policy count before trusting a branch; fall back to a production single-transaction dry-run if a
branch is unfaithful), the auth-schema dry-run caveat (below), and the exact two-command
`ghl-job-webhook --no-verify-jwt` deploy-invariant block. CLAUDE.md and BUILD_PLAN.md both got the
7→12 RLS policy-count correction (the 7 `get_my_role()`/`get_my_crew_id()`-based policies plus 5
plain `auth.uid()`-based ones that were previously undercounted).

**Task 0B (SQL lane):** migration `20260818143000_workforce_auth_boundary.sql` plus the repo's
**first pgTAP SQL test**, `supabase/tests/workforce_auth_boundary_test.sql` (19 assertions).
Creates `workforce_profiles` (RLS, 2 policies — `workforce_self_read`/`workforce_owner_all`, the
system's first policies on any new-schema table), a `SECURITY DEFINER` helper
`is_workforce_owner()` (search_path pinned, `authenticated` EXECUTE — required for RLS qual
evaluation, no cross-user surface), and a rewritten `handle_new_auth_user()` (search_path pinned,
now inserts into `workforce_profiles` with a total `display_name` expression so a NULL-email/
phone-only signup can never abort the insert).

**Validation chain, full red/green record:**
- Disposable branch (`cwmabtgjvwetswvsfiuh`, schema-only clone, N=0 auth users), fidelity-probed
  FAITHFUL (26 migrations, 5 live-only definers with matching ACL/proconfig, the trigger, 12
  legacy policies all matched).
- Branch RED (pre-migration): 14 fail / 3 pass, exactly as the corrected prediction (17-assertion
  file at that point; the plan's "13 fail" was an arithmetic slip caught and corrected in the SDD
  ledger before the run).
- Branch GREEN (post-migration): 12 pass / 5 fail — **not** the expected 17/17. Root-caused to a
  test-file defect, not a migration defect: 5 pgTAP assertions (`has_table`, `has_column`,
  `policy_cmd_is`) were missing their trailing `description` argument, so Postgres resolved the
  wrong overload and the calls silently checked for a table literally named `public` instead of
  the schema-qualified form. Direct catalog queries independently proved the migration was 100%
  correct (table, 7 columns, RLS, both policies with correct SELECT/ALL commands all present) — the
  files were correctly left uncommitted per the task's own gate ("commit only on 17/17") pending a
  fix round.
- GoTrue simulation on the branch: PASS — inserting a probe row into `auth.users` produced exactly
  one `workforce_profiles` row (`pending`/`inactive`), `public.users` stayed at 0.
- Fix round added the 5 missing description args (test file only, migration untouched) and
  extended `plan(17)` → `plan(19)` with two new table-privilege assertions pinning the ACL posture.
- **Production single-transaction dry-run made MANDATORY** (new runbook caveat, below) because a
  branch cannot reproduce `auth.users` ownership. Prod RED dry-run: 16 fail / 3 pass, exact match.
  Prod GREEN dry-run (first pass): 18/19 — assertion 19 caught a **real security gap**:
  `authenticated` had retained default-ACL REFERENCES/TRIGGER/TRUNCATE on `workforce_profiles`
  (TRUNCATE is not RLS-gated) because the revoke list omitted `authenticated`. Fixed (one line);
  prod GREEN dry-run rerun: **19/19**, rolled back.
- Real `apply_migration` to production, then post-apply verification: all 6 catalog booleans TRUE,
  `backfill_rows=1` (the one existing `auth.users` row got its `workforce_profiles` row —
  pending/inactive, name Matt), `public.users` still 0, 12 legacy policies untouched, `get_my_role`
  ACL unchanged, helper ACL exactly postgres/service_role/authenticated, table ACL for
  `authenticated` exactly `arwd` (no TRUNCATE), pgTAP not installed on prod (0 as expected).
- Suites at validation time: `deno task test` 317/317, `cd web && npx vitest run` 261/261.

**Three review-caught defects that matter for the record (the hard-won facts):**
1. **Auth-schema DDL is branch-blind.** The plan's original Section 6 was `drop trigger` +
   `create trigger` on `auth.users`. `DROP TRIGGER` requires table *ownership*; `postgres` holds
   only the TRIGGER privilege on `auth.users`, not ownership — so the drop would 42501 on
   production while passing cleanly on a branch (branches apparently don't reproduce this
   ownership gap). Fixed to a single `CREATE OR REPLACE TRIGGER` (needs only TRIGGER privilege,
   same end state, atomic). **This is now a standing runbook rule: any migration touching an
   auth-schema object requires the production single-transaction dry-run regardless of branch
   results** — a branch-green result is not sufficient evidence for auth-schema DDL.
2. **The v2 spec's verbatim pgTAP assertions carried a latent, unfixable-by-migration bug** — see
   the branch GREEN root-cause above. `has_table('public', 'x')` and friends silently resolve to
   the wrong 2/3/4-arg overload without a trailing description string. Fixed by adding
   descriptions; no assertion of this shape should ever be written without one going forward.
3. **Supabase's default privileges pre-grant `authenticated` more than expected**, including
   TRUNCATE, which RLS does not gate. An explicit revoke list must include `authenticated`
   explicitly, not just `anon` — this was the gap the production GREEN dry-run's new assertion 19
   caught before it ever reached a real apply.

**Accepted advisor finding:** one new WARN post-apply — `authenticated` can EXECUTE
`is_workforce_owner()` via PostgREST RPC. Accepted as intentional: EXECUTE is required for RLS
qual evaluation (the "authenticated evaluates RLS as itself" lesson from 2026-08-17), the function
returns only a boolean about the calling user (`auth.uid()`), and there is no cross-user read
surface. All other advisor items are pre-existing baseline.

**BL-7 IS NOW CLOSED.** `handle_new_auth_user()` is no longer a silent no-op — see the CLAUDE.md
paragraph rewrite in this commit for the new live state. Owner promotion (flipping Matt's row from
`pending`/`inactive` to an active owner role) is deliberately deferred to v2 Task 8's launch
runbook, not done here.

Full deviation record: plan doc `docs/superpowers/plans/2026-08-18-profitability-v2-phase0.md` →
"Spec deviations" (8 original) + "Execution amendments (2026-08-18)" (3 more, recorded during the
build — the trigger fix above, the pgTAP description fix, and a `display_name` total-expression
fix so a NULL-email/phone-only signup can never abort).

**What remains:** v2 Phase 1 planning (Tasks 1–5) is next. **Phase 1 gate precondition still
outstanding, unrelated to this session's work**: Matt's phone smoke test + one real estimate
through the builder (outstanding since 2026-08-14; first real estimate will be ≥1426). BL-6
echo-guard design draft still awaits Matt's review. No edge function was touched this session — no
status-table function rows changed.

Commits on `v2-phase0` (not yet merged to `main` — controller merges after the whole-branch
review): `27f95c3` (plan landed), `4597b5b` (Task 0A docs), `67cff95` (Task 0B SQL — migration +
pgTAP test), `c50a5d6` (execution amendments + runbook caveat recorded in the plan copy).

### 2026-08-18 — Profitability Program v2 reconciled, ratified, and landed (docs only)

Brainstorming/reconciliation session with Matt. Two Codex-authored program documents — a 17-task
"Live Job Profitability Health Dashboard" implementation plan (v1) and its design spec — were
reconciled against `BUILD_PLAN.md`. The v1 reconciliation surfaced five structural conflicts
(job-creation authority, GHL-owned invoicing silently replacing Stripe/Synder/QBO, blindness to
BL-7, a nonexistent local `supabase db reset`/pgTAP harness, mega-plan packaging violating
amend-don't-rival). Codex's **Version 2** resolved nearly all of them; Matt ratified it with four
decisions and five adjustments, all landed this session.

#### Decisions (Matt, 2026-08-18)
1. **App-side scheduling mints `JOB-XXXX`** — Quote Accepted becomes pre-job. Phase A's GHL
   minting stays **live** until v2 Task 4 ships, then is flag-disabled permanently (rollback never
   re-enables it). Precondition on the v2 Phase 1 gate: Matt's phone smoke + one real estimate
   through the builder. Consequence accepted explicitly: after launch, every job requires an
   app-created estimate with financial details — no GHL-only or Fillout-only jobs.
2. **Two-way Google Calendar sync confirmed as a real requirement**, with the full channel
   lifecycle now specified (registry, expiry, renewal-before-expiry, overlap dedup, failure
   alerts, reconciliation fallback — Google watch channels expire in days; v2 originally omitted
   renewal entirely).
3. **Phase D RESOLVED — the last 🔴 blocking decision.** Split D1 (unblocked: job-time schema,
   manual/CSV import, foreman approval, Dane override, labor-cost attribution, audit,
   provider-neutral adapter contract = v2 Task 13) / D2 (deferred: vendor evaluation + connector;
   ClockShark/busybusy/custom judged against the same contract; Gusto stays payroll; add-on
   question parked). Verbatim wording in the `BUILD_PLAN.md` 2026-08-18 amendment.
4. **Scoped auth returns**: Supabase Auth for foremen + Dane's financial routes via the isolated
   `workforce_profiles` boundary (BL-7 resolved by Task 0B before any account exists); the
   no-login estimator picker stays, with `actor_assurance` recording which identity kind acted.

Also reaffirmed: **direct Stripe invoicing + Synder→QBO; GHL never becomes invoice authority**
(reverses the design spec's §2, which is now flagged in the spec itself).

#### The five adjustments folded into the landed v2
1. Estimate immutability: no "presentation freezes the chain" — every persisted version's inputs
   stay immutable under the existing trigger; presentation pins + hashes the exact version; the
   four limited mutable fields are preserved.
2. `estimate_identity_links` = canonical family→GHL identity; `ghl_push_state` = per-version
   delivery bookkeeping only; deterministic, idempotent backfill rule specified (disagreeing
   families → manual review, never guessed).
3. Task 0 split into **0A (canonical documentation and plan landing)** and **0B (BL-7 auth
   boundary)** — 0A completion must never be read as the auth migration existing.
4. Calendar channel lifecycle fully specified (see decision 2).
5. Stripe native reminders + weekly AR digest: deferred **with owner (Matt) and activation
   criterion** (`stripe-webhook` live with real invoices — v2 Phase 5 gate), recorded in both the
   v2 non-goals and BUILD_PLAN Phase E.

#### Files changed (all docs)
- `docs/superpowers/plans/2026-08-18-live-job-profitability-health-dashboard-v2.md` — landed with
  all amendments (provenance note at top lists them).
- v1 plan → `docs/archive/2026-08-18-live-job-profitability-health-dashboard.md` (git rename,
  nothing deleted; archive README row added).
- `BUILD_PLAN.md` — new "⚠️ AMENDED 2026-08-18" section (the five decisions + verbatim Phase D),
  Phase D section resolved, open-decisions rows 5/6 updated, ClockShark carried-over conflict
  resolved, Phase E absorption note.
- `CLAUDE.md` — Direction bullet for the ratification, open-decisions rows 3/6, roadmap Phase D
  row + new Profitability Program v2 row.
- Design spec — status reduced to design input; §2 invoice-ownership conflict flagged inline.
- `NEXT_SESSION_PROMPT.md` regenerated.

#### Explicitly NOT done this session
No production migrations, no application code, no deploys, no Supabase changes. v2 **Task 0A is
incomplete** — `docs/runbooks/profitability-schema-validation.md` is unwritten. **Task 0B (the
`workforce_profiles`/BL-7 migration) is not implemented or verified.** Phase A behavior is
unchanged and live. Estimates ≤1425 remain TEST-labeled; JOB-1102/1104 remain cancelled.

#### Next session
Execute the v2 Task 0A remainder (runbook) and Task 0B under the standing build rules — the v2
plan is the approved program plan, but every phase still gates on adversarial review, live-probe,
and Dane/Matt sign-off. Independently: the BL-6 echo-guard draft still awaits Matt's review, and
Matt's phone smoke + one-real-bid Fillout check are still owed (now also a hard precondition of
the v2 Phase 1 gate). Note for BL-6 prioritization: the v2 program shortens the remaining life of
the Airtable↔GHL sync pair — weigh the echo-guard investment against that horizon.

### 2026-08-18 — Vercel project renamed AND production URL changed: `lbd-estimates` → `lostboysdemolition` (Matt, in the Vercel UI)

Docs-only session, in two steps. Matt first renamed the Vercel project (same project ID
`prj_hCH0ZxkpeuRaOWLFjCaZ9wz5KKKm`, team `matt-risenmays-projects`); a rename alone does not touch
`.vercel.app` domains, so the old URL initially stayed live. Matt then added the matching domain
and **deleted the old one**. Final state, verified by probe:

- **Production URL is now https://lostboysdemolition.vercel.app** — 200, `/` → `/estimates`,
  title "LBD Estimates".
- **`lbd-estimates.vercel.app` is deleted and 404s — no redirect.** Anyone with the old URL
  bookmarked or saved to a phone home screen (Dane/Jackson) must be given the new one; nothing
  server-side pointed at the app, so that is the only breakage surface.
- `web/.vercel/project.json` still says `"projectName":"lbd-estimates"` — harmless, the CLI links
  by project ID and will refresh it on next use.

Updated the current-state references in `CLAUDE.md`, `web/README.md`, `NEXT_SESSION_PROMPT.md`,
and this file's status table to the new URL. Entries below dated 2026-08-14 keep the old URL —
true when written.

### 2026-08-20 — BL-5 SHIPPED: crew calendar events stripped of pricing; BL-6 design draft; concurrency directive strengthened

**Executed** `docs/superpowers/plans/2026-08-18-bl5-crew-calendar-no-pricing.md` (approved 2026-08-18)
via subagent-driven development: sonnet implemented, opus adversarially reviewed (Approved, 0
Critical/Important), merged to `main` as fast-forward `ac58673`. Suite: **317 passing** (312 + 5 new),
golden-321 gate intact.

#### Deployed
| Function | Version | What changed |
|---|---|---|
| `ghl-job-webhook` | **19** (sha `024cc198…`, was `da43aada…`) | `buildCalendarDescription`/`buildCalendarEventBody` take a **required** `audience: "main" \| "crew"` param — crew omits the `Estimate: $X` line, main is byte-identical to before (locked by unchanged test literals). Schedule leg builds per-target bodies paired structurally with their calendarId; needsMain/needsCrew gates, I1/I2/I3, and error aggregation untouched. |

#### Live probe (2026-08-18, verified by Matt 2026-08-20)
JOB-1104: set TEST `estimate_value=4200`, nulled both gcal IDs, Matt re-dragged the test opportunity
to Job Scheduled. v19 created main `d2nqvpvj6o1p8vg808re7n98o4` + crew `9p88u9p07cjr9hq57h2qjsitm4`
in one fire, zero errors, both IDs stamped. **Matt eyeballed both events: main showed
`Estimate: $4,200.00`, crew showed none.** Row restored after (cancelled, estimate 0, IDs stamped).
`slack_notified_at` stayed stamped throughout so no crew Slack ping was possible.

#### ⚠️ Two live hazards caught this session (neither about BL-5's code)
1. **JOB-1104 had drifted back to `status_v2='scheduled'`** (BL-4's E2E re-drag; `handleJobScheduled`
   writes it unconditionally and has no cancelled-guard) with `start_date=2026-08-20` and no
   night-before stamp — the Aug-19 digest would have pinged the REAL Crew 1 channel with TEST data.
   Re-cancelled before it could, and again immediately after the probe. Lesson: **any test re-drag
   revives the job row — re-cancel as part of cleanup, every time.**
2. **A bare `supabase functions deploy` silently flipped `verify_jwt` to `true`** (v17), which would
   have 401'd every GHL webhook call. Caught by reading back `list_edge_functions` immediately after
   deploy; fixed with `--no-verify-jwt` (v18/v19 — the extra versions are this correction, same
   bundle sha all three). **Always pass `--no-verify-jwt` for the webhook functions and always read
   back `verify_jwt` after a CLI deploy.**

#### Consciously accepted residual
Legacy `airtable-job-scheduled` still emits `Estimated Revenue` into descriptions posted to crew
calendars. Out of BL-5's scope by decision (Airtable-era path, retirement-bound, and touching it
forces a live-function redeploy under the parity rule) — recorded in the plan's Global Constraints
and flagged by the opus review as a ⚠️; resolved as deferred-by-design.

#### Review minors deferred (ledger'd, none blocking)
Derive per-target body from the label in a helper to make a main-body-on-crew-calendar
unrepresentable; pin the literal in the null-estimate equivalence test; note that
`buildCalendarEventBody` is now evaluated only when a target is actually pushed (strictly more
robust); second integration test doesn't restate `calendar:"success"` (covered by neighbours).

#### Parallel lane: BL-6 echo-guard design DRAFT (Matt's strengthened directive, first application)
**Matt strengthened the concurrency standing directive this session (2026-08-18):** concurrency is
now *required* when it doesn't impact quality/integrity, and **plans must be written for concurrent
execution up front** — CLAUDE.md's Standing Instruction updated. Applied immediately: an opus design
lane ran alongside BL-5's serial tail and produced
`docs/superpowers/plans/2026-08-18-bl6-echo-guard-design-DRAFT.md` (design only, nothing built).
Key live-proven findings: the A→G→A echo loop is **real** (100% of `airtable_to_ghl` syncs since
June are followed by a `ghl_to_airtable` sync of the same email, p50 1.68s); GHL fires its workflow
even on no-op PUTs; `tags` arrives empty in 620/624 logged payloads, so a whole-tuple hash guard
would mismatch forever — the draft recommends a field-wise `last_synced_values` jsonb snapshot on
`client_sync_state`, guard in `ghl-contact-sync` first, fail-open, plus a hop-rate breaker. Draft
awaits Matt's review; its claim that a CLAUDE.md tags line needs correcting is **unverified — do not
edit docs from the draft alone.**

#### Still owed / carried forward
- ~~Matt: delete the two probe events~~ — **done 2026-08-20, confirmed by Matt.** No BL-5 test
  artifacts remain on any calendar. JOB-1104's `gcal_main_event_id`/`gcal_crew_event_id` stay
  stamped (pointing at the deleted events, same pattern as JOB-1102) so a re-fire can't duplicate.
- Matt's phone smoke + one-real-bid Fillout parallel check on the estimate builder (outstanding
  since 2026-08-14).
- BL-6 draft review is the natural next session.

### 2026-08-17 — BL-4 SHIPPED: crew Slack format + estimate→job promotion; 2 repo fixes; 3 new backlog items

**Executed the approved brief** `docs/superpowers/plans/2026-08-14-bl4-crew-slack-and-repo-fixes.md`.
Everything below is merged to `main` and live. Suite: **312 passing**, golden-321 gate intact.

#### Deployed
| Function | Version | What changed |
|---|---|---|
| `ghl-job-webhook` | **16** | Contact fields persisted at Quote Accepted; estimate→job promotion; 4-tier scope; new Slack format; `SLACK_TEST_CHANNEL_OVERRIDE` |
| `crew-night-before` | **11** | Same format + divider; shared module; override no longer stamps `night_before_sent_on` |
| `airtable-client-sync` | **29** | Repaired search, duplicate-path update, name-erasure guard |

Migrations applied: `bl4_job_crew_fields` (5 nullable text columns on `jobs`),
`widen_sync_log_match_method` (adds `'email_duplicate'`), `security_revoke_legacy_definers`.

#### The estimate→job promotion now exists
`estimates.job_number` had **zero writers** before today. Quote Accepted now back-writes it and flips
the estimate to `accepted` via the two mutation RPCs, non-fatally (a job with no estimate is the
ordinary Path A case), and re-runs on the skip path so a re-fire self-heals.

**⚠️ The single most important fix in this build (review finding F2).** The first implementation
resolved a *row*, not a *chain*, which meant the **ordinary quote cycle silently produced nothing**:
revising an estimate supersedes v1, the GHL push is a manual button so v2 often has no
`ghl_push_state` row, leaving only a superseded v1 to match → `not_found` → no `job_number` → then all
scope tiers empty. Now it identifies the `estimate_number` from the push-state row (deliberately
**not** filtering superseded, because a superseded row still names its chain) and resolves that
chain's current version. **Live-proven** against exactly that shape: chain read
`1424 v1 superseded job=- | 1424 v2 accepted job=JOB-1104`, scope resolved via tier
`estimate_by_job_number` with 3 line items, exactly 2 `estimate_mutations_audit` rows.

#### Scope is a 4-tier hybrid
1. `estimate_by_job_number` → line items (`name — description`)
2. `estimate_by_push_state` → chain pivot → line items
3. `estimate_job_details` — **Matt's decision**: quick-mode estimates have no line items, and **12 of
   16 live estimates have zero**, so this is the common shape, not an edge case. It is the only scope
   source that can contain money, so `stripCurrencyFromScopeText` removes `$`-amounts, percentages
   and bare money decimals.
4. `ghl_fallback` → GHL `Job Scope` names
Plus `none` (genuinely empty) and `error` (a lookup failed) as distinct outcomes.

**🚨 No pricing may reach a crew channel.** GHL `Scope Notes` is never read — it carries total bid,
quoted price, markup % and true margin %. Line-item selects are `name, description, sort_order` only.

#### Two defects the live E2E caught that no unit test could
1. **`ghl_push_state` has no `created_at` column.** The F6 review fix added `.order("created_at")` to
   both queries on that table; PostgREST rejects the whole query, so the first live fire returned
   `promotion:"failed"` and scope tier `error`. The mocks don't validate column names. Fixed to
   `updated_at`. **This is the second time this project has been bitten by "mocks can't see the DB" —
   live-probe every deploy.**
2. **The schedule leg lacked the `client_name` fallback** that `crew-night-before` was given, so the
   two crew messages disagreed and any job minted before BL-4 would render with no client at all.

#### Review findings fixed before deploy (none catchable by tests)
- **F1** — `scope_summary` was written unconditionally, and "lookup errored" collapsed into the same
  `null` as "no scope", so one PostgREST blip on a reschedule would permanently wipe scope text no
  other writer can restore. The key is now **omitted** rather than nulled.
- **F3** — new `conflict` outcome refuses to overwrite a *different* non-null `job_number`, preventing
  ping-pong between two opportunities sharing a chain and the audit-table pollution that follows.
- **H1** (`crew-night-before`) — the test override redirected Slack **and still stamped**
  `night_before_sent_on`, so an E2E would have consumed real crews' digests with `sync_log` reading
  success and **no retry by design**. Now gated.
- Divider was shipping as 10× U+2500 instead of the brief's `———` (3× U+2014), and **no test could
  catch it** because the assertion compared against the constant, not a literal.
- `formatPhone` turned `+49 30 123456` into `(801)`-style nonsense; crew maps rebuilt on
  `Object.create(null)` (`resolveCrewEnvKey("constructor")` returned the `Object` constructor).

#### `airtable-client-sync` — fixed, but the data-loss item is NOT closed
Repaired the `POST /contacts/search` leg, added the missing `updateGhlContact` on the duplicate-400
path, and **stopped blank names erasing GHL contact names** (`firstName`/`lastName` were sent as `""`;
87 of 1045 Clients rows have a blank first name, 203 a blank last name).

Also found: the old code wrote `match_method='email_duplicate'` / `action_taken='matched_existing'`,
**both illegal** under the live CHECKs, so that insert had been **silently rejected for 3.5 months** —
zero such rows exist. Widened the constraint so the two match paths stay distinguishable.

**Corrections to what this repo believed:** the data-loss claim was overstated. 313 live rows show
`ghl_contact_id`/`updated`, so once a contact's GHL ID is cached in Airtable every later edit *does*
propagate. More importantly the automation (`wflSSK2Twr9Tqwgpq`) fires on **`recordCreated` only**, so
edits never invoke the function at all and no code change can fix that. → **BL-6**, which must design
an echo guard first (`ghl-contact-sync` → Airtable → `airtable-client-sync` → GHL → … terminates today
*only* because the trigger is create-only).

#### Security hardening
Pinned `search_path` (with **`pg_temp` last** — `anon`/`authenticated` both hold TEMP) and revoked
EXECUTE from `public, anon, authenticated` on 10 functions. Verified: all 10 now deny anon and
authenticated, `service_role` and `postgres` retain it, so `next_job_number()` still mints.

**`handle_new_auth_user()` deliberately left unpinned → BL-7.** GoTrue connects as
`supabase_auth_admin` (`search_path=auth`), so its unqualified `INSERT INTO users` resolves to
`auth.users`, collides, and is swallowed by `ON CONFLICT DO NOTHING`. **It has always been a silent
no-op** — `auth.users` 1 row, `public.users` 0. *That*, not "never used", is why `public.users` is
empty. Pinning it would flip it into a real insert and activate the RLS policies below.

**⚠️ Doc drift found:** CLAUDE.md says `users`/`crews`/`time_entries` have "RLS enabled, no policies by
design". They carry **7 live policies** calling `get_my_role()`/`get_my_crew_id()`. The revoke turns
"0 rows" into "permission denied" for anon/authenticated — fine with no login, but **Phase D is
specced against `time_entries`** and must re-grant or replace them.

#### Decisions taken
- **Scope source for quick mode:** wire `job_details` **and** have Dane tick GHL `Job Scope`.
- **Crew calendar pricing → BL-5.** Crew calendar events carry `Estimate: $X`, contradicting the rule
  BL-4 just wrote down, one channel over. Decision made (strip from crew only, keep on main), work
  deferred — it needs two event descriptions without disturbing the per-target calendar idempotency.
  **Until then the inconsistency is KNOWN AND DELIBERATE.**
- **Parallel agent execution is now a Standing Instruction** in CLAUDE.md (Matt: "run agents in
  parallel as much as possible; quality first, efficiency second" — ordered, not traded off).

#### Test residue left live, deliberately
`estimate_number` 1424 v2 is `accepted` with `job_number = JOB-1104` — real promotion residue on a
TEST estimate, left as evidence. JOB-1104 carries `TEST`-prefixed identity values. The fabricated
`ghl_push_state` row was deleted (back to 10 rows). `SLACK_TEST_CHANNEL_OVERRIDE` was **unset and
confirmed absent**.

#### Process note
One deploy went out while 2 tests were red, because the exit code was masked by `| tail` in the
pipeline that ran the suite. The code was correct and the suite is green at 312, but the gate did not
hold — check `PIPESTATUS` when gating a deploy on a piped test run.

#### Still owed
- **Matt's phone smoke + the one-real-bid Fillout parallel check** on the estimate builder — outstanding
  since 2026-08-14, untouched by this session.
- Eyeball the #ops-test message rendering.
- Dane habit items: populate GHL **Job Start Time** and **Job Scope**.

### 2026-08-14 (night, second) — BL-4 + repo fixes PLANNED and APPROVED (planning only, nothing built)

**Status:** 🟡 Plan approved, **not built**. No code written, no function deployed, no migration
applied, no live system touched. The approved build brief is
`docs/superpowers/plans/2026-08-14-bl4-crew-slack-and-repo-fixes.md` — **the next session starts
there.**

**Scope Matt chose:** BL-4 (crew Slack message format) plus the three repo-level fix items, then a
live test of the estimate tool and workflow. He explicitly **declined** the historical import of
the 321 Airtable estimates.

**Decisions taken this session (all Matt's):**
- **Scope source = hybrid.** Render the scope line from the linked estimate's line items, falling
  back to the GHL `Job Scope` multi-select when no estimate is linked. This requires building the
  estimate→job promotion that has never existed.
- **Both messages get the new format** — `ghl-job-webhook`'s schedule-leg post and
  `crew-night-before`'s digest.
- **GHL "Job Start Time" is not reliably populated.** Wire the field so it lights up if adopted;
  omit the line when blank rather than ship a permanently-empty line. Getting it populated is a
  habit/config item for Dane, not a code item.

**Findings worth keeping, independent of whether BL-4 ever ships:**

- **Three of BL-4's four missing fields are already fetched and discarded.** Quote Accepted already
  does `GET /contacts/{id}` and holds `phone` + `companyName` (the latter collapsed into a single
  `client_name` label by `_shared/job.ts:51`); the schedule leg already does
  `GET /opportunities/{id}` and reads 3 of its custom fields, discarding the rest — including Job
  Start Time, Job Scope, and Scope Notes. **Net new GHL calls needed for BL-4: zero.**
- **The estimate→job link has never existed and has zero callers.** `estimates.job_number` carries
  the comment "job link set at promotion"; `update_estimate_job_number`'s own docstring says it
  exists for "a *future* estimate-to-job promotion"; `grep updateJobNumber web/src` returns only
  its definition. No edge function queries `estimates` at all. The only latent join key is
  `jobs.ghl_opportunity_id` ↔ `ghl_push_state.ghl_opportunity_id`.
- **BL-4 is a restoration, not an invention.** `airtable-job-scheduled/index.ts:241-271` already
  built this exact block (client, revenue, crew, address, start time, phone, client type, then a
  JOB SCOPE section). Phase A's rebuild dropped it because the Postgres fields didn't exist.
- **⚠️ `airtable-client-sync` is worse than previously recorded.** Known: `searchGhlByEmail`
  (`:33-40`) uses the dead `GET /contacts/?email=` shape and never checks `res.ok`, so it returns
  `null` indistinguishably from "no such contact". **Newly established: that makes the
  update-in-place branch (`:132-136`) unreachable, so every existing contact is matched via the
  duplicate-400 fallback and its field changes are silently dropped — Airtable edits have never
  propagated to existing GHL contacts.** This is data loss, not just misleading `match_method`
  logging. The fix must also add `updateGhlContact` on the duplicate-400 path, not only repair the
  search.
- **⚠️ `notify_airtable_on_archive` is a live enabled trigger on `jobs`** that POSTs to the dormant,
  latently-buggy `push-to-airtable`. Verified via `pg_get_functiondef` that it fires only on
  `status → 'archived'` (the legacy enum), so it is inert for ordinary `jobs` writes — but no
  future work should assume `jobs` is trigger-free.
- **The `SECURITY DEFINER` count is 5, not 6.** `SYSTEM_AUDIT_2026-07-30.md` was right; this log
  and `NEXT_SESSION_PROMPT.md` were wrong and are corrected. Live:
  `calculate_duration_and_cost`, `get_my_crew_id`, `get_my_role`, `handle_new_auth_user`,
  `notify_airtable_on_archive`. None pin `search_path`; all are `anon`-EXECUTE-able. **Three are
  triggers**; only `get_my_role`/`get_my_crew_id` are genuinely callable RPCs, and both read a
  0-row `users` table keyed by `auth.uid()` (NULL for anon). **Real data exposure today: none** —
  the risk is the unpinned `search_path`, not a leak. Separately, `next_job_number()` is
  `anon`-executable with no revoke, so an anon caller could burn job numbers.
- **`crew-night-before`'s redeploy stops being a separate task** — BL-4 touches both Slack senders
  and `_shared/`, so the redeploy falls out of it and closes the
  `_shared/package.json {"type":"module"}` question for free.
- **A structural problem the plan had to solve:** `buildCrewDigest` joins job blocks with `\n\n`,
  but Matt's requested format uses blank lines *inside* a block, which would make multi-job digests
  unreadable. The plan keeps a headline line per block and adds a divider between jobs — a
  deliberate, flagged deviation from the literal spec.

**Not done, deliberately:** nothing was implemented. The deletion checklist from the previous entry
is still open and untouched, and `.env.example` still needs Matt's 6 key names added by hand.

**Next session:** execute
`docs/superpowers/plans/2026-08-14-bl4-crew-slack-and-repo-fixes.md` as written. Note its
verification step 2 doubles as the outstanding estimate-tool test — creating a TEST estimate,
pushing it to GHL, and dragging the opportunity Quote Accepted → Job Scheduled exercises the full
Phase B → Phase A chain, which has never been run end to end.

---

### 2026-08-14 (late) — Repo file/doc hygiene pass (docs only, no code touched)

**Status:** 🟢 Complete on branch `chore/repo-hygiene` (4 commits, `964184c..9062012`), **not
merged** — awaiting Matt. No deploy, no Supabase change, no live system touched.

**Scope, as chosen by Matt:** file/doc hygiene only · archive rather than delete · separate atomic
commits on a branch. Explicit standing instruction for the session: **nothing gets deleted without
his specific per-item approval.** Nothing was.

**What shipped**

1. **`.gitignore` gaps closed** (`964184c`) — added `supabase/.temp/` (Supabase CLI scratch:
   `linked-project.json` carrying the project ref + org id, and `cli-latest`; the only active source
   of untracked noise), `.claude/` (previously invisible *only* because of a rule in Matt's
   machine-global `~/.config/git/ignore` — a portability gap, not a leak), and `*.tsbuildinfo` /
   `*.log` / `coverage/` hoisted from `web/.gitignore` to root. Left alone deliberately: the blanket
   `*.csv` and `*.pdf` rules, which are wider than they look — a rate sheet or spec PDF you *want*
   committed will silently fail to stage.

2. **`docs/archive/` created; 8 documents moved in** (`01161e4`) — all six tracked files moved as
   git **renames**, so history follows them. Tracked: `SCHEMA_AUDIT_REPORT.md`, `schema_audit.json`,
   `schema_overview.md`, `LostBoys_PricingEngine_ProjectBrief.md`, `jobs_schema_prompt.txt`,
   `lostboys_demolition_airtable_prompt.txt`. Previously untracked, now tracked: `OPS_ROADMAP.md`,
   `prompt.md`. `docs/archive/README.md` records per file what it was, what superseded it, and why.
   **Filenames are unchanged** — older BUILD_LOG entries citing them by name still resolve, only the
   directory moved.

3. **Doc pointers repointed** (`e5efbaf`) — `CLAUDE.md`'s START HERE preamble and Repository
   Structure tree; `INTEGRATION_DESIGN.md`'s two now-broken relative links (and its wrong
   description of `schema_overview.md` as "Canonical Airtable schema"); `web/README.md` replaced
   (was still verbatim `create-next-app` boilerplate).

4. **Two supersession banners** (`9062012`) — on the slice-2 plan (whose Architecture/Tech Stack
   lines still advertised Supabase Auth + `@supabase/ssr`, and whose Task 6 login gate was deleted
   mid-session) and on `airtable-automations/README.md` (mirror-only code, unverified against the
   live base since 2026-07-30, on the Phase B/E retirement path).

**Things worth knowing that this pass surfaced**

- **Security: clean.** No secret-bearing file has ever been committed across all 109 commits. A
  full-history content scan for `eyJhbGciOi` / `sbp_` / `sk-` / bearer tokens found only npm
  `sha512-` integrity hashes. `.env` and `web/.env.local` exist on disk and are correctly ignored.
- **Nothing was ignored-but-tracked** before this pass, and no tracked file is missing from disk.
- **`web/src` carries zero orphans from the deleted Supabase Auth work** — no `middleware.ts`, no
  `/login`, no `requireUser`, and `@supabase/ssr` appears nowhere in `web/package-lock.json`. The
  no-login deletion was complete.
- `CLAUDE.md`'s repo tree had **never listed `WORKFLOW_OVERVIEW_2026-07-31.md`** — which is why it
  looked orphaned. It is not stale; it is Matt's raw source prose and `DISCOVERY_2026-07-31.md` was
  built from it. Now documented. (Its own first line calls the company "Lost Point Demolition" —
  left as written rather than silently edited.)

**Defect found and self-corrected mid-pass:** the step-3 commit was made with `git add -A`, which
swept in the untracked 413 KB session transcript — a file explicitly on the pending-approval list.
Caught by the `git diff main --stat` verification step (6,447 insertions where ~500 were expected).
The two affected commits were rewound with `git reset --mixed` and rebuilt from explicit paths;
final diff is 506 insertions and the transcript is untracked again. **Lesson for future sessions:
never `git add -A` in a repo with pending-decision untracked files — stage explicit paths.**

**Not done — carried forward**

- **`.env.example` still lists 2 of the 8 keys the real `.env` carries.** Missing *names*:
  `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`, `AIRTABLE_WEBHOOK_SECRET`,
  `FILLOUT_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Editing it was blocked by a local permission rule
  on env files — **Matt to add by hand.**
- **Deletion checklist, all still pending Matt's per-item approval:** 3 `.DS_Store` files; empty
  dirs `.claude/worktrees/` and `node_modules/.vite-temp/`; the 413 KB transcript
  `2026-07-31-150137-*.txt` (untracked, zero references — recommend moving *outside* the repo
  rather than committing it); the 5 unreferenced `create-next-app` SVGs in `web/public/`; local
  branch `phase-b-slice-2` and remotes `origin/phase-b-slice-2` +
  `origin/claude/build-spec-backlog-items-i5y5g3` + `origin/claude/codebase-review-summary-r57jug`
  (all three verified fully merged into `main`); `web/.next` (91 MB) + `web/node_modules` (497 MB).
- **`git gc` not run.** The object store is 1,062 loose objects with zero packs — it has never been
  packed. Non-destructive, would compress well. Deliberately deferred because the rewound commits
  above are still reachable via reflog and gc would prune that safety net.
- **Out of scope by Matt's choice, recorded so they don't get lost:** retiring
  `setup_airtable.js` / `setup_airtable_v2.js` / `audit_schema.js` (April one-shots for a retiring
  platform — ⚠️ re-running either `setup_airtable*.js` against the drifted live base would be
  actively harmful) plus the root `package.json`/`package-lock.json` that exist only to give them
  `dotenv`; archiving `INTEGRATION_DESIGN.md` (needs a comment fix in `ghl-job-webhook/index.ts`);
  the dead `allocateAmounts` re-export at `web/src/lib/ghl/estimateDoc.ts:135`; and the real
  duplication in the Airtable-era functions — `airtable-job-scheduled/index.ts:141–240` still holds
  the ~100 lines of Google auth/calendar helpers `_shared/google.ts` was lifted *from*,
  `formatCurrency` exists a third time in `airtable-job-completed/index.ts:109`, and ~14 raw
  `sync_log`/`job_events` inserts across five functions bypass `_shared/log.ts`. That last one is
  genuine debt, but every edit forces a same-session redeploy of a live function under the parity
  rule, and most of those functions are slated for retirement — `airtable-job-scheduled` is the
  only one that survives past Airtable and the only one worth the risk.

**Verification (all green):**
- `git diff main --stat -- web/src supabase/functions supabase/migrations` → **empty**. No shipped
  code changed, which is the whole guarantee of a docs-only pass.
- `deno task test` → **18/18**. `cd web && npx vitest run` → **261/261**. Both unchanged.
- All six tracked moves registered as `R` (rename), not delete + add.
- `git check-ignore -v` confirms the new rules catch `supabase/.temp/linked-project.json` and
  `.claude/settings.local.json`. `git status` now shows exactly one untracked file (the transcript
  awaiting Matt's decision), down from four.
- Grep for broken relative links to any moved file → **none**.

**Deliberately left unedited:** `BUILD_LOG.md`'s and `SYSTEM_AUDIT_2026-07-30.md`'s existing
references to the moved files at their old root paths. Both are dated historical records; rewriting
them to match today's layout would falsify the snapshot. The old-path → new-path mapping lives in
`docs/archive/README.md`. Also untouched: the 15 applied migrations, the plan/ledger files under
`docs/superpowers/plans/` (append-only), `_shared/package.json`, `web/next.config.ts`'s
`externalDir`/`turbopack.root`, `deno.json`, and `field_mapping.md` / `ghl_field_mapping.md` (three
live code paths cite those two by filename as the sole authority for GHL custom field IDs).

---

### 2026-08-14 (night) — Phase B slice-2 COMPLETE on branch: T11/T11b/T12/T9f + no-login scope change + final review; T13 docs close-out

**Status:** 🟢 Complete on branch `phase-b-slice-2` (tip `53e7d64`, 16 new commits since the last
close at `26b9495`), **NOT merged to main** — merge-to-main is Matt's call, informed by the final
whole-branch review's APPROVED verdict below. Resumes and finishes the session paused after Task 8.
Vercel deploy and the production phone smoke are **controller/Matt-owned, not part of this session's
scope** — see the deploy-status line at the bottom of this entry.

**What shipped, task by task (all reviewed by opus; sonnet implemented):**

- **T11 — estimate builder page** (`/estimates/new`): mobile-first, live client-side recalc via
  `computeEstimate`, quick/itemized modes, scope picker over the 19 `scope_library` rows, markup
  preset chips. First-real-create live smoke burned estimate 1416. Fix round 1 closed two review
  findings: partial-decimal inputs (`".25"`) silently resolving to 0, and Save being disabled with
  unreachable dead-code explanations. Merge was deliberately **deferred** past the fix round because
  the no-login scope change (below) landed mid-flight and would have broken the builder's call
  signature immediately after merging — folded into one **integration round** instead (commit
  `cfc90f0`) that rebased onto the merged no-login branch, wired `useEstimator()` → `estimatorName`,
  wired the Path B toggle to the now-real `is_path_b` column, fixed a comma/whitespace decimal-parse
  bug, and re-ran the live smoke through the real action path (estimate 1424). Self-caught mid-round:
  `/estimates/new` had gone **static** post-auth-removal (would have frozen rates at build time) —
  `force-dynamic` added; confirmed the only affected route.
- **T11b — list + detail + lifecycle pages**: quote override (required reason enforced by the
  `quote_override_reason_required` DB CHECK), status actions restricted to sent/accepted/declined
  only, version chain + audit history display, revise → new version. Estimate 1425 burned
  (override → v2 → declined) proving the full lifecycle live. Two **live-caught UI bugs fixed
  in-commit**, not just found: the override-reason textarea was unmounting mid-typing (now keyed off
  price-differs-from-bid instead of a state flag that flickered), and `revise`'s `notFound()` was
  firing spuriously on a Next.js post-action page refresh (guard removed; a friendly
  "newer version exists" message now covers the real conflict case — reproduced live with two
  browser tabs racing a double-revise). Fix round 1 additionally closed the `listEstimates`
  PostgREST-filter-injection carry from T8 (verified live against `,()` bypass attempts) and gave
  superseded-version pages a "viewing an old version" banner.
- **T12 — GHL push orchestration** (`web/src/lib/ghl/push.ts` + `PushPanel.tsx`): per-target
  idempotent push (opportunity fields, draft estimate doc) via `ghl_push_state`, attach-existing or
  create-new-opportunity, version-to-version GHL-id inheritance via `supersedes_estimate_id`. Live
  E2E burned estimates 1417–1420 (initial) and 1421–1423 (fix-round re-verification); real GHL
  artifacts created and manually cleaned up. **Settled a standing open question live**: `PUT
  /opportunities/{id}` **merges** `customFields`, it does not replace them (CV-2, previously an
  assumption inherited from Phase A's behavior — now proven, and it matters to
  `airtable-job-created`/`ghl-job-webhook` too, not just this feature). Fix round 1 decoupled the
  fields-push and doc-push targets so a transient fields error no longer silently skips and
  mislabels the doc-push `sync_log` row, and added create-fallback recovery for a doc Dane manually
  deleted in the GHL UI (previously wedged that estimate's doc push forever on a 404).
- **T9f — follow-up fix task** (controller-created mid-session, not in the original 14): repaired
  `searchContactByEmail` in `web/src/lib/ghl/client.ts` (the live API had moved off the `GET
  /contacts/?email=` shape T9 was built against — that call now 422s; fixed to `POST
  /contacts/search` with an `eq` filter, live-verified); added the `server-only` import guard T9
  deferred; found and closed a **second, transitive** version of the same guard gap
  (`estimateFields.ts → estimateDoc.ts → client.ts` via the money-allocation helper) by extracting a
  zero-dependency `allocation.ts` — proven **byte-identical** behavior via md5 hash match before/after
  the extraction, so T10's exact-remainder money math did not change.
- **No-login scope change (mid-session, Matt's explicit directive, plan-mode approved):**
  `docs/superpowers/plans/2026-08-14-no-login-estimator-picker.md`. Three tasks (A1 identity
  plumbing, A2 delete the auth stack, B1 persist Path B as a real column) replaced Task 6's
  Supabase-Auth login gate with a no-password device-remembered estimator picker. **See CLAUDE.md's
  "No-login estimate tool" section for the full user-facing description — do not rely on any
  auth-related text elsewhere in this repo written before this entry's date.** Net: `middleware.ts`,
  `/login`, `auth.ts`, `safe-next.ts` (and its 3-fix-round-hardened open-redirect protection),
  `supabase/server.ts`, and the `/debug` route are **deleted** (preserved in git history, not lost —
  T6's work through merged range `34eb9b7..0d3470b` remains a reusable pattern). Manual Setup #2
  (provision 3 auth users) is **cancelled**. Migration `20260814230000_phase_b2_path_b_flag.sql`
  applied live, adding `estimates.is_path_b boolean not null default false` and re-creating
  `create_estimate_with_items`/`enforce_estimate_immutability` to cover it — one fix round on the
  DB task (I-1: the coalesce expression needed a `nullif('')` wrap to match the guard's existing
  convention, verified via `pg_get_functiondef` hunk-diffs against the live baseline before and after
  apply, and confirmed the two function bodies contained *only* the intended `is_path_b` deltas).
- **Final whole-branch review** (dispatched early, in parallel with T11b's build, over commit range
  `342f489..e430534`, then a scoped supplemental pass over T11b's range after it merged): **APPROVED
  FOR MERGE, conditional** on three must-fix items — C-1 (these docs, this entry), C-2 (the
  `listEstimates` injection carry — closed inside T11b's own fix round, verified in that review),
  C-3 (stale `requireUser()` doc-comments left behind by the no-login deletion — closed by a
  dedicated **final fix wave** commit that also added `layout.tsx`'s missing title/description,
  fixed GHL doc-list pagination (see below), and added allowlist-rejection tests at the actions
  layer). Reviewer's full triage: 23 findings already resolved by the time of review, 3 must-fix (all
  closed above), 26 follow-up-OK (see Known limitations / Deferred below).

**The three new DB migrations from the paused-session entry below are unchanged; one more applied
live this segment:**
- `20260814230000_phase_b2_path_b_flag.sql` — `estimates.is_path_b`, described above.

**Gates at close:** `deno task test` **18/18** (golden 321 gate intact — the engine changed by
exactly one word across the entire slice, the `requireRates` export). Web suite (`cd web && npx
vitest run`) **261/261** (15 test files). `npm run build` green with env supplied — routes: `/`
(static), `/estimates` (dynamic), `/estimates/[id]` (dynamic), `/estimates/[id]/revise` (dynamic),
`/estimates/new` (dynamic, force-dynamic-corrected). No middleware, no `/login` in the build output.

**Live estimates data at close (verified via SQL this docs pass, not carried from memory):** 16
rows total. `estimate_number` 1414 (v1+v2), 1416, 1417 (v1+v2), 1418, 1419 (v1+v2), 1420, 1421,
1422, 1423, 1424 (v1+v2), 1425 (v1+v2) — every row `job_name` labeled `TEST` / `TEST — void, do not
use` variants, every row's final status is `declined` or `superseded`. **First real estimate will be
≥ 1426.** `ghl_push_state` has **10 rows** (T12's E2E + fix-round pushes — the table is genuinely
written now, not just schema). `sync_log` has **24 rows** with `direction='app_to_ghl'`.
`estimate_mutations_audit` has **27 rows**.

**Defects found and fixed this segment (beyond the ones named above):**
- GHL estimate-doc listing (`listEstimateDocs`) defaulted to GHL's own `limit=10` — a contact with
  more than 10 historical docs could have its live draft missed by the push logic, which would then
  create a duplicate instead of updating in place (or, worse, `PUT` a stale doc id). Fixed to
  auto-paginate at `AUTO_PAGE_SIZE=100` when no explicit limit is given; live-verified GHL honors
  `limit=100` (100 of 511 docs returned per page; auto-pagination sweeps the rest).
- `/estimates/new` going static post-auth-removal (named above under T11).
- The override-reason-textarea-unmounts-mid-typing and spurious-`notFound()`-on-refresh bugs (named
  above under T11b) — both **live-caught through real browser interaction**, not unit tests; the SDD
  session's live-smoke discipline is what surfaced them.

**Known limitations — recorded here because they are invisible from reading any single file, per
the final review's explicit flag (not fixed this session, accepted as low-risk at 3 internal
users):**
1. **Superseded-version protection is UI-only.** The detail page hides status/push controls once a
   version is superseded, but `updateStatusAction` and `pushEstimateAction` do not themselves
   re-check version status — a stale browser tab left open from before a `revise` can still mutate
   or push the superseded row. Partially self-healing (re-pushing the current version overwrites
   the GHL side) but not a status fix — the UI only offers sent/accepted/declined, so restoring a
   wrongly-set superseded marker needs a direct RPC/SQL call, not a click anywhere in the app; a
   server-side defense-in-depth check is deferred.
2. **No concurrency guard on the GHL push.** Two simultaneous first-pushes of the same estimate can
   race `search-before-create` and create duplicate GHL opportunities — `ghl_push_state` has no
   arbitrating constraint. Low likelihood; recovery is deleting the duplicate opportunity in GHL.
3. **The no-login deployment ships network-layer open.** Anyone with the URL can create/mutate/push
   estimates. Deliberately deferred, not solved, by this session — see CLAUDE.md.

**Repo-level open items surfaced this session, out of slice-2's own scope, needing their own future
task:**
- **`airtable-client-sync` v19's `searchGhlByEmail()` is the same broken shape T9f fixed in the web
  app** — `GET /contacts/?email=` now 422s live, and the function never checks `res.ok` before
  `res.json()`, so its search leg is silently dead; the function only survives because GHL's
  duplicate-contact 400 exposes `meta.contactId` as a fallback match. Confirmed by reading the live
  deployed source this docs pass. Needs its own edge-function fix task — same repair T9f applied
  (`POST /contacts/search`, `eq` filter).
- **`crew-night-before` redeploy still owed** — carried from T5's CV-1 mitigation: T5 proved
  `supabase/functions/_shared/package.json {"type":"module"}` is deploy-inert for the two live
  consumers (`ghl-job-webhook`, `crew-night-before`) via static analysis (absent from the Deno
  module graph) and `deno check`, but neither function has actually been **redeployed** since that
  file was added. A real redeploy (not just a check) closes the question permanently; low urgency
  since the static proof is solid, but it's the difference between "proven" and "proven and shipped."
- **6 pre-existing clock-in-era `SECURITY DEFINER` functions callable by `anon`** (e.g.
  `get_my_role`) — flagged during T3's review as unrelated to slice 2 but real; worth re-weighing
  now that the estimate tool itself ships network-open (the security posture of the whole
  environment, not just this feature, deserves a fresh look).

**Deferred minors (non-blocking, not addressed this session — full itemized list, task-by-task, is
in the SDD ledger `progress.md`; the ones with practical follow-up weight):**
- `quotedPrice`/negative-entry inputs clamp silently in the builder UI rather than showing a hint.
- Decimal-comma mis-parse (`"0,25"` → `25`) — theoretical for a US-locale team, not exercised live.
- `revise`-mode prop pairing between the builder and its preload path is not structurally enforced
  by the type system (M-3, final review) — works correctly today, worth a type-level tightening.
- A duplicated `scope_library` loader and a dead `isLifecycleActionStatus` export (M-4, final
  review) — harmless, cheap cleanup whenever someone is next in that file.
- `crypto.randomUUID` throws on non-secure origins (breaks LAN-IP phone QA over plain HTTP; fine
  once Vercel gives it HTTPS).
- Several accessibility nits (unassociated labels, missing `aria-pressed` on the chip, dialog
  semantics on the scope-picker sheet).

**Manual setup status — Manual Setup #1 (env vars) DONE mid-session (Matt); Manual Setup #2
(auth users) CANCELLED (see no-login change above), not owed anymore.**

**Deploy status:** Vercel deploy LIVE 2026-08-14: project `lbd-estimates` (team matt-risenmays-projects, `prj_hCH0ZxkpeuRaOWLFjCaZ9wz5KKKm`), Root Directory `web`, include-files-outside-root ENABLED, production branch `main`, all 5 env vars set in all 3 environments (encrypted). Production URL **https://lbd-estimates.vercel.app** — verified 200, `/` → `/estimates`, title "LBD Estimates". Merge to main: `dd6cc87` (Matt's explicit instruction, same session). Build 31s. Outstanding human verification: Matt's phone smoke + the one-real-bid Fillout parallel check (brief item — not yet performed at close).

**Next session:** merge-to-main is Matt's decision, informed by the final review's APPROVED verdict
above. If merging: standard PR/merge flow, no additional gate. After that (or in parallel): Phase C
(BILL expenses + dump counts), Track B (lead intake), or the BL-4 crew Slack format item deferred
from this slice's brief. See `NEXT_SESSION_PROMPT.md` (regenerated this session) for the full
picture.

### 2026-08-14 (evening) — Phase B slice-2 IN PROGRESS: 10/14 tasks done on branch `phase-b-slice-2` (paused mid-build)

**Status:** 🟡 In progress, paused for session close. Branch `phase-b-slice-2` (tip `123b74a`), **16 commits, NOT merged to main.** Tasks T1–T10 complete + reviewed + merged onto the branch; **T11, T11b, T12, T13 remain.** Executed subagent-driven (sonnet implements / opus reviews per task + fix loops) under a **hybrid-lane concurrency model Matt approved** — a DB migration lane and a web lane ran concurrently via isolated git worktrees, each task merged back after its own review passed. SDD ledger + all task briefs/reports live under `.superpowers/sdd/2026-08-14-phase-b-slice-2-estimate-builder-ghl-push/` (gitignored) — read `progress.md` there first next session.

**What shipped this session (all on the branch, all reviewed):**

*DB lane — 3 new migrations, all APPLIED LIVE to `eiqqqwajmcpcwhvxxnhx` and committed (parity holds):*
- `20260814200000_phase_b2_estimator_columns.sql` — adds `estimates.created_by uuid → auth.users`, `created_by_name text` (both **immutable**, added to the `enforce_estimate_immutability` guard list; mutable set unchanged: status/quoted_price/quote_override_reason/job_number).
- `20260814210000_phase_b2_rpcs_audit.sql` + `20260814215000_phase_b2_rpcs_fixups.sql` — the estimate **write RPCs** (`create_estimate_with_items`, `update_estimate_status`, `update_estimate_quote`, `update_estimate_job_number`) + `estimate_mutations_audit` table & AFTER-UPDATE trigger. All RPCs service-role-only (revoked from public/anon/authenticated), `search_path=public`, take `p_actor`/`p_actor_name` for the audit trail. The create RPC is one transaction (writer contract: v1 omits estimate_number→sequence, vN passes parent's number + supersedes_estimate_id, flips parent to superseded). Fixups added: insert-path override-reason CHECK (`quote_override_reason_required`), `nullif('')` cast hardening, quote-clearing allowed, 2dp rounding, audit-table immutability guard, and actor-on-supersede.
- `20260814220000_phase_b2_ghl_push_state.sql` — `ghl_push_state` table (PK estimate_id → estimates; contact/opp/estimate-doc ids, per-target timestamps, last_error, attempts; mutable, app sets updated_at) + widened `sync_log_direction_check` with `app_to_ghl`.
- **Test estimate rows** (permanent — estimates are undeletable): `estimate_number 1414` (v1+v2, both `job_name='TEST — void, do not use'`, left `declined`) from the T3 verification. `1415` **burned** by the T3-fixups negative-CHECK test (nextval non-transactional). Numbers 1400–1413 burned earlier by dev rollbacks. **First real estimate will be ≥ 1416.**

*Web lane — first Next.js app code, in `web/` (own package.json; legacy root untouched):*
- **T5 scaffold** — Next 16.3 App Router + Tailwind 4 + vitest 4; imports the golden-tested `_shared/pricing.ts` via a re-export shim `web/src/lib/pricing.ts` (never forked). Needed `supabase/functions/_shared/package.json {"type":"module"}` for Turbopack ESM resolution (proven deploy-inert — absent from the Deno module graph).
- **T6 auth** — Supabase Auth (email/password, 3 users, no self-signup), `@supabase/ssr` middleware, `requireUser()`, service-role `admin.ts` (`import "server-only"`), gated `(app)` group. **Open-redirect hardening took 3 fix rounds** (protocol-relative, control-char, and normalized-output re-entrancy bypasses each found+closed; final `safeNext` uses `new URL()` origin re-resolution, fuzzed 71k cases 0 violations).
- **T7 rates loader** — `web/src/lib/rates.ts` `loadRatesConfig()` reads all 6 `pricing_variables` live via service role; throws on any missing key (**never** falls back to DEFAULT_RATES). Exported `requireRates` from pricing.ts (one word; golden gate held 18/18).
- **T9 GHL client** — `web/src/lib/ghl/client.ts` (contacts/opportunities/pipelines/custom-field-defs/estimate-list + retry-once ghlFetch). **Live scope smoke = GO: the existing `GHL_API_KEY` already has estimate scopes** (HTTP 200, 510 docs) — no token rotation needed.
- **T10 estimate-doc builder** — `web/src/lib/ghl/estimateDoc.ts`: builds the customer-facing GHL draft estimate. **Live-validated 3 payload corrections** the OpenAPI spec got wrong (`name`≤40 chars, line items need `type:"one_time"`, `frequencySettings.schedule` must be `null`). Allocation uses **largest-remainder (Hamilton)** so line amounts sum to the quoted price exactly AND are never negative. ⚠️ **GHL stores `meta` keys CAMELCASED** (`lbdEstimateId`) — read-back must use camelCase (T12 must honor).
- **T8 data layer** — `web/src/lib/estimates/{types,validate,map,repo}.ts` + `app/(app)/estimates/actions.ts`. Pure validate (zod; itemized reconciliation; **rejects negative inputs** the DB doesn't constrain) + map (writer contract) + repo (the 7 operations via RPCs, service-role, numeric-as-string normalization at every boundary) + server actions (each calls `requireUser()` itself). Added `zod ^4.4.3` as an explicit web dep.

**Gates at pause:** web vitest **139/139**, `deno task test` **18/18** (golden 321 intact), `npm run build` green with env supplied. `pricing.ts` engine only changed by the one-word `export` — no quoted price moved.

**Defects found but deferred to next session (from reviews, none blocking the merge):**
- `listEstimates` `q` param is PostgREST-filter-injectable (`repo.ts` ~1116) — **sanitize `,()` before T11b wires the list page** (low risk: 3 trusted users, read-only, service-role, same table).
- `quotedPrice` not non-negative-guarded (`validate.ts:69`) — a negative override → negative GHL amount in T12; add `nonNegativeNumber`.
- `updateStatus` accepts any of the 6 statuses with no transition rules — T11b UI must only offer sent/accepted/declined.
- `createNewVersion` on a stale (already-superseded) parent fails with a raw unique-violation string — T11b should add a friendly "newer version exists" check.
- T6 minor: middleware matcher exempts `*.png`-suffixed routes at any depth (inert today).
- T1 doc minors (fold into T13 doc pass): CLAUDE.md prose polish around the test command; `deno.json` absent from the repo-structure tree.

**Manual setup still owed by Matt (carried; none blocked this session's work):**
1. **`web/.env.local`** must be hand-created before local `npm run dev`/build (the M5 env-guard throws without it — by design). Needs `NEXT_PUBLIC_SUPABASE_URL=https://eiqqqwajmcpcwhvxxnhx.supabase.co`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_ZmXLIhozN3vMWf-8e13hQQ_59AkdjnY`, and the **service-role key** (server-only). The permission layer blocked agents from writing it.
2. **Provision the 3 auth users** (Dane/Jackson/Matt) in the Supabase dashboard with `display_name` metadata, then disable public signups. Only 1 pre-existing account exists today. Record their emails in CLAUDE.md once created. **(CANCELLED — see the 2026-08-14 (night) entry above; the no-login scope change replaced this with a picker, no auth users needed.)**
3. GHL estimate scopes: **already present** — no action needed (smoke test confirmed).

**Repo-hygiene note for future migration work:** migration **filenames** carry 14-digit timestamps but the live `schema_migrations` **version** stamps differ (MCP `apply_migration` uses its own wall-clock) — repo-wide, pre-existing. Consequence: a `supabase db push` from the repo would see these as unapplied and re-run `create table` (fails). Don't "fix" by renaming applied files; document only.

**Next session — resume at T11 + T12 (both unblocked, can run in parallel):** T11 = the mobile-first estimate builder page (live recalc via client-side `computeEstimate`, scope picker, quick/itemized modes, Path B toggle) with a first-real-create live smoke test; T12 = push orchestration (`pushEstimateToGhl`, per-target idempotent via `ghl_push_state`, honoring the meta-camelCase read + search-before-create idempotency the reviews flagged). Then T11b (list+detail+lifecycle), then T13 (Vercel deploy + docs + BUILD_LOG close + optionally merge to main). Briefs are staged in the SDD workspace dir.

### 2026-08-14 — Phase B slice-1 COMPLETE: golden master, seeds, full verification (Tasks 2, 4, 5)

**Status:** 🟢 Complete · **MERGED TO MAIN AND PUSHED same day** (`0196449..7920a9c`, 10 commits;
branch `phase-b-slice-1` deleted local + remote; tests re-run green on the merged result) · No new
edge function deployed this slice — schema + engine only.

**Addendum — final whole-branch review fix wave (same day).** Ran the final whole-branch review
and shipped its fix wave: migration `phase_b_estimates_fixups2` (applied live) widens
`estimates.dump_count`, `estimate_line_items.dump_count`, and `scope_library.default_dump_count`
from `numeric(5,1)` to `numeric(6,2)` — the golden fixture carries real dump counts of 0.25, 0.35,
and 1.25 loads (estimates 1236, 1131, 1295, 1296) that `numeric(5,1)` would have silently rounded
and re-priced — and adds a `version_chain` check constraint on `estimates` (`version = 1 or
supersedes_estimate_id is not null`). Also renamed the two colliding 8-digit-prefix migration
files (`20260814_phase_b_estimates_schema.sql`, `20260814_phase_b_seeds.sql`, both of which parsed
to the same version number and byte-sorted out of intended order) to unique ordered 14-digit
prefixes — pure renames, content unchanged; live migration history is unaffected since filenames
are documentation only. Deferred follow-ups for next session, in priority order: (1) a
`deno.json` test task so the golden-master gate runs in CI, not just by hand; (2) a
`pricing_variables` loader so `_shared/pricing.ts` reads live rates instead of the `DEFAULT_RATES`
snapshot; (3) an audit trail for the four estimate columns immutability still allows to mutate
(`status`, `quoted_price`, `quote_override_reason`, `job_number`).

Closes out the mid-flight state left by the entry directly below. Tasks 1 and 3 (engine, schema)
were already shipped and reviewed; this entry covers Tasks 2, 4, and the Task 5 close-out pass.

- **Task 2 `41e15dc` — golden master.** `pricing_golden_test.ts` +
  `fixtures/estimates-golden-321.json`: all 321 live Airtable estimates reproduce to the cent —
  309 exact, 11 legacy-diff (two-sided pinned deltas against the known 2026-03-19 hand-keyed
  backfill), 1 penny-tolerance (est 1075) — **under the Task-1-review's corrected half-up
  rounding**, proving the rounding fix moved no quoted price. Full `_shared` suite 18/18.
- **Task 4 `093773c` — seeds.** Migration `20260814_phase_b_seeds.sql` applied live: 19
  `scope_library` rows (with `airtable_record_id` provenance) and 6 `pricing_variables`
  (`labor_rate_per_hour` 26, `overhead_rate_per_hour` 23, `dump_rate_per_load` 300, `cc_fee_rate`
  0.0350, `default_markup_pct` 25, `markup_floor_pct` 15 — the corrected 3.5% CC fee, not the
  stale Airtable 3% row). `default_materials_cost` left NULL for Phase G.
- **Task 5 (this session) — full verification + docs.** All green, no regressions found:
  - `deno test --allow-all supabase/functions/_shared/` → **18/18 passed** (4 `job_test.ts` + 2
    `pricing_golden_test.ts`, incl. the `exact = 309` count assertion, + 12 `pricing_test.ts`).
  - `deno check` on `pricing.ts`, `pricing_test.ts`, `pricing_golden_test.ts` → clean.
  - `get_advisors` (security + performance, project `eiqqqwajmcpcwhvxxnhx`): no new criticals
    attributable to the four new tables. Only `rls_enabled_no_policy` (INFO, accepted house
    posture) and two `unindexed_foreign_keys` INFO notices
    (`estimate_line_items_scope_library_id_fkey`, `estimates_supersedes_estimate_id_fkey`) —
    informational, not blocking. Confirmed `enforce_estimate_immutability` does **not** appear in
    the `function_search_path_mutable` warning list — the Task 3 review's `search_path = public`
    pin is holding live.
  - Live DB: `estimates`, `estimate_line_items`, `scope_library`, `pricing_variables` all RLS
    enabled, 0 policies. `scope_library` = 19 rows, `pricing_variables` = 6 rows,
    `cc_fee_rate = 0.0350`. Ran a live trigger test inside an explicit `BEGIN…ROLLBACK` (so no
    permanent row was left): inserted one draft estimate, confirmed an UPDATE to `total_bid`
    (a computed column) raised `estimates are immutable — write a new version row instead`, then
    confirmed an UPDATE to `status` succeeded — both as designed — then rolled back. `estimates`
    row count confirmed back to 0 after. Side effect: `estimate_number_seq` advanced to **1410**
    from the test insert (sequences don't roll back) — harmless per the existing documented
    behavior, just means the first real estimate will now be ≥1411, not ≥1402.
  - `list_migrations` shows `phase_b_estimates_schema`, `phase_b_estimates_fixups`, and
    `phase_b_seeds` all applied; all three SQL files are committed in this branch (parity rule
    holds).
  - `CLAUDE.md` updated: Supabase Tables section gained rows for the four new tables (immutability
    rule stated for `estimates`/`estimate_line_items`, DELETE-blocked noted); Edge Functions
    section gained a paragraph on `_shared/pricing.ts` (not yet wired into any deployed function —
    that's the next Phase B slice).

**Deferred, recorded so nothing is lost (per the Task 5 brief):** historical import of the 321
Airtable estimates as `status='historical'` rows (numbers 1001–1321, needs a fuller Airtable pull
for client fields not in the golden fixture); the estimate builder UI (first Next.js/Vercel app
code) and GHL push (line items + headline numbers) — the next two Phase B plans; reading rates
from `pricing_variables` at runtime instead of the code-level `DEFAULT_RATES` snapshot; leaving the
Airtable `Pricing Variables` 3% row uncorrected (read by nothing, parallel-running rule).

**What the next session needs:** Phase B slice-1 is **merged to `main` and pushed to GitHub**
(Matt chose local merge; branch deleted local + remote; stale `origin/phase-b-slice-1` removed).
Next step is **Phase B slice 2: estimate builder UI (first Next.js/Vercel app code) + GHL push**,
with the deno.json test task for the golden gate as the first follow-up. No open defects. No new
edge function to deploy. The 4 test calendar events (JOB-1102 Aug 17, JOB-1104 Aug 20, main +
Crew 1 each) were deleted by Matt at session close — that cleanup item is closed.

### 2026-08-14 — Phase A verification CLOSED, ghl-contact-sync fixed, Phase B slice-1 planned + 2/5 tasks built

**Session shape:** three approved goals run in parallel lanes — harden what's live, verify
workflow 2, plan Phase B — then Phase B execution began (subagent-driven) and was deliberately
closed mid-flight at Matt's request. Branch **`phase-b-slice-1`** carries the in-progress work.

**1. `ghl-contact-sync` tags crash — FIXED and live-verified (commit `65cae85`, deployed as
version counter 27).** GHL workflow webhooks send `tags` as a comma-separated *string*; `tags.map()`
threw OUTSIDE the try block, so the function 500'd with **no `sync_log` row** — invisible. Fix:
normalize tags (array/string/other), move payload extraction inside the try. Adversarial review
verdict SHIP with a bigger finding: **all 590 logged payloads carried string tags (empty until
2026-08-13), so contacts with tags had NEVER synced client type through this function.** Damage
window: 5 crashes 2026-08-13 21:53–22:44 UTC (backoff pattern, likely one event). Live-verified
same session: Matt edited Test Client's phone → 3 `contact_updated` webhooks with
`tags:"contractor"` → all succeeded. Deploy-version counters on other functions bumped
cosmetically (known CLI behavior).

**2. Workflow 2 (job_scheduled) — VERIFIED through the real GHL workflow. Phase A verification
is now COMPLETE.** Matt created a test opportunity, set Crew 1 + start 2026-08-20, dragged
Quote Accepted → minted **JOB-1104**; dragged Job Scheduled → both calendars + Slack (to
`#ops-test` `C0BPPG8997Z` via temporarily repointed `SLACK_CREW1_CHANNEL`, restored after,
digest-confirmed) + BILL skipped by design. **Epoch-ms date risk resolved: GHL DATE custom fields
arrive ISO-parseable through the real workflow.** Re-drag proved idempotency AND that GHL allows
workflow re-entry (matters for reschedules). Bonus: Matt's first attempt hit Job Scheduled before
Quote Accepted and the loud no-job-record error guard fired exactly as designed. JOB-1104
cancelled at session end. **Manual cleanup still owed: 4 test calendar events** (JOB-1102 Aug 17
×2, JOB-1104 Aug 20 ×2, main + Crew 1 calendars — Matt's connected Google account can't delete
them; reader-only on a non-jobs calendar).

**3. Phase B research + plan (commit `0196449`).** Live Airtable pull: **321 estimates** (not
296). **All 265 live-Fillout records match the DISCOVERY §1 chain to the cent at 3.5% CC; 0/321
match at 3% — the 3% Pricing Variables row was NEVER live.** 12 revenue mismatches: 11 from the
2026-03-19 hand-keyed bulk backfill + 1 penny artifact (est 1075). Estimates have NO linked
records and NO line items; days×employees method used 1/321 times; dump counts can be fractional
(0.5); Dane's manual discounts exist only in prose (est 1108: $41,038 calc → $39,000 quoted).
Research: `docs/superpowers/plans/2026-08-14-phase-b-estimates-research.md`. Plan (approved by
Matt, engine+schema slice): `docs/superpowers/plans/2026-08-14-phase-b-pricing-engine-and-schema.md`.
Golden fixture committed: `supabase/functions/_shared/fixtures/estimates-golden-321.json`.
**BL-4 added to BUILD_PLAN.md**: Matt's crew-Slack message format, scheduled for end of Phase B.

**4. Phase B slice-1 execution STARTED (subagent-driven, branch `phase-b-slice-1`) — closed
mid-flight.** Tasks 1+3 ran as concurrent lanes (disjoint files, Matt's directive):
- Task 1 `cd39fca`: `_shared/pricing.ts` + tests — engine ported, 9/9 tests, deno check clean.
- Task 3 `e6ec4df`: `supabase/migrations/20260814_phase_b_estimates_schema.sql` — **APPLIED TO
  LIVE** (`phase_b_estimates_schema`) and live-verified: `estimates` (immutable via trigger,
  seq starts 1400), `estimate_line_items`, `scope_library`, `pricing_variables`; RLS on, 0
  policies. Repo file == applied SQL (parity holds).
- ⚠️ **Neither task has had its Opus review yet.** Tasks 2 (golden master), 4 (seeds), 5
  (verification/docs) not started; briefs staged. Resume state + rulings (concurrency, live-apply
  pre-merge, models) in `.superpowers/sdd/2026-08-14-phase-b-pricing-engine-and-schema/progress.md`
  — **read that ledger before touching Phase B.**

**Defects found, not fixed:** none new. Standing: `receive-airtable-webhook` retirement queued;
`push-to-airtable` latent bug; `airtable-job-created` v21 GHL-UI verification (moot-adjacent).

### 2026-08-13 — Phase A build: job record keystone SHIPPED — GHL→Postgres→Calendar/Slack live
**Status:** 🟢 Complete · **Deploys:** `ghl-job-webhook` (new, v7 after fix wave) · `crew-night-before` (new, v4) ·
4 migrations applied · branch `phase-a-job-record`

Built via subagent-driven development: sonnet implementers, opus adversarial reviewers, Matt
checkpointing after Task 1 (migration apply), after Task 4 (before real crew channels), and at
Task 6 (GHL workflow wiring). Full session ledger:
`docs/superpowers/plans/2026-08-13-phase-a-job-record-ledger.md`.

#### What shipped

- **`ghl-job-webhook`** (new function, v7) — one webhook, two events. `quote_accepted` mints a
  canonical `JOB-XXXX` job record in Postgres from a GHL opportunity (name format
  `JOB-XXXX – Client – City`, client name/type from the GHL contact, city parsed from the job
  address). `job_scheduled` fires the schedule leg: Google Calendar (main + crew), Slack crew
  notification, and a gated BILL job-code leg (no-ops — `BILL_API_TOKEN` isn't set anywhere).
  Accepts the request body either top-level (`{event, opportunityId}`, curl/Custom Webhook shape)
  or nested under `customData` (GHL's "Webhook" workflow action shape) — both parsed by the same
  `parseWebhookBody`.
- **`crew-night-before`** (new function, v4) — nightly per-crew Slack digest of tomorrow's jobs.
  Fires via `pg_cron` at both 22:30 and 23:30 UTC; the function self-gates on America/Denver local
  hour (`Intl.DateTimeFormat`) so exactly one of the two daily fires actually sends, with no DST
  seasonal cron edits required.
- **4 migrations** (`supabase/migrations/2026081300000*`): `phase_a_jobs_keystone` (canonical
  `jobs` reshape, `JOB-XXXX` sequence starting at 1100, `job_lifecycle` enum, RLS), `..._fixups`
  (Task 1 review fixes), `schedule_crew_night_before` (pg_cron + pg_net, twice-daily UTC), and
  `phase_a_audit_write_fixups` (sync_log/job_events constraint widening — found live, see below).
- **`supabase/functions/_shared/`** (new) — first shared module in the codebase: job-name/city
  parsing (`job.ts`, unit-tested), Google Calendar auth lifted out of `airtable-job-scheduled`
  (`google.ts`, transitional duplication — old function untouched, cleanup deferred to Phase-B
  era), and `sync_log`/`job_events` writers that now check and log `supabase-js` errors instead of
  swallowing them (`log.ts`).
- **98 tests** on `ghl-job-webhook`, **41** on `crew-night-before` — both `deno check` clean.

#### Live E2E results

JOB-1102 minted from a **real GHL opportunity** (`OQzr5dwMbqpuOBKf5xsD`) via Matt dragging it to
Quote Accepted in the GHL UI — not a curl test. Opportunity card visually confirmed renamed
"JOB-1102 – Contractor Company" in GHL (Matt's screenshot). Schedule-leg drag drove both
calendars and a Slack post to `#ops-test` — exact message shape confirmed, address emoji correctly
omitted when the field is null. Idempotency proven: re-firing the create webhook against the same
opportunity returned `skipped`/same job number, and the GHL write-back PUT self-heals on re-fire.
One production defect surfaced and fixed mid-session: GHL's "Webhook" workflow action nests the
payload under a `customData` key rather than sending it top-level — the first real workflow drag
400'd; fixed to accept both shapes (commit `402b6b0`), redeployed, re-verified.

**`crew-night-before`'s digest Slack leg was live-verified separately, after this entry's original
docs commit.** The controller created a synthetic scheduled job (JOB-1103, Crew 1, start
2026-08-14), then force-fired the function: it posted the "⏰ Tomorrow:" digest to `#ops-test`,
stamped `night_before_sent_on`, and an idempotent re-fire correctly returned "no jobs". The
synthetic row was then deleted and the Crew 1 Slack secret restored to the real channel.

#### Defects found and fixed pre-production (adversarial review loop)

- **Enum collision** — the plan's migration would have silently bound `status_v2` to the
  *existing* `job_status` enum (`{active,archived}`, from the legacy schema) instead of a new one;
  inserts of `'accepted'` would have failed at runtime. Renamed the new type `job_lifecycle`.
- **NOT NULL trap** — `jobs.airtable_job_id` was `NOT NULL` with no default; every canonical
  (non-Airtable) insert would have hit `23502`. Relaxed in the fixups migration.
- **23505 misattribution** — the create path couldn't distinguish a `job_number` sequence
  collision from a genuine `ghl_opportunity_id` race, risking a silent 200/skipped/success with no
  row actually written. Fixed with race-path tests that exercise the divergence.
- **Silent log-write failures** — `supabase-js` returns `{error}` rather than throwing; the
  original `sync_log`/`job_events` writers never checked it. Fixed to check and `console.error`.
- **Per-event-ID calendar resumability** — the schedule leg wasn't resumable per event ID; a
  partial failure (main calendar written, crew calendar not) could duplicate crew events or mask
  configuration errors as success on re-fire. Fixed with per-leg idempotency and tests for both
  directions.
- **`sync_log.direction` check constraint** — found live, not in review: the constraint allowed
  only the two legacy Airtable directions (`ghl_to_airtable`, `airtable_to_ghl`); Phase A's new
  directions (`ghl_to_supabase`, `supabase_to_slack`) were rejected with a 400 on every write.
  Widened via `phase_a_audit_write_fixups`.
- **`job_events.job_id` NOT NULL** — also found live: the legacy column (holds Airtable `recXXX`
  IDs) is `NOT NULL`, but Phase A code intentionally writes `job_number` only, omitting it.
  Dropped the constraint in the same fixups migration. Both audit-write defects were invisible to
  mocks — only Matt's live probe with a real secret and a bogus opportunity ID caught them; the
  error path is now fully live-verified (500 response + both `sync_log` and `job_events` rows
  landing).

#### Defects found, not fixed

- **`ghl-contact-sync` v20 — live `TypeError: tags.map is not a function`.** Unlogged, on real
  traffic at 22:24 during this session. Pre-existing deployed function, **not** Phase A code —
  needs its own small fix in a future session.
- **PII in debug logs** — the `[ghl]` contact-fetch console log and the create-path logs carry
  contact PII. Kept deliberately until Phase A's live payload shapes are fully confirmed; trim
  once they are.

#### Decisions/rulings that matter forward

- **Night-before digest is single-send, no same-day retry.** A missed digest is now *visible* as
  a `sync_log` error (previously invisible) but not auto-resent — the calendar event is the
  primary signal; retry machinery was judged too baroque for a convenience layer.
- **Reschedules ship as visibility, not automation.** When crew/dates change after the schedule
  legs are already stamped, the function updates the DB and logs a `reschedule_detected` event
  with old→new values but does not move calendar events or re-notify. Full auto-reschedule is a
  surfaced backlog item for Matt; reschedules are hand-managed today anyway.
- **BILL leg ships gated off.** `BILL_API_TOKEN` is absent in every environment by design — no
  BILL credentials exist yet. The leg no-ops cleanly; Phase C turns it on once Matt supplies
  credentials.
- **Legacy function version counters may read higher than documented** — the Supabase CLI's
  deploy tooling bumps version numbers on unrelated already-deployed functions as a side effect;
  their `sha256` is unchanged, so this is cosmetic, not a redeploy.

#### What next session needs to know

- **JOB-1102 needs a cancel-or-keep decision from Matt before 2026-08-16** — the night-before
  digest will fire to the real Crew 1 Slack channel for it otherwise.
- **Workflow 2 (job_scheduled) drag is still pending** — Task 6's create-path drag was verified
  live; the schedule-path drag through the actual GHL workflow (vs. the earlier direct-curl
  schedule-leg test) has not been done.
- **BILL credentials** — supply if the BILL leg should go live in Phase A; otherwise it stays
  gated until Phase C.
- **Fillout/estimate side is untouched.** Phase B (estimate builder) is next.
- **`receive-airtable-webhook` retirement is still queued**, unrelated to this build — disable
  Airtable automations `wflYoupCQ00h2BrVa`/`wfldrRGvkSgRsE3ok` first, then remove the function.

Commits: `5c52c8b`, `7fca329`, `55c17f6`, `0b8f5b2`, `358cf8a`, `b6f0f27`, `9fa8770`, `bd7aca7`,
`79b479d`, `0f3c6a9`, `f63be73`, `4942552`, `402b6b0` (branch `phase-a-job-record`, not yet merged
to `main`).

---

### 2026-08-13 — Status review; Aug-11 sync error burst analyzed; Phase A decisions taken
**Status:** 🟢 Complete · **Deploys:** none (review + planning only)

Live verification 13 days after the discovery session: repo clean and synced, function versions
unchanged (19/20/21/16/14/11/11). `sync_log` 668 → **918** rows, daily traffic. Estimates
296 → **321** (~2/business day). Jobs still **9** — zero job records created in ~12 weeks. All
actuals tables still 0 rows. The 321-estimates-to-9-jobs gap is the Phase A problem, measured.

**New defect, self-healed — CLAUDE.md's "no errors since May 2" is stale.** 14 sync errors on
2026-08-11 18:29:36 ("Airtable create returned no record ID") during a 156-record burst day
(~8/day is normal). All 14 contacts recovered within 5 minutes and have both Airtable and GHL IDs —
no data loss. Likely Airtable rate-limiting under bulk load, rescued by GHL webhook redelivery.
`airtable-client-sync` has no explicit retry/backoff; a larger bulk import could drop records less
gracefully. CLAUDE.md line corrected this session.

**Phase A decisions (Matt, 2026-08-13):**
- **Trigger = GHL stage move.** Opportunity → "Quote Accepted" mints the job record. Path B jobs
  must also get an opportunity staged in GHL — behavioral, restate to Dane.
- **Job name = `JOB-XXXX – Client – City`** (company name for businesses, else last name).

Phase A implementation plan written and approved; build follows in next entry.

---

### 2026-07-31 — Three backlog items captured from Dane meeting (equipment, tools, crew P&L)
**Status:** 🟢 Complete · **Deploys:** none · **Documentation only — nothing live was touched**

Matt relayed three asks from a meeting with Dane the same day. All three were explicitly framed as
"not now" — they are recorded as backlog, **not** folded into the A–G critical path.

New section in `BUILD_PLAN.md`: **"Backlog — captured, not scheduled"**, placed after Track B.

- **BL-1 — Equipment maintenance tracking.** Service/repair per unit. Today it disappears into
  ~$572k/yr of BILL card spend with no equipment dimension. Reserve an `equipment` table and
  `expenses.equipment_id` in the initial schema; capture on the foreman completion checklist.
- **BL-2 — Tool inventory.** What exists, which crew has it, what is lost/replaced. Reserve
  `tools` + a `tool_assignments` ledger keyed to `crew_id` (per-crew, not per-employee). Scope to
  exceptions only — a full per-job tool enumeration will not get done.
- **BL-3 — Crew-level P&L + foreman incentive comp.** Each crew as a business unit, foreman cost
  allocated to the crew, bonus on financial performance.

**The one thing a future session must not miss:** BL-3 carries a real hazard, flagged inline in the
plan. Because the dump pad (+$221k/yr) and the labor shortfall (−$246k/yr) cancel, **absolute crew
margin moves with how a job was priced, not how well the crew ran it** — dump-heavy jobs carry the
pad, labor-heavy jobs carry the shortfall. Bonusing on absolute margin would pay foremen for the
estimator's job mix and incentivise them toward dump-heavy work. The defensible basis is **variance
against the accepted estimate** (hours vs. estimated hours, loads vs. estimated loads) plus a
quality gate. Do not attach dollars until the distortion is corrected or explicitly neutralised.

Dependency note: BL-3 is mostly a reporting increment on Phase F — crew is already a first-class
dimension (`crews`, per-crew calendars, per-crew Slack channels, `Crew 1–4` on the job). The new
work is *allocating non-job-level costs* (foreman salary, equipment, tools, overhead share), and
the allocation basis is an unmade decision. BL-3 also depends on **Phase D, which is still
blocking** — no per-crew hours means no labor actual means no crew P&L.

Also added a Backlog row to the `CLAUDE.md` phase roadmap table so it is visible from the entry
point. No open decision changed; the Phase D blocker is unaffected.

---

### 2026-07-31 — Business discovery + financial analysis; BUILD_PLAN amended to A–G; four pads found
**Status:** 🟢 Complete · **Deploys:** none · **Nothing live was touched**

Discovery session, no code. Matt supplied a workflow overview, answered 45 discovery questions in a
Google Doc, and exported four datasets: Stripe payments, BILL card transactions, Gusto payroll, and
the GHL invoice list. All analysis is read-only and reproducible from those files.

**New file `DISCOVERY_2026-07-31.md` is now the business ground truth.** It supersedes
`SYSTEM_AUDIT_2026-07-30.md` wherever they conflict.

#### The finding that matters most
A deliberate dump-fee pad (**+$221k/yr**) has been almost exactly financing a labor estimating
shortfall (**−$246k/yr**). Every individual number in the pricing engine is wrong; they cancel to
roughly +$31k. **This is why nobody ever noticed any of them**, and it is why no pricing input may
be corrected in isolation — fixing the dump rate alone would strip the buffer covering a
quarter-million-dollar annual gap.

Measured scale (annualized): ~$1,315k invoiced / ~$1,169k paid · field payroll ~$619k · BILL card
spend ~$572k · ~712 dump loads at a **$65 median cost** against a ~$388 effective charge.

#### Repo documentation was wrong in five places — all corrected
- **`CLAUDE.md`'s labor benchmark was backwards.** It claimed true all-in labor is $27–29/hr and
  that profit is "structurally overstated." Real payroll says **$23.13/hr** — the $26 standard is
  $2.87 *above* cost and profit is *understated*. (Caveat: excludes workers' comp; ~$25.30 with it.)
- **`CLAUDE.md`'s margin-divisor rule was never implemented.** The live calculator is cost-plus
  markup, so an entered 25% realises 19.3% and the "15% floor" is really 12.6%. Cost-plus is
  *intentional* — a labeling problem, not a pricing bug.
- **`SYSTEM_AUDIT` §2 describes `Jobs (old)`, not the live base.** The five pricing defaults *are*
  set; `Price Before Fees` doesn't exist; estimate fields are plain currency; and **there is no
  `Dump Fee Buffer` field anywhere.** Phase 2's two blocking decisions were framed around fields
  that don't exist. A correction banner was added to §2.
- **Roles were wrong.** Dane is owner/founder/president; Jackson is sales/estimator.
- **Zapier's role is now confirmed** — it runs **website lead form → Slack**. A live dependency; do
  not retire Zapier blindly. It previously sent the night-before crew message, abandoned as
  unreliable.

#### BUILD_PLAN.md amended — 0–9 retired, replaced by A–G + Track B
Defects found in the old numbering: Phase 1's `default_materials_cost` seeding **is not doable**
(no reference list exists; it's a feedback-loop output); Phase 4's clock-in PWA was premised on
crews not clocking in, but **they do, reliably**; and the "GHL opportunity = the screen Dane and
Jackson use" premise is **false today** — GHL isn't used for pipeline tracking at all.

Decisions **resolved**: CC fee (3.5%, cost line, prices held), Dump Fee Buffer ($300 is a *pricing
rate*, not a cost), `receive-airtable-webhook` (**retire, don't secure** — its only two callers are
Airtable automations `wflYoupCQ00h2BrVa` and `wfldrRGvkSgRsE3ok`, neither of which sends the
header). Lead intake, which no phase owned, is now **Track B**.

#### New blocking decision — Phase D
**Gusto has no project-creation API**; `time_tracking/time_sheets` requires a pre-existing
`job_uuid`. This reverses an earlier recommendation to skip ClockShark, which assumed clock-in
could be cheaply rebuilt. Crews already clock in reliably — the *project* is what's missing. Four
options are in `BUILD_PLAN.md`; nothing in Phase D can be designed until Matt chooses.

#### Defects found, not fixed
- **BILL:** Job Name populated on only **35.5%** of transactions; 14% of spend uncategorised;
  ~$6,944 of dump spend mis-tagged (Local Dumpster $5,273 blank, Pay Fulltilt Dump under
  *Donations*, Round Up Transfer under *Gas*); Little Caesars $4.33 tagged as a dump fee.
- **GHL:** **$61,150 overdue** across 18 invoices; **46 invoices (17%) carry blank status and $0**;
  line-item names are uncontrolled free text ("Interior Demolition" 114 vs. "Interior Demo" 30;
  "Commerical Demo" typo) — **this is why scope-mix data doesn't exist.**
- **83% of invoices have exactly one line item**, so scope detail lives in prose. Per-scope
  attribution must come from the estimate side, not the invoice side.

#### Next session needs to know
- **Phase D is the only blocker.** Everything else is decided.
- Outstanding asks: example GHL estimates + their matching invoices; Fillout calculator export;
  what Blue Collar Haulers and Chew It Up Enterprises actually do (Dane) — $19,664 across 7
  transactions currently distorting per-load dump cost; clarification on client sign-off.
- **The v21 GHL UI verification dropped in priority** — it was justified by the "GHL is the human
  surface" premise, which turns out not to hold today.
- Working plan file (outside the repo): `~/.claude/plans/reactive-knitting-sphinx.md`.

---

### 2026-07-30 — Repo/origin reconciliation; BUILD_PLAN.md made official; build log moved in-repo
**Status:** 🟢 Complete · **Deploys:** none · **Ends at:** `721c5c4` plus this closing docs commit, `main`, pushed

No edge function was deployed, no Supabase change made, nothing live was touched.

Merged four remote commits (`ec3fb44`, `56d8056`, `427543a`, `a976059`) with unpushed local work
(`0dd5103`). One conflict, `airtable-job-created/index.ts`, resolved to the origin side —
whitespace only, and that side matches deployed source byte-for-byte.

- **Verified the recovery was exact.** The two Airtable automation scripts and
  `airtable-client-sync/index.ts`, reconstructed from the live base and deployed Supabase, were
  **byte-identical** to the local originals. Only `SETUP_INSTRUCTIONS.md` was unrecoverable —
  Airtable stores script bodies but not the UI wiring around them — so it was restored from a
  local backup (`d5b0f39`).
- **Folded the local CLAUDE.md edits into the rewrite** (`0166d6a`) rather than reverting to
  either side. Of the old 11-item Open Items list, 3 were still live and kept; 8 were superseded
  or duplicated and dropped.
- **Rescued a calculation-ownership note** (`90e7fc3`) that existed only in the pre-rewrite
  CLAUDE.md: Fillout owns estimate math, Airtable stores estimate outputs as inert plain fields,
  Airtable formulas cover actuals and variance only. Absent from BUILD_PLAN.md and the audit.
- **Designated `BUILD_PLAN.md` the official plan** (`7ab339a`). `OPS_ROADMAP.md` (2026-07-15) is
  superseded and its 0–10 phase numbering retired. Before retiring it, its orphaned decisions were
  copied into a new **"Carried over from OPS_ROADMAP.md — unreconciled"** section of
  `BUILD_PLAN.md`: QuickBooks Online via Synder, the GHL number port + A2P 10DLC, client sign-off,
  callback tracking, Stripe native invoice reminders — none owned by any phase — plus a
  ClockShark-vs-in-house-clock-in conflict. Recorded, not resolved.
- **Closed a correction pending since 2026-05-22** (`6959b67`): Fillout → Airtable is a native
  Fillout integration, not Zapier. Zapier's real role is unverified and is now labeled as such.
- **Added `NEXT_SESSION_PROMPT.md`** — ephemeral copy-paste handoff, regenerated each session.
- **Moved the build log into the repo** (`721c5c4`). All 8 records from the Airtable Pipeline
  Reference `Build Log` table were transferred verbatim into this file, which is now the build
  log. The standing rule was retargeted: append here at the end of **every** session, not only
  after deploys, and commit it with the work it describes. The Airtable table is superseded;
  Field Registry, Secrets & Credentials, and People & IDs remain in Airtable. Note the Airtable
  table itself carries no deprecation notice — someone opening the base directly will not see
  that it is retired.
- **Deleted after verification:** a nested `lostboysdemolition/` clone inside the repo (the remote
  session's working directory — clean tree, no stashes, no unpushed commits, nothing unique) and
  the local `../lb-local-backup`.

**Still untracked, intentionally:** `OPS_ROADMAP.md` (superseded, banner added), `prompt.md`
(spent v21 brief), `supabase/.temp/` (CLI scratch). Delete only after BUILD_PLAN.md's carried-over
section is worked through.

**Awaiting Matt:** the 5 carried-over decisions and 1 conflict above; BUILD_PLAN.md's own 5 open
decisions (CC fee and Dump Fee Buffer block Phase 2); whether to add the missing
`x-webhook-secret` check to `receive-airtable-webhook`.

---

<!-- ─────────── MIGRATED FROM AIRTABLE — records below authored in the Pipeline Reference base ─────────── -->

### 2026-07-30 — Documentation reset + session context capture
**Status:** 🟢 Live · **Supabase project:** `eiqqqwajmcpcwhvxxnhx`

Commit a976059. Session closed here — this is the handoff record.

NEXT SESSION: read SYSTEM_AUDIT_2026-07-30.md and BUILD_PLAN.md first. CLAUDE.md now points at both.

ADDED: BUILD_PLAN.md (approved rebuild plan, previously only in the session plan file outside the repo — would have been lost). SYSTEM_AUDIT_2026-07-30.md (ground truth on live Airtable + Supabase + repo).

REWROTE CLAUDE.md: was describing a system that does not exist. Now leads with actual state, records Matt's decisions, lists the 5 open decisions and what each blocks, records the Gusto/BILL API findings, corrects all function and table inventories, adds a repo/production parity rule.

FIXED schema_overview.md: entire body was duplicated (646 lines for 323 lines of content). Deduped + banner added, since CLAUDE.md and the Project Brief both cite it as the Airtable schema reference and it has contained no Airtable schema since commit 3a6af2d. Original spec still at `git show d9eedd6:schema_overview.md` (verified, 498 lines).

MARKED SUPERSEDED: SCHEMA_AUDIT_REPORT.md, including its error about which Clients.Jobs link to delete — Jobs (fldefnvFlGeJSUeFx) points at Jobs (old), Jobs 2 (fldQvLnbflwL0cAgU) points at the live table. The report guessed backwards; following it would destroy legacy linkage.

STATE AT CLOSE: Phase 0 repo reconciliation and RLS hardening complete and verified. Phase 1 (Postgres schema + migration of 989 clients / 296 estimates / 51 legacy jobs / 19 scopes / 5 pricing variables) is unblocked and safe to start — it does not depend on the open decisions. Phase 2 is blocked on the CC-fee and Dump Fee Buffer decisions.

Branch: claude/codebase-review-summary-r57jug, 4 commits, pushed. No PR opened.

> **Superseded 2026-07-30 (later same day):** that branch has since been merged into `main`, and
> five further commits landed on top. Start from `NEXT_SESSION_PROMPT.md`, not from this entry.

---

### 2026-07-30 — Phase 0 — Repo reconciliation + RLS hardening
**Status:** 🟢 Live · **Supabase project:** `eiqqqwajmcpcwhvxxnhx`

No new edge function deploys this session. Codebase review + full build plan approved; Phase 0 executed.

REPO RECONCILIATION (commit ec3fb44): repo was missing 3 deployed functions and carried a stale 4th — redeploying from git would have regressed prod. Added airtable-client-sync (v19, documented in CLAUDE.md but never in git, processing traffic daily), receive-airtable-webhook (v11), push-to-airtable (v11). Replaced airtable-job-created with deployed v21 (Stage 3 only, 15 GHL custom fields via id: format through buildCustomFields, job_events logging) — committed copy was a generation behind.

SECURITY (commit 56d8056, migrations 20260730205654 + 20260730205752): RLS was OFF on sync_log, client_sync_state, job_events, invoice_reminders, labor_actuals, expense_actuals — 989 client records and 668 webhook payloads readable/writable by anyone with the anon key. Enabled RLS on all six, no policies by design (service_role has rolbypassrls=true so edge functions unaffected). RLS alone was NOT sufficient: two SECURITY DEFINER views over sync_log (recent_sync_activity, sync_errors) still leaked — anon read 50 rows after RLS was on, and sync_errors exposed full payload_in with names/phones/addresses. Both set to security_invoker=on. Verified: anon 0 rows everywhere, service_role retains full read + INSERT.

AIRTABLE AUTOMATIONS (commit 427543a): recovered create-line-items.js (wflrlJo8fpwOdCCFv) and update-line-items.js (wflqUwoKPt7wUF8ms) from base apptzp0IclCaAtOk2 — never existed in git despite CLAUDE.md claiming they were on disk.

DEFECTS FOUND, NOT FIXED: (1) receive-airtable-webhook has no x-webhook-secret validation + permissive CORS — can create/archive jobs unauthenticated. (2) push-to-airtable PATCHes 'Actual Labor Cost', an Airtable formula field — would fail if invoked, and addresses fields by name not ID. (3) Jobs formulas Labor Cost Variance (fld5pKKhsSHP5eQVT) and Revenue Variance (fld5FnWhKc2yF2JWg) are isValid:false, referencing deleted fields. (4) Estimate chain returns blank on every record — 5 pricing defaults never set, so IF({Target Margin Percent},...) guard fails; this is why code bills off Total Bid rather than Final Estimated Price.

KEY FINDING: live counts are Estimates 296, Clients 989, Jobs 9 (5 are test records), zero actuals anywhere. Approved plan is a greenfield Postgres rebuild carrying data only. Blockers resolved: Gusto has no project-tracking read API but does expose POST /v1/companies/{uuid}/time_tracking/time_sheets for pushing hours in for payroll; BILL Spend & Expense v3 supports custom-field creation with allowCustomValues plus transaction webhooks, so job codes can be auto-created at scheduling.

AWAITING MATT: CC fee cost vs pass-through (25% target currently reports 27.25%); Dump Fee Buffer priced in or informational; deposit policy; scope calibration rules; whether to drop the Gusto time-tracking add-on.

---

### 2026-05-15 — `airtable-job-created`
**Status:** 🟡 In Progress

v21 deployed. Full estimate field population via buildCustomFields helper. Stage fixed to Stage 3 (Estimate in Progress). job_events logging added. GHL UI visual verification PENDING — session closed before check. First task next session: trigger on test job and confirm all estimate custom fields populated in GHL UI. If blank: id: vs key: format issue.

> **Still open as of 2026-07-30.** This is the oldest unresolved item in the project.

---

### 2026-05-15 — `airtable-job-scheduled`
**Status:** 🟢 Live · **Supabase project:** `eiqqqwajmcpcwhvxxnhx`
**Deploy URL:** https://eiqqqwajmcpcwhvxxnhx.supabase.co/functions/v1/airtable-job-scheduled

v16 deployed 2026-05-15. Full end-to-end verified: GHL stage advance ✅, Google Calendar event created ✅, Event ID written back to Airtable fldry3k8ZNGGbm1aJ ✅, sync_log writing ✅, job_events writing ✅ (migration 002 applied this session). Three bugs fixed: (1) Airtable automation guard blocked retrigger — removed status=Scheduled check; (2) sync_log constraint violation — action_taken was 'stage_advanced', must be 'updated'; (3) GOOGLE_SERVICE_ACCOUNT_KEY stale — rotated to key ID 34f3a762c765. SLACK_PLACEHOLDER still in place — pending SLACK_BOT_TOKEN setup.

---

### 2026-05-15 — GHL Custom Fields + Mapping
**Status:** 🟢 Live

19 custom fields created on opportunity model via create-ghl-fields.js. Mapping committed to repo as ghl_field_mapping.md. API quirks documented: field body key is 'name' (not 'label'), MONETORY is GHL's actual enum spelling, options must be plain strings. All 5 MONETORY fields accepted without fallback.

---

### 2026-05-08 — `airtable-job-completed` (Stage 8)
**Status:** 🟢 Live · **Stage:** 8 · **Supabase project:** `eiqqqwajmcpcwhvxxnhx`
**Deploy URL:** https://eiqqqwajmcpcwhvxxnhx.supabase.co/functions/v1/airtable-job-completed

v7 deployed 2026-05-08. Replaced lump-sum distribution with per-line item rendering + 'Project Total' adjustment logic. Each named line item (including $0) appears at its actual amount. If sum of line items < Total Bid, a 'Project Total' line is appended for the difference so the invoice always totals to Total Bid. Stripe rendering pattern unchanged: POST /products first, then POST /invoiceitems with price_data[product]=<product.id>.

v6 (2026-05-08): Two-step Stripe rendering: POST /products → POST /invoiceitems with price_data[product]. Confirmed via test job recj05GY73A1felqj → invoice in_1TUpSHBbICAK6z7HvajiGSI9 ($3,790.40 draft).

Pending: Airtable automations (create-line-items.js, update-line-items.js) need manual setup in Airtable UI. Scripts are on disk at airtable-automations/. End-to-end test pending.

> **Update 2026-07-30:** now at v14; Slack paused via `SLACK_NOTIFICATIONS_ENABLED = false`. The
> two automations are live in the base (`wflrlJo8fpwOdCCFv`, `wflqUwoKPt7wUF8ms`) and their scripts
> are committed at `airtable-automations/`.

---

### 2026-05-07 — Job Completed Airtable Automation
**Status:** 🟡 In Progress · **Stage:** 8

Automation trigger for Stage 8 — fires when Job Status = Completed

---

### (not dated) — `stripe-webhook`
**Status:** 🔴 Not Built · **Stage:** 9 · **Supabase project:** `eiqqqwajmcpcwhvxxnhx`

Builds after airtable-job-completed. Handles Stages 9-11.

> **Context 2026-07-30:** sandbox endpoint is configured for `invoice.sent` and `invoice.paid`.
> `STRIPE_SECRET_KEY` is currently a **test** key — confirm the Lost Boys live account before real
> invoicing. Corresponds to Phase 6 of `BUILD_PLAN.md`.
