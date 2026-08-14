// ============================================================
// Lost Boys Demolition — web app — estimate lifecycle status gating
//
// PURE. `estimates.status` has 6 values (draft/sent/accepted/declined/
// superseded/historical), but only 3 are estimator-driven transitions —
// 'draft' is a row's own creation state, and 'superseded'/'historical'
// are system-managed ('superseded' is flipped automatically by
// create_estimate_with_items when a new version is created; nothing in
// this slice ever sets 'historical'). The update_estimate_status RPC
// accepts all 6 (it's a generic status-set primitive, not a state
// machine) — the narrowing to "only offer these three as buttons" is a
// UI-layer decision, not a DB one. This module is that decision, in one
// place, so the detail page's status buttons and any future caller agree
// on the same list rather than each reinventing it (or drifting).
// ============================================================

import type { EstimateStatus } from "./types";

/** The only statuses an estimator may set via the detail page's status
 *  buttons. Order is the display order. */
export const LIFECYCLE_ACTION_STATUSES = ["sent", "accepted", "declined"] as const;

export type LifecycleActionStatus = (typeof LIFECYCLE_ACTION_STATUSES)[number];

export function isLifecycleActionStatus(status: string): status is LifecycleActionStatus {
  return (LIFECYCLE_ACTION_STATUSES as readonly string[]).includes(status);
}

/** Human label for any of the 6 DB status values — used for badges/
 *  display, which must render draft/superseded/historical too even
 *  though no button ever sets them. */
export function statusLabel(status: EstimateStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "sent":
      return "Sent";
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "superseded":
      return "Superseded";
    case "historical":
      return "Historical";
    default:
      return status;
  }
}
