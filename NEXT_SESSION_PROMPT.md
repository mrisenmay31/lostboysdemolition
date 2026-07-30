# Next Session Prompt

**Ephemeral.** Regenerate at the end of each session; this file describes a moment, not the plan.
The plan is `BUILD_PLAN.md`. Generated 2026-07-30, ending at commit `7ab339a`.

---

## Master prompt — copy everything in this block

```
Lost Boys Demolition ops system. Read CLAUDE.md, then BUILD_PLAN.md (the official
plan), then SYSTEM_AUDIT_2026-07-30.md (ground truth) before proposing anything.

Where the last session left off (2026-07-30, ended at commit 7ab339a, pushed, tree
clean): it was documentation and repo hygiene only. No edge function was deployed,
no Supabase change made, nothing live was touched. The repo had drifted badly from
production — three deployed functions existed nowhere in git — and that is now
reconciled. BUILD_PLAN.md was designated the official plan; OPS_ROADMAP.md
(2026-07-15) is superseded and untracked.

Nothing has been built toward BUILD_PLAN.md yet. Phase 0 is partially done (repo
reconciliation and RLS hardening); the Next.js/Vercel skeleton has not been started.
No phase past 0 has begun.

Three things need a decision from me before real work starts. Do not start coding
until we have talked through them:

1. BUILD_PLAN.md has a section "Carried over from OPS_ROADMAP.md — unreconciled".
   It holds five decisions that no phase owns (QuickBooks Online as the books via
   Synder; porting the business number into GHL with A2P 10DLC registration; client
   sign-off at completion; callback tracking; Stripe native invoice reminders) plus
   an unresolved conflict — ClockShark (budget already approved, ~$100-170/mo) vs.
   building crew clock-in in-house in Phase 4. Note BUILD_PLAN.md has no lead-intake
   phase at all, yet lost leads were identified as the single biggest business pain.
   Walk me through these and let's resolve each one.

2. BUILD_PLAN.md's own "Open decisions needed from Matt" — five items, two of which
   (credit-card fee treatment, Dump Fee Buffer) block Phase 2 entirely.

3. The oldest open item in the project: airtable-job-created v21 was deployed
   2026-05-15 and its GHL UI verification was never done. Trigger a test job,
   confirm the estimate custom fields populate and the opportunity lands in Stage 3
   (not Stage 4). If fields are blank, suspect id: vs key: format — the function
   logs "[info] GHL customFields being sent:".

Also still open: whether to add the missing x-webhook-secret check to
receive-airtable-webhook, which is live and currently unauthenticated.

Standing rules that apply to you: (a) before writing code for any new build, produce
a plan and wait for my explicit approval — small fixes are exempt; (b) anything
deployed to Supabase must be committed to this repo in the same session, verified
against the live function list, because repo/production drift is this project's
core failure mode; (c) at the end of every session, append an entry to BUILD_LOG.md
in the repo — this now replaces the Airtable Build Log table. The Airtable Pipeline
Reference base (appA7uj7FhnPp9Bvg) is still used for Field Registry, Secrets &
Credentials, and People & IDs only.

Start by telling me what you think the highest-value next move is, and why.
```

---

## Supporting context (not part of the prompt)

### State at close

- `main` = `origin/main` = `7ab339a`. Working tree clean.
- Six commits landed: `0dd5103` (v21 work) · `8634bf3` (merge) · `d5b0f39`
  (`SETUP_INSTRUCTIONS.md` restored) · `0166d6a` (CLAUDE.md edits folded in) · `90e7fc3`
  (calculation-ownership note) · `7ab339a` (BUILD_PLAN.md made official).
- Untracked and intentionally left: `OPS_ROADMAP.md` (superseded, banner added), `prompt.md`
  (spent — the v21 brief), `supabase/.temp/` (Supabase CLI scratch; gitignore candidate).

### Deferred cleanup

Delete `prompt.md`, gitignore `supabase/.temp/`, and remove `OPS_ROADMAP.md` — but only after
BUILD_PLAN.md's carried-over section has been worked through. Everything unique to
`OPS_ROADMAP.md` has already been copied into `BUILD_PLAN.md`, so the file itself is now safe to
delete on that condition.

### Live vs. scaffolding — do not confuse these

Working today: bidirectional client sync (`airtable-client-sync` + `ghl-contact-sync`), 668
`sync_log` rows, no errors since May 2. Fillout, Google Calendar, Slack, GHL, Stripe-via-GHL, and
Gusto run the actual business daily.

Scaffolding: the Airtable Jobs pipeline and the stage edge functions. Zero actuals exist anywhere
— every variance field reads −100%. The pricing engine has never computed a number.

### Traps

- `STRIPE_SECRET_KEY` is a **test** key. Confirm the Lost Boys live account before real invoicing.
  The Stripe MCP available in-session is CTA Integrity's, not Lost Boys'.
- `receive-airtable-webhook` is live and **unauthenticated**.
- `push-to-airtable` has a latent bug — it PATCHes a formula field. Never been run.
- The `jobs` table is a permanently stale mirror; it never handles `Completed`.
- Airtable field *names* have drifted; field *IDs* have not. Always address by ID.
- Fillout → Airtable is a **native Fillout integration, not Zapier**. Older docs say otherwise and
  are wrong.
- Airtable estimate fields are inert plain values — editing one recomputes nothing.
