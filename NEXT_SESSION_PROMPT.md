# Next Session Prompt

**Ephemeral.** Regenerate at the end of each session; this file describes a moment, not the plan.
The plan is `BUILD_PLAN.md`. Generated 2026-08-13, at the end of the Phase A build session.

---

## Master prompt — copy everything in this block

```
Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md (official plan, amended 2026-07-31, phases A–G + Track B).
SYSTEM_AUDIT_2026-07-30.md is still useful for pre-Phase-A systems state but its §2 is materially
wrong and carries a correction banner.

Where the last session left off (2026-08-13, branch `phase-a-job-record`, NOT YET MERGED to main):
Phase A — the job record keystone — shipped and is live. Two new Supabase Edge Functions:
ghl-job-webhook (v6) and crew-night-before (v4), plus 4 migrations (canonical `jobs` schema with
JOB-XXXX sequence starting 1100, RLS, two rounds of adversarial-review fixups, and a pg_cron
schedule for the night-before digest), plus a first-ever shared module at
supabase/functions/_shared/ (job-name/city parsing, lifted Google Calendar auth, hardened
sync_log/job_events writers). 98 tests on ghl-job-webhook, 41 on crew-night-before, all deno-check
clean.

This was built via subagent-driven development — sonnet implementers, opus adversarial reviewers,
me checkpointing at three points — and it is LIVE-VERIFIED, not just tested: Matt dragged a real
GHL opportunity to Quote Accepted in the GHL UI and it minted JOB-1102 with the client name/type
correctly pulled from the GHL contact; the opportunity card visually renamed itself in GHL; the
schedule-path drag (via direct test, not yet the actual workflow drag) drove both Google Calendars
and a Slack post to a test channel, with idempotent re-fires proven safe. One production defect
was found and fixed mid-session — GHL's "Webhook" workflow action nests its payload under a
customData key rather than sending it top-level; the parser now accepts both shapes. Two more
were found live (not by any mock) via a probe with a bogus opportunity ID: sync_log.direction and
job_events.job_id had check constraints that silently 400'd every Phase A audit write; both
widened in a third migration. Full defect list — including 7 caught by adversarial review before
any of this went live — is in the 2026-08-13 Phase A entry of BUILD_LOG.md; read that entry before
touching this code again.

IMMEDIATE OPEN ITEMS, in priority order:
1. JOB-1102 needs a keep-or-cancel decision from me before 2026-08-16 — the night-before digest
   will otherwise fire to the real Crew 1 Slack channel for a job that only exists because of a
   live-verification drag.
2. Workflow 2 (job_scheduled) still needs its GHL-workflow drag done — the create-path drag was
   verified through the real GHL UI; the schedule path was verified by a direct function call, not
   yet by dragging the opportunity through the actual GHL workflow.
3. BILL credentials, if the BILL job-code leg should go live now rather than waiting for Phase C.
   BILL_API_TOKEN is unset everywhere by design; the leg no-ops cleanly without it.
4. ghl-contact-sync v20 has a live, pre-existing, unfixed bug — an unlogged
   `TypeError: tags.map is not a function` on some live traffic, found by accident during this
   session. Not Phase A code. Needs its own small fix.
5. receive-airtable-webhook retirement is still queued and unrelated to Phase A — disable Airtable
   automations wflYoupCQ00h2BrVa and wfldrRGvkSgRsE3ok in base apptzp0IclCaAtOk2 first, then remove
   the function, so they fail closed.

NEXT BUILD: Phase B — the estimate builder. It replaces the Fillout bid calculator (the
Fillout/estimate side of the system is completely untouched by Phase A) and must reproduce today's
prices to the cent before anything else about it matters. Read BUILD_PLAN.md's Phase B section
before planning it.

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

- **Branch state:** all Phase A work is on `phase-a-job-record`, not merged to `main`. Commits:
  `5c52c8b`, `7fca329`, `55c17f6`, `0b8f5b2`, `358cf8a`, `b6f0f27`, `9fa8770`, `bd7aca7`,
  `79b479d`, `0f3c6a9`, `f63be73`, `4942552`, `402b6b0`, plus this docs close-out commit. Decide
  whether/when to merge before starting Phase B.
- **Full build ledger:** `docs/superpowers/plans/2026-08-13-phase-a-job-record-ledger.md` — every
  ruling, defect, and review round from the session, in order (frozen, closed 2026-08-13).
- **CLAUDE.md was corrected in three places this session** beyond the Phase A additions: the GHL
  pipeline table went from 13 stages to the live 12 (no "Closed Lost / Cancelled" stage exists);
  the `sync_log` constraints section now documents `direction`/`match_method`/`status` checks, not
  just `action_taken`; and `job_events`'s column list now includes `job_number` and
  `ghl_opportunity_id`, which the live schema always had but the docs omitted.
- **PII in debug logs** (the `[ghl]` contact-fetch log and related create-path logs) was
  deliberately left in place — trim once Phase A's live payload shapes are fully confirmed, not
  before.
- **Slack crew channel IDs are now in Supabase secrets** (set 2026-08-13): Crew1 `C087S6M0Q4Q`
  (Nick), Crew2 `C087S6G3248` (Alex), Crew3 `C0ABF44937A` (Brady), Crew4 `C0ABF4XMKDE` (Cade).
- **Airtable Pipeline Reference base updates from the plan's Task 7 step are now done.** Both
  tables were updated by the controller: Secrets & Credentials has the 4 `SLACK_CREW1..4_CHANNEL`
  rows marked ✅ Live, and Field Registry records `Gtl6ADpbBGOlYYFil4n6` as reused for the Job
  Number field.
