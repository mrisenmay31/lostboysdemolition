// ============================================================
// Lost Boys Demolition — web app — largest-remainder dollar allocation
//
// PURE. No network calls, no "server-only", no Supabase. Extracted from
// estimateDoc.ts by task T9f (2026-08-14): estimateDoc.ts imports
// client.ts (real ghlFetch calls), which gained a top-level
// `import "server-only"` in the same task — so anything that imported
// allocateAmounts FROM estimateDoc.ts (estimateFields.ts, which declares
// itself pure and must stay import-guard-free) would otherwise transitively
// pull in server-only too. Living in its own zero-dependency module lets
// both estimateDoc.ts and estimateFields.ts import it directly without
// coupling to each other or to client.ts.
// ============================================================

function toCents(dollars: number): number {
  // Same half-up-to-cents intent as _shared/pricing.ts's roundToCent, in
  // integer cents so the remainder arithmetic below is exact (no repeated
  // floating-point drift across a running sum).
  return Math.round(Number((dollars * 100).toPrecision(12)));
}

function fromCents(cents: number): number {
  return cents / 100;
}

/** Splits `docTotal` across `weights` proportionally using the
 *  largest-remainder (Hamilton) method: each line's exact fractional cent
 *  share is floored (a non-negative share floors to a non-negative
 *  integer, always), then the leftover whole cents — `docTotalCents` minus
 *  the sum of the floors — are handed out one at a time to the lines with
 *  the largest fractional remainder (ties broken by ascending index, i.e.
 *  ascending `sort_order` for the caller's line-item use). This
 *  guarantees BOTH invariants at once: every amount is `>= 0`, and the sum
 *  is exactly `docTotal` — flooring never overshoots and leftover cents
 *  are only ever added, never subtracted.
 *
 *  An all-zero (or empty-sum) weight vector falls back to an equal split
 *  under the same floor-then-largest-remainder rule.
 *
 *  Superseded a "last weight absorbs the whole remainder" approach that
 *  could round the wrong direction on lines with near-zero weight,
 *  landing them below zero — reachable in production because $0 line
 *  items are real in this system's data (see task-10-report.md's
 *  post-review fix-up for the reproduction). */
export function allocateAmounts(docTotal: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const docTotalCents = toCents(docTotal);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const useEqualSplit = totalWeight <= 0;

  const rawShares = weights.map((w) =>
    useEqualSplit ? docTotalCents / n : (w / totalWeight) * docTotalCents,
  );
  const floors = rawShares.map((s) => Math.floor(s));
  const fractions = rawShares.map((s, i) => s - floors[i]);

  const flooredTotal = floors.reduce((sum, c) => sum + c, 0);
  // Mathematically always >= 0: floor(s) <= s for every term, so the sum of
  // floors can never exceed the sum of the raw shares (which equals
  // docTotalCents by construction), and both sides are integers here.
  const leftoverCents = docTotalCents - flooredTotal;

  const byLargestFractionThenIndex = fractions
    .map((frac, i) => ({ frac, i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const cents = [...floors];
  // Math.min is a pure defensive bound (see the invariant note above) —
  // leftoverCents is always < n in exact arithmetic, this just guards
  // against indexing past the array under any floating-point edge case.
  for (let k = 0; k < Math.min(leftoverCents, n); k++) {
    cents[byLargestFractionThenIndex[k].i] += 1;
  }

  return cents.map(fromCents);
}
