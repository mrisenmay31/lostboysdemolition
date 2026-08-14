"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  ESTIMATOR_STORAGE_KEY,
  ESTIMATORS,
  isEstimatorName,
  type EstimatorName,
} from "@/lib/estimator";

/** Cross-component subscription so the header chip and the builder stay in
 *  sync when the pick changes (storage events also cover other tabs). */
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => { listeners.delete(cb); window.removeEventListener("storage", cb); };
}
function getSnapshot(): EstimatorName | null {
  const v = localStorage.getItem(ESTIMATOR_STORAGE_KEY);
  return isEstimatorName(v) ? v : null;
}

export function useEstimator() {
  const estimator = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const setEstimator = useCallback((name: EstimatorName) => {
    localStorage.setItem(ESTIMATOR_STORAGE_KEY, name);
    emit();
  }, []);
  return { estimator, setEstimator };
}

export default function EstimatorChip() {
  const { estimator, setEstimator } = useEstimator();
  return (
    <div className="flex items-center gap-1">
      {ESTIMATORS.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => setEstimator(name)}
          className={
            name === estimator
              ? "rounded-full bg-zinc-900 px-3 py-1 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "rounded-full px-3 py-1 text-sm font-medium text-zinc-500 dark:text-zinc-400"
          }
        >
          {name}
        </button>
      ))}
    </div>
  );
}
