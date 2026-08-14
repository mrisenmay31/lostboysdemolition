"use client";

interface PresetChipsProps {
  value: number;
  onChange: (value: number) => void;
  presets: readonly number[];
  /** HARD REQUIREMENT (Task 8 review carry): markup must never go negative
   *  — both the preset taps and the free-entry input clamp to this floor. */
  min?: number;
  suffix?: string;
  inputId: string;
}

/** Preset chips (20/25/30/35 markup %) + a free-entry number input for any
 *  other value. Both paths clamp to `min` — never negative. */
export function PresetChips({
  value,
  onChange,
  presets,
  min = 0,
  suffix = "%",
  inputId,
}: PresetChipsProps) {
  function handleFreeEntry(raw: string) {
    if (raw === "") {
      onChange(min);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onChange(Math.max(min, parsed));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => {
          const selected = value === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(Math.max(min, preset))}
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
        type="number"
        inputMode="decimal"
        min={min}
        step="0.1"
        value={value}
        onChange={(e) => handleFreeEntry(e.target.value)}
        className="h-12 w-28 rounded-lg border border-zinc-300 px-3 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
      />
    </div>
  );
}
