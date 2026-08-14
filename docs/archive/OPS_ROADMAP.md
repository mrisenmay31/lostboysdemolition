# Lost Boys Demolition — End-to-End Ops Roadmap (Prospect → Payment)

> # ⚠️ SUPERSEDED — DO NOT PLAN FROM THIS DOCUMENT
>
> **`BUILD_PLAN.md` is the official plan** as of 2026-07-30. This roadmap (2026-07-15) is retired,
> including its 0–10 phase numbering — the canonical numbering is `BUILD_PLAN.md`'s 0–9.
>
> This file is untracked in git and slated for deletion in a future planning session. The
> decisions below that `BUILD_PLAN.md` never addressed — QuickBooks Online via Synder, the GHL
> number port and A2P registration, client sign-off, callback tracking, Stripe native invoice
> reminders, and the ClockShark-vs-in-house time-tracking conflict — have been copied into the
> **"Carried over from OPS_ROADMAP.md — unreconciled"** section of `BUILD_PLAN.md`. Work from
> there, not from here.

## Context

Matt asked for a start-to-finish plan covering the full job lifecycle: prospect intake → accurate bid → job start → cost collection → quality → invoice → payment. Discovery this session established:

- **Leads are getting lost** — prospects reach Dane/Jackson by phone/text/contractor referral and nothing is written down until an estimate exists. Top-of-funnel is the #1 pain.
- **GHL is paid for but unused** because it was never integrated well enough. **Decision: commit to GHL** as the front door (lead capture, comms, pipeline) rather than replace it.
- **The actuals loop doesn't exist** — Gusto per-job hours are manual and can't be pulled out easily; Divvy reconciliation is manual. Nobody can tell if a bid missed, so bid accuracy can't improve until actuals flow.
- **Quality** = all four: before/after photos, foreman completion checklist that gates the invoice, client sign-off, callback tracking.
- **Collections pain** = no reminders, no AR visibility, slow invoice creation. **QuickBooks Online is the books** (new to the architecture).
- **Model:** SaaS-first, custom code as glue. AI = later phase, once data flows.

This is **not a re-platform**. The existing spine (Airtable schema, Airtable↔GHL job sync, Stripe draft invoicing, Google Calendar scheduling — 5 live edge functions) survives; the plan finishes the loop around it.

### Decisions locked by Matt (this session)

