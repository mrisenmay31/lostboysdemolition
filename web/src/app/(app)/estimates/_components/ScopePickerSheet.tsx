"use client";

import type { ScopeLibraryItem } from "@/lib/estimates/builderLogic";

interface ScopePickerSheetProps {
  open: boolean;
  onClose: () => void;
  items: readonly ScopeLibraryItem[];
  onSelect: (item: ScopeLibraryItem) => void;
}

/** Bottom sheet over the scope_library rows (already filtered by the
 *  builder to the currently-selected job type, if any). Tapping a row adds
 *  it as a new, editable LineItemCard prefilled from its defaults and
 *  closes the sheet — no external bottom-sheet dependency, just a fixed
 *  overlay + a rounded-top panel anchored to the bottom of the viewport. */
export function ScopePickerSheet({ open, onClose, items, onSelect }: ScopePickerSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close scope picker"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative max-h-[75vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-8 dark:bg-zinc-950">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Add scope item</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-zinc-500 dark:text-zinc-400"
          >
            Close
          </button>
        </div>
        {items.length === 0 ? (
          <p className="py-6 text-sm text-zinc-500 dark:text-zinc-400">
            No scope items match this job type.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="flex w-full flex-col items-start gap-0.5 py-3 text-left"
                >
                  <span className="text-sm font-medium">{item.name}</span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {item.defaultLaborHours} hrs · {item.defaultDumpCount} dump
                    {item.defaultMaterialsCost
                      ? ` · $${item.defaultMaterialsCost} materials`
                      : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
