// ============================================================
// Lost Boys Demolition — web app — acceptance-state presentation (pure)
// (Phase 1, v2 Task 2 / Session 2 lane 2d, fix round F3)
//
// Deliberately its own file, NOT part of commercialLifecycle.ts (where
// this logic was originally added) — commercialLifecycle.ts carries a
// top-level `import "server-only"`, which poisons ANY module that imports
// from it, even a 100% pure, side-effect-free export, for any Client
// Component in the tree. `CommercialLifecyclePanel.tsx` ("use client")
// needs this function directly (it's the render-branching logic the fix
// round F3 finding requires), so the function has to live somewhere the
// "server-only" tag can't reach. Same "pure logic lives in its own
// untagged file" pattern as `builderLogic.ts`/`validate.ts`/`map.ts` in
// this same directory.
//
// `commercialLifecycle.ts` re-exports this verbatim (`export {
// resolveAcceptancePresentation, type AcceptancePresentation } from
// "./acceptancePresentation"`) so every existing import site
// (commercialLifecycle.test.ts, this module's own doc comments) keeps
// working unchanged — the split is an implementation detail, not a public
// API change.
// ============================================================

import type { EstimateAcceptanceStateRow } from "./types";

/** How `CommercialLifecyclePanel` should render acceptance state for ONE
 *  specific version, and where its Reverse control (if any) should aim. */
export interface AcceptancePresentation {
  /** This version IS the family's current accepted version — render
   *  "Accepted" + a Reverse control targeting THIS estimate id. */
  acceptedThisVersion: boolean;
  /** The family has an active acceptance, but it belongs to a DIFFERENT
   *  version than the one being viewed (the dead-end this fix round
   *  closes: after revising an accepted estimate, the new latest version
   *  is never itself "accepted", but the family still is). Render a
   *  notice naming/linking `reverseTargetEstimateId`, offer Reverse
   *  targeting IT, and do NOT render the acceptance form — accepting a
   *  second version on top of an already-accepted family is exactly the
   *  phantom-duplicate scenario F7's guard exists to prevent. */
  acceptedOtherVersion: boolean;
  /** The estimate id any Reverse control should submit as its target.
   *  Equals `estimateId` whenever there's no active acceptance anywhere
   *  (a Reverse control simply isn't rendered in that case, but the field
   *  stays total for callers) — otherwise always the family's
   *  `current_estimate_id`, per `reverseEstimateAcceptance`'s own F1/F3
   *  target-check (commercialLifecycle.ts) ("the reversal target must be
   *  the currently accepted version"). Reversing is therefore NEVER
   *  performed against the page's own `estimateId` when that differs from
   *  the accepted version — only against the version acceptance actually
   *  lives on. */
  reverseTargetEstimateId: string;
}

/**
 * Pure classification `CommercialLifecyclePanel` uses to decide what to
 * render for one version (`estimateId`) given the FAMILY-level
 * `acceptanceState`. Deliberately mirrors `isSchedulingEligible`'s
 * (commercialLifecycle.ts) "accepted && current_estimate_id === estimateId"
 * shape rather than inventing a new predicate style — the two are read
 * together everywhere they matter (this drives what the estimator sees;
 * that drives what `schedule_estimate` will accept).
 */
export function resolveAcceptancePresentation(
  state: EstimateAcceptanceStateRow | null,
  estimateId: string,
): AcceptancePresentation {
  const accepted = !!state?.accepted;
  const currentEstimateId = state?.current_estimate_id ?? null;
  const acceptedThisVersion = accepted && currentEstimateId === estimateId;
  const acceptedOtherVersion = accepted && currentEstimateId !== estimateId;
  return {
    acceptedThisVersion,
    acceptedOtherVersion,
    reverseTargetEstimateId: accepted && currentEstimateId ? currentEstimateId : estimateId,
  };
}
