import type { ComparisonColumnSet, ComparisonRow, FinancialComparison } from "@/lib/jobs/map";

// ============================================================
// Lost Boys Demolition — web app — v2 Task 6 Lane C: job detail
//
// Pure server component (props → markup, no I/O, no money math). Every
// number rendered here is read directly off `FinancialComparison` — built
// once, in @/lib/jobs/map.ts's `buildFinancialComparison`, and passed
// down through `getJobHealthDetail`. This component never recomputes a
// subtotal, a margin, or a category sum; it only formats and lays out
// values it is handed.
//
// Locked row order (task-4-brief.md Step 2): Total Revenue; the 6 direct
// category rows; Total Direct Costs; Gross Profit; Overhead Allocation;
// Processing Fees; Job Profit; Job Profit Margin (percent row, its own
// `ComparisonColumnSet` shape — no `key`/`label` — wrapped into a
// pseudo-row here purely for rendering, not recomputed).
//
// Desktop (`sm:` and up): a real `<table>` inside an `overflow-x-auto`
// wrapper. Mobile (below `sm:`): stacked category cards, one per row,
// four labeled value pairs — no horizontal page scroll at any viewport.
// ============================================================

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Total Direct Costs / Gross Profit / Job Profit are the sums this table
 *  is building toward — visually distinct (font-medium, top border).
 *  Overhead Allocation and Processing Fees are single line items, not
 *  sums, so they stay in the regular row style even though the brief's
 *  own prose bolds them for readability. */
const SUBTOTAL_KEYS = new Set(["total_direct", "gross_profit", "job_profit"]);

interface FinancialComparisonTableProps {
  comparison: FinancialComparison;
}

interface RenderRow {
  key: string;
  label: string;
  original: string;
  current: string;
  actualPlusCommitted: string;
  forecast: string;
  emphasize: boolean;
}

function formatMoneyRow(row: ComparisonRow, emphasize: boolean): RenderRow {
  return {
    key: row.key,
    label: row.label,
    original: currency.format(row.original),
    current: currency.format(row.current),
    actualPlusCommitted: currency.format(row.actualPlusCommitted),
    forecast: currency.format(row.forecast),
    emphasize,
  };
}

function formatPercentRow(key: string, label: string, columns: ComparisonColumnSet): RenderRow {
  return {
    key,
    label,
    original: `${columns.original.toFixed(1)}%`,
    current: `${columns.current.toFixed(1)}%`,
    actualPlusCommitted: `${columns.actualPlusCommitted.toFixed(1)}%`,
    forecast: `${columns.forecast.toFixed(1)}%`,
    emphasize: true,
  };
}

function buildRows(comparison: FinancialComparison): RenderRow[] {
  const moneyRows: ComparisonRow[] = [
    comparison.totalRevenue,
    ...comparison.directRows,
    comparison.totalDirect,
    comparison.grossProfit,
    comparison.overheadAllocation,
    comparison.processingFees,
    comparison.jobProfit,
  ];

  return [
    ...moneyRows.map((row) => formatMoneyRow(row, SUBTOTAL_KEYS.has(row.key))),
    formatPercentRow("job_profit_margin_pct", "Job Profit Margin", comparison.jobProfitMarginPct),
  ];
}

const FOOTNOTE =
  "Processing fees are captured below Gross Profit and never counted in direct costs.";

export function FinancialComparisonTable({ comparison }: FinancialComparisonTableProps) {
  const rows = buildRows(comparison);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Financial comparison
      </h2>

      {/* Desktop / wide viewports: real table, scrolls internally only. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="caption-bottom pt-2 text-left text-xs italic text-zinc-500 dark:text-zinc-400">
            {FOOTNOTE}
          </caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Category
              </th>
              <th scope="col" className="py-1.5 px-3 text-right font-medium">
                Original
              </th>
              <th scope="col" className="py-1.5 px-3 text-right font-medium">
                Current
              </th>
              <th scope="col" className="py-1.5 px-3 text-right font-medium">
                Actual + Committed
              </th>
              <th scope="col" className="py-1.5 pl-3 text-right font-medium">
                Forecast
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={
                  row.emphasize
                    ? "border-t border-zinc-300 font-medium dark:border-zinc-700"
                    : "border-t border-zinc-100 dark:border-zinc-900"
                }
              >
                <td className="py-1.5 pr-3">{row.label}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{row.original}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{row.current}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{row.actualPlusCommitted}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums">{row.forecast}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile / narrow viewports: stacked category cards. */}
      <div className="flex flex-col gap-2 sm:hidden">
        {rows.map((row) => (
          <div
            key={row.key}
            className={
              row.emphasize
                ? "rounded-lg border border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900"
                : "rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
            }
          >
            <p className={row.emphasize ? "text-sm font-semibold" : "text-sm font-medium"}>
              {row.label}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <ValuePair label="Original" value={row.original} />
              <ValuePair label="Current" value={row.current} />
              <ValuePair label="Actual + Committed" value={row.actualPlusCommitted} />
              <ValuePair label="Forecast" value={row.forecast} />
            </dl>
          </div>
        ))}
        <p className="text-xs italic text-zinc-500 dark:text-zinc-400">{FOOTNOTE}</p>
      </div>
    </section>
  );
}

function ValuePair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
