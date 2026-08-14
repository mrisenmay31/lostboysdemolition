import Link from "next/link";
import { notFound } from "next/navigation";
import { getEstimate } from "@/lib/estimates/repo";
import { statusLabel } from "@/lib/estimates/lifecycle";
import { StatusActions } from "./_components/StatusActions";
import { QuoteOverridePanel } from "./_components/QuoteOverridePanel";
import { PushPanel } from "./_components/PushPanel";

/**
 * Estimate detail page (Task 11b). Server-rendered from `getEstimate()`'s
 * single round trip (header + line items + version chain + audit trail +
 * push state — repo.ts). Interactive pieces (status buttons, the quoted-
 * price editor, the GHL push button) are small client components that
 * each call their own server action directly.
 *
 * `dynamic = "force-dynamic"`: same reasoning as every other data-reading
 * route under (app) — this page must never be prerendered/frozen, since
 * status/quote/push state change from other tabs and devices.
 */
export const dynamic = "force-dynamic";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail;
  try {
    detail = await getEstimate(id);
  } catch {
    // getEstimate throws on any lookup failure (no row, malformed id,
    // query error) — this route treats all of them as "not found" rather
    // than trying to distinguish a bad link from a transient DB error,
    // matching the equivalent guard in [id]/revise/page.tsx.
    notFound();
  }

  const { estimate, lineItems, versionChain, auditTrail, pushState } = detail;

  // Every row in a chain becomes 'superseded' the instant its successor
  // is created (the writer contract flips exactly the immediate parent,
  // never anything else) — so 'superseded' is equivalent to "not the
  // latest version" for every estimate in this schema. See
  // [id]/revise/page.tsx's matching comment.
  const canRevise = estimate.status !== "superseded";
  const latestInChain = versionChain.reduce(
    (latest, v) => (v.version > latest.version ? v : latest),
    estimate,
  );

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 p-4 pb-12">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">
            #{estimate.estimate_number} v{estimate.version}
          </h1>
          <span className="shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium dark:bg-zinc-800">
            {statusLabel(estimate.status)}
          </span>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {estimate.job_name ?? "Untitled job"} — {estimate.client_name ?? "—"}
        </p>
        {estimate.is_path_b ? (
          <span className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            Record-only (Path B)
          </span>
        ) : null}
      </header>

      {canRevise ? (
        <Link
          href={`/estimates/${estimate.id}/revise`}
          className="flex h-11 items-center justify-center rounded-lg bg-zinc-900 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Revise this estimate
        </Link>
      ) : (
        <p className="rounded-lg border border-zinc-300 p-3 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          This version has been superseded.{" "}
          <Link href={`/estimates/${latestInChain.id}`} className="font-medium underline">
            View v{latestInChain.version} instead.
          </Link>
        </p>
      )}

      {/* Outputs panel */}
      <section className="rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Estimate breakdown
        </h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <OutputRow label="Labor cost" value={currency.format(estimate.labor_cost)} />
          <OutputRow label="Dump fees" value={currency.format(estimate.dump_fees)} />
          <OutputRow label="Total direct" value={currency.format(estimate.total_direct)} />
          <OutputRow label="Overhead" value={currency.format(estimate.overhead)} />
          <OutputRow label="Profit (markup)" value={currency.format(estimate.profit)} />
          <OutputRow label="CC fee" value={currency.format(estimate.cc_fee)} />
          <OutputRow label="Total bid" value={currency.format(estimate.total_bid)} />
          <OutputRow label="True margin" value={`${estimate.true_margin_pct.toFixed(1)}%`} />
        </dl>
      </section>

      <QuoteOverridePanel
        estimateId={estimate.id}
        totalBid={estimate.total_bid}
        quotedPrice={estimate.quoted_price}
        quoteOverrideReason={estimate.quote_override_reason}
      />

      <StatusActions estimateId={estimate.id} currentStatus={estimate.status} />

      {/* Line items */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Scope
        </h2>
        {lineItems.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No scope line items — quick-mode estimate.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lineItems.map((li) => (
              <li
                key={li.id}
                className="flex flex-col gap-1 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700"
              >
                <p className="font-medium">{li.name}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {li.labor_hours} hrs · {li.dump_count} dump{li.dump_count === 1 ? "" : "s"} ·{" "}
                  {currency.format(li.materials_cost)} materials
                </p>
                {li.description ? (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">{li.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Version chain */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Version history
        </h2>
        <ul className="flex flex-col gap-1">
          {versionChain.map((v) => (
            <li key={v.id}>
              <Link
                href={`/estimates/${v.id}`}
                className={`flex items-center justify-between rounded-lg border p-2 text-sm ${
                  v.id === estimate.id
                    ? "border-zinc-900 dark:border-zinc-100"
                    : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                <span>
                  v{v.version} {v.id === estimate.id ? "(viewing)" : ""}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {statusLabel(v.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Audit history */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Audit history
        </h2>
        {auditTrail.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No changes recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {auditTrail.map((row) => (
              <li key={row.id} className="rounded-lg border border-zinc-300 p-2 dark:border-zinc-700">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {new Date(row.changed_at).toLocaleString()} — {row.actor_name ?? "system"}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                  {row.old_status !== row.new_status ? (
                    <li>
                      Status: {row.old_status ?? "—"} → {row.new_status ?? "—"}
                    </li>
                  ) : null}
                  {row.old_quoted_price !== row.new_quoted_price ? (
                    <li>
                      Quoted price:{" "}
                      {row.old_quoted_price !== null ? currency.format(row.old_quoted_price) : "—"}{" "}
                      →{" "}
                      {row.new_quoted_price !== null ? currency.format(row.new_quoted_price) : "—"}
                    </li>
                  ) : null}
                  {row.old_job_number !== row.new_job_number ? (
                    <li>
                      Job number: {row.old_job_number ?? "—"} → {row.new_job_number ?? "—"}
                    </li>
                  ) : null}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PushPanel
        estimateId={estimate.id}
        isPathB={estimate.is_path_b}
        hasClientEmail={!!estimate.client_email}
        hasClientPhone={!!estimate.client_phone}
        pushState={pushState}
      />
    </div>
  );
}

function OutputRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
