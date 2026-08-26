import type { ForecastConfidence, HealthStatus } from "@/lib/profitability/types";

// ============================================================
// Lost Boys Demolition — web app — v2 Task 6 Lane C: job detail
//
// Pure server component (props → markup, no I/O). Full-width tinted
// banner reading the job's current health at a glance. `health === null`
// covers two real cases in this data model: the job is cancelled
// (isEngineScorable excludes "cancelled" — @/lib/jobs/map.ts), OR — less
// common but still real for a scheduled/in_progress job — the engine
// simply hasn't scored it yet (e.g. no current budget version). The brief
// pairs "health null" with "cancelled" as the primary reading; this
// component still renders an honest neutral fallback for the second case
// rather than fabricating a cancellation that didn't happen.
// ============================================================

interface HealthBannerProps {
  health: HealthStatus | null;
  confidence: ForecastConfidence | null;
  leadingReason: string | null;
  cancelled: boolean;
  cancellationReason: string | null;
}

const CONFIDENCE_LABEL: Record<ForecastConfidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const HEALTH_STYLE: Record<HealthStatus, string> = {
  at_risk:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200",
  watch:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  on_track:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
};

const NEUTRAL_STYLE =
  "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";

export function HealthBanner({
  health,
  confidence,
  leadingReason,
  cancelled,
  cancellationReason,
}: HealthBannerProps) {
  if (health === null) {
    return (
      <div className={`w-full rounded-lg border p-3 text-sm ${NEUTRAL_STYLE}`}>
        {cancelled
          ? `Cancelled — ${cancellationReason ?? "—"}`
          : "No health forecast available for this job yet."}
      </div>
    );
  }

  return (
    <div className={`w-full rounded-lg border p-3 text-sm ${HEALTH_STYLE[health]}`}>
      <p className="font-medium">{leadingReason ?? "No leading reason recorded."}</p>
      <p className="mt-1 text-xs opacity-80">
        Confidence: {confidence ? CONFIDENCE_LABEL[confidence] : "—"}
      </p>
    </div>
  );
}
