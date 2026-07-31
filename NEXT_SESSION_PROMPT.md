# Next Session Prompt

**Ephemeral.** Regenerate at the end of each session; this file describes a moment, not the plan.
The plan is `BUILD_PLAN.md`. Generated 2026-07-31, at the end of that session.

---

## Master prompt — copy everything in this block

```
Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth — read this before anything else), then BUILD_PLAN.md (official plan, amended 2026-07-31).
SYSTEM_AUDIT_2026-07-30.md is still useful for systems state but its §2 is materially wrong and
carries a correction banner.

Where the last session left off (2026-07-31, pushed, tree clean): business discovery and financial
analysis. No code, no deploys, nothing live touched. I supplied a workflow overview, answered 45
discovery questions, and exported Stripe payments, BILL transactions, Gusto payroll, and the GHL
invoice list. The analysis is in DISCOVERY_2026-07-31.md.

The headline finding: a deliberate dump-fee pad (+$221k/yr) has been almost exactly financing a
labor estimating shortfall (-$246k/yr). Every number in the pricing engine is wrong; they cancel to
roughly +$31k. No pricing input may be corrected in isolation and no quoted price may move —
correcting the dump rate alone would strip out the buffer covering a ~$246k annual gap. Every fix
is a reporting change; repricing is a separate decision Dane makes on real data.

Phase numbering changed. The 0–9 sequence is retired. The canonical structure is A–G + Track B in
BUILD_PLAN.md → "Revised phases (2026-07-31)". Phase A (the job record) is the start point — it's
the keystone that makes automation we already built and paid for finally fire.

ONE THING BLOCKS WORK — decide it first. Phase D, time tracking. Gusto has no project-creation API
(time_tracking/time_sheets requires a pre-existing job_uuid). Crews already clock in reliably; the
project is what's missing, and it can't be created programmatically. Four options are in
BUILD_PLAN.md under "The one open decision": foreman-confirms-hours on the existing form
(cheapest), ClockShark (~$180-250/mo at ~20 seats), build our own PWA, or standardise Gusto names
and assign an owner. Everything else in the plan is decided.

Artifacts I still owe you:
- 2–3 example GHL estimates AND their matching invoices — to model customer-facing line-item
  grouping, and to confirm whether invoice line items track estimate line items.
- Fillout bid calculator screenshots/export — final confirmation of the formulas.
- What Blue Collar Haulers and Chew It Up Enterprises actually do (ask Dane) — $19,664 across 7
  transactions, currently distorting per-load dump cost.
- Clarification on client sign-off at completion — my earlier answer was ambiguous.

Defects found and not fixed:
- BILL: Job Name on only 35.5% of transactions; 14% of spend uncategorised; ~$6,944 of dump spend
  mis-tagged; Little Caesars $4.33 booked as a dump fee.
- GHL: $61,150 overdue across 18 invoices; 46 invoices (17%) with blank status and $0 — drafts,
  voids, or a data problem, nobody knows which.
- receive-airtable-webhook is still live and unauthenticated. The decision is made: RETIRE it,
  don't secure it. Disable automations wflYoupCQ00h2BrVa and wfldrRGvkSgRsE3ok in base
  apptzp0IclCaAtOk2 FIRST, then remove the function, so they fail closed.

Standing rules that apply to you:
(a) Before writing code for any new build, produce a plan and wait for my explicit approval —
    small fixes are exempt.
(b) Anything deployed to Supabase must be committed to this repo in the same session, verified
    against the live function list, because repo/production drift is this project's core failure
    mode.
(c) At the end of every session, append an entry to BUILD_LOG.md — including documentation-only
    sessions. The Airtable Pipeline Reference base (appA7uj7FhnPp9Bvg) is used for Field Registry,
    Secrets & Credentials, and People & IDs only.
(d) "The easier, the better." If a capture step takes more than one tap, assume it won't happen and
    the data won't exist.

Start by telling me what you think the highest-value next move is, and why.
```

---

## Session context not in the prompt above

- The working plan file from the discovery session lives outside the repo at
  `~/.claude/plans/reactive-knitting-sphinx.md`. `DISCOVERY_2026-07-31.md` supersedes it; the plan
  file is kept only for provenance.
- Source data for every figure in the discovery doc came from four exports in `~/Downloads`
  (Stripe `unified_payments`, BILL transactions, Gusto payroll summary, GHL invoice list). They are
  **not** committed — they contain customer and employee PII. Re-export if the analysis needs
  rerunning.
- The v21 GHL UI verification, open since 2026-05-15, **dropped in priority**. It was justified by
  the "GHL opportunity is the screen Dane and Jackson use" premise, which discovery showed does not
  hold today — GHL is used for estimates and payments, not pipeline tracking. Matt does want GHL to
  become that surface, so the check retains some value, just not urgency.
