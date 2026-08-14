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
| `airtable-client-sync` | — | 🟢 Live (v19) | 2026-07-30 |
| `ghl-contact-sync` | — | 🟢 Live (v20) | 2026-07-30 |
| `airtable-job-created` | 3 | 🟡 In Progress (v21) — **GHL UI verification still pending since 2026-05-15** | 2026-07-30 |
| `airtable-job-scheduled` | 6 | 🟢 Live (v16) — verified end to end | 2026-05-15 |
| `airtable-job-completed` | 8 | 🟢 Live (v14) | 2026-07-30 |
| `receive-airtable-webhook` | — | 🟢 Live (v11) — **unauthenticated**, retirement queued | 2026-07-30 |
| `push-to-airtable` | — | ⚪ Dormant (v11) — never run, latent bug | 2026-07-30 |
| `ghl-job-webhook` | A | 🟢 Live (v7) — Phase A keystone, live E2E verified; v7 = final-review fix wave | 2026-08-13 |
| `crew-night-before` | — | 🟢 Live (v4) — nightly crew digest, Slack E2E verified live via synthetic job (see below) | 2026-08-13 |
| `stripe-webhook` | 9–11 | 🔴 Not Built | — |
| Job Completed Airtable Auto | 8 | 🟡 In Progress | 2026-05-07 |
| GHL Custom Fields + Mapping | — | 🟢 Live (19 fields) | 2026-05-15 |

Supabase project for all functions: `eiqqqwajmcpcwhvxxnhx`.

---

## Entries

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
