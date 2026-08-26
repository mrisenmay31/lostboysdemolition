import Link from "next/link";
import {
  listJobHealthSummaries,
  type DashboardFilter,
  type JobHealthSummary,
} from "@/lib/jobs/healthRepo";
import type { HealthStatus } from "@/lib/profitability/types";

/**
 * Job Dashboard (v2 Task 6, Lane C). Server-rendered list at `/jobs`, one
 * `listJobHealthSummaries(filter)` call per request — the filter comes
 * from the `?filter=` search param, validated against the `DashboardFilter`
 * union with `"active"` as the default. The six filter chips are plain
 * server-rendered `<Link>`s (no client state): each one just navigates to
 * `/jobs?filter=<value>`, so the active chip is whichever one matches the
 * resolved filter for this render.
 *
 * `dynamic = "force-dynamic"`: same reasoning as every other data-reading
 * route under `(app)` (see `estimates/page.tsx`) — this reads live job
 * health, alerts, and exceptions, so it must never be statically frozen.
 *
 * Every numeric/health field on `JobHealthSummary` is nullable by design
 * (cancelled or budget-less jobs carry nulls straight through) — every
 * render below either omits the field or falls back to an em dash rather
 * than fabricating a number. Money uses `Intl.NumberFormat` in
 * `"en-US"`/`"USD"`, matching `estimates/page.tsx`'s `currency` const.
 *
 * This is a Dane/office financial surface — no shared/exported card
 * component here by design, everything stays local to this file.
 */
export const dynamic = "force-dynamic";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const FILTERS: ReadonlyArray<{ value: DashboardFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Job Completed" },
  { value: "invoice_reconciliation", label: "Invoice / Reconciliation" },
  { value: "financially_closed", label: "Financially Closed" },
  { value: "reconciliation_required", label: "Reconciliation Required" },
  { value: "cancelled", label: "Canceled" },
];

const HEALTH_PILL: Record<HealthStatus, { label: string; classes: string }> = {
  at_risk: {
    label: "At Risk",
    classes: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  },
  watch: {
    label: "Watch",
    classes: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  },
  on_track: {
    label: "On Track",
    classes: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
  },
};

const CONFIDENCE_LABEL: Record<"high" | "medium" | "low", string> = {
  high: "high confidence",
  medium: "medium confidence",
  low: "low confidence",
};

function isDashboardFilter(value: string | undefined): value is DashboardFilter {
  return FILTERS.some((f) => f.value === value);
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `null`/undefined-safe number formatter — never fabricates a value; a
 *  missing input always renders as an em dash rather than 0 or blank. */
function formatNum(value: number | null, digits = 1): string {
  return value === null ? "—" : value.toFixed(digits);
}

interface JobsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const resolved = await searchParams;
  const rawFilter = firstParam(resolved.filter);
  const filter: DashboardFilter = isDashboardFilter(rawFilter) ? rawFilter : "active";

  const summaries = await listJobHealthSummaries(filter);
  const hasOpenExceptions = summaries.some((s) => s.openExceptionCount > 0);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 pb-12 md:max-w-5xl">
      <h1 className="text-xl font-semibold">Job Dashboard</h1>

      {hasOpenExceptions ? (
        <Link
          href="/jobs/exceptions"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
        >
          Open schedule exceptions need resolution → /jobs/exceptions
        </Link>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = f.value === filter;
          return (
            <Link
              key={f.value}
              href={`/jobs?filter=${f.value}`}
              aria-current={active ? "true" : undefined}
              className={
                active
                  ? "rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                  : "rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {summaries.length} job{summaries.length === 1 ? "" : "s"}
      </p>

      {summaries.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No jobs in this view.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {summaries.map((s) => (
            <li key={s.job.job_number} className="flex flex-col gap-1">
              <JobCard summary={s} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One dashboard card. Not exported — local to this route by design (see
 *  module doc comment). The whole card is a `<Link>` to the job detail
 *  route; `nextAction` renders as its own sibling `<Link>` underneath
 *  rather than nested inside (nested `<a>` tags are invalid HTML and
 *  Next.js's `<Link>` renders one). */
function JobCard({ summary }: { summary: JobHealthSummary }) {
  const { job } = summary;
  const isCancelled = job.status_v2 === "cancelled";
  const clientName = job.client_name ?? job.business_name ?? "—";
  const schedule =
    job.start_date !== null || job.end_date !== null
      ? `${job.start_date ?? "—"} – ${job.end_date ?? "—"}`
      : "—";
  const pill = summary.health ? HEALTH_PILL[summary.health] : null;

  return (
    <>
      <Link
        href={`/jobs/${job.job_number}`}
        className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium">
            {job.job_number} — {clientName}
          </span>
          {!isCancelled && pill ? (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${pill.classes}`}
            >
              {pill.label}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-0.5 text-sm text-zinc-600 dark:text-zinc-400">
          <span>Crew: {job.crew ?? "—"}</span>
          <span>Schedule: {schedule}</span>

          {isCancelled ? (
            <span>Cancelled: {job.cancellation_reason ?? "—"}</span>
          ) : (
            <>
              {summary.confidence ? <span>{CONFIDENCE_LABEL[summary.confidence]}</span> : null}
              <span>
                Forecast profit:{" "}
                {summary.forecastProfit !== null ? currency.format(summary.forecastProfit) : "—"}
                {summary.forecastProfitPct !== null
                  ? ` (${formatNum(summary.forecastProfitPct)}% of approved revenue)`
                  : ""}
              </span>
              <span>
                Hours: {formatNum(summary.forecastHours)} forecast / {formatNum(summary.budgetHours)}{" "}
                budget
              </span>
              <span>Crew-days remaining: {formatNum(summary.crewDaysRemaining)}</span>
            </>
          )}

          {summary.leadingReason ? (
            <span className="text-zinc-700 dark:text-zinc-300">{summary.leadingReason}</span>
          ) : null}
        </div>
      </Link>

      {summary.nextAction ? (
        <Link
          href={summary.nextAction.href}
          className="self-start text-xs font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
        >
          {summary.nextAction.label} →
        </Link>
      ) : null}
    </>
  );
}
