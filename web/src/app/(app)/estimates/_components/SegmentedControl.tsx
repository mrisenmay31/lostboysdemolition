"use client";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  name: string;
  value: T | null;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
}

/** Two-or-more-way toggle (Client type, Job type, Labor method). Renders
 *  as a `radiogroup` of equal-width buttons — no external dependency. */
export function SegmentedControl<T extends string>({
  name,
  value,
  onChange,
  options,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="flex overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`h-12 flex-1 text-sm font-medium transition-colors ${
              index > 0 ? "border-l border-zinc-300 dark:border-zinc-700" : ""
            } ${
              selected
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-transparent text-zinc-700 dark:text-zinc-300"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
