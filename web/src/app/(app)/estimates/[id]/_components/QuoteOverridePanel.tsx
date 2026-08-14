"use client";

import { useState } from "react";
import { useEstimator } from "@/app/(app)/EstimatorChip";
import { validateQuoteOverride } from "@/lib/estimates/validate";
import { fieldInputClass, fieldTextareaClass } from "../../_components/Field";
import { updateQuoteAction } from "../../actions";

interface QuoteOverridePanelProps {
  estimateId: string;
  totalBid: number;
  quotedPrice: number | null;
  quoteOverrideReason: string | null;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * Quoted-price block (Task 11b binding carry #4). Read-only by default,
 * showing the calculated total_bid unless Dane has already overridden it.
 * Editing away from total_bid REVEALS a REQUIRED reason field — enforced
 * here via the same pure `validateQuoteOverride` the RPC's own CHECK
 * constraint mirrors (validate.ts), so the UI rejects a missing reason
 * before ever calling the server action; updateQuote (repo.ts) re-checks
 * it against the live DB row regardless, and the RPC itself is the final
 * backstop. Clearing the override (quotedPrice -> null) needs no reason
 * and is always allowed.
 */
export function QuoteOverridePanel({
  estimateId,
  totalBid,
  quotedPrice,
  quoteOverrideReason,
}: QuoteOverridePanelProps) {
  const { estimator } = useEstimator();
  const [editing, setEditing] = useState(false);
  const [priceRaw, setPriceRaw] = useState(() => String(quotedPrice ?? totalBid));
  const [reason, setReason] = useState(quoteOverrideReason ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedPrice = Number(priceRaw);
  const priceValid = priceRaw.trim() !== "" && Number.isFinite(parsedPrice) && parsedPrice >= 0;
  // Live smoke-test finding: this must track "price differs from the
  // calculated bid," NOT "the override-reason rule currently fails" —
  // driving visibility off `!check.ok` made the textarea vanish out from
  // under the estimator's cursor the instant a valid reason was typed
  // (check.ok flips true, needsReason flips false, field unmounts mid-
  // typing). Rounding to 2dp matches validateQuoteOverride's own
  // comparison (float noise never toggles this).
  const needsReason =
    priceValid && Math.round(parsedPrice * 100) !== Math.round(totalBid * 100);
  const check = priceValid ? validateQuoteOverride(parsedPrice, totalBid, reason) : { ok: false };

  function startEditing() {
    setError(null);
    setPriceRaw(String(quotedPrice ?? totalBid));
    setReason(quoteOverrideReason ?? "");
    setEditing(true);
  }

  async function handleSave() {
    setError(null);
    if (!estimator) {
      setError("Pick who's estimating first — tap a name up top.");
      return;
    }
    if (!priceValid) {
      setError("Enter a valid price.");
      return;
    }
    if (!check.ok) {
      setError(check.error ?? "A reason is required for this override.");
      return;
    }
    setSaving(true);
    try {
      const result = await updateQuoteAction(
        estimateId,
        parsedPrice,
        needsReason ? reason.trim() : null,
        estimator,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setError(null);
    if (!estimator) {
      setError("Pick who's estimating first — tap a name up top.");
      return;
    }
    setSaving(true);
    try {
      const result = await updateQuoteAction(estimateId, null, null, estimator);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Quoted price
        </h2>
        <p className="text-lg font-semibold">
          {currency.format(quotedPrice ?? totalBid)}
          {quotedPrice !== null ? (
            <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
              (bid {currency.format(totalBid)})
            </span>
          ) : null}
        </p>
        {quotedPrice !== null && quoteOverrideReason ? (
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Reason: {quoteOverrideReason}</p>
        ) : null}
        <button
          type="button"
          onClick={startEditing}
          className="h-10 w-fit rounded-lg border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
        >
          Edit quoted price
        </button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Quoted price
      </h2>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Price</span>
        <input
          type="text"
          inputMode="decimal"
          value={priceRaw}
          onChange={(e) => setPriceRaw(e.target.value)}
          className={fieldInputClass}
        />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Calculated bid: {currency.format(totalBid)}
        </span>
      </label>
      {needsReason ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Reason (required)</span>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            className={fieldTextareaClass}
          />
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="h-10 flex-1 rounded-lg bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          disabled={saving}
          className="h-10 flex-1 rounded-lg border border-zinc-300 text-sm font-semibold disabled:opacity-60 dark:border-zinc-700"
        >
          Cancel
        </button>
        {quotedPrice !== null ? (
          <button
            type="button"
            onClick={handleClear}
            disabled={saving}
            className="h-10 flex-1 rounded-lg border border-zinc-300 text-sm font-semibold text-red-600 disabled:opacity-60 dark:border-zinc-700 dark:text-red-400"
          >
            Clear override
          </button>
        ) : null}
      </div>
    </section>
  );
}
