// ============================================================
// Lost Boys Demolition — web app — v2 Task 6 Lane C: job detail
//
// Pure server component (props → markup). Newest-first list of
// `job_events` rows (the caller — @/lib/jobs/healthRepo.ts's
// getJobHealthDetail — already queries `order("created_at", { ascending:
// false })`, so this component does not re-sort). Timestamp formatting
// mirrors the house pattern (jobs/exceptions/page.tsx:74-79):
// `America/Denver`, `dateStyle: "medium"`, `timeStyle: "short"`.
// ============================================================

interface JobEvent {
  id: number;
  stage_from: number | null;
  stage_to: number | null;
  function_name: string | null;
  action_summary: string | null;
  status: string | null;
  created_at: string;
}

interface AuditTimelineProps {
  jobEvents: JobEvent[];
}

const STATUS_DOT: Record<string, string> = {
  success: "bg-emerald-500",
  error: "bg-red-500",
  skipped: "bg-zinc-400",
};

function formatDenver(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Denver",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AuditTimeline({ jobEvents }: AuditTimelineProps) {
  if (jobEvents.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No events recorded yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2 text-sm">
      {jobEvents.map((event) => (
        <li
          key={event.id}
          className="flex items-start gap-2 rounded-lg border border-zinc-300 p-2 dark:border-zinc-700"
        >
          <span
            aria-hidden
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
              event.status ? (STATUS_DOT[event.status] ?? "bg-zinc-300") : "bg-zinc-300"
            }`}
          />
          <div className="flex flex-col">
            <p className="font-medium">
              {event.action_summary ?? `${event.stage_from ?? "—"} → ${event.stage_to ?? "—"}`}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {event.function_name ?? "—"} · {formatDenver(event.created_at)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
