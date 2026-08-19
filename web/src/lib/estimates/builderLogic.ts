// ============================================================
// Lost Boys Demolition — web app — estimate builder pure logic
//
// PURE — no React, no Supabase, no "server-only". Extracted so the two
// rules governing the builder's quick-vs-itemized behavior (Task 11 brief
// / plan "Design decisions": "Header inputs stay the pricing source of
// truth... Itemized mode (>=1 line) = header hours/dumps become read-only
// sums of line items; server validates reconciliation (Σ to 0.01)."
// `days_employees` mode hides line items entirely.") are unit-testable
// without rendering the client component (no jsdom/RTL in this project —
// vitest runs in the `node` environment).
// ============================================================

import type { LaborMethod } from "@/lib/pricing";
import type { EstimateFinancialDetailsRow, LineItemDraft } from "./types";

export type BuilderMode = "quick" | "itemized";

/**
 * Quick mode = the header fields (totalJobHours/dumpCount) are typed
 * directly by the estimator, exactly like today's Fillout flow. Itemized
 * mode = at least one scope line item exists, so those header fields
 * become read-only sums of the line items instead (see sumLineItems).
 *
 * `days_employees` labor method has no totalJobHours field for line items
 * to reconcile against (validateEstimateDraft only requires totalJobHours
 * in total_hours mode), so it ALWAYS reports "quick" — the builder UI
 * hides the scope-line-items section entirely for this method, but this
 * function stays defensive even if it's ever called with a non-empty
 * array in that mode.
 */
export function deriveMode(laborMethod: LaborMethod, lineItemCount: number): BuilderMode {
  if (laborMethod === "days_employees") return "quick";
  return lineItemCount > 0 ? "itemized" : "quick";
}

export interface LineItemSums {
  laborHours: number;
  dumpCount: number;
  materialsCost: number;
}

/** Sums the three reconciled fields across a set of scope line items —
 *  the values itemized mode uses to auto-populate totalJobHours/dumpCount
 *  (and to floor jobSpecificCosts against materialsCost). Does not mutate
 *  its input. */
export function sumLineItems(lineItems: readonly LineItemDraft[]): LineItemSums {
  return lineItems.reduce<LineItemSums>(
    (totals, item) => ({
      laborHours: totals.laborHours + item.laborHours,
      dumpCount: totals.dumpCount + item.dumpCount,
      materialsCost: totals.materialsCost + item.materialsCost,
    }),
    { laborHours: 0, dumpCount: 0, materialsCost: 0 },
  );
}

/**
 * Strips everything parseNonNegativeDecimal/isInvalidDecimalInput treat as
 * pure formatting rather than part of the number: surrounding whitespace,
 * thousands-separator commas, and any internal whitespace (so "1, 200" and
 * "1,200" behave identically). Shared by both functions below so their
 * notion of "cleaned up" can never drift apart.
 */
function cleanDecimalInput(raw: string): string {
  return raw.trim().replace(/[,\s]/g, "");
}

/**
 * Parses a raw decimal-input string into a finite, non-negative number for
 * computation. THE RAW STRING ITSELF stays the source of truth for what's
 * DISPLAYED in the input — this function only derives a number from it for
 * `computeEstimate()`/submission, it never writes anything back into the
 * field.
 *
 * Why this exists (Task 11 review Finding 1): `<input type="number">`'s
 * HTML value-sanitization algorithm returns `""` from `.value` for any
 * string that isn't a syntactically complete float — including legal
 * *intermediate* states of typing a fraction, like ".25" (the grammar
 * requires a digit before the decimal point) or "0.". Every one of those
 * keystrokes delivered `""` to a handler that mapped `"" -> 0`, so React
 * saw the state go 0 -> 0 -> 0 and (correctly) never re-rendered the
 * input — meaning the DOM was never told to fix itself, and the field
 * visibly showed ".25" while state, the live preview, and the persisted
 * row all silently held 0. The fix is structural, not a smarter parse:
 * builder inputs that need fractional entry hold their RAW TEXT in state
 * (via a `type="text" inputMode="decimal"` field, which the browser never
 * sanitizes) and call this function only to derive the number used for
 * math — so displayed text and computed value can never fight each other.
 *
 * Also tolerates thousands-separator commas ("1,200" -> 1200) and any
 * internal whitespace, via cleanDecimalInput — a free-text field takes
 * whatever an estimator's thumbs produce, and both are common ways people
 * type a job-specific-costs figure.
 */
