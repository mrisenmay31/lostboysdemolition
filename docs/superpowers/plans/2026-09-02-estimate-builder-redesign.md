# Estimate Builder Redesign — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Status: APPROVED by Matt 2026-09-02 (Session 17). Build starts at the opening of Session 18.** Per-task step
> bodies (file contents, commands) are expanded at dispatch time from this plan and the spec; the lanes, file
> ownership, interfaces, and review gates below are locked.

**Goal:** Ship the approved four-step estimate builder (Job → Client → Financial → Review) with server-side drafts,
customer lines with editable prices, the dashboard-prototype design system applied to the estimates section, the
shell, and `/jobs` (styling only), and owner auth dormant — so Dane and Jackson can replace Fillout from a phone.

**Spec:** `docs/superpowers/specs/2026-09-02-estimate-builder-redesign-design.md` (approved mockup:
`docs/prototypes/2026-09-02-estimate-builder-approved.html`).

**Tech stack:** Next 16 App Router + Tailwind 4 + vitest (web); Postgres migrations + pgTAP on a disposable
Supabase branch; `_shared/pricing.ts` untouched (golden-321 gate).

## Global constraints
- Build Planning Rule satisfied (Matt approved this plan). Sonnet implements; the strongest available model
  adversarially reviews every task; a final whole-branch review gates the merge.
- Delete nothing; never `git add -A`. Files that lose their last caller stay in place with a header note and are
  listed for Matt's per-item deletion OK.
- Every migration runs the runbook (`docs/runbooks/profitability-schema-validation.md`): branch probes → RED → apply →
  GREEN → production apply only on Matt's go → catalog asserts + `get_advisors`. Anything applied to Supabase is
  committed the same session.
- Raise texts are a cross-lane API matched by substring in web classifiers — never reword one side alone.
- `z.number()` only in Zod (never coerce); money in cents when splitting; tabular numerals in UI.
- No pricing in crew-visible text: line names/descriptions reject currency amounts.
- Both themes: every color a token defined on bare `:root`; dark redefined under the media query and `[data-theme]`.
- Scoped test runs per lane while siblings are mid-flight; full suites once at integration.

## Branch, worktree, and concurrency map
Branch `claude/estimate-redesign`, worktree `.claude/worktrees/estimate-redesign` (from `main`).

**Wave 0 (5 concurrent):** S1 ∥ D1→D2 ∥ L1→L2→L3 ∥ A1 ∥ X1. D is interface-defining for the UI lanes (primitives +
`format.ts`); L is interface-defining for W/G/P (types, `wizard.ts`). Both are small and land first.
**Wave 1 (4 concurrent, after D2 + L2):** W1→W2→W3→W4 ∥ G1,G2 ∥ P1,P2 ∥ J1.
**Wave 2:** integration (orchestrator), whole-branch review, Matt's gates, X2.

**File ownership (enforced in every agent prompt; everything not listed is off-limits to that lane):**
- **S:** `supabase/migrations/20260903120000_estimate_redesign_schema.sql`, `supabase/tests/estimate_redesign_test.sql`.
- **D:** `web/src/app/globals.css`, `web/src/app/layout.tsx`, `web/src/components/ui/*` (new), `web/src/lib/format.ts`
  (+test), `web/src/app/(app)/layout.tsx`, `web/src/app/(app)/EstimatorChip.tsx`.
- **L:** `web/src/lib/estimates/{types,validate,map,builderLogic,repo}.ts` + tests, `web/src/lib/estimates/wizard.ts`
  (new, +test), `web/src/lib/estimates/drafts.ts` (new, +test), `web/src/app/(app)/estimates/actions.ts` + test.
- **W:** `web/src/app/(app)/estimates/new/**` (new `EstimateWizard.tsx`, `_steps/*`, `_components/*`, `page.tsx`),
  `web/src/app/(app)/estimates/[id]/revise/page.tsx`, `web/src/app/(app)/estimates/drafts/[id]/page.tsx` (new).
- **G:** `web/src/lib/ghl/{estimateDoc,estimateFields}.ts` + tests, `web/src/lib/ghl/allocation.ts` (header note only),
  `web/src/app/(app)/estimates/[id]/schedule/{page.tsx,ScheduleEstimateForm.tsx}`.
- **P:** `web/src/app/(app)/estimates/page.tsx`, `web/src/app/(app)/estimates/[id]/page.tsx`,
  `web/src/app/(app)/estimates/[id]/_components/*`.
