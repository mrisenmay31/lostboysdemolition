"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEstimator } from "@/app/(app)/EstimatorChip";
import { resolveJobAlertAction } from "../../actions";
import type { HealthStatus } from "@/lib/profitability/types";

// ============================================================
// Lost Boys Demolition — web app — v2 Task 6 Lane C: job detail
//
// Client component: open `job_alerts` for this job, each with an inline
// "Resolve" note field wired to @/app/(app)/jobs/actions.ts's
// resolveJobAlertAction, plus this job's open schedule exceptions
// (@/lib/jobs/exceptionActions.ts's OpenScheduleException — resolved
// elsewhere, at /jobs/exceptions; this queue only links out to it). This
// is the resolution path that closes the "calendar_watch:* alerts have no
// resolution path" deferral (task-4-brief.md).
//
// Same identity pattern as ResolveExceptionForm.tsx: the picker name from
// useEstimator() is required before submit; resolveJobAlertAction
// re-validates it server-side regardless.
// ============================================================

interface JobAlert {
  id: string;
  job_number: string;
  fingerprint: string;
  severity: HealthStatus;
  title: string;
  message: string;
  action_path: string;
  opened_at: string;
}

interface OpenException {
  id: string;
  job_number: string;
}

interface ActionQueueProps {
  openAlerts: JobAlert[];
  openExceptions: OpenException[];
  jobNumber: string;
}

const SEVERITY_PILL: Record<HealthStatus, string> = {
  at_risk: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200",
  watch: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  on_track: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
};

const SEVERITY_LABEL: Record<HealthStatus, string> = {
  at_risk: "At risk",
  watch: "Watch",
  on_track: "On track",
};

export function ActionQueue({ openAlerts, openExceptions, jobNumber }: ActionQueueProps) {
  if (openAlerts.length === 0 && openExceptions.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Open actions
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing open for {jobNumber}.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Open actions
      </h2>
      <ul className="flex flex-col gap-3">
        {openAlerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} />
        ))}
        {openExceptions.map((exception) => (
          <li
            key={exception.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700"
          >
            <span>Open schedule exception</span>
            <Link href="/jobs/exceptions" className="font-medium underline">
              Resolve
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AlertCard({ alert }: { alert: JobAlert }) {
  const router = useRouter();
  const { estimator } = useEstimator();

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!estimator) {
      setError("Pick who's estimating first.");
      return;
    }

    setPending(true);
    try {
      const result = await resolveJobAlertAction({ alertId: alert.id, note }, estimator);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setResolved(true);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (resolved) {
    return (
      <li className="rounded-lg border border-emerald-300 p-3 text-sm dark:border-emerald-700">
        <p className="font-medium text-emerald-700 dark:text-emerald-400">Resolved.</p>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span
            className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_PILL[alert.severity]}`}
          >
            {SEVERITY_LABEL[alert.severity]}
          </span>
          <p className="font-medium">{alert.title}</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">{alert.message}</p>
          {alert.action_path ? (
            <Link href={alert.action_path} className="w-fit text-xs font-medium underline">
              Open
            </Link>
          ) : null}
        </div>
      </div>

      {open ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">Resolution note</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending || !estimator}
              className="h-9 rounded-lg bg-zinc-900 px-3 text-xs font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {pending ? "Resolving…" : "Confirm resolve"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-9 rounded-lg px-3 text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Cancel
            </button>
          </div>
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
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-fit text-xs font-medium underline"
        >
          Resolve
        </button>
      )}
    </li>
  );
}
