"use client";

import { fieldInputClass } from "./Field";
import type { LineItemDraft } from "@/lib/estimates/types";

interface LineItemCardProps {
  item: LineItemDraft;
  onChange: (patch: Partial<LineItemDraft>) => void;
  onRemove: () => void;
}

/** HARD REQUIREMENT (Task 10 review carry): line item numeric fields must
 *  never go negative client-side (the engine/DB reject negatives too, but
 *  a negative labor/dump/materials value would produce a negative GHL
 *  line amount downstream — clamp at the source). */
function clampNonNegative(raw: string): number {
  if (raw === "") return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

/** Editable card for one scope line item, prefilled from a scope_library
 *  default when added via the "Add scope" bottom sheet. Name is the
 *  controlled-vocabulary scope_library name (display only); hours, dump
 *  count, and materials cost are editable per-job. */
export function LineItemCard({ item, onChange, onRemove }: LineItemCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">{item.name}</p>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400"
        >
          Remove
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          Hours
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.25"
            value={item.laborHours}
            onChange={(e) => onChange({ laborHours: clampNonNegative(e.target.value) })}
            className={fieldInputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          Dumps
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.05"
            value={item.dumpCount}
            onChange={(e) => onChange({ dumpCount: clampNonNegative(e.target.value) })}
            className={fieldInputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          Materials $
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="1"
            value={item.materialsCost}
            onChange={(e) => onChange({ materialsCost: clampNonNegative(e.target.value) })}
            className={fieldInputClass}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        Notes (optional)
        <input
          type="text"
          value={item.description ?? ""}
          onChange={(e) => onChange({ description: e.target.value })}
          className={fieldInputClass}
        />
      </label>
    </div>
  );
}
