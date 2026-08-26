import Link from "next/link";
import { notFound } from "next/navigation";
import { loadLedgerJobContext } from "@/lib/ledger/repo";
import { RevenueEntryForm } from "./RevenueEntryForm";

// ============================================================
// Lost Boys Demolition — web app — v2 Task 7 Lane D: manual revenue entry
//
// Server component. Mirrors costs/page.tsx's shape (force-dynamic,
// notFound on a missing job, one loadLedgerJobContext round trip) for
// the job's revenue ledger. No budget-vs-entered table here — revenue has
// a single authoritative figure (the current budget's approved_revenue,
// per the locked explainer block below), not a per-category comparison.
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

function formatStatusLabel(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Credits and refunds render as a reduction regardless of the sign the
 *  underlying row happens to carry — see RevenueEntryForm.tsx's module
 *  header and @/lib/ledger/types.ts's RevenueEntryInput doc comment
 *  ("sign for credit/refund is applied by the repo layer, not by the
 *  form"). `Math.abs` first makes this idempotent either way. */
function signedAmount(entryType: string, amount: number): number {
  return entryType === "credit" || entryType === "refund" ? -Math.abs(amount) : amount;
}

interface RevenuePageProps {
  params: Promise<{ jobNumber: string }>;
}

export default async function RevenuePage({ params }: RevenuePageProps) {
  const { jobNumber } = await params;

  const context = await loadLedgerJobContext(jobNumber);
  if (!context) {
    notFound();
  }

  const { job, revenueEntries } = context;

  const sortedEntries = [...revenueEntries].sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  );

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 p-4 pb-12">
      <header className="flex flex-col gap-1">
        <Link href={`/jobs/${jobNumber}`} className="w-fit text-xs font-medium underline">
          ← {jobNumber}
        </Link>
        <h1 className="text-xl font-semibold">Revenue — {jobNumber}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{job.client_name ?? "—"}</p>
      </header>

      <p className="rounded-lg border border-zinc-300 p-3 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        Economic revenue = invoices − credits − refunds. <strong>Payments affect collection
        status, not job profit</strong> — they are recorded here but excluded from the
        profitability revenue. Approved-contract entries are informational; the budget&apos;s
        approved revenue is authoritative. There is no edit for revenue entries — correct a
        mistake with an offsetting credit or refund.
      </p>

      <RevenueEntryForm jobNumber={jobNumber} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Entries ({sortedEntries.length})
        </h2>
        {sortedEntries.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No revenue entries yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sortedEntries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-800"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{formatStatusLabel(entry.entry_type)}</span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {formatDenver(entry.occurred_at)} · {entry.source_system}
                  </span>
                </div>
                <span className="tabular-nums font-medium">
                  {currency.format(signedAmount(entry.entry_type, entry.amount))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