- **J:** `web/src/app/(app)/jobs/**` presentational files only (`page.tsx`, `[jobNumber]/page.tsx`, `_components/*`,
  `costs/page.tsx`, `revenue/page.tsx`, `exceptions/*`) — className/token swaps, no logic.
- **A:** `web/src/lib/workforce/authMode.ts` (new), `web/src/lib/supabase/proxyDecision.ts` + test, `web/src/proxy.ts`,
  `web/src/app/(app)/jobs/layout.tsx`, `web/src/app/(app)/page.tsx`, `web/src/app/(app)/jobs/actions.ts` + test,
  `web/src/app/(app)/jobs/[jobNumber]/_components/ForecastOverridePanel.tsx`, `web/src/lib/forecasts/repo.ts` + test,
  `docs/runbooks/owner-promotion.md`. (⚠️ J must not touch `ForecastOverridePanel.tsx`'s logic; A owns it.)
- **X:** docs (BUILD_PLAN, v2 plan note, CLAUDE.md, BUILD_LOG, NEXT_SESSION_PROMPT).

## Locked interfaces (lanes fan out against these)

**Types (L1):**
```ts
export interface LineItemDraft { scopeLibraryId?: string | null; name: string; description?: string;
  customerPrice: number; isCustom: boolean; sortOrder?: number }
// EstimateDraft gains: clientBusinessName: string | null; requestedStartDate: string | null;
// otherJobCostsBreakdown?: { materials: number; rentals: number; subcontractors: number; otherDirect: number } | null
// laborMethod stays in the schema; the wizard always sends "total_hours".
```
**Wizard pure module (L2, `web/src/lib/estimates/wizard.ts`):** `stepIsComplete(step, draft): { ok: boolean; missing: string[] }`
· `splitEvenCents(totalCents, n): number[]` (largest remainder, sums exactly) · `applyLineEdit(lines, index, price,
calculatedBid): { lines; quotedPrice: number | null }` (quotedPrice null when the sum equals the calculated bid to the
cent) · `breakdownSum(b)` · `deriveEconomics(draft, outputs)` → the six economics inputs (lump → otherDirect; dump
cost = loads × 65; processing = ccFee) · `QUOTE_REASON_CHIPS = ["Rounded","Competitive","Customer budget","Other…"]`.
**RPC contract (S1):** `create_estimate_with_items_v2` unchanged signature; `p_line_items[]` gains `customer_price`,
`is_custom`; new raise `'create_estimate_with_items_v2: line prices (%) must sum to the quoted price (%)'`
(classifier needle `"must sum to the quoted price"` → `invalid_input`). `p_estimate` gains `client_business_name`,
`requested_start_date`. Drafts: `upsert_estimate_draft(p_id uuid, p_payload jsonb, p_step int, p_actor_name text)
returns estimate_drafts` (`p_id` null = new), `discard_estimate_draft(p_id uuid, p_actor_name text)`,
`mark_estimate_draft_promoted(p_id uuid, p_estimate_id uuid)`; raises prefixed with the function name; posture:
revoke public/anon/authenticated, grant service_role.
**Primitives (D2, `web/src/components/ui`):** `Button({variant: "primary"|"secondary"|"quiet"|"danger", size})`,
`Field({label, hint, error})`, `Input`/`Textarea` (16px, 48px), `SegmentedControl({options, value, onChange})`,
`ChipGroup({options, value|values, onChange, multi})`, `Card({title})`, `Pill({tone: "neutral"|"success"|"warning"|
"danger"|"info"|"accent"})`, `TotalBand({total, trueMarginPct, hours, loads, breakdown, quotedPrice?})`,
`Stepper({steps, current})`, `BrandMark`, `BottomNav`. `format.ts`: `currency`, `currency2`, `pct1`, `denverDate`,
`denverDateTime`, `statusLabel`.
**Auth mode (A1):** `isOwnerAuthEnabled(): boolean` = `process.env.OWNER_AUTH_ENABLED === "true"`.

## Tasks

### S1 (Wave 0, Lane S): migration + pgTAP
**Files:** create the migration + test above.
- [ ] Columns: `estimates.client_business_name text`, `estimates.requested_start_date date`;
  `estimate_line_items.customer_price numeric(12,2) not null default 0 check (customer_price >= 0)`,
  `estimate_line_items.is_custom boolean not null default false`.
- [ ] `create or replace function public.enforce_estimate_immutability()` = the `20260814230000` body + the two new
  columns in the watched list (byte-identical otherwise; header cites the precedent).
- [ ] `create or replace function public.create_estimate_with_items_v2(jsonb,jsonb,jsonb)`: add the two estimate
  columns and the two line columns to the inserts; after the line loop, if lines exist and
  `abs(sum(customer_price) − coalesce(quoted_price,total_bid)) > 0.01` raise the locked text. ACLs preserved.
- [ ] `estimate_drafts` table + 3 RPCs (house header, pinned search_path, posture block).
- [ ] pgTAP (fixture 9600xx): columns exist; immutability raise on each new column; v2 inserts prices/custom flag;
  mismatch raises; lump vs breakdown economics rows; draft upsert-new/upsert-existing/discard/promote; EXECUTE posture
  for all three; existing suites unchanged.
- [ ] Runbook branch RED→GREEN recorded; commit.

### D1 (Wave 0, Lane D): tokens, fonts, shell
- [ ] `globals.css`: `@theme` tokens (light on `:root`, dark under `prefers-color-scheme` guarded `:root:not([data-theme="light"])`
  and `:root[data-theme="dark"]`), remove the Arial body rule, `font-family: var(--font-sans)`.
- [ ] `layout.tsx`: `next/font/google` Inter → `--font-sans`; viewport + `theme-color`.
- [ ] `(app)/layout.tsx`: header = `BrandMark` placeholder + title + `EstimatorChip`; `BottomNav` (Jobs / Estimates /
  New) with active state via `usePathname`; doc comment corrected (`/` flip is live/dormant per flag).
### D2 (Wave 0, Lane D, after D1): primitives + `format.ts`
- [ ] Build the primitives listed under Locked interfaces on the tokens; pure helper tests (`Pill` tone map =
  the single health map; `format.ts` cases).
- [ ] Do NOT edit consumers (other lanes swap to these).

### L1 (Wave 0, Lane L): types / validate / map
- [ ] `types.ts` per Locked interfaces (+ `EstimateLineItemRow.customer_price/is_custom`, `EstimateRow` new columns).
- [ ] `validate.ts`: new `lineItemDraftSchema`; delete the hours/dumps/materials reconciliation; add the currency-in-
  text rule (`/\$\s?\d|\b\d+(\.\d{2})?\s?(usd|dollars)\b/i`) on name + description; new nullable fields; keep
  `validateQuoteOverride`. Tests updated (25 → adjusted; every removed case replaced by a new-rule case).
- [ ] `map.ts`: line payload `{scope_library_id, name, description, customer_price, is_custom, sort_order, labor_hours:0,
  dump_count:0, materials_cost:0}`; estimate payload new columns; economics from `deriveEconomics`.
### L2 (Wave 0, Lane L, after L1): `wizard.ts` (pure) + tests (even split exactness incl. $0.01 remainders, 1 line,
0 lines; line edit → quotedPrice null when equal; step completeness rules: Job needs job name + ≥0 scope; Client needs
client name; Financial needs hours ≥ 0 and dumps ≥ 0 numeric; Review needs a reason when quoted ≠ calculated).
### L3 (Wave 0, Lane L, after L2): drafts repo + actions + repo changes
- [ ] `drafts.ts`: `upsertDraft`, `getDraft`, `listDrafts` (row cap sentinel), `discardDraft`, `markDraftPromoted`.
- [ ] `repo.ts`: classifier needle; after `computeEstimate`, assert line sum = `quotedPrice ?? totalBid` (throws
  `EstimateValidationError` before the RPC); `getEstimate` reads the new columns.