export function parseNonNegativeDecimal(raw: string): number {
  const cleaned = cleanDecimalInput(raw);
  if (cleaned === "") return 0;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

/**
 * True when `raw` is non-blank but still doesn't parse to a finite number
 * even after the same comma/whitespace cleanup `parseNonNegativeDecimal`
 * applies — e.g. "abc" or "1.2.3". Purely informational: it does NOT gate
 * anything (parseNonNegativeDecimal still treats unparseable input as `0`
 * for computation/submission, so a bad keystroke never blocks the live
 * preview or Save) — callers use this only to show a small inline "not a
 * number" hint next to the field, so mistyping doesn't fail silently.
 */
export function isInvalidDecimalInput(raw: string): boolean {
  if (raw.trim() === "") return false;
  const cleaned = cleanDecimalInput(raw);
  if (cleaned === "") return false;
  return !Number.isFinite(Number(cleaned));
}

/**
 * Assigns `sortOrder` = array index to every line item, discarding
 * whatever value (if any) it carried in. MUST be called at submit time,
 * not at add time (Task 11 review Finding 3): assigning `sortOrder =
 * prev.length` when a line item is added goes stale the moment a MIDDLE
 * item is later removed — add A/B/C (sort_order 0/1/2), remove B, add D
 * (sort_order = prev.length = 2) leaves C and D both claiming sort_order
 * 2, permanently, since `estimate_line_items` rows are immutable once
 * written. Deriving fresh 0..n-1 values from the final array's order at
 * submit time makes a collision structurally impossible. Does not mutate
 * its input.
 */
export function assignSortOrders(items: readonly LineItemDraft[]): LineItemDraft[] {
  return items.map((item, index) => ({ ...item, sortOrder: index }));
}

/**
 * The `scope_library` row shape the builder's server shell (Task 11's
 * page.tsx) queries and hands to the client component. Not part of the
 * Task 8 data layer's types.ts because scope_library isn't versioned/
 * immutable like estimates — this is a builder-specific projection
 * (camelCase, only the columns the "Add scope" picker and its prefill
 * need).
 */
export interface ScopeLibraryItem {
  id: string;
  name: string;
  defaultDescription: string;
  defaultLaborHours: number;
  defaultDumpCount: number;
  /** NULL until Phase G seeds it from actuals — treat as 0 when prefilling. */
  defaultMaterialsCost: number | null;
  jobTypeApplicability: string[];
}

export interface ReviseCostDefaults {
  materialsCostRaw: string;
  rentalsCostRaw: string;
  subcontractorsCostRaw: string;
  otherDirectCostRaw: string;
}

/**
 * Fix round F5 (`[id]/revise/page.tsx`'s builder-initial-values seeding):
 * the "revise" flow preloads the four economic-plan category cost fields
 * from the PARENT version's `estimate_financial_details` row. That row is
 * null only for a pre-Task-2 LEGACY estimate — one created via the v1
 * `create_estimate_with_items` RPC, before `estimate_financial_details`
 * existed — which has no category breakdown at all, only the parent's
 * single aggregate `job_specific_costs` figure.
 *
 * Zeroing all four fields in that case (the previous behavior) silently
 * DROPPED that aggregate the moment the revise builder recomputes
 * `jobSpecificCosts = materialsCost + rentalsCost + subcontractorsCost +
 * otherDirectCost` (`EstimateBuilder.tsx`) — the revised estimate would
 * reprice as though the legacy job had zero material/rental/subcontractor/
 * other cost, silently discounting it. Folding the whole legacy amount
 * into `otherDirectCost` instead is the one placement that preserves the
 * parent's aggregate EXACTLY (`0 + 0 + 0 + jobSpecificCosts ==
 * jobSpecificCosts`) while still giving the estimator a real, editable
 * starting number — "other" reads honestly as "uncategorized legacy
 * cost", not a guess at which of the three real categories it belonged
 * to.
 */
export function resolveReviseCostDefaults(
  jobSpecificCosts: number,
  financialDetails: Pick<
    EstimateFinancialDetailsRow,
    "materials_cost" | "rentals_cost" | "subcontractors_cost" | "other_direct_cost"
  > | null,
): ReviseCostDefaults {
  if (!financialDetails) {
    return {
      materialsCostRaw: "0",
      rentalsCostRaw: "0",
      subcontractorsCostRaw: "0",
      otherDirectCostRaw: String(jobSpecificCosts),
    };
  }
  return {
    materialsCostRaw: String(financialDetails.materials_cost),
    rentalsCostRaw: String(financialDetails.rentals_cost),
    subcontractorsCostRaw: String(financialDetails.subcontractors_cost),
    otherDirectCostRaw: String(financialDetails.other_direct_cost),
  };
}
