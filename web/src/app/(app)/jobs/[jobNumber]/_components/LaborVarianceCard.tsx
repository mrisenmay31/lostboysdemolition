import type { ComparisonRow } from "@/lib/jobs/map";

// ============================================================
// Lost Boys Demolition — web app — v2 Task 6 Lane C: job detail
//
// Pure server component (native <details>, no client JS needed).
// Collapsed by default; expanded shows a productivity view (hours,
// unitless) and a cost view (dollars, but every dollar figure here is
// read straight from the "direct_labor" row of the ALREADY-BUILT
// FinancialComparison — see @/lib/jobs/map.ts's buildFinancialComparison
// — never recomputed). The one derived value this component computes
// itself is `remainingHours`, a plain hours subtraction (not money math),
// mirroring the same clamp-at-zero shape @/lib/jobs/map.ts's
// `crewDaysRemaining` uses for its own (also non-money) hours arithmetic.
//
// Rate variance is deliberately NOT rendered as a number — there is no
// per-employee rate data until Task 13 (Phase D2), so fabricating a
// $/hour delta here would be dishonest. Only the fixed explanatory label
// is shown.
// ============================================================

interface LaborVarianceCardProps {
  /** currentBudget.productive_hours (via healthInput.budgetHours). */
  budgetHours: number | null;
  /** health.forecastHours — null when the engine hasn't scored this job. */
  forecastHours: number | null;
  /** healthInput.approvedHours */
  approvedHours: number | null;
  /** healthInput.provisionalHours */
  provisionalHours: number | null;
  /** The "direct_labor" row from FinancialComparison.directRows — carries
   *  budget (current), actual+committed, and forecast labor dollars.
   *  `null` when there is no comparison table to source it from (e.g. no
   *  original budget version yet). */
  laborCostRow: ComparisonRow | null;
}

const hoursFmt = (n: number | null): string => (n === null ? "—" : `${n.toFixed(1)}`);

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (n: number | null): string => (n === null ? "—" : currency.format(n));

/** max(0, forecastHours − (approvedHours + provisionalHours)) — hours
 *  only, never dollars. `null` when either input is unavailable, so the
 *  UI renders an honest em dash instead of a fabricated zero. */
function remainingHours(
  forecast: number | null,
  approved: number | null,
  provisional: number | null,
): number | null {
  if (forecast === null || approved === null || provisional === null) return null;
  return Math.max(0, forecast - (approved + provisional));
}

export function LaborVarianceCard({
  budgetHours,
  forecastHours,
  approvedHours,
  provisionalHours,
  laborCostRow,
}: LaborVarianceCardProps) {
  const remaining = remainingHours(forecastHours, approvedHours, provisionalHours);
  const trackedHours =
    approvedHours === null && provisionalHours === null ? null : (approvedHours ?? 0) + (provisionalHours ?? 0);

  return (
    <details className="rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
      <summary className="cursor-pointer text-sm font-medium">
        Labor: forecast {hoursFmt(forecastHours)} h vs budget {hoursFmt(budgetHours)} h
      </summary>

      <div className="mt-3 flex flex-col gap-4 text-sm">
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Productivity
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <StatPair label="Budget hours" value={`${hoursFmt(budgetHours)} h`} />
            <StatPair label="Approved + provisional hours" value={`${hoursFmt(trackedHours)} h`} />
            <StatPair label="Forecast hours" value={`${hoursFmt(forecastHours)} h`} />
            <StatPair label="Remaining hours" value={`${hoursFmt(remaining)} h`} />
          </dl>
        </div>

        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Cost
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <StatPair label="Budget labor cost" value={money(laborCostRow?.current ?? null)} />
            <StatPair
              label="Actual + committed labor cost"
              value={money(laborCostRow?.actualPlusCommitted ?? null)}
            />
            <StatPair label="Forecast labor cost" value={money(laborCostRow?.forecast ?? null)} />
          </dl>
        </div>

        <p className="text-xs italic text-zinc-500 dark:text-zinc-400">
          Rate variance — available when approved time carries employee rates (Phase 5)
        </p>
      </div>
    </details>
  );
}

function StatPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
