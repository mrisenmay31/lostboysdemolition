import Link from "next/link";
import EstimatorChip from "./EstimatorChip";

/**
 * Shell for every route in this tool. There is no login — this is an open
 * internal tool (Matt's decision): anyone with the link can use it. The
 * header's `EstimatorChip` lets whoever is at the keyboard declare which
 * of the three allowed estimators they are; that pick is a self-declared
 * convenience, not an auth boundary, and every write is re-validated
 * server-side against the fixed estimator allowlist.
 *
 * Bottom nav reflects the 2026-08-25 home-surface decision's Task 6 slice:
 * the Job Dashboard is now reachable at `/jobs` alongside Estimates and
 * New. `/` still redirects to `/estimates` until v2 Task 8 flips the home
 * route — this nav does not change that, it only adds a destination.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <EstimatorChip />
      </header>

      <main className="flex-1">{children}</main>

      <nav className="grid grid-cols-3 border-t border-zinc-200 dark:border-zinc-800">
        <Link
          href="/jobs"
          className="flex h-16 items-center justify-center text-base font-medium"
        >
          Jobs
        </Link>
        <Link
          href="/estimates"
          className="flex h-16 items-center justify-center text-base font-medium"
        >
          Estimates
        </Link>
        <Link
          href="/estimates/new"
          className="flex h-16 items-center justify-center text-base font-medium"
        >
          New
        </Link>
      </nav>
    </div>
  );
}
