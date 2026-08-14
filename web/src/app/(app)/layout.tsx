import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

/**
 * Auth-gated shell for every authenticated route. `requireUser()` is a
 * second, defense-in-depth check on top of middleware's session-refresh
 * gate — it also gives the layout the signed-in user's display name for
 * the header.
 *
 * Bottom nav is intentionally minimal: just the two destinations this
 * slice cares about (Estimates, New). Later tasks build what those routes
 * render; this task only builds the shell and the redirect.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {user.name}
        </span>
        <form action={signOut}>
          <button
            type="submit"
            className="text-sm font-medium text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            Sign out
          </button>
        </form>
      </header>

      <main className="flex-1">{children}</main>

      <nav className="grid grid-cols-2 border-t border-zinc-200 dark:border-zinc-800">
        <Link
          href="/estimates"
          className="flex h-16 items-center justify-center text-base font-medium"
        >
          Estimates
        </Link>
        <Link
          href="/new"
          className="flex h-16 items-center justify-center text-base font-medium"
        >
          New
        </Link>
      </nav>
    </div>
  );
}
