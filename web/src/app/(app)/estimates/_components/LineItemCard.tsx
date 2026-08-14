"use client";

import { useState } from "react";
import { fieldInputClass } from "./Field";
import { parseNonNegativeDecimal } from "@/lib/estimates/builderLogic";
import type { LineItemDraft } from "@/lib/estimates/types";

interface LineItemCardProps {
  item: LineItemDraft;
  onChange: (patch: Partial<LineItemDraft>) => void;
  onRemove: () => void;
}

/** Editable card for one scope line item, prefilled from a scope_library
 *  default when added via the "Add scope" bottom sheet. Name is the
 *  controlled-vocabulary scope_library name (display only); hours, dump
 *  count, and materials cost are editable per-job.
 *
 * Hours/dumps/materials are `type="text" inputMode="decimal"` fields, each
 * holding its own raw text locally (initialized once from the item's
 * starting value — nothing outside this component overwrites it after
 * creation). This is the Task 11 review Finding 1 fix: `type="number"`
 * blanks `.value` for legal-but-incomplete states like ".25", which
 * fights every keystroke of a fractional entry. See
 * parseNonNegativeDecimal's doc comment for the full explanation. The
 * derived NUMBER (always clamped >= 0) is what gets bubbled up via
 * onChange — the parent's line-item state, the live sum/preview, and the
 * eventual submission all use that number, never the raw text directly.
 */
export function LineItemCard({ item, onChange, onRemove }: LineItemCardProps) {
  const [laborHoursRaw, setLaborHoursRaw] = useState(() => String(item.laborHours));
  const [dumpCountRaw, setDumpCountRaw] = useState(() => String(item.dumpCount));
  const [materialsCostRaw, setMaterialsCostRaw] = useState(() => String(item.materialsCost));

  function handleLaborHoursChange(raw: string) {
    setLaborHoursRaw(raw);
    onChange({ laborHours: parseNonNegativeDecimal(raw) });
  }

  function handleDumpCountChange(raw: string) {
    setDumpCountRaw(raw);
    onChange({ dumpCount: parseNonNegativeDecimal(raw) });
  }

  function handleMaterialsCostChange(raw: string) {
    setMaterialsCostRaw(raw);
    onChange({ materialsCost: parseNonNegativeDecimal(raw) });
  }

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
            type="text"
            inputMode="decimal"
            value={laborHoursRaw}
            onChange={(e) => handleLaborHoursChange(e.target.value)}
            className={fieldInputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          Dumps
          <input
            type="text"
            inputMode="decimal"
            value={dumpCountRaw}
            onChange={(e) => handleDumpCountChange(e.target.value)}
            className={fieldInputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          Materials $
          <input
            type="text"
            inputMode="decimal"
            value={materialsCostRaw}
            onChange={(e) => handleMaterialsCostChange(e.target.value)}
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
