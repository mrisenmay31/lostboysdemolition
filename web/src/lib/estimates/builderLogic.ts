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
import type { LineItemDraft } from "./types";

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
