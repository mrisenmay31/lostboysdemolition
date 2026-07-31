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
| `receive-airtable-webhook` | — | 🟢 Live (v11) — **unauthenticated** | 2026-07-30 |
| `push-to-airtable` | — | ⚪ Dormant (v11) — never run, latent bug | 2026-07-30 |
| `stripe-webhook` | 9–11 | 🔴 Not Built | — |
| Job Completed Airtable Auto | 8 | 🟡 In Progress | 2026-05-07 |
| GHL Custom Fields + Mapping | — | 🟢 Live (19 fields) | 2026-05-15 |

Supabase project for all functions: `eiqqqwajmcpcwhvxxnhx`.

---

## Entries

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
