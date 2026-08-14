"use client";

import { useState, useTransition } from "react";
import { useEstimator } from "@/app/(app)/EstimatorChip";
import {
  LIFECYCLE_ACTION_STATUSES,
  statusLabel,
  type LifecycleActionStatus,
} from "@/lib/estimates/lifecycle";
import type { EstimateStatus } from "@/lib/estimates/types";
import { updateStatusAction } from "../../actions";

interface StatusActionsProps {
  estimateId: string;
  currentStatus: EstimateStatus;
}

/**
 * Sent / Accepted / Declined buttons — the ONLY 3 statuses the detail
 * page ever offers as a button (Task 11b binding carry #2:
 * `updateStatusAction` itself still accepts any of the 6 DB values —
 * 'superseded'/'historical' are system-managed and 'draft' is a row's own
 * creation state, none of them a button should set — LIFECYCLE_ACTION_STATUSES
 * is the single place that narrowing lives, see its doc comment).
 */
export function StatusActions({ estimateId, currentStatus }: StatusActionsProps) {
  const { estimator } = useEstimator();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSetStatus(status: LifecycleActionStatus) {
    setError(null);
    if (!estimator) {
      setError("Pick who's estimating first — tap a name up top.");
      return;
    }
    startTransition(async () => {
      const result = await updateStatusAction(estimateId, status, estimator);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Status
      </h2>
      <div className="flex gap-2">
        {LIFECYCLE_ACTION_STATUSES.map((status) => {
          const isCurrent = status === currentStatus;
          return (
            <button
              key={status}
              type="button"
              disabled={pending || isCurrent}
              onClick={() => handleSetStatus(status)}
              className={`h-10 flex-1 rounded-lg border text-sm font-medium disabled:opacity-60 ${
                isCurrent
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {statusLabel(status)}
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