- [ ] `actions.ts`: `saveDraftAction(input, estimatorName)`, `discardDraftAction`, `createEstimateAction` +
  `newVersionAction` accept the new fields and an optional `draftId` (promotion marks after create). Tests: 4-part
  rubric per action.

### W1–W4 (Wave 1, Lane W): the wizard
- [ ] W1 `EstimateWizard.tsx` (client; reducer state; `?step=`/`?draft=`; Back/Next/Save as draft; `Stepper`) +
  `JobStep` (incl. `ScopePicker`: search, library chips, custom-line offer, picked list) + `ClientStep` (business name
  conditional).
- [ ] W2 `FinancialStep`: `TotalBand` fed by `computeEstimate` via `@/lib/pricing` with rates from
  `loadRatesConfig()` (server prop); direct costs; breakdown disclosure; profit-margin `ChipGroup` + Other….
- [ ] W3 `ReviewStep`: band with `quotedPrice`; `LinePriceTable` (even split, edit → `applyLineEdit`);
  `QuoteReasonChips` (required when differing); Record only switch; internal summary; Save and send / Save estimate /
  Save as draft; success screen → detail.
- [ ] W4 `new/page.tsx` (rates + scope library + optional `?ghlOpportunityId` prefill retained), `revise/page.tsx`
  (initial values from the parent incl. lines as customer lines), `drafts/[id]/page.tsx` (resume). Pure-helper
  tests for step components (no jsdom in the repo — extract helpers).

