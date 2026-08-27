"use client";

import { useState, useTransition, type FormEvent } from "react";
import { CATEGORY_LABELS } from "@/lib/jobs/map";
import type { ForecastOverrideRow } from "@/lib/jobs/map";
import { COST_CATEGORIES, type CostCategory } from "@/lib/profitability/types";
import {
  createForecastOverrideAction,
  type ForecastOverrideActionResult,
} from "../../actions";

// ============================================================
// Lost Boys Demolition — web app — v2 Task 9 (Session 14): owner
// forecast override panel
//
// Client component. Collapsed-by-default <details> disclosure on the job
// detail page (see page.tsx's Session-14 note on the locked section
// order). UNLIKE CostEntryForm.tsx / CancelJobPanel.tsx, this does NOT
// gate on useEstimator() — createForecastOverrideAction's gate is the
// authenticated owner session (Task 8a's requireActiveOwner()), so an
// unauthenticated/non-owner submit simply comes back `ok:false` with a
// friendly error from the action itself; there is no client-side owner
// signal to check before that.
//
// Two override kinds share one form: "labor" patches the
// remainingWorkdays × expectedCrewSize × hoursPerDay product the labor
// forecast is built from; "category" patches a single category's
// expectedRemainingCost. Submission shaping lives in the exported pure
// helper buildOverrideSubmission (unit-tested) so the empty-string ->
// undefined convention (never Number("") -> 0 — the Task 6 final-review
// carry, see CostEntryForm.tsx's parseRequiredNumber) is verifiable
// without touching React at all. Numeric validation itself is server-side
// (@/lib/forecasts/validate.ts); this only shapes the payload.
// ============================================================

type OverrideMode = "labor" | "category";

interface OverrideFormStrings {
  remainingWorkdays: string;
  expectedCrewSize: string;
  hoursPerDay: string;
  category: string;
  expectedRemainingCost: string;
  reason: string;
}

/** Form strings → action input. Empty string → undefined (NEVER Number("")
 *  → 0 — the Task 6 final-review carry), so Zod reports missing rather
 *  than silently zeroing. Validation itself lives server-side in
 *  @/lib/forecasts/validate.ts; this only shapes the payload. */
export function buildOverrideSubmission(
  mode: "labor" | "category",
  jobNumber: string,
  form: OverrideFormStrings,
): Record<string, unknown> {
  const num = (v: string): number | undefined => {
    const trimmed = v.trim();
    return trimmed === "" ? undefined : Number(trimmed);
  };
  if (mode === "labor") {
    return {
      kind: "labor",
      jobNumber,
      remainingWorkdays: num(form.remainingWorkdays),
      expectedCrewSize: num(form.expectedCrewSize),
      hoursPerDay: num(form.hoursPerDay),
      reason: form.reason.trim(),
    };
  }
  return {
    kind: "category",
    jobNumber,
    category: form.category === "" ? undefined : form.category,
    expectedRemainingCost: num(form.expectedRemainingCost),
    reason: form.reason.trim(),
  };
}

const deltaCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const currency = deltaCurrency;

/** Signed forecast-profit delta label, or null when either side is
 *  unknown (no snapshotable health before/after). */
export function formatProfitDelta(previous: number | null, next: number | null): string | null {
  if (previous === null || next === null) return null;
  const delta = next - previous;
  const label = deltaCurrency.format(Math.abs(delta));
  if (delta > 0) return `+${label}`;
  if (delta < 0) return `-${label}`;
  return label;
}

const HEALTH_LABELS: Record<string, string> = {
  on_track: "On track",
  watch: "Watch",
  at_risk: "At risk",
};