| Decision | Answer |
|---|---|
| Front-of-funnel | Commit to GHL (not Jobber-class FSM, not Airtable-only) |
| New SaaS budget | **Approved**: ClockShark (~$100–170/mo) + Synder (~$20–50/mo) |
| Phone | **Port the existing business number into GHL** |
| Website | Live website exists → A2P registration unblocked, lead form can embed |
| Client sign-off | **Non-blocking, no delay** — sign-off SMS and invoice fire simultaneously at completion |
| Labor hours | ClockShark primary; foreman daily-log form as interim + permanent fallback |
| Divvy expenses | Weekly CSV import (idempotent, keyed on Divvy Transaction ID) + required Job-ID tag in Divvy; API spike in parallel (open item #8) |
| Invoice reminders | Stripe native hosted-invoice auto-reminders (config only); custom `invoice_reminders` engine stays dormant |
| Stripe→QBO | Synder |
| AI | Phase 10, after data exists |

---

## Phase Plan

Effort unit = one working session (~half day). Per the CLAUDE.md standing rule, each build phase gets its own Opus plan subagent + Matt's approval before code; every deploy ends with the Pipeline Reference base update (base `appA7uj7FhnPp9Bvg`).

### Phase 0 — Verify & stabilize what's live *(1 session — do first)*
- Trigger a test job → verify `airtable-job-created` v21 estimate custom fields render in GHL UI and the opp lands in Stage 3 (open item #5). If blank, debug `id:` vs `key:` format per function notes.
- Fix the CLAUDE.md tech-stack row: Fillout→Airtable is native Fillout, not Zapier (standing memory item).
- Update Build Log in the reference base.

### Phase 1 — GHL lead capture goes live *(1–2 sessions config + carrier wait; start immediately)*
**Goal: no lead exists only in a phone again.** All configuration, no code.
- **Day one:** file the number port into GHL (LC Phone) AND A2P 10DLC registration (brand + low-volume campaign; uses EIN + live website + sample messages). Both have multi-day-to-2-week carrier lead times — everything else proceeds while they pend. Interim: a temporary GHL number with forwarding until the port completes.
- Missed-call text-back workflow ("text us details/photos, number within 48h").
- LeadConnector mobile app on Dane's + Jackson's phones, push on. Capturing a walk-up lead = ~20 seconds; called/texted leads = zero effort (auto contact + conversation).
- GHL workflow: new inbound contact → auto-create opportunity at Stage 1 (New Lead).
- **Stale-lead alarm**: Stage 1–2 opp untouched >24h → notify Dane + Slack. This is the anti-lead-loss mechanism.
- Lead form (share link + website embed).
- **Behavior change (the real work):** Dane/Jackson agree to a 24h touch SLA; all client comms move to the GHL number/app.
- **Verify:** test call → contact + Stage 1 opp + missed-call text; planted stale lead fires the alarm; one real week of leads all visible on the board.

### Phase 2 — Cash loop: stripe-webhook + reminders + AR *(1–2 sessions; independent of Phase 1 — build while port/A2P pend)*
**Goal: invoices chase themselves; Matt sees AR without asking.**
- **Build `stripe-webhook`** edge function (the long-planned Stages 9–11 piece): signature verification; `invoice.sent` → GHL Stage 10 + Invoice Sent Date; `invoice.paid` → Stage 11 + Payment Date + **write Actual Revenue** (a Loop-1 input); `invoice.payment_failed` → Slack alert. Idempotent on Stripe event ID; `sync_log` + `job_events` per house pattern. Sandbox webhook endpoint already configured (open item #3).
- **Config:** Stripe auto-reminders on hosted invoices (e.g. 3/7/14 days) — zero build.
- **Config:** AR Airtable Interface ("Money" page): Ready-to-Invoice queue, Sent, aging buckets, paid-this-month.
- **Build:** weekly Slack AR digest (small cron edge function).
- **Verify:** sandbox invoice sent→paid moves GHL 9→10→11 and writes dates + Actual Revenue; digest posts.

### Phase 3 — Lead→estimate handoff *(1–2 sessions; needs Phase 1)*
**Goal: one thread from first text to quote; no duplicate opportunities.**
- **Build `airtable-job-created` v22 — update-not-create:** payload carries GHL Opp ID → PUT that opp (move to Stage 3, write Airtable Job ID/Record ID custom fields). No Opp ID → search contact's open Stage 1–2 opps → update match. No match → create (preserves Path B and walk-up estimates).
- **Build/config:** estimator launches Fillout from GHL via a custom-values link prefilling GHL Contact ID + Opportunity ID (hidden Fillout fields → 2 new Airtable Jobs fields).
- Stage 4 discipline: Dane sends the quote from the GHL conversation (24–48h SLA) and drags the opp to Quote Sent.
- **Risk to manage:** between Phase 1 and Phase 3, leads create Stage-1 opps that v21 would duplicate at estimate time — ship Phase 3 promptly; interim, estimator merges dupes by hand.
- **Verify:** lead → estimate → exactly one opportunity at Stage 3 with all custom fields and intact conversation history.

### Phase 4 — Labor actuals *(2 sessions + 14-day trial; foreman form ships immediately)*
**Goal: reliable per-job hours with no manual Gusto reconciliation.**
- **Session 1 (interim + fallback):** foreman daily-log Fillout form tied to Job ID — actuals start flowing now. Build **Slack crew notifications** (open item #7: `SLACK_BOT_TOKEN` + crew channel secrets, notification logic in `airtable-job-scheduled`) as the delivery channel for job/form links.
- **Trial:** ClockShark with Crew 1 (Nick), 14 days. Pass criteria: Gusto payroll sync clean (no double entry) AND API/Zapier gives per-job per-day hours.
- **Session 2 (post-trial):** auto-create ClockShark job `JOB-XXXX` on Status=Scheduled; nightly pull → `labor_actuals` Supabase table → roll up to Airtable `Actual Labor Hours`. Roll out crew by crew.
- **Verify:** a real job's ClockShark hours match Airtable within rounding; Gusto runs clean.
- **Biggest adoption risk in the program** — forms <2 min, links pushed via Slack, pilot first, Matt/Dane visibly use the data.

### Phase 5 — Expense actuals *(1 session + API spike)*
- **Build:** idempotent Divvy CSV import (edge function or repo script) → Expenses table, matched on Divvy Transaction ID, job-linked via Job-ID tag; "Unassigned" triage view for Dane.
- **Policy:** Job-ID tag required on every Divvy purchase.
- **Spike (1–2h):** BILL Spend & Expense API token access (resolves open item #8); upgrade to nightly API pull only if granted.
- **Verify:** weekly export → correctly linked Expenses rows; re-import creates no duplicates; Jobs Expense Total rollup populates.

### Phase 6 — Quality gate *(2 sessions; needs Phase 4's Slack notifications)*
**Goal: "done" means proven done; the invoice fires only through the checklist.**
- **Job-start Fillout form** (foreman, <2 min): before photos, crew count (also captures `Number of Employees` actuals). Link arrives in the Slack crew notification.
- **Job-completion Fillout form**: after photos + checklist (client walkthrough, cleanup, haul-off/dump count, property condition) + notes. Airtable automation verifies checklist complete → sets Status=Completed → existing `airtable-job-completed` invoice flow fires unchanged. Incomplete → Slack alert instead of invoice. Foremen/Dane no longer flip Completed by hand.
- **Client sign-off:** at completion, GHL workflow sends SMS sign-off link (Fillout: signature + rating). **Non-blocking, no delay** — fires simultaneously with the invoice flow; result recorded on the job.
- **Callbacks table** (new): Job link, crew, reason, date, hours spent, resolved. Quick-entry form; per-crew rollups; callback hours flow into actuals so rework hits job profitability.
- **Verify:** job cannot reach Completed without the checklist; completion → sign-off SMS + invoice draft both fire on a test job; callback entry appears in crew stats.

### Phase 7 — QBO sync *(½ session, config-only; any time after Phase 2)*
- Synder Stripe→QBO. **Verify:** one sandbox + one live paid invoice reconcile in QBO with Stripe fees split correctly.

### Phase 8 — Fillout estimate form rebuild *(1–2 sessions)*
- Full rebuild per brief: Job Scope multi-select, Engagement Type, Path B toggle, Pricing Variables pre-fill, field remap. Create the 4 missing Airtable fields (open item #6) and activate their `JOB_FIELDS` slots in v22. Deliberately late — don't disturb the working estimate path until actuals flow.
- **Verify:** Path A and Path B submissions produce correct Airtable records + GHL fields.

### Phase 9 — Intelligence: dashboards + feedback ritual *(1–2 sessions; needs ~10–15 completed jobs with actuals)*
- "Estimate Accuracy" Interface (variance by scope, estimator, crew), Crew Performance view (incl. callbacks), margin-alert automation (actual margin under estimate by >X% → Slack).
- **Quarterly ritual:** review Pricing Variables ($26 labor already flagged conservative vs $27–29 true cost) and update Scope Library default hours from historical medians. This is where Loop 1 pays.

### Phase 10 — AI layer *(scoped later, by design)*
- Photo→scope+hours suggester at intake; AI-drafted estimate from lead description + Scope Library + historicals; AI collections nudges; monthly variance narrative. Each its own planned build.

**Deliberately deferred:** deposit automation — blocked on policy decisions (open items #9/#10), not tech.

---

## Kill / Keep — existing components

| Component | Fate |
|---|---|
| `airtable-client-sync`, `ghl-contact-sync` | Keep unchanged — more valuable once GHL is the front door |
| `airtable-job-created` v21 | Keep → evolve to v22 (update-not-create, Phase 3) |
| `airtable-job-scheduled` v16 + Google Calendar | Keep unchanged; gains Slack crew notify (Phase 4) |
| `airtable-job-completed` v10 | Keep unchanged; trigger becomes checklist-gated (Phase 6) |
| Airtable 7-table schema + line-item automations | Keep; add Callbacks table, checklist/sign-off fields, 4 missing estimate fields |
| `sync_log`, `job_events` | Keep — house pattern |
| `labor_actuals`, `expense_actuals` | Keep — finally used (Phases 4–5) |
| `invoice_reminders` | Dormant — Stripe native reminders instead |
| Zapier | Shrink — new glue prefers edge functions; keep only what's live |
| GHL 13-stage pipeline | Keep as designed — Stages 1–2 finally get used |

## Risks

1. **Number port + A2P lead time** (days–2 weeks each) — file both day one of Phase 1; temp GHL number with forwarding in the interim; SMS throttled until A2P approves.
2. **Foreman adoption** (Phases 4/6 live or die on it) — forms <2 min, links pushed to Slack, one-crew pilot, leadership visibly uses the data.
3. **ClockShark↔Gusto sync quality unverified** — the trial's pass criteria cover it; foreman-log fallback already running.
4. **Divvy API unknown** — CSV path works regardless.
5. **GHL API quirks** (`MONETORY`, `name` not `label`, Version header, `id:` vs `key:`) — documented in repo; v22 reuses v21 patterns.
6. **Duplicate opportunities in the Phase 1→3 gap** — ship Phase 3 promptly; manual merge interim.

## Remaining open questions (don't block start)

1. Who owns the lead-triage SLA and invoice chasing day to day — Dane? (assumed yes)
2. Exact field headcount for ClockShark seats.
3. Payroll cadence (affects labor-actuals reconciliation timing).
4. Deposit policy (open items #9/#10) — stays deferred.

## Verification (program level)

- Each phase has its own verify step above; house pattern: test record → check GHL UI / Stripe sandbox / Airtable / `sync_log` / `job_events`.
- End-state test (after Phase 6): one real job traced end-to-end — inbound text → Stage 1 opp → estimate via Fillout-from-GHL → scheduled (calendar + Slack) → clocked hours land in Actual Labor Hours → Divvy expense lands on the job → completion checklist → invoice draft → Dane finalizes → Stripe reminder config visible → paid → Stage 11 + Actual Revenue + QBO reconciled → variance fields populated.
- After every deploy: update the Pipeline Reference base (standing rule).

## Immediate next steps (first two working sessions)

1. Phase 0 verification (v21 GHL UI check) + CLAUDE.md correction.
2. Phase 1 day-one filings: number port + A2P registration, then GHL config.
3. Phase 2 `stripe-webhook` build while carrier items pend.
