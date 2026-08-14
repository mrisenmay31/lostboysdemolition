import Link from "next/link";
import { listEstimates } from "@/lib/estimates/repo";
import { statusLabel } from "@/lib/estimates/lifecycle";

/**
 * Estimates list (Task 11b). Server-rendered, server-side search — the
 * `q` param round-trips through listEstimates' `ilike` query (repo.ts,
 * hardened against filter-injection by lib/estimates/search.ts's
 * sanitizeSearchTerm — see that module's doc comment). Superseded rows
 * are hidden by default (brief) — `all=1` shows them.
 *
 * `dynamic = "force-dynamic"`: same reasoning as every other data-reading
 * route under (app) — see new/page.tsx's doc comment. Without it, Next's
 * static optimizer could prerender this list once and freeze it.
 */
export const dynamic = "force-dynamic";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface EstimatesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EstimatesPage({ searchParams }: EstimatesPageProps) {
  const resolved = await searchParams;
  const q = firstParam(resolved.q);
  const includeSuperseded = firstParam(resolved.all) === "1";

  const estimates = await listEstimates({ q, includeSuperseded, limit: 100 });

  const toggleParams = new URLSearchParams();
  if (q) toggleParams.set("q", q);
  if (!includeSuperseded) toggleParams.set("all", "1");
  const toggleHref = `/estimates${toggleParams.toString() ? `?${toggleParams.toString()}` : ""}`;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 pb-12">
      <h1 className="text-xl font-semibold">Estimates</h1>

      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search job or client…"
          aria-label="Search estimates"
          className="h-11 flex-1 rounded-lg border border-zinc-300 px-3 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
        />
        {includeSuperseded ? <input type="hidden" name="all" value="1" /> : null}
        <button
          type="submit"
          className="h-11 rounded-lg border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
        >
          Search
        </button>
      </form>

      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          {estimates.length} estimate{estimates.length === 1 ? "" : "s"}
        </span>
        <Link href={toggleHref} className="font-medium underline underline-offset-2">
          {includeSuperseded ? "Hide superseded versions" : "Show superseded versions"}
        </Link>
      </div>

      {estimates.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No estimates found.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {estimates.map((e) => (
            <li key={e.id}>
              <Link
                href={`/estimates/${e.id}`}
                className="flex flex-col gap-1 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">
                    #{e.estimate_number} v{e.version} — {e.job_name ?? e.client_name ?? "Untitled"}
                  </span>
                  <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800">
                    {statusLabel(e.status)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
                  <span>{currency.format(e.quoted_price ?? e.total_bid)}</span>
                  {e.is_path_b ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                      Record-only
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
