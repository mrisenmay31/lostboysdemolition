"use client";

import { parseNonNegativeDecimal } from "@/lib/estimates/builderLogic";

interface PresetChipsProps {
  /** Raw text of the free-entry field — the display source of truth. See
   *  parseNonNegativeDecimal's doc comment (Task 11 review Finding 1):
   *  this is a `type="text"` field, not `type="number"`, specifically so
   *  the browser never blanks `.value` mid-keystroke on a legal
   *  intermediate decimal like ".5" or "0.". */
  rawValue: string;
  onRawChange: (raw: string) => void;
  presets: readonly number[];
  suffix?: string;
  inputId: string;
}

/** Preset chips (20/25/30/35 markup %) + a free-entry text input for any
 *  other value. Both paths write the RAW STRING up to the parent — the
 *  numeric value (always clamped >= 0, never negative) is only derived
 *  from it via parseNonNegativeDecimal, for computation and highlighting
 *  which chip (if any) matches the current value. */
export function PresetChips({ rawValue, onRawChange, presets, suffix = "%", inputId }: PresetChipsProps) {
  const numericValue = parseNonNegativeDecimal(rawValue);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => {
          const selected = numericValue === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onRawChange(String(preset))}
              className={`h-10 rounded-full border px-4 text-sm font-medium ${
                selected
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {preset}
              {suffix}
            </button>
          );
        })}
      </div>
      <input
        id={inputId}
        type="text"
        inputMode="decimal"
        value={rawValue}
        onChange={(e) => onRawChange(e.target.value)}
        className="h-12 w-28 rounded-lg border border-zinc-300 px-3 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
      />
    </div>
  );
}