### G1 (Wave 1, Lane G): GHL doc/notes on `customer_price` — `estimateDoc.ts` amounts = stored prices (fallback
"Demolition services" at `quoted_price ?? total_bid` when no lines); `estimateFields.ts` scope-notes lines
`- <name> — <price>`; `allocation.ts` header note "no callers since 2026-09-0x (estimate redesign)"; tests updated.
### G2 (Wave 1, Lane G): schedule form prefills `startDate` from `requested_start_date` (end date left blank).

### P1 (Wave 1, Lane P): list — drafts section (Draft pill, resume link, discard), status filter chips (All / Draft /
Sent / Accepted / Declined; superseded toggle kept), search kept, cards on primitives.
### P2 (Wave 1, Lane P): detail — band (quoted vs calculated), customer-document preview from stored line prices
(legacy versions with all-zero prices render one "calculated" line + a note), lifecycle / quote override / identity /
push / schedule panels restyled on primitives, version chain + audit as expanders. No behavior change.

### J1 (Wave 1, Lane J): `/jobs` reskin — className/token swaps to primitives (`Pill` health tones, `Card`, `Button`,
`Field`); reviewer asserts the non-className diff is empty.

### A1 (Wave 0, Lane A): auth dormancy — `authMode.ts`; `decideProxyAction(pathname, hasUser, authEnabled)` (+tests
both modes); `proxy.ts` early `next()` when disabled; `jobs/layout.tsx` pass-through when disabled; `(app)/page.tsx`
→ `/jobs` when disabled; `createForecastOverrideAction(input, estimatorName)` dual-mode (owner path when enabled,
picker path with `authUserId: null` when disabled) + tests (first auth-branch tests: mock `@/lib/workforce/profile`
with a hoisted `OwnerAuthError`); `ForecastOverridePanel` uses `useEstimator`; `forecasts/repo.ts` nullable actor;
runbook banner "DORMANT while `OWNER_AUTH_ENABLED` is unset".

### X1 (Wave 0): docs already staged in Session 17 (this plan, the spec, the BUILD_PLAN amendment). Verify present.
### X2 (close): BUILD_LOG entry, CLAUDE.md, NEXT_SESSION_PROMPT.

## Integration (orchestrator) and Matt's gates
1. Full suites: `cd web && npx vitest run` (baseline 811 → higher), `deno task test` (411, golden-321 intact),
   `npm run lint && npm run build`.
2. Whole-branch adversarial review; fix round; re-review. Attention list: raise text ↔ needle byte match; reason
   required at every layer when quoted ≠ calculated; immutability list has both new columns; no currency in scope
   text; stored `customer_price` = doc amount = notes amount; even split exact; drafts never bypass the v2 RPC;
   picker gate on every new action; dark tokens complete; `/jobs` diff className-only; golden untouched.
3. Migration → production via the runbook (Matt's go). Existing 21 estimates unaffected.
4. Merge (tree byte-identity check as Session 15) → Vercel deploy verify: `/` 307→`/jobs` anon; `/jobs` 200 anon;
   `/estimates` 200; `/estimates/new` 200.
5. **Matt's phone smoke = adoption step 1:** one real estimate (≥1431) through all four steps, draft save + resume,
   a line-price edit with a reason, Save and send → GHL fields + draft doc with per-line prices as typed.

## Risk flags
- Legacy versions carry `customer_price 0` on lines; P2 must not render `$0` lines (fallback + note).
- The reason requirement could feel like friction on Review; chips keep it to one tap. If Matt wants it dropped, the
  table CHECK must be relaxed in the same migration (decision, not a code detail).
- Free-text custom names raise Job Scope picklist misses in GHL (notes carry them; acceptable).
- `EstimateBuilder.tsx`, `LineItemCard.tsx`, `ScopePickerSheet.tsx`, `StickyTotalBar.tsx`, `allocation.ts` become
  unreferenced → cleanup list for Matt.
- `OWNER_AUTH_ENABLED` default-off is the ruled state; re-enabling = set `"true"` in Vercel.
