import Link from "next/link";
import { notFound } from "next/navigation";
import { getJobHealthDetail } from "@/lib/jobs/healthRepo";
import { HealthBanner } from "./_components/HealthBanner";
import { FinancialComparisonTable } from "./_components/FinancialComparisonTable";
import { LaborVarianceCard } from "./_components/LaborVarianceCard";
import { ActionQueue } from "./_components/ActionQueue";
import { AuditTimeline } from "./_components/AuditTimeline";
import { CancelJobPanel } from "./_components/CancelJobPanel";
import { ForecastOverridePanel } from "./_components/ForecastOverridePanel";

// ============================================================
// Lost Boys Demolition — web app — v2 Task 6 Lane C: job detail
//
// Per-job profitability detail route (task-4-brief.md Step 1). Server
// component, `dynamic = "force-dynamic"` — same reasoning as every other
// data-reading route under (app): this page reads live forecast/ledger
// state that changes from crew time entries, BILL webhooks, and the
// calendar sync, so it must never be prerendered/frozen.
//
// Consumes ONE round trip — @/lib/jobs/healthRepo.ts's
// getJobHealthDetail(jobNumber) — and renders its `JobHealthDetail`
// verbatim in the locked 9-section order below (originally 8; Session 14
// / v2 Task 9 inserted section 6, "Forecast override", between Labor
// variance and Change orders, shifting every section after it down by
// one — this comment update IS the deliberate act the task-7 brief
// requires, not a silent renumbering). This page never recomputes money
// math itself; every dollar figure either comes straight off a
// `JobBudgetVersionRow`/`JobHealthResult` field or off the pre-built
// `FinancialComparison` (@/lib/jobs/map.ts), read here only to pick out
// the one row LaborVarianceCard needs.
//
// Session-14 controller ruling (same session, after first review): the
// new ForecastOverridePanel (section 6) REPLACES the pre-existing static
// "Forecast overrides (n)" `<details>` block that used to live under
// section 8/9's "Expandable sections" group — that block duplicated the
// panel's own override-history list. It has been removed; the panel is
// now the SINGLE override-history surface on this page. Every field the
// old block rendered (remaining_workdays, expected_crew_size,
// hours_per_day, expected_remaining_cost, reason, created_by_name,
// created_at) is still shown, via the panel's overrideSummary()/
// laborSummary() helpers — no data visibility was lost, only the
// duplicate presentation. Net effect on the "Expandable sections" group:
// its sub-block count drops from 4 (Cost entries, Revenue entries,
// Forecast overrides, Audit) to 3 (Cost entries, Revenue entries, Audit).
// ============================================================

