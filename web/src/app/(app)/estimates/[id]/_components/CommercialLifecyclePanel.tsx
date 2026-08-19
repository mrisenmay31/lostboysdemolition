"use client";

import { useState } from "react";
import Link from "next/link";
import { useEstimator } from "@/app/(app)/EstimatorChip";
// Fix round F3 build note: imported from acceptancePresentation.ts, NOT
// from "@/lib/estimates/commercialLifecycle" — that module carries a
// top-level `import "server-only"`, which fails the Next.js build the
// instant a Client Component (this file) imports anything from it, even
// a pure re-exported function. See acceptancePresentation.ts's header.
import { resolveAcceptancePresentation } from "@/lib/estimates/acceptancePresentation";
import type {
  EstimateAcceptanceStateRow,
  EstimatePresentationRow,
  EstimateRow,
} from "@/lib/estimates/types";
import {
  presentEstimateAction,
  recordEstimateAcceptanceAction,
  reverseEstimateAcceptanceAction,
} from "../../actions";

interface CommercialLifecyclePanelProps {
  estimateId: string;
  presentation: EstimatePresentationRow | null;
  acceptanceState: EstimateAcceptanceStateRow | null;
  /** Every version sharing this estimate's `estimate_number` (from
   *  `getEstimate()`'s detail — page.tsx passes it straight through).
   *  Fix round F3: used only to look up the VERSION NUMBER of
   *  `acceptanceState.current_estimate_id` when it names a version other
   *  than the one being viewed, so the "accepted elsewhere" notice can
   *  say "v2 is accepted" instead of just a bare id. */
  versionChain: EstimateRow[];
}

const AUTHORIZATION_METHODS = ["signature", "email", "text", "verbal", "other"] as const;

/**
 * Present / Record acceptance / Reverse acceptance controls (Phase 1, v2
 * Task 2 lane 2d). Follows the same pattern as StatusActions/
 * QuoteOverridePanel: a "use client" component owning its own small form
 * state, calling one server action per submit, surfacing that action's
 * error string via `role="alert"`.
 *
 * `acceptanceState.accepted` (not `estimate.status`) is the scheduling-
 * authority signal this panel keys its "accepted" branch off of —
 * `estimates.status` is only ever a MIRROR of it (see
 * commercialLifecycle.ts's presentEstimate/recordEstimateAcceptance/
 * reverseEstimateAcceptance, each of which writes both).
 *
 * FIX ROUND F3: `acceptanceState.accepted` alone used to drive this panel
 * — a boolean with no notion of WHICH version it belongs to. After
 * revising an accepted estimate, the family stays accepted but
 * `current_estimate_id` still names the OLD version, so the new latest
 * version's page showed "Accepted" (never actually true for it) with a
 * Reverse control that always raised "not the accepted version" — a
 * dead end with no way to reverse OR re-accept. `resolveAcceptancePresentation`
 * (commercialLifecycle.ts, pure, unit-tested there) now classifies THIS
 * version against the family state and returns the id any Reverse control
 * should target, which this panel always uses instead of `estimateId`
 * directly — see `reverseEstimateAcceptance`'s own doc comment for why
 * that id (not the page's own version) is the one the RPC will accept.
 */
