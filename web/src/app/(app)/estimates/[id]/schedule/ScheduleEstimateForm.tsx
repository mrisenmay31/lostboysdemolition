"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useEstimator } from "@/app/(app)/EstimatorChip";
import { scheduleEstimateAction } from "@/app/(app)/jobs/actions";
import { CREW_OPTIONS } from "@/lib/jobs/crews";

// Crew selection (Phase 1, v2 Task 4 / Session 3 lane 4b). CREW_OPTIONS
// now lives in the shared pure @/lib/jobs/crews.ts module (fix round 1,
// review finding #2) — imported here AND by validate.ts, so the closed
// "Crew 1".."Crew 4" set is defined exactly once and enforced at the
// server trust boundary too, not just presented as this form's option
// list. See crews.ts's header for the full rationale (matches
// `_shared/slack.ts`'s `resolveCrewEnvKey` vocabulary; "Jackson"/"Other"
// deliberately excluded, pending a product decision).

interface ScheduleEstimateFormProps {
  estimateId: string;
}

/**
 * Schedule form (Phase 1, v2 Task 4 / Session 3 lane 4b). Same
 * "use client" component pattern as CommercialLifecyclePanel/
 * QuoteOverridePanel/StatusActions: owns its own form state, calls one
 * server action on submit, surfaces that action's error via
 * `role="alert"`.
 *
 * Inclusive start/end dates, both explicitly labeled "All day" (v2 doc
 * Step 3: "The form requires crew, inclusive start date, and inclusive
 * end date and explicitly labels the event 'All day.'"). On success,
 * shows the minted/linked job number (v2 Task 6's `/jobs/[jobNumber]`
 * route 404s until that task ships, but the number itself is real and
 * worth showing immediately) and then navigates there, per v2 doc Step 3
 * ("On success, navigate to /jobs/<JOB-XXXX>").
 *
 * `already_scheduled` is handled as a soft success, not an error — see
 * repo.ts's ScheduleEstimateError doc comment: the page-level pre-check
 * ([id]/schedule/page.tsx) should already have kept the user from
 * reaching this form for an estimate that carries a job_number, so this
 * branch is a race-condition backstop (e.g. a second tab), not the
 * common path.
 */
export function ScheduleEstimateForm({ estimateId }: ScheduleEstimateFormProps) {
  const router = useRouter();
  const { estimator } = useEstimator();

  const [crew, setCrew] = useState<string>(CREW_OPTIONS[0]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduledJobNumber, setScheduledJobNumber] = useState<string | null>(null);
  const [linkedJobNumber, setLinkedJobNumber] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!estimator) {
      setError("Pick who's estimating first — tap a name up top.");
      return;
    }
    if (!startDate || !endDate) {
      setError("Start date and end date are required.");
      return;
    }

    setPending(true);
    try {
      const result = await scheduleEstimateAction(
        { estimateId, crew, startDate, endDate },
        estimator,
      );

      if (!result.ok) {
        if (result.code === "already_scheduled" && result.jobNumber) {
          setLinkedJobNumber(result.jobNumber);
          return;
        }
        setError(result.error);
        return;
      }

      setScheduledJobNumber(result.job.job_number);
      router.push(`/jobs/${result.job.job_number}`);
    } finally {
      setPending(false);
    }
  }

  if (linkedJobNumber) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
        <p className="font-medium">This estimate is already linked to job {linkedJobNumber}.</p>
        <button
          type="button"
          onClick={() => router.push(`/jobs/${linkedJobNumber}`)}
          className="h-10 w-fit rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          View job {linkedJobNumber}
        </button>
      </div>
    );
  }

  if (scheduledJobNumber) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-emerald-300 p-3 text-sm dark:border-emerald-700">
        <p className="font-medium text-emerald-700 dark:text-emerald-400">
          Scheduled as {scheduledJobNumber}.
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Taking you to the job…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Crew</span>
        <select
          value={crew}
          onChange={(e) => setCrew(e.target.value)}
          className="h-11 w-full rounded-lg border border-zinc-300 px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        >
          {CREW_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">
          Start date <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">(all day)</span>
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
          End date <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">(all day, inclusive)</span>
        </span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="h-11 w-full rounded-lg border border-zinc-300 px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-lg bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Scheduling…" : "Schedule job"}
      </button>

      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