export const dynamic = "force-dynamic";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatDenver(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Denver",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** "financially_closed" -> "Financially closed", "scheduled" ->
 *  "Scheduled" — shared formatting for the status_v2/financial_status
 *  chips and the change-order status line. Purely cosmetic, no meaning
 *  attached. */
function formatStatusLabel(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface JobDetailPageProps {
  params: Promise<{ jobNumber: string }>;
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobNumber } = await params;

  const detail = await getJobHealthDetail(jobNumber);
  if (!detail) {
    notFound();
  }

  const {
    job,
    originalBudget,
    currentBudget,
    healthInput,
    health,
    comparison,
    costEntries,
    revenueEntries,
    openAlerts,
    openExceptions,
    overrides,
    changeOrders,
    jobEvents,
    costEntryAudit,
    estimateHref,
  } = detail;

  const isCancelled = job.status_v2 === "cancelled";
  const showCancelPanel = job.status_v2 === "scheduled" || job.status_v2 === "in_progress";

  const laborCostRow = comparison?.directRows.find((row) => row.key === "direct_labor") ?? null;

  const hasCompanyIdentity = Boolean(job.client_contact_name || job.business_name);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 p-4 pb-12">
      {/* 1. Identity/status header */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{job.job_number}</h1>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium dark:bg-zinc-800">
              {formatStatusLabel(job.status_v2)}
            </span>
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium dark:bg-zinc-800">
              {formatStatusLabel(job.financial_status)}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-0.5 text-sm">
          {hasCompanyIdentity ? (
            <>
              {job.client_contact_name ? <p>{job.client_contact_name}</p> : null}
              {job.business_name ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{job.business_name}</p>
              ) : null}
            </>
          ) : (
            <p>{job.client_name ?? "—"}</p>
          )}
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {job.job_address ?? "—"}
          {job.city ? `, ${job.city}` : ""}
        </p>

        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          <span>Crew: {job.crew ?? "—"}</span>
          <span>
            {job.start_date ?? "—"} – {job.end_date ?? "—"}
            {job.start_time ? ` at ${job.start_time}` : ""}
          </span>
        </div>

        {estimateHref ? (
          <Link href={estimateHref} className="w-fit text-xs font-medium underline">
            {job.original_estimate_number !== null
              ? `Estimate #${job.original_estimate_number}`
              : "View source estimate"}
          </Link>
        ) : null}
      </header>

      {/* 2. Health banner */}
      <HealthBanner
        health={health?.health ?? null}
        confidence={health?.confidence ?? null}
        leadingReason={health?.reasons[0] ?? null}
        cancelled={isCancelled}
        cancellationReason={job.cancellation_reason}
      />

      {/* 3. Forecast profit vs. original expectation */}
      <section className="grid grid-cols-2 gap-3">
        <StatTile
          label="Forecast profit"
          value={health ? currency.format(health.forecastProfit) : "—"}
          sub={health ? `${health.forecastProfitPct.toFixed(1)}%` : undefined}
        />
        <StatTile
          label="Original plan"
          value={originalBudget ? currency.format(originalBudget.planned_economic_profit) : "—"}
          sub={originalBudget ? `${originalBudget.planned_profit_pct.toFixed(1)}%` : undefined}
        />
      </section>
      <p className="-mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        {health
          ? `Retaining ${health.profitRetentionPct.toFixed(1)}% of planned profit`
          : "Profit retention unavailable — no forecast yet."}
      </p>

      {/* 4. Financial comparison table */}
      {comparison ? (
        <FinancialComparisonTable comparison={comparison} />
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Financial comparison
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Unavailable — this job is missing an original or current budget version.
          </p>
        </section>
      )}

      {/* 5. Labor variance */}
      <LaborVarianceCard
        budgetHours={currentBudget?.productive_hours ?? null}
        forecastHours={health?.forecastHours ?? null}
        approvedHours={healthInput?.approvedHours ?? null}
        provisionalHours={healthInput?.provisionalHours ?? null}
        laborCostRow={laborCostRow}
      />

      {/* 6. Forecast override (owner-gated, Session 14 / v2 Task 9) */}
      <ForecastOverridePanel
        jobNumber={job.job_number}
        current={{
          remainingWorkdays: healthInput?.remainingWorkdays ?? null,
          expectedCrewSize: healthInput?.expectedCrewSize ?? null,
          hoursPerDay: healthInput?.hoursPerDay ?? 8,
          forecastProfit: health?.forecastProfit ?? null,
          health: health?.health ?? null,
        }}
        overrides={overrides}
      />

      {/* 7. Change orders */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Change orders
        </h2>
        {changeOrders.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No change orders. Creation ships with v2 Task 10.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {changeOrders.map((co) => (
              <li
                key={co.id}
                className="rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700"
              >
                <p className="font-medium">
                  Change order #{co.change_order_number} — v{co.current_version}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formatStatusLabel(co.status)} · {co.created_by_name} ·{" "}
                  {formatDenver(co.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 8. Action queue */}
      <ActionQueue openAlerts={openAlerts} openExceptions={openExceptions} jobNumber={job.job_number} />

      {/* 9. Expandable sections */}
      <details className="rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
        <summary className="cursor-pointer text-sm font-medium">
          Cost entries ({costEntries.length})
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          {costEntries.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No cost entries yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    <th className="py-1 pr-2 font-medium">Category</th>
                    <th className="py-1 px-2 font-medium">State</th>
                    <th className="py-1 px-2 text-right font-medium">Amount</th>
                    <th className="py-1 px-2 font-medium">Vendor / Employee</th>
                    <th className="py-1 px-2 font-medium">Incurred</th>
                    <th className="py-1 pl-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {costEntries.map((entry) => (
                    <tr key={entry.id} className="border-t border-zinc-100 dark:border-zinc-900">
                      <td className="py-1 pr-2">{formatStatusLabel(entry.category)}</td>
                      <td className="py-1 px-2">{formatStatusLabel(entry.state)}</td>
                      <td className="py-1 px-2 text-right tabular-nums">
                        {currency.format(entry.amount)}
                      </td>
                      <td className="py-1 px-2">
                        {entry.vendor_name ?? entry.employee_name ?? "—"}
                      </td>
                      <td className="py-1 px-2">{formatDenver(entry.incurred_at)}</td>
                      <td className="py-1 pl-2">{entry.source_system}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link
            href={`/jobs/${jobNumber}/costs`}
            className="w-fit text-xs font-medium underline"
          >
            Add cost entries
          </Link>
        </div>
      </details>

      <details className="rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
        <summary className="cursor-pointer text-sm font-medium">
          Revenue entries ({revenueEntries.length})
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          {revenueEntries.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No revenue entries yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {revenueEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 p-2 dark:border-zinc-800"
                >
                  <span>{formatStatusLabel(entry.entry_type)}</span>
                  <span className="tabular-nums">{currency.format(entry.amount)}</span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {formatDenver(entry.occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Payments affect collection, not job profit.
          </p>
          <Link
            href={`/jobs/${jobNumber}/revenue`}
            className="w-fit text-xs font-medium underline"
          >
            Add revenue entries
          </Link>
        </div>
      </details>

      <details className="rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
        <summary className="cursor-pointer text-sm font-medium">
          Audit ({jobEvents.length + costEntryAudit.length})
        </summary>
        <div className="mt-3">
          <AuditTimeline jobEvents={jobEvents} costAudit={costEntryAudit} />
        </div>
      </details>

      {showCancelPanel ? <CancelJobPanel jobNumber={job.job_number} /> : null}
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-zinc-500 dark:text-zinc-400">{sub}</p> : null}
    </div>
  );
}
