"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useEstimator } from "@/app/(app)/EstimatorChip";
import { createCostEntryAction, correctCostEntryAction } from "@/app/(app)/jobs/actions";
import { CATEGORY_LABELS } from "@/lib/jobs/map";
import { COST_CATEGORIES, type CostCategory } from "@/lib/profitability/types";

// ============================================================
// Lost Boys Demolition — web app — v2 Task 7 Lane D: manual cost entry
//
// Client component. Two forms in one file (Lane D's own): CostEntryForm
// (new manual cost-ledger entry, rendered once per job on costs/page.tsx)
// and CostCorrectionForm (per-entry amend/void, rendered inside a
// <details> disclosure by costs/page.tsx for each source_system ===
// "manual" non-void entry). Mirrors CancelJobPanel.tsx's shape —
// useEstimator() gate, pending state, role="alert" error text,
// router.refresh() on success — and ScheduleEstimateForm.tsx's
// controlled-<select>/<input type="date"> idiom.
//
// Numeric-field convention (the Task-6 carry — see CLAUDE.md's Task 9
// note and @/lib/ledger/validate.ts's module header): a blank string
// input converts to `undefined` for a REQUIRED z.number() field (amount)
// so Zod reports it as missing rather than `Number("")` silently
// becoming 0 and slipping past a naive check; a blank string for a
// NULLABLE z.number() field (quantity, unitCost) converts to explicit
// `null` instead — @/lib/ledger/validate.ts's schemas use `.nullable()`
// WITHOUT `.optional()` on those two fields, so sending `undefined`
// there fails as "expected number | null, received undefined" rather
// than being read as "not applicable."
// ============================================================

type CreatableState = "provisional" | "committed" | "approved";
type CorrectionState = "provisional" | "committed" | "approved" | "void";

const STATE_EXPLAINERS: Record<CreatableState, string> = {
  provisional: "Provisional — estimated, not yet invoiced/confirmed",
  committed: "Committed — ordered or contracted, amount known",
  approved: "Approved — verified actual",
};

const CORRECTION_STATE_OPTIONS: Array<{ value: CorrectionState; label: string }> = [
  { value: "provisional", label: "Provisional" },
  { value: "committed", label: "Committed" },
  { value: "approved", label: "Approved" },
  { value: "void", label: "Void — remove this entry from all totals" },
];

function todayDenver(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(new Date());
}

/** "" -> undefined for a REQUIRED numeric field — see module header. */
function parseRequiredNumber(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

/** "" -> null for a NULLABLE numeric field — see module header. */
function parseNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : Number(trimmed);
}

function quantityLabel(category: CostCategory): string {
  if (category === "direct_labor") return "Hours";
  if (category === "dump") return "Loads";
  return "Quantity (optional)";
}

/** `not_correctable` gets a fixed friendly override; every other code
 *  falls through to the action's own message — same convention as
 *  CancelJobPanel.tsx's friendlyCancelErrorMessage. */
