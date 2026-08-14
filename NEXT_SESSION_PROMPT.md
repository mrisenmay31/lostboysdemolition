# Next Session Prompt

**This file is regenerated at the end of every session. Copy-paste the block below to start the
next one.**

---

Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md (official plan, phases A–G + Track B). The 2026-08-14 entry in
BUILD_LOG.md describes exactly where things stand.

Where the last session left off (2026-08-14):

Phase A is now FULLY verified — both GHL workflow drags done through the real UI (JOB-1104),
idempotent re-fires and workflow re-entry proven, epoch-ms date risk resolved (dates arrive
ISO-parseable). The ghl-contact-sync tags crash was fixed, reviewed, deployed, and live-verified
(commit 65cae85); review found contacts with tags had NEVER synced client type before this fix.

**Phase B slice 1 (pricing engine + estimates schema) is APPROVED, PLANNED, and MID-EXECUTION on
branch `phase-b-slice-1`** via subagent-driven development (sonnet implementers, opus reviewers):

- Plan: `docs/superpowers/plans/2026-08-14-phase-b-pricing-engine-and-schema.md`
- Research (ground truth for all pricing numbers):
  `docs/superpowers/plans/2026-08-14-phase-b-estimates-research.md` — 321 estimates, all 265
  live-Fillout records match the formula chain to the cent at 3.5% CC.
- **SDD ledger — READ FIRST before touching Phase B:**
  `.superpowers/sdd/2026-08-14-phase-b-pricing-engine-and-schema/progress.md` (rulings +
  precise resume state).
- Done: Task 1 (`cd39fca`, pricing engine, 9/9 tests) and Task 3 (`e6ec4df`, schema migration
  — APPLIED TO LIVE and verified; estimates/estimate_line_items/scope_library/pricing_variables,
  immutability trigger, seq @1400, RLS on/0 policies).
- ⚠️ NEITHER task has had its Opus review yet — resume by dispatching those two task reviews
  (review packages/briefs staged in the SDD workspace), then Task 2 (golden-master test),
  Task 4 (seeds), Task 5 (verification/docs), final whole-branch opus review, then
  superpowers:finishing-a-development-branch.

IMMEDIATE OPEN ITEMS:
1. Resume Phase B slice-1 execution per the SDD ledger (reviews for Tasks 1+3 first).
2. Matt: delete 4 test calendar events — "JOB-1102 – Contractor Company" Aug 17 and JOB-1104
   Aug 20, each on BOTH main and Crew 1 calendars.
3. BL-4 (crew Slack message format, in BUILD_PLAN.md backlog) — scheduled for END of Phase B.
4. receive-airtable-webhook retirement still queued (disable Airtable automations
   wflYoupCQ00h2BrVa + wfldrRGvkSgRsE3ok in base apptzp0IclCaAtOk2 first).
5. BILL credentials still absent by design; the gated leg no-ops.

Standing rules: (a) plan + explicit approval before any new build (small fixes exempt);
(b) anything deployed to Supabase committed same session, verified against the live function
list; (c) BUILD_LOG.md entry at every session close; (d) one-tap capture or it won't happen.
Pipeline Reference base appA7uj7FhnPp9Bvg = Field Registry / Secrets & Credentials / People & IDs
only.

Start by reading the SDD ledger and resuming the Phase B task loop.
