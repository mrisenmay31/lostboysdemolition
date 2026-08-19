// ============================================================
// Lost Boys Demolition — web app — schedule-link visibility (pure)
// (Phase 1, v2 Task 4 / profitability v2 Phase 1 Session 3, lane 4b,
// fix round 1 — review finding #1, MAJOR/gating)
//
// PURE. Deliberately its own file, NOT inlined into [id]/page.tsx or
// [id]/schedule/page.tsx — same "pure logic lives in its own untagged
// file, testable without a Next.js/RSC harness" pattern as
// @/lib/estimates/acceptancePresentation.ts (whose header comment this
// one mirrors) and @/lib/estimates/lifecycle.ts.
//
// FIX ROUND 1 FINDING (BLOCKER): the first pass nested the "Schedule job"
// link inside [id]/page.tsx's pre-existing `canRevise ? (...) : null`
// block (`canRevise = estimate.status !== "superseded"`). Traced failure
// — the CANONICAL accept-then-revise flow, not an edge case: Dane accepts
// v1, then revises to v2. Acceptance stays pinned to v1
// (estimate_acceptance_state.current_estimate_id keeps naming v1 — see
// acceptancePresentation.ts's header), and v1's own `status` flips to
// 'superseded' the instant v2 is created (the writer contract). Reading
// v1: `canScheduleThisVersion` is TRUE (v1 is still the accepted version,
// still has no job_number) — but v1's `canRevise` is FALSE, so the old
// nesting suppressed the link entirely. Reading v2: v2 is not
// `acceptedThisVersion` (acceptance still points at v1), so no link
// renders there either. Net result: the one schedulable version had NO
// UI path to the schedule page, even though the schedule ROUTE and the
// `schedule_estimate` RPC both correctly allow it (neither of them keys
// off `estimates.status`/`canRevise` — see [id]/schedule/page.tsx, which
// never imports or reads `canRevise`). The fix is this file: extract the
// visibility condition into one pure, directly-tested function, and have
// [id]/page.tsx render the link on THIS condition alone, structurally
// independent of `canRevise` — see that file's render site.
// ============================================================

import { resolveAcceptancePresentation } from "@/lib/estimates/acceptancePresentation";
import type { EstimateAcceptanceStateRow } from "@/lib/estimates/types";

/**
 * True exactly when `estimateId` is the family's current, accepted,
 * not-yet-scheduled version — the same eligibility condition
 * `schedule_estimate` itself enforces (v2 doc Step 2 eligibility 1 + 2;
 * verified against lane 4a's landed
 * supabase/migrations/20260819170000_schedule_estimate_rpc.sql — see
 * repo.ts's classifyScheduleError doc comment for the exact raise text
 * this mirrors). Deliberately does NOT consider `estimates.status`/
 * `canRevise` — the RPC never does, and neither should this. `jobNumber`
 * is passed in explicitly (not re-fetched) so this stays a pure function
 * of already-loaded data, callable identically from both
 * [id]/page.tsx (has `estimate.job_number` on hand) and
 * [id]/schedule/page.tsx (which currently short-circuits on the same
 * field before ever computing acceptance — see that file for why it
 * still checks `job_number` first rather than calling this directly).
 */
export function canScheduleThisVersion(
  acceptanceState: EstimateAcceptanceStateRow | null,
  estimateId: string,
  jobNumber: string | null,
): boolean {
  return (
    resolveAcceptancePresentation(acceptanceState, estimateId).acceptedThisVersion &&
    jobNumber === null
  );
}
