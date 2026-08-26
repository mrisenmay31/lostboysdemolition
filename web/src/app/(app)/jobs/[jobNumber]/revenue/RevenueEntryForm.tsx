"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useEstimator } from "@/app/(app)/EstimatorChip";
import { createRevenueEntryAction } from "@/app/(app)/jobs/actions";

// ============================================================
// Lost Boys Demolition — web app — v2 Task 7 Lane D: manual revenue entry
//
// Client component. Mirrors costs/CostEntryForm.tsx's shape —
// useEstimator() gate, pending state, role="alert" error text, fieldErrors
// list, router.refresh() on success — for the one revenue-entry form.
// There is no revenue correction form: revenue/page.tsx's locked
// explainer block is explicit that a mistake is fixed with an offsetting
// credit or refund, not an edit.
// ============================================================

type RevenueEntryType = "approved_contract" | "invoice" | "credit" | "refund" | "payment";

const ENTRY_TYPE_OPTIONS: Array<{ value: RevenueEntryType; label: string; explainer: string }> = [
  {
    value: "approved_contract",
    label: "Approved contract",
    explainer: "Informational — the budget's approved revenue is authoritative.",
  },
  {
    value: "invoice",
    label: "Invoice",
    explainer: "Counts toward economic revenue.",
  },
  {
    value: "credit",
    label: "Credit",
    explainer: "Entered as a positive number, recorded as a reduction.",
  },
  {
    value: "refund",
    label: "Refund",
    explainer: "Entered as a positive number, recorded as a reduction.",
  },
  {
    value: "payment",
    label: "Payment",
    explainer: "Affects collection status, not job profit.",
  },
];

function todayDenver(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(new Date());
}

/** "" -> undefined for a REQUIRED numeric field — same convention as
 *  costs/CostEntryForm.tsx's parseRequiredNumber (see that file's module
 *  header for the full rationale). */
function parseRequiredNumber(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

interface RevenueEntryFormProps {
  jobNumber: string;
}

export function RevenueEntryForm({ jobNumber }: RevenueEntryFormProps) {
  const router = useRouter();
  const { estimator } = useEstimator();

  const [entryType, setEntryType] = useState<RevenueEntryType>("invoice");
  const [amountStr, setAmountStr] = useState("");
  const [occurredOn, setOccurredOn] = useState(() => todayDenver());
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);

  function resetForm() {
    setEntryType("invoice");
    setAmountStr("");
    setOccurredOn(todayDenver());
    setNote("");
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors([]);

    if (!estimator) {
      setError("Pick who's estimating first.");
      return;
    }

    setPending(true);
    try {
      const result = await createRevenueEntryAction(
        {
          jobNumber,
          entryType,
          amount: parseRequiredNumber(amountStr),
          occurredOn,
          note,
        },
        estimator,
      );

      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? []);
        return;
      }

      resetForm();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700"
    >
      <h2 className="text-sm font-semibold">Add revenue entry</h2>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Type</legend>
        {ENTRY_TYPE_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="revenue-entry-type"
              value={opt.value}
              checked={entryType === opt.value}
              onChange={() => setEntryType(opt.value)}
              className="mt-1"
            />
            <span className="flex flex-col">
              <span>{opt.label}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{opt.explainer}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Amount</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          className="h-11 w-full rounded-lg border border-zinc-300 px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Date</span>
        <input
          type="date"
          value={occurredOn}
          onChange={(e) => setOccurredOn(e.target.value)}
          className="h-11 w-full rounded-lg border border-zinc-300 px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">
          Where does this number come from? e.g. &quot;Stripe invoice 0042&quot;
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          required
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <button
        type="submit"
        disabled={pending || !estimator}
        className="h-11 w-full rounded-lg bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Saving…" : "Add revenue entry"}
      </button>

      {!estimator ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Pick who&apos;s estimating first.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {fieldErrors.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          {fieldErrors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
