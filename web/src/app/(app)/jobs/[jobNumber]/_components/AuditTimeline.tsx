import { CATEGORY_LABELS } from "@/lib/jobs/map";
import type { CostAuditRow } from "@/lib/jobs/healthRepo";

// ============================================================
// Lost Boys Demolition — web app — v2 Task 6 Lane C: job detail
//
// Pure server component (props → markup). Merges two independently-sorted
// row kinds — `job_events` (newest first via `created_at`) and, as of the
// gate-audit task, `job_cost_entry_audit` correction/void history (newest
// first via `changed_at`) — into ONE newest-first timeline via
// `mergeAuditRows` below. Neither input array needs re-sorting on its own
// (the caller — @/lib/jobs/healthRepo.ts's getJobHealthDetail — already
// queries both `order(..., { ascending: false })`), but the two kinds DO
// need interleaving against each other, which is what changed from the
// job_events-only version of this component. Timestamp formatting mirrors
// the house pattern (jobs/exceptions/page.tsx:74-79): `America/Denver`,
// `dateStyle: "medium"`, `timeStyle: "short"`.
// ============================================================

interface JobEvent {
  id: number;
  stage_from: number | null;
  stage_to: number | null;
  function_name: string | null;
  action_summary: string | null;
  status: string | null;
  created_at: string;
}

interface AuditTimelineProps {
  jobEvents: JobEvent[];
  costAudit: CostAuditRow[];
}

const STATUS_DOT: Record<string, string> = {
  success: "bg-emerald-500",
  error: "bg-red-500",
  skipped: "bg-zinc-400",
};

// Cost-audit rows get their own neutral dot — they're corrections/voids,
// not job_events' success/error/skipped statuses, so they don't belong in
// STATUS_DOT's lookup.
const COST_AUDIT_DOT = "bg-amber-500";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatDenver(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Denver",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type MergedAuditRow =
  | { kind: "event"; timestamp: string; event: JobEvent }
  | { kind: "cost_audit"; timestamp: string; audit: CostAuditRow };

/**
 * Interleaves `jobEvents` (sorted by `created_at`) and `costAudit` (sorted
 * by `changed_at`) into one newest-first list. Both inputs are assumed
 * already sorted descending by their own timestamp (the caller's query
 * order, see the module header) — this is a merge, not a full re-sort, but
 * implemented as a straightforward sort-by-timestamp over the tagged union
 * for simplicity, since both source arrays are small display-capped
 * windows (50 rows each) rather than anything worth an O(n) merge over.
 * Exported for direct unit testing.
 */
export function mergeAuditRows(jobEvents: JobEvent[], costAudit: CostAuditRow[]): MergedAuditRow[] {
  const tagged: MergedAuditRow[] = [
    ...jobEvents.map((event) => ({ kind: "event" as const, timestamp: event.created_at, event })),
    ...costAudit.map((audit) => ({ kind: "cost_audit" as const, timestamp: audit.changed_at, audit })),
  ];
  return tagged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/** `CATEGORY_LABELS` lookup with a raw-string fallback for a category the
 *  map doesn't know (unknown `job_cost_entries.category` value, or a row
 *  whose embed never resolved — see `normalizeCostAuditRow`'s "" default). */
function categoryLabel(category: CostAuditRow["category"]): string {
  return category in CATEGORY_LABELS ? CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] : category || "Cost entry";
}

/**
 * Derives a `CostAuditRow`'s headline title. Priority order (locked by the
 * gate-audit brief, checked in this exact sequence):
 *   1. Amount changed (`old_amount`/`new_amount` both known and differ) ->
 *      "<label> correction: $X → $Y", regardless of any state change.
 *   2. State changed TO `void` -> "<label> voided" with the amount shown
 *      (parenthesized) when either amount is known.
 *   3. State changed to anything else -> "<label>: <old_state> → <new_state>".
 *   4. Neither derivable (e.g. a note-only correction) -> "<label> correction".
 * Exported for direct unit testing.
 */
export function deriveCostAuditTitle(row: CostAuditRow): string {
  const label = categoryLabel(row.category);

  const amountChanged =
    row.old_amount !== null && row.new_amount !== null && row.old_amount !== row.new_amount;
  if (amountChanged) {
    return `${label} correction: ${currency.format(row.old_amount as number)} → ${currency.format(row.new_amount as number)}`;
  }

  const stateChanged = row.old_state !== null && row.new_state !== null && row.old_state !== row.new_state;
  if (stateChanged && row.new_state === "void") {
    const shownAmount = row.new_amount ?? row.old_amount;
    return shownAmount !== null ? `${label} voided (${currency.format(shownAmount)})` : `${label} voided`;
  }
  if (stateChanged) {
    return `${label}: ${row.old_state} → ${row.new_state}`;
  }

  return `${label} correction`;
}

function JobEventItem({ event }: { event: JobEvent }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-zinc-300 p-2 dark:border-zinc-700">
      <span
        aria-hidden
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          event.status ? (STATUS_DOT[event.status] ?? "bg-zinc-300") : "bg-zinc-300"
        }`}
      />
      <div className="flex flex-col">
        <p className="font-medium">
          {event.action_summary ?? `${event.stage_from ?? "—"} → ${event.stage_to ?? "—"}`}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {event.function_name ?? "—"} · {formatDenver(event.created_at)}
        </p>
      </div>
    </li>
  );
}

function CostAuditItem({ audit }: { audit: CostAuditRow }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-zinc-300 p-2 dark:border-zinc-700">
      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${COST_AUDIT_DOT}`} />
      <div className="flex flex-col">
        <p className="font-medium">{deriveCostAuditTitle(audit)}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {audit.reason} · {audit.actor_name ?? "—"} · {formatDenver(audit.changed_at)}
        </p>
      </div>
    </li>
  );
}

export function AuditTimeline({ jobEvents, costAudit }: AuditTimelineProps) {
  if (jobEvents.length === 0 && costAudit.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No events recorded yet.</p>;
  }

  const merged = mergeAuditRows(jobEvents, costAudit);

  return (
    <ul className="flex flex-col gap-2 text-sm">
      {merged.map((row) =>
        row.kind === "event" ? (
          <JobEventItem key={`event-${row.event.id}`} event={row.event} />
        ) : (
          <CostAuditItem key={`cost-audit-${row.audit.id}`} audit={row.audit} />
        ),
      )}
    </ul>
  );
}
