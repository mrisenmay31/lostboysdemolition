import Link from "next/link";
import { notFound } from "next/navigation";
import { loadLedgerJobContext } from "@/lib/ledger/repo";
import { budgetToCategoryAmounts, rollupLedger, CATEGORY_LABELS } from "@/lib/jobs/map";
import { COST_CATEGORIES } from "@/lib/profitability/types";
import { roundToCent } from "@/lib/pricing";
import { CostEntryForm, CostCorrectionForm } from "./CostEntryForm";

// ============================================================
// Lost Boys Demolition — web app — v2 Task 7 Lane D: manual cost entry
//
// Server component, `dynamic = "force-dynamic"` — same reasoning as every
// other data-reading route under (app) (see [jobNumber]/page.tsx's
// matching comment): manual ledger entries are written by this very
// route's own forms, so the page must never serve a cached/stale list.
//
// One round trip — @/lib/ledger/repo.ts's loadLedgerJobContext(jobNumber)
// (Task 3) — mirroring [jobNumber]/page.tsx's single-round-trip idiom.
// Money math (the budget-vs-entered table) is built from the same pure
// @/lib/jobs/map.ts helpers the job detail page already uses
// (rollupLedger, budgetToCategoryAmounts, CATEGORY_LABELS) — this page
// never recomputes ledger arithmetic itself.
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

/** `YYYY-MM-DD` in America/Denver, for seeding a correction form's
 *  `<input type="date">` from an `incurred_at` timestamptz. */
function denverDateInput(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(new Date(iso));
}

function formatStatusLabel(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface CostsPageProps {
  params: Promise<{ jobNumber: string }>;
}

export default async function CostsPage({ params }: CostsPageProps) {
  const { jobNumber } = await params;

  const context = await loadLedgerJobContext(jobNumber);
  if (!context) {
    notFound();
  }

  const { job, currentBudget, costEntries } = context;

  const rollup = rollupLedger(costEntries);
  const budgetAmounts = currentBudget ? budgetToCategoryAmounts(currentBudget) : null;

  const sortedEntries = [...costEntries].sort(
    (a, b) => new Date(b.incurred_at).getTime() - new Date(a.incurred_at).getTime(),
  );

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 p-4 pb-12">
      <header className="flex flex-col gap-1">
        <Link href={`/jobs/${jobNumber}`} className="w-fit text-xs font-medium underline">
          ← {jobNumber}
        </Link>
        <h1 className="text-xl font-semibold">Costs — {jobNumber}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{job.client_name ?? "—"}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Budget vs. entered
        </h2>
        {budgetAmounts ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[24rem] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  <th className="py-1 pr-2 font-medium">Category</th>
                  <th className="py-1 px-2 text-right font-medium">Budget</th>
                  <th className="py-1 pl-2 text-right font-medium">Entered</th>
                </tr>
              </thead>
              <tbody>
                {COST_CATEGORIES.map((category) => {
                  const budget = budgetAmounts[category];
                  const entered = roundToCent(
                    rollup.approved[category] + rollup.provisional[category] + rollup.committed[category],
                  );
                  const overBudget = entered > budget;
                  return (
                    <tr key={category} className="border-t border-zinc-100 dark:border-zinc-900">
                      <td className="py-1 pr-2 align-top">
                        {CATEGORY_LABELS[category]}
                        {category === "payment_processing" ? (
                          <p className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                            Captured below Gross Profit — never counted in direct costs.
                          </p>
                        ) : null}
                      </td>
                      <td className="py-1 px-2 text-right align-top tabular-nums">
                        {currency.format(budget)}
                      </td>
                      <td
                        className={
                          overBudget
                            ? "py-1 pl-2 text-right align-top tabular-nums text-red-600 dark:text-red-400"
                            : "py-1 pl-2 text-right align-top tabular-nums"
                        }
                      >
                        {currency.format(entered)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No current budget version — entries still record.
          </p>
        )}
      </section>

      <CostEntryForm jobNumber={jobNumber} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Entries ({sortedEntries.length})
        </h2>
        {sortedEntries.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No cost entries yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {sortedEntries.map((entry) => {
              const isVoid = entry.state === "void";
              const correctable = entry.source_system === "manual" && !isVoid;
              return (
                <li
                  key={entry.id}
                  className="rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-0.5">
                      <span
                        className={
                          isVoid
                            ? "font-medium text-zinc-400 line-through dark:text-zinc-600"
                            : "font-medium"
                        }
                      >
                        {CATEGORY_LABELS[entry.category]}
                      </span>
                      <span
                        className={
                          isVoid
                            ? "text-xs text-zinc-400 line-through dark:text-zinc-600"
                            : "text-xs text-zinc-500 dark:text-zinc-400"
                        }
                      >
                        {formatStatusLabel(entry.state)}
                      </span>
                    </div>
                    <span
                      className={
                        isVoid
                          ? "tabular-nums font-medium text-zinc-400 line-through dark:text-zinc-600"
                          : "tabular-nums font-medium"
                      }
                    >
                      {currency.format(entry.amount)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {entry.quantity !== null ? <span>Qty: {entry.quantity}</span> : null}
                    <span>{entry.employee_name ?? entry.vendor_name ?? "—"}</span>
                    <span>{formatDenver(entry.incurred_at)}</span>
                    <span>{entry.source_system}</span>
                  </div>
                  {correctable ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium underline">
                        Correct / void
                      </summary>
                      <div className="mt-2">
                        <CostCorrectionForm
                          entryId={entry.id}
                          initialAmount={entry.amount}
                          initialState={entry.state}
                          initialQuantity={entry.quantity}
                          initialIncurredOn={denverDateInput(entry.incurred_at)}
                        />
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