export function CommercialLifecyclePanel({
  estimateId,
  presentation,
  acceptanceState,
  versionChain,
}: CommercialLifecyclePanelProps) {
  const { estimator } = useEstimator();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const [customerContactName, setCustomerContactName] = useState("");
  const [method, setMethod] = useState<(typeof AUTHORIZATION_METHODS)[number]>("signature");
  const [note, setNote] = useState("");

  const [reversing, setReversing] = useState(false);
  const [destination, setDestination] = useState<"quote_sent" | "closed_lost">("quote_sent");
  const [reversalReason, setReversalReason] = useState("");

  function requireEstimator(): boolean {
    if (!estimator) {
      setError("Pick who's estimating first — tap a name up top.");
      return false;
    }
    return true;
  }

  async function handlePresent() {
    setError(null);
    setWarning(null);
    if (!requireEstimator() || !estimator) return;
    setPending(true);
    try {
      const result = await presentEstimateAction(estimateId, estimator);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Fix round F2: a non-null `warning` here means the presentation
      // itself WAS recorded (and status updated) — the GHL stage move is
      // what failed. Non-blocking: never treated as an error.
      if (result.warning) setWarning(result.warning);
    } finally {
      setPending(false);
    }
  }

  async function handleAccept() {
    setError(null);
    setWarning(null);
    if (!requireEstimator() || !estimator) return;
    if (!customerContactName.trim()) {
      setError("Customer contact name is required.");
      return;
    }
    if (!note.trim()) {
      setError("A note is required.");
      return;
    }
    setPending(true);
    try {
      const result = await recordEstimateAcceptanceAction(
        {
          estimateId,
          method,
          customerContactName: customerContactName.trim(),
          effectiveAt: new Date().toISOString(),
          note: note.trim(),
          evidencePaths: [],
        },
        estimator,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.warning) setWarning(result.warning);
      setCustomerContactName("");
      setNote("");
    } finally {
      setPending(false);
    }
  }

  async function handleReverse() {
    setError(null);
    setWarning(null);
    if (!requireEstimator() || !estimator) return;
    if (!reversalReason.trim()) {
      setError("A reason is required to reverse the acceptance.");
      return;
    }
    setPending(true);
    try {
      // Fix round F3: NEVER reverse against `estimateId` (this page's own
      // version) when the family's active acceptance belongs to a
      // different version — `reverseTargetEstimateId` is exactly
      // `acceptanceState.current_estimate_id` in that case. See
      // `resolveAcceptancePresentation` and `reverseEstimateAcceptance`'s
      // own doc comment.
      const result = await reverseEstimateAcceptanceAction(
        presentationInfo.reverseTargetEstimateId,
        destination,
        reversalReason.trim(),
        estimator,
      );
      if (!result.ok) {
        // Handoff #5 — this message is the classified
        // RecordAcceptanceEventError text when applicable (e.g. "no active
        // acceptance to reverse", "is not the accepted version"); show it
        // verbatim rather than retrying anything.
        setError(result.error);
        return;
      }
      if (result.warning) setWarning(result.warning);
      setReversing(false);
      setReversalReason("");
    } finally {
      setPending(false);
    }
  }

  // Fix round F3: classify THIS version against the family-level
  // acceptanceState — see resolveAcceptancePresentation's doc comment and
  // this component's own header comment for the dead-end this replaces.
  const presentationInfo = resolveAcceptancePresentation(acceptanceState, estimateId);
  const { acceptedThisVersion, acceptedOtherVersion } = presentationInfo;
  const acceptedElsewhereVersion = acceptedOtherVersion
    ? versionChain.find((v) => v.id === acceptanceState?.current_estimate_id) ?? null
    : null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Commercial lifecycle
      </h2>

      {presentation ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Presented via {presentation.presented_via} by {presentation.presented_by_name} on{" "}
          {new Date(presentation.presented_at).toLocaleString()}.
        </p>
      ) : (
        <button
          type="button"
          onClick={handlePresent}
          disabled={pending}
          className="h-10 w-fit rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-60 dark:border-zinc-700"
        >
          {pending ? "Presenting…" : "Mark as presented"}
        </button>
      )}

      {acceptedThisVersion || acceptedOtherVersion ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            {acceptedThisVersion
              ? "Accepted (this version)"
              : `Accepted — v${acceptedElsewhereVersion?.version ?? "?"}`}
            {acceptanceState?.accepted_price !== null && acceptanceState?.accepted_price !== undefined
              ? ` — ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(acceptanceState.accepted_price)}`
              : ""}
          </p>
          {/* Fix round F3: the dead end this closes — after a revise, THIS
              version is never itself "accepted", but the family still is,
              on a different version. Name/link it rather than showing a
              Reverse control with no context for what it targets. */}
          {acceptedOtherVersion ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              This family&apos;s active acceptance belongs to{" "}
              <Link
                href={`/estimates/${presentationInfo.reverseTargetEstimateId}`}
                className="font-medium underline"
              >
                v{acceptedElsewhereVersion?.version ?? "…"}
              </Link>
              , not the version you&apos;re viewing — reversing below acts on that version.
            </p>
          ) : null}
          {reversing ? (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Reverse to</span>
                <select
                  value={destination}
                  onChange={(e) => setDestination(e.target.value as "quote_sent" | "closed_lost")}
                  className="h-11 w-full rounded-lg border border-zinc-300 px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="quote_sent">Quote Sent</option>
                  <option value="closed_lost">Closed Lost (Declined)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Reason (required)</span>
                <textarea
                  rows={2}
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleReverse}
                  disabled={pending}
                  className="h-10 flex-1 rounded-lg bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {pending ? "Reversing…" : "Confirm reversal"}
                </button>
                <button
                  type="button"
                  onClick={() => setReversing(false)}
                  disabled={pending}
                  className="h-10 flex-1 rounded-lg border border-zinc-300 text-sm font-semibold disabled:opacity-60 dark:border-zinc-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setReversing(true)}
              className="h-10 w-fit rounded-lg border border-zinc-300 px-4 text-sm font-medium text-red-600 dark:border-zinc-700 dark:text-red-400"
            >
              Reverse acceptance
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Customer contact name</span>
            <input
              type="text"
              value={customerContactName}
              onChange={(e) => setCustomerContactName(e.target.value)}
              className="h-11 w-full rounded-lg border border-zinc-300 px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Authorization method</span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as (typeof AUTHORIZATION_METHODS)[number])}
              className="h-11 w-full rounded-lg border border-zinc-300 px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
            >
              {AUTHORIZATION_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Note</span>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <button
            type="button"
            onClick={handleAccept}
            disabled={pending}
            className="h-10 w-fit rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? "Recording…" : "Record acceptance"}
          </button>
        </div>
      )}

      {/* Fix round F2: non-blocking notice — the action DID succeed (the
          DB write is durable), only the follow-on GHL stage move failed. */}
      {warning ? (
        <p role="status" className="text-xs font-medium text-amber-700 dark:text-amber-400">
          {warning}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