function friendlyLedgerErrorMessage(code: string | undefined, message: string): string {
  if (code === "not_correctable") return "Only manually entered costs can be corrected here.";
  return message;
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

// ---- CostEntryForm ----------------------------------------------------------

interface CostEntryFormProps {
  jobNumber: string;
}

export function CostEntryForm({ jobNumber }: CostEntryFormProps) {
  const router = useRouter();
  const { estimator } = useEstimator();

  const [category, setCategory] = useState<CostCategory>(COST_CATEGORIES[0]);
  const [entryState, setEntryState] = useState<CreatableState>("provisional");
  const [amountStr, setAmountStr] = useState("");
  const [quantityStr, setQuantityStr] = useState("");
  const [unitCostStr, setUnitCostStr] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [incurredOn, setIncurredOn] = useState(() => todayDenver());
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);

  function resetForm() {
    setCategory(COST_CATEGORIES[0]);
    setEntryState("provisional");
    setAmountStr("");
    setQuantityStr("");
    setUnitCostStr("");
    setEmployeeName("");
    setVendorName("");
    setIncurredOn(todayDenver());
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
      const result = await createCostEntryAction(
        {
          jobNumber,
          category,
          state: entryState,
          amount: parseRequiredNumber(amountStr),
          quantity: parseNullableNumber(quantityStr),
          unitCost: parseNullableNumber(unitCostStr),
          employeeName: employeeName === "" ? null : employeeName,
          vendorName: vendorName === "" ? null : vendorName,
          incurredOn,
          note: note === "" ? null : note,
        },
        estimator,
      );

      if (!result.ok) {
        setError(friendlyLedgerErrorMessage(result.code, result.error));
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
      <h2 className="text-sm font-semibold">Add cost entry</h2>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Category</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as CostCategory)}
          className={inputClass}
        >
          {COST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
              {c === "payment_processing" ? " — processing fees" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>State</span>
        <select
          value={entryState}
          onChange={(e) => setEntryState(e.target.value as CreatableState)}
          className={inputClass}
        >
          <option value="provisional">Provisional</option>
          <option value="committed">Committed</option>
          <option value="approved">Approved</option>
        </select>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{STATE_EXPLAINERS[entryState]}</p>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Amount</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{quantityLabel(category)}</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={quantityStr}
          onChange={(e) => setQuantityStr(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Unit cost (optional)</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={unitCostStr}
          onChange={(e) => setUnitCostStr(e.target.value)}
          className={inputClass}
        />
      </label>

      {category === "direct_labor" ? (
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Employee name</span>
          <input
            type="text"
            value={employeeName}
            onChange={(e) => setEmployeeName(e.target.value)}
            className={inputClass}
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Vendor name</span>
          <input
            type="text"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            className={inputClass}
          />
        </label>
      )}

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Date</span>
        <input
          type="date"
          value={incurredOn}
          onChange={(e) => setIncurredOn(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Note</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className={textareaClass}
        />
      </label>

      <button
        type="submit"
        disabled={pending || !estimator}
        className="h-11 w-full rounded-lg bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Saving…" : "Add cost entry"}
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

      <FieldErrorList fieldErrors={fieldErrors} />
    </form>
  );
}

// ---- CostCorrectionForm ------------------------------------------------------

interface CostCorrectionFormProps {
  entryId: string;
  initialAmount: number;
  initialState: CorrectionState;
  initialQuantity: number | null;
  /** `YYYY-MM-DD`, Denver-local — costs/page.tsx derives this from the
   *  entry's `incurred_at` timestamptz before passing it in. */
  initialIncurredOn: string;
}

export function CostCorrectionForm({
  entryId,
  initialAmount,
  initialState,
  initialQuantity,
  initialIncurredOn,
}: CostCorrectionFormProps) {
  const router = useRouter();
  const { estimator } = useEstimator();

  const [amountStr, setAmountStr] = useState(String(initialAmount));
  const [entryState, setEntryState] = useState<CorrectionState>(initialState);
  const [quantityStr, setQuantityStr] = useState(
    initialQuantity === null ? "" : String(initialQuantity),
  );
  const [incurredOn, setIncurredOn] = useState(initialIncurredOn);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors([]);

    if (!estimator) {
      setError("Pick who's estimating first.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }

    setPending(true);
    try {
      const result = await correctCostEntryAction(
        {
          entryId,
          reason,
          patch: {
            amount: parseRequiredNumber(amountStr),
            state: entryState,
            quantity: parseNullableNumber(quantityStr),
            incurredOn: incurredOn.trim() === "" ? undefined : incurredOn,
            note: note === "" ? null : note,
          },
        },
        estimator,
      );

      if (!result.ok) {
        setError(friendlyLedgerErrorMessage(result.code, result.error));
        setFieldErrors(result.fieldErrors ?? []);
        return;
      }

      setDone(true);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
        Correction saved.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Amount</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>State</span>
        <select
          value={entryState}
          onChange={(e) => setEntryState(e.target.value as CorrectionState)}
          className={inputClass}
        >
          {CORRECTION_STATE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Quantity</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={quantityStr}
          onChange={(e) => setQuantityStr(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Incurred date</span>
        <input
          type="date"
          value={incurredOn}
          onChange={(e) => setIncurredOn(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Note</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className={textareaClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>
          Why is this being corrected? Recorded permanently in the audit history.
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          required
          className={textareaClass}
        />
      </label>

      <button
        type="submit"
        disabled={pending || !estimator}
        className="h-11 w-full rounded-lg bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Saving…" : "Save correction"}
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

      <FieldErrorList fieldErrors={fieldErrors} />
    </form>
  );
}
