import { redirect } from "next/navigation";
import { getWorkforceSession, isActiveOwner } from "@/lib/workforce/profile";
import { signOutAction } from "@/app/auth/actions";

/**
 * v2 Task 8a: the financial-route gate. Every route under /jobs — the
 * dashboard, job detail, costs, revenue, exceptions — renders through
 * this layout, so the active-owner check happens exactly once, server-
 * side, per navigation. The proxy already bounced session-less requests
 * to /auth/sign-in; this layout is the AUTHORIZATION check (pending or
 * foreman profiles are not owners) and the defense-in-depth re-check.
 *
 * The estimator picker surface (/estimates/*) is deliberately outside
 * this gate and unchanged — see CLAUDE.md "No-login estimate tool".
 */
export default async function JobsLayout({ children }: { children: React.ReactNode }) {
  const session = await getWorkforceSession();
  if (session.status === "unauthenticated") {
    redirect("/auth/sign-in?next=/jobs");
  }
  if (session.status !== "authenticated" || !isActiveOwner(session.profile)) {
    redirect("/estimates");
  }
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-end gap-2 border-b border-zinc-200 px-4 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span>Signed in as {session.profile.displayName}</span>
        <form action={signOutAction}>
          <button type="submit" className="underline">
            Sign out
          </button>
        </form>
      </div>
      {children}
    </div>
  );
}
