# Next-session prompt (regenerated 2026-08-14, post Phase B slice-1 merge)

Copy-paste to start the next session:

---

Lost Boys Demolition ops system. Read CLAUDE.md, then DISCOVERY_2026-07-31.md (business ground
truth), then BUILD_PLAN.md (official plan, phases A–G + Track B). The 2026-08-14 entries in
BUILD_LOG.md (Phase B slice-1 + fix-wave addendum) describe exactly where things stand.

Where the last session left off (2026-08-14, evening):

**Phase B slice 1 is COMPLETE — merged to main and pushed (`0196449..7920a9c`, 10 commits;
branch `phase-b-slice-1` deleted local + remote).** All 5 tasks went through sonnet
implementation + opus review + fix loops, then a final whole-branch opus review with one fix
wave. Everything is live on Supabase project `eiqqqwajmcpcwhvxxnhx` AND committed:

- `supabase/functions/_shared/pricing.ts` + `pricing_test.ts` (12 tests) — exact Fillout port,
  cost-plus markup, true half-up rounding, `requireRates` validation.
- `pricing_golden_test.ts` + `fixtures/estimates-golden-321.json` — all 321 live estimates
  reproduce to the cent (309 exact + 11 legacy-diff pinned + 1 penny). This is the acceptance
  gate for "no quoted price may move." Run:
  `deno test --allow-all supabase/functions/_shared/` (18/18 green at merge).
- 4 migrations, applied live and committed, ordered 14-digit prefixes:
  `20260814150000_phase_b_estimates_schema` (estimates/estimate_line_items/scope_library/
  pricing_variables, immutability trigger, seq @1400 — live seq drifted to ~1410 by rolled-back
  tests, first real estimate ≥1411), `20260814160000_phase_b_estimates_fixups` (search_path
  pins; line items immutable, estimates undeletable), `20260814163000_phase_b_seeds` (19 scopes,
  6 pricing vars, cc_fee_rate 0.035), `20260814170000_phase_b_estimates_fixups2`
  (dump_count → numeric(6,2) — live data has 0.25/0.35/1.25 loads; `version_chain` constraint).
- Estimates writer contract (slice 2 must honor): version 1 rows take `estimate_number` from the
  sequence; version >1 rows supply the parent's `estimate_number` explicitly AND set
  `supersedes_estimate_id` (DB check enforces the latter). RLS on, zero policies, all 4 tables.

NEXT UP — Phase B slice 2: estimate builder UI (first Next.js/Vercel app code) + GHL push.
Before or at its start, the top deferred follow-ups (full list in BUILD_LOG addendum):
1. `deno.json` test task so the golden gate doesn't depend on someone typing `--allow-read`
   (final review's highest-leverage recommendation).
2. `pricing_variables` loader to replace the `DEFAULT_RATES` duplication.
3. Audit trail for the 4 mutable estimate columns (`quoted_price` especially).

OTHER OPEN ITEMS:
1. ✅ 4 test calendar events deleted by Matt 2026-08-14 — no test artifacts remain.
2. BL-4 (crew Slack message format) — scheduled for END of Phase B.
3. receive-airtable-webhook retirement still queued (disable Airtable automations
   wflYoupCQ00h2BrVa + wfldrRGvkSgRsE3ok in base apptzp0IclCaAtOk2 first).
4. BILL credentials still absent by design; the gated leg no-ops.
5. Phase D (time tracking) remains the only blocking decision.

Standing rules: (a) plan + explicit approval before any new build (small fixes exempt);
(b) anything deployed to Supabase committed same session; (c) BUILD_LOG.md entry at every
session close; (d) one-tap capture or it won't happen. Pipeline Reference base
appA7uj7FhnPp9Bvg = Field Registry / Secrets & Credentials / People & IDs only.
