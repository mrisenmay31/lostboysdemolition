import { revalidatePath } from "next/cache";
import { isEstimatorName } from "@/lib/estimator";
import {
  listOpenScheduleExceptions,
  resolveDeletedCalendarEvent,
  ResolveExceptionError,
} from "@/lib/jobs/exceptionActions";
import {
  ResolveExceptionForm,
  type ResolveExceptionActionInput,
  type ResolveExceptionActionResult,
} from "./ResolveExceptionForm";

/**
 * Schedule-exceptions queue page (Phase 1, v2 Task 5B Step 2, Lane W).
 * The plan's own words for why this page exists at all: "Without it,
 * resolveDeletedCalendarEvent is unreachable except via console and the
 * Phase 1 gate's 'simulate deletion and resolve it' has no app path."
 * Full dashboard integration (linking from a job's own page, etc.)
 * remains v2 Task 6 — this is deliberately minimal: a flat list of every
 * open exception, newest first, each with an inline resolve form.
 *
 * `dynamic = "force-dynamic"`: same reasoning as every other data-reading
 * route under (app) — see estimates/[id]/schedule/page.tsx's matching
 * comment. Exceptions are opened by the inbound Google Calendar webhook,
 * not by this app, so this route must never serve a cached/stale list.
 *
 * No pricing anywhere on this page or in ResolveExceptionForm — only
 * job number, previous schedule (crew + dates), and opened-at. Matches
 * `previous_schedule`'s own construction (Task 1: crew + both dates +
 * both gcal ids, never a dollar figure) and the wider
 * no-pricing-to-crew-surfaces rule this repo enforces elsewhere
 * (`_shared/slack.ts`, BL-5's crew calendar bodies).
 *
 * The resolve server action is defined INLINE below ("use server" at the
 * top of the function body) rather than in a dedicated actions.ts file —
 * this task's file ownership is scoped to exactly four files (this page,
 * ResolveExceptionForm.tsx, and the lib module + its test), so a fifth
 * actions.ts file is off-limits. Next.js supports a Server Action defined
 * inline inside a Server Component and passed down as a prop to a Client
 * Component; the pattern here mirrors jobs/actions.ts's
 * scheduleEstimateAction (re-validate the picker name against the fixed
 * allowlist, call the lib action, classify a thrown typed error, never
 * let a bare Error string reach the client uncategorized).
 */
export const dynamic = "force-dynamic";

export default async function JobExceptionsPage() {
  const exceptions = await listOpenScheduleExceptions();

  async function resolveExceptionAction(
    input: ResolveExceptionActionInput,
    estimatorName: string,
  ): Promise<ResolveExceptionActionResult> {
    "use server";

    if (!isEstimatorName(estimatorName)) {
      return { ok: false, error: "Pick who's estimating first." };
    }

    try {
      const result = await resolveDeletedCalendarEvent({
        ...input,
        actorName: estimatorName,
      });
      revalidatePath("/jobs/exceptions");
      return { ok: true, result };
    } catch (err) {
      if (err instanceof ResolveExceptionError) {
        return { ok: false, error: err.message, code: err.code };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 p-4 pb-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Schedule exceptions</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          A calendar event tied to a scheduled job was deleted outside the app. Resolve each
          one below.
        </p>
      </header>

      {exceptions.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No open schedule exceptions.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {exceptions.map((exception) => (
            <li
              key={exception.id}
              className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700"
            >
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {exception.job_number}
                </p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Was scheduled {exception.previous_schedule.start_date ?? "—"} to{" "}
                  {exception.previous_schedule.end_date ?? "—"}
                  {exception.previous_schedule.crew
                    ? ` — ${exception.previous_schedule.crew}`
                    : ""}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Opened {new Date(exception.opened_at).toLocaleString()}
                </p>
              </div>
              <ResolveExceptionForm
                exception={exception}
                resolveExceptionAction={resolveExceptionAction}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
