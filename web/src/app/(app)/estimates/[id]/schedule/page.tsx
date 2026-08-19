import Link from "next/link";
import { notFound } from "next/navigation";
import { getEstimate } from "@/lib/estimates/repo";
import { resolveAcceptancePresentation } from "@/lib/estimates/acceptancePresentation";
import { ScheduleEstimateForm } from "./ScheduleEstimateForm";

/**
 * Schedule route (Phase 1, v2 Task 4 / profitability v2 Phase 1 Session 3,
 * lane 4b). Loads the estimate + acceptance state server-side and renders
 * the form ONLY when this version is the family's currently accepted one
 * — the same visibility condition `schedule_estimate` itself enforces
 * (v2 doc Step 2: "It is exactly the presented estimate referenced by the
 * current accepted projection ... `job_number` is null"). This page
 * mirrors that condition for a good UX; the RPC (lane 4a) is what
 * actually enforces it — see [id]/page.tsx's matching "Schedule job"
 * link, which uses the identical condition.
 *
 * Reuses the same acceptance-state read path CommercialLifecyclePanel
 * uses (`resolveAcceptancePresentation`, pure, from
 * acceptancePresentation.ts — NOT reimplemented here) rather than
 * inventing a second eligibility check.
 *
 * `dynamic = "force-dynamic"`: same reasoning as every other data-reading
 * route under (app) — see [id]/page.tsx's matching comment.
 */
export const dynamic = "force-dynamic";

export default async function ScheduleEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail;
  try {
    detail = await getEstimate(id);
  } catch {
    // getEstimate throws on any lookup failure — same "treat as not
    // found" contract as [id]/page.tsx and [id]/revise/page.tsx.
    notFound();
  }

  const { estimate, acceptanceState, versionChain } = detail;

  // Already scheduled — this estimate already carries a job_number
  // (schedule_estimate calls update_estimate_job_number on success, per
  // v2 doc Step 2 point 5). No RPC call needed to know this; the form
  // never renders for an already-scheduled estimate.
  if (estimate.job_number) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 pb-12">
        <h1 className="text-xl font-semibold">Already scheduled</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This estimate is already linked to job{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{estimate.job_number}</span>.
        </p>
        {/* v2 Task 6 ships /jobs/[jobNumber] — this link 404s until then,
            by design (see the Phase 1 plan's Session 3 lane 4b brief). */}
        <Link
          href={`/jobs/${estimate.job_number}`}
          className="flex h-11 items-center justify-center rounded-lg bg-zinc-900 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          View job {estimate.job_number}
        </Link>
        <Link href={`/estimates/${estimate.id}`} className="text-center text-sm font-medium underline">
          Back to estimate
        </Link>
      </div>
    );
  }

  const presentation = resolveAcceptancePresentation(acceptanceState, estimate.id);

  if (!presentation.acceptedThisVersion) {
    const acceptedElsewhere = presentation.acceptedOtherVersion
      ? versionChain.find((v) => v.id === acceptanceState?.current_estimate_id) ?? null
      : null;

    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 pb-12">
        <h1 className="text-xl font-semibold">Can&apos;t schedule yet</h1>
        {acceptedElsewhere ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This estimate family&apos;s active acceptance belongs to{" "}
            <Link
              href={`/estimates/${presentation.reverseTargetEstimateId}/schedule`}
              className="font-medium underline"
            >
              v{acceptedElsewhere.version}
            </Link>
            , not this version — schedule from there instead.
          </p>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This estimate must be accepted before it can be scheduled.
          </p>
        )}
        <Link
          href={`/estimates/${estimate.id}`}
          className="flex h-11 items-center justify-center rounded-lg border border-zinc-300 text-sm font-medium dark:border-zinc-700"
        >
          Back to estimate
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 p-4 pb-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Schedule job</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          #{estimate.estimate_number} v{estimate.version} — {estimate.job_name ?? "Untitled job"} —{" "}
          {estimate.client_name ?? "—"}
        </p>
      </header>
      <ScheduleEstimateForm estimateId={estimate.id} />
      <Link href={`/estimates/${estimate.id}`} className="text-center text-sm font-medium underline">
        Back to estimate
      </Link>
    </div>
  );
}
