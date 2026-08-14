"use client";

import type { EstimateOutputs } from "@/lib/pricing";

interface StickyTotalBarProps {
  outputs: EstimateOutputs;
  markupPct: number;
  markupFloorPct: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onSave: () => void;
  saving: boolean;
  saveDisabled?: boolean;
  saveError?: string | null;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * Sticky bottom bar: live Total Bid + true margin, recomputed on every
 * keystroke by the caller's client-side `computeEstimate()` preview.
 * Tapping the total/margin area expands an 8-output breakdown panel
 * (everything computeEstimate() returns except totalBid itself, which is
 * already shown in the collapsed bar). The amber markup-floor advisory is
 * non-blocking — Save stays enabled below the floor, per the plan's
 * "15% floor is an advisory warning, never blocking."
 */
export function StickyTotalBar({
  outputs,
  markupPct,
  markupFloorPct,
  expanded,
  onToggleExpand,
  onSave,
  saving,
  saveDisabled,
  saveError,
}: StickyTotalBarProps) {
  const belowFloor = markupPct < markupFloorPct;

  return (
    <div className="sticky bottom-0 left-0 right-0 border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
      {expanded ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <OutputRow label="Effective hours" value={outputs.effectiveHours.toFixed(2)} />
          <OutputRow label="Labor cost" value={currency.format(outputs.laborCost)} />
          <OutputRow label="Dump fees" value={currency.format(outputs.dumpFees)} />
          <OutputRow label="Total direct" value={currency.format(outputs.totalDirect)} />
          <OutputRow label="Overhead" value={currency.format(outputs.overhead)} />
          <OutputRow label="Profit (markup)" value={currency.format(outputs.profit)} />
          <OutputRow label="CC fee" value={currency.format(outputs.ccFee)} />
          <OutputRow label="True margin" value={`${outputs.trueMarginPct.toFixed(1)}%`} />
        </dl>
      ) : null}

      {belowFloor ? (
        <p className="bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          Markup {markupPct}% is below the {markupFloorPct}% floor — confirm with Dane.
        </p>
      ) : null}

      {saveError ? (
        <p role="alert" className="px-4 py-1.5 text-xs font-medium text-red-600 dark:text-red-400">
          {saveError}
        </p>
      ) : null}

      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className="flex flex-1 flex-col items-start"
        >
          <span className="text-lg font-semibold">{currency.format(outputs.totalBid)}</span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {outputs.trueMarginPct.toFixed(1)}% true margin · {expanded ? "hide" : "show"} details
          </span>
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || saveDisabled}
          className="h-12 rounded-lg bg-zinc-900 px-6 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
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
