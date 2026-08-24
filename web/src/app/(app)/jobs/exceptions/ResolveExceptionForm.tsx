"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useEstimator } from "@/app/(app)/EstimatorChip";
import type {
  OpenScheduleException,
  ResolveDeletedCalendarEventInput,
  ResolveExceptionErrorCode,
  ResolvedException,
  ResolveExceptionResolution,
} from "@/lib/jobs/exceptionActions";

// ------------------------------------------------------------
// Shared with page.tsx (type-only import back into the Server Component
// — see that file's header comment for why the inline server action is
// typed against shapes defined HERE rather than the reverse).
// ------------------------------------------------------------

/** What the client sends — everything `resolveDeletedCalendarEvent` needs
 *  EXCEPT `actorName`, which the server action supplies itself from the
 *  re-validated picker name (never trusted from the client directly). */
export type ResolveExceptionActionInput = Omit<
  ResolveDeletedCalendarEventInput,
  "actorName"
>;

export type ResolveExceptionActionResult =
  | { ok: true; result: ResolvedException }
  | { ok: false; error: string; code?: ResolveExceptionErrorCode };

interface ResolveExceptionFormProps {
  exception: OpenScheduleException;
  resolveExceptionAction: (
    input: ResolveExceptionActionInput,
    estimatorName: string,
  ) => Promise<ResolveExceptionActionResult>;
}

const RESOLUTIONS: Array<{
  value: ResolveExceptionResolution;
  label: string;
  explanation: string;
}> = [
  {
    value: "reschedule",
    label: "Reschedule",
    explanation: "Pick a new schedule window — the app recreates the calendar event.",
  },
  {
    value: "postponed",
    label: "Postponed",
    explanation: "Unschedules the job and returns GHL to Quote Accepted.",
  },
  {
    value: "closed_lost",
    label: "Closed lost",
    explanation: "Unschedules the job and moves GHL to Closed Lost (Declined).",
  },
  {
    value: "dismiss",
    label: "Dismiss",
    explanation: "Keeps the same dates and recreates the calendar event as scheduled.",
  },
];

/**
 * Resolve form for one open schedule exception (Phase 1, v2 Task 5B
 * Step 2, Lane W). Same "use client" pattern as
 * estimates/[id]/schedule/ScheduleEstimateForm.tsx: owns its own form
 * state, calls one server action on submit, surfaces that action's
 * error via `role="alert"`. One instance renders per card on the
 * `/jobs/exceptions` list — `exception.id` is what actually identifies
 * which row is being resolved (see exceptionActions.ts's module header:
 * a job can hold two open exceptions at once, so `job_number` alone
 * would be ambiguous).
 *
 * No pricing rendered anywhere in this form — only the resolution
 * choice, its one-line consequence, optional reschedule dates, and a
 * required reason.
 */
export function ResolveExceptionForm({
  exception,
  resolveExceptionAction,
}: ResolveExceptionFormProps) {
  const router = useRouter();
  const { estimator } = useEstimator();

  const [resolution, setResolution] = useState<ResolveExceptionResolution>("reschedule");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedException | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!estimator) {
      setError("Pick who's estimating first — tap a name up top.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    if (resolution === "reschedule" && (!startDate || !endDate)) {
      setError("Start date and end date are required for reschedule.");
      return;
    }

    setPending(true);
    try {
      const result = await resolveExceptionAction(
        {
          exceptionId: exception.id,
          resolution,
          reason,
          ...(resolution === "reschedule" ? { startDate, endDate } : {}),
        },
        estimator,
      );

      if (!result.ok) {
        // Fix round 1, review finding #1: `result.error` arrives already
        // mapped to a human-readable message — page.tsx's server action
        // runs it through @/lib/jobs/exceptionActions.ts's
        // friendlyResolveErrorMessage before returning (that mapping
        // can't live here: it's exported from the "server-only"
        // exceptionActions.ts module, and a Client Component importing a
        // VALUE — not just a type — from a server-only module fails the
        // Next.js build). `not_open` is the operationally important
        // case: it means someone else already resolved this exact row
        // between page load and this submit, so the on-screen list is
        // stale — router.refresh() re-fetches it (page.tsx is
        // force-dynamic, so this pulls a fresh listOpenScheduleExceptions()
        // read) rather than leaving a dead form on screen.
        setError(result.error);
        if (result.code === "not_open") {
          router.refresh();
        }
        return;
      }
      setResolved(result.result);
    } finally {
      setPending(false);
    }
  }

  if (resolved) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-emerald-300 p-3 text-sm dark:border-emerald-700">
        <p className="font-medium text-emerald-700 dark:text-emerald-400">
          Resolved as {resolved.resolution.replace("_", " ")}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Resolution</legend>
        {RESOLUTIONS.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`resolution-${exception.id}`}
              value={option.value}
              checked={resolution === option.value}
              onChange={() => setResolution(option.value)}
              className="mt-1"
            />
            <span className="flex flex-col">
              <span className="font-medium">{option.label}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {option.explanation}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {resolution === "reschedule" ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              Start date{" "}
              <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                (all day)
              </span>
            </span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-11 w-full rounded-lg border border-zinc-300 px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              End date{" "}
              <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                (all day, inclusive)
              </span>
            </span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-11 w-full rounded-lg border border-zinc-300 px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Reason</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-lg bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Resolving…" : "Resolve"}
      </button>

      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