function formatDenver(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Denver",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** "3 days × 4 crew × 8h" for a labor override; only the fields that are
 *  actually present are rendered — a labor override never sets every
 *  field (see @/lib/forecasts/validate.ts's laborSchema, which requires
 *  all three, so in practice all three ARE present, but this stays
 *  defensive rather than assuming). */
function laborSummary(override: ForecastOverrideRow): string {
  const parts: string[] = [];
  if (override.remaining_workdays !== null) parts.push(`${override.remaining_workdays} days`);
  if (override.expected_crew_size !== null) parts.push(`${override.expected_crew_size} crew`);
  if (override.hours_per_day !== null) parts.push(`${override.hours_per_day}h`);
  return parts.join(" × ");
}

function overrideSummary(override: ForecastOverrideRow): string {
  if (override.category !== null) {
    const label = CATEGORY_LABELS[override.category] ?? override.category;
    return override.expected_remaining_cost !== null
      ? `${label} ETC → ${currency.format(override.expected_remaining_cost)}`
      : label;
  }
  return laborSummary(override);
}

const inputClass =
  "h-11 w-full rounded-lg border border-zinc-300 px-3 text-base dark:border-zinc-700 dark:bg-zinc-900";
const textareaClass =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "text-sm font-medium";

function FieldErrorList({ fieldErrors }: { fieldErrors: string[] }) {
  if (fieldErrors.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
      {fieldErrors.map((err) => (
        <li key={err}>{err}</li>
      ))}
    </ul>
  );
}

interface ForecastOverridePanelProps {
  jobNumber: string;
  current: {
    remainingWorkdays: number | null;
    expectedCrewSize: number | null;
    hoursPerDay: number;
    forecastProfit: number | null;
    health: string | null;
  };
  overrides: ForecastOverrideRow[];
}

const EMPTY_FORM: OverrideFormStrings = {
  remainingWorkdays: "",
  expectedCrewSize: "",
  hoursPerDay: "",
  category: "",
  expectedRemainingCost: "",
  reason: "",
};

export function ForecastOverridePanel({ jobNumber, current, overrides }: ForecastOverridePanelProps) {
  const [mode, setMode] = useState<OverrideMode>("labor");
  const [form, setForm] = useState<OverrideFormStrings>(EMPTY_FORM);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<ForecastOverrideActionResult | null>(null);

  function updateField<K extends keyof OverrideFormStrings>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleModeChange(next: OverrideMode) {
    setMode(next);
    setError(null);
    setFieldErrors([]);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors([]);

    if (!form.reason.trim()) {
      setError("A reason is required.");
      return;
    }

    const input = buildOverrideSubmission(mode, jobNumber, form);

    startTransition(async () => {
      const result = await createForecastOverrideAction(input);
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? []);
        return;
      }
      setLastResult(result);
      setForm(EMPTY_FORM);
    });
  }

  const delta = lastResult && lastResult.ok
    ? formatProfitDelta(lastResult.previousForecastProfit, lastResult.newForecastProfit)
    : null;

  return (
    <details className="rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
      <summary className="cursor-pointer text-sm font-medium">Override forecast…</summary>

      <div className="mt-3 flex flex-col gap-3">
        <div className="rounded-lg border border-zinc-200 p-2 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <p>
            Current: {current.remainingWorkdays ?? "—"} remaining workdays × crew of{" "}
            {current.expectedCrewSize ?? "—"} × {current.hoursPerDay}h/day
          </p>
          <p>
            Forecast profit: {current.forecastProfit !== null ? currency.format(current.forecastProfit) : "—"}
            {current.health ? ` · ${HEALTH_LABELS[current.health] ?? current.health}` : ""}
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={labelClass}>Override type</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="override-mode"
              value="labor"
              checked={mode === "labor"}
              onChange={() => handleModeChange("labor")}
            />
            <span>Labor (remaining workdays / crew / hours)</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="override-mode"
              value="category"
              checked={mode === "category"}
              onChange={() => handleModeChange("category")}
            />
            <span>Category expected-remaining-cost</span>
          </label>
        </fieldset>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {mode === "labor" ? (
            <>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Remaining workdays</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={form.remainingWorkdays}
                  onChange={(e) => updateField("remainingWorkdays", e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Expected crew size</span>
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={form.expectedCrewSize}
                  onChange={(e) => updateField("expectedCrewSize", e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Hours per day</span>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={form.hoursPerDay}
                  onChange={(e) => updateField("hoursPerDay", e.target.value)}
                  className={inputClass}
                />
              </label>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Category</span>
                <select
                  value={form.category}
                  onChange={(e) => updateField("category", e.target.value)}
                  className={inputClass}
                >
                  <option value="">— select —</option>
                  {COST_CATEGORIES.map((c: CostCategory) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Expected remaining cost</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.expectedRemainingCost}
                  onChange={(e) => updateField("expectedRemainingCost", e.target.value)}
                  className={inputClass}
                />
              </label>
            </>
          )}

          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Reason</span>
            <textarea
              value={form.reason}
              onChange={(e) => updateField("reason", e.target.value)}
              rows={2}
              required
              className={textareaClass}
            />
          </label>

          <button
            type="submit"
            disabled={pending}
            className="h-11 w-full rounded-lg bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? "Saving…" : "Save override"}
          </button>

          {error ? (
            <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <FieldErrorList fieldErrors={fieldErrors} />
        </form>

        {lastResult?.ok ? (
          <div className="rounded-lg border border-emerald-300 p-2 text-xs dark:border-emerald-700">
            <p className="font-medium text-emerald-700 dark:text-emerald-400">Override saved.</p>
            <p className="text-zinc-600 dark:text-zinc-400">
              New health: {lastResult.newHealth ? HEALTH_LABELS[lastResult.newHealth] ?? lastResult.newHealth : "—"}
              {lastResult.newConfidence ? ` (${lastResult.newConfidence} confidence)` : ""}
            </p>
            <p className="text-zinc-600 dark:text-zinc-400">
              Forecast profit delta: {delta ?? "unavailable"}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Override history ({overrides.length})
          </h3>
          {overrides.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No forecast overrides.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {overrides.map((override) => (
                <li
                  key={override.id}
                  className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800"
                >
                  <p className="font-medium">{overrideSummary(override)}</p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">{override.reason}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {override.created_by_name} · {formatDenver(override.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
}
