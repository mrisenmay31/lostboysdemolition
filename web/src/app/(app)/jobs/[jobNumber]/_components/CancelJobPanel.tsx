"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useEstimator } from "@/app/(app)/EstimatorChip";
import { cancelScheduledJobAction } from "../../actions";
import type { CancelJobErrorCode } from "@/lib/jobs/scheduleActions";

// ============================================================
// Lost Boys Demolition — web app — v2 Task 6 Lane C: job detail
//
// Client component. Collapsed "Cancel / postpone…" disclosure for an
// already-scheduled job (rendered only for status_v2 "scheduled" or
// "in_progress" — see page.tsx). Mirrors ResolveExceptionForm.tsx's
// structure (pending state, error rendering, router.refresh() on
// success) while calling @/app/(app)/jobs/actions.ts's
// cancelScheduledJobAction, a DIFFERENT server action against a DIFFERENT
// RPC (`cancel_scheduled_job`, via @/lib/jobs/scheduleActions.ts).
//
// `CancelJobErrorCode` is imported `import type` only — scheduleActions.ts
// is "server-only", and a Client Component importing a VALUE (not just a
// type) from a server-only module breaks the Next.js build (the same
// precedent ResolveExceptionForm.tsx's own doc comment cites for
// exceptionActions.ts).
// ============================================================

interface CancelJobPanelProps {
  jobNumber: string;
}

type Resolution = "postponed" | "closed_lost";

const RESOLUTIONS: Array<{ value: Resolution; label: string }> = [
  {
    value: "postponed",
    label: "Postpone — client will reschedule (returns to Quote Accepted)",
  },
  {
    value: "closed_lost",
    label: "Closed lost — work is not happening",
  },
];

/** `not_cancellable` gets the brief's fixed friendly message (the job's
 *  status moved between page load and submit); every other code falls
 *  through to the RPC's own message — same "expected codes get a
 *  friendly override, everything else shows verbatim" convention as
 *  @/lib/jobs/exceptionActions.ts's friendlyResolveErrorMessage. */
function friendlyCancelErrorMessage(
  code: CancelJobErrorCode | undefined,
  rawMessage: string,
): string {
  if (code === "not_cancellable") return "This job's status changed — refresh.";
  return rawMessage;
}

export function CancelJobPanel({ jobNumber }: CancelJobPanelProps) {
  const router = useRouter();
  const { estimator } = useEstimator();

  const [resolution, setResolution] = useState<Resolution>("postponed");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Resolution | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!estimator) {
      setError("Pick who's estimating first.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }

    setPending(true);
    try {
      const result = await cancelScheduledJobAction(
        { jobNumber, resolution, reason },
        estimator,
      );
      if (!result.ok) {
        setError(friendlyCancelErrorMessage(result.code, result.error));
        return;
      }
      setDone(resolution);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-300 p-3 text-sm dark:border-emerald-700">
        <p className="font-medium text-emerald-700 dark:text-emerald-400">
          {done === "postponed" ? "Job postponed." : "Job marked closed lost."}
        </p>
      </div>
    );
  }

  return (
    <details className="rounded-lg border border-red-300 p-3 dark:border-red-800">
      <summary className="cursor-pointer text-sm font-medium text-red-700 dark:text-red-400">
        Cancel / postpone…
      </summary>

      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Resolution</legend>
          {RESOLUTIONS.map((option) => (
            <label key={option.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="cancel-resolution"
                value={option.value}
                checked={resolution === option.value}
                onChange={() => setResolution(option.value)}
                className="mt-1"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Reason</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            required
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <button
          type="submit"
          disabled={pending || !estimator}
          className="h-11 w-full rounded-lg bg-red-700 text-sm font-semibold text-white disabled:opacity-60 dark:bg-red-600"
        >
          {pending ? "Submitting…" : "Submit"}
        </button>

        {!estimator ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Pick who&apos;s estimating first.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
