"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { computeEstimate, type EstimateInputs, type LaborMethod } from "@/lib/pricing";
import type { RatesConfig } from "@/lib/rates";
import type {
  ClientType,
  EstimateDraft,
  EstimateRow,
  JobType,
  LineItemDraft,
} from "@/lib/estimates/types";
import {
  assignSortOrders,
  deriveMode,
  parseNonNegativeDecimal,
  sumLineItems,
  type ScopeLibraryItem,
} from "@/lib/estimates/builderLogic";
import { createEstimateAction } from "../actions";
import { Field, fieldInputClass, fieldTextareaClass, readOnlyValueClass } from "./Field";
import { SegmentedControl, type SegmentedOption } from "./SegmentedControl";
import { PresetChips } from "./PresetChips";
import { ScopePickerSheet } from "./ScopePickerSheet";
import { LineItemCard } from "./LineItemCard";
import { StickyTotalBar } from "./StickyTotalBar";

interface EstimateBuilderProps {
  ratesConfig: RatesConfig;
  scopeItems: readonly ScopeLibraryItem[];
}

/** Line items need a stable React key before they have a DB id — carried
 *  client-side only and stripped before the draft is submitted. */
type LocalLineItem = LineItemDraft & { key: string };

const MARKUP_PRESETS = [20, 25, 30, 35] as const;

const CLIENT_TYPE_OPTIONS: readonly SegmentedOption<ClientType>[] = [
  { value: "Homeowner", label: "Homeowner" },
  { value: "Contractor", label: "Contractor" },
];

const JOB_TYPE_OPTIONS: readonly SegmentedOption<JobType>[] = [
  { value: "Residential", label: "Residential" },
  { value: "Commercial", label: "Commercial" },
];

const LABOR_METHOD_OPTIONS: readonly SegmentedOption<LaborMethod>[] = [
  { value: "total_hours", label: "Total hours" },
  { value: "days_employees", label: "Days × crew" },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function EstimateBuilder({ ratesConfig, scopeItems }: EstimateBuilderProps) {
  // Client
  const [clientName, setClientName] = useState("");
  const [clientType, setClientType] = useState<ClientType | null>(null);
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");

  // Job
  const [jobName, setJobName] = useState("");
  const [jobAddress, setJobAddress] = useState("");
  const [city, setCity] = useState("");
  const [jobType, setJobType] = useState<JobType | null>(null);
  const [estimateDate, setEstimateDate] = useState(todayIso);
  const [jobDetails, setJobDetails] = useState("");

  // Scope line items
  const [lineItems, setLineItems] = useState<LocalLineItem[]>([]);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);

  // Labor, Dumps, Costs, Markup — all six of these hold RAW TEXT, not a
  // number, and are parsed via parseNonNegativeDecimal below (Task 11
  // review Finding 1: a `type="number"` input blanks `.value` for
  // legal-but-incomplete decimal states like ".25" or "0.", fighting
  // every keystroke of a fractional entry — see that function's doc
  // comment for the full explanation).
  const [laborMethod, setLaborMethod] = useState<LaborMethod>("total_hours");
  const [totalJobHoursRaw, setTotalJobHoursRaw] = useState("0");
  const [daysAtJobRaw, setDaysAtJobRaw] = useState("0");
  const [numEmployeesRaw, setNumEmployeesRaw] = useState("0");
  const [dumpCountRaw, setDumpCountRaw] = useState("0");
  const [jobSpecificCostsRaw, setJobSpecificCostsRaw] = useState("0");
  const [markupPctRaw, setMarkupPctRaw] = useState(() => String(ratesConfig.defaultMarkupPct));

  // Path B — "record only, no formal proposal". Held as pure client form
  // state for now, named to match the approved contract from
  // docs/superpowers/plans/2026-08-14-no-login-estimator-picker.md (an
  // `is_path_b` estimates column + draft field are landing in a separate
  // lane). NOT yet included in the submitted draft payload — wiring that
  // is a follow-up integration step once the column exists; sending it
  // today would just be silently stripped by the draft schema.
  const [isPathB, setIsPathB] = useState(false);

  // Sticky bar / save
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<{ estimate: EstimateRow; drift: number | null } | null>(null);

  const mode = deriveMode(laborMethod, lineItems.length);
  const lineItemSums = useMemo(() => sumLineItems(lineItems), [lineItems]);

  // Derived numbers from the six raw-text fields above.
  const totalJobHoursQuick = parseNonNegativeDecimal(totalJobHoursRaw);
  const daysAtJob = parseNonNegativeDecimal(daysAtJobRaw);
  const numEmployees = parseNonNegativeDecimal(numEmployeesRaw);
  const dumpCountQuick = parseNonNegativeDecimal(dumpCountRaw);
  const jobSpecificCosts = parseNonNegativeDecimal(jobSpecificCostsRaw);
  const markupPct = parseNonNegativeDecimal(markupPctRaw);

  const effectiveTotalJobHours =
    laborMethod === "total_hours"
      ? mode === "itemized"
        ? lineItemSums.laborHours
        : totalJobHoursQuick
      : null;

  const effectiveDumpCount = mode === "itemized" ? lineItemSums.dumpCount : dumpCountQuick;

  const materialsFloor = lineItemSums.materialsCost;
  const jobSpecificCostsBelowFloor = mode === "itemized" && jobSpecificCosts < materialsFloor;

  const inputs: EstimateInputs = useMemo(() => {
    if (laborMethod === "total_hours") {
      return {
        laborMethod: "total_hours",
        totalJobHours: effectiveTotalJobHours ?? 0,
        dumpCount: effectiveDumpCount,
        jobSpecificCosts,
        markupPct,
      };
    }
    return {
      laborMethod: "days_employees",
      daysAtJob,
      numEmployees,
      dumpCount: effectiveDumpCount,
      jobSpecificCosts,
      markupPct,
    };
  }, [
    laborMethod,
    effectiveTotalJobHours,
    effectiveDumpCount,
    jobSpecificCosts,
    markupPct,
    daysAtJob,
    numEmployees,
  ]);

  // Live preview — recomputed on every keystroke against the server-
  // provided rates. The server action recomputes authoritatively on save;
  // this is a preview only.
  const outputs = useMemo(() => computeEstimate(inputs, ratesConfig.rates), [inputs, ratesConfig.rates]);

  const filteredScopeItems = useMemo(() => {
    if (!jobType) return scopeItems;
    return scopeItems.filter((item) => item.jobTypeApplicability.includes(jobType));
  }, [scopeItems, jobType]);

  function addLineItem(scopeItem: ScopeLibraryItem) {
    // sortOrder is deliberately NOT set here (see assignSortOrders' doc
    // comment, Task 11 review Finding 3) — it's derived fresh from the
    // final array's order at submit time instead, so removing a middle
    // item and adding a new one can never collide two items on the same
    // sort_order.
    setLineItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        scopeLibraryId: scopeItem.id,
        name: scopeItem.name,
        description: scopeItem.defaultDescription,
        laborHours: scopeItem.defaultLaborHours,
        dumpCount: scopeItem.defaultDumpCount,
        materialsCost: scopeItem.defaultMaterialsCost ?? 0,
      },
    ]);
    setScopePickerOpen(false);
  }

  function updateLineItem(key: string, patch: Partial<LineItemDraft>) {
    setLineItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function removeLineItem(key: string) {
    setLineItems((prev) => prev.filter((item) => item.key !== key));
  }

  function handleLaborMethodChange(next: LaborMethod) {
    setLaborMethod(next);
    if (next === "days_employees") {
      // days_employees has no totalJobHours field for line items to
      // reconcile against (validateEstimateDraft only requires it in
      // total_hours mode) -- switching methods clears any in-progress
      // itemization rather than leaving an unreconcilable draft.
      setLineItems([]);
    }
  }

  async function handleSave() {
    setSaveError(null);
    setFieldErrors([]);
    setSaved(null);

    if (!clientName.trim()) {
      setSaveError("Client name is required.");
      return;
    }
    if (!jobName.trim()) {
      setSaveError("Job name is required.");
      return;
    }
    if (jobSpecificCostsBelowFloor) {
      setSaveError(
        `Job-specific costs must be at least $${materialsFloor.toFixed(2)} (the sum of scope item materials).`,
      );
      return;
    }

    const draft: EstimateDraft = {
      jobName: jobName.trim(),
      clientName: clientName.trim(),
      clientType,
      clientEmail: clientEmail.trim() || null,
      clientPhone: clientPhone.trim() || null,
      jobAddress: jobAddress.trim() || null,
      city: city.trim() || null,
      jobType,
      estimateDate,
      jobDetails: jobDetails.trim() || null,
      laborMethod,
      totalJobHours: laborMethod === "total_hours" ? effectiveTotalJobHours : null,
      daysAtJob: laborMethod === "days_employees" ? daysAtJob : null,
      numEmployees: laborMethod === "days_employees" ? numEmployees : null,
      dumpCount: effectiveDumpCount,
      jobSpecificCosts,
      markupPct,
      // sort_order is derived fresh from final array order here, not
      // carried from add-time (Task 11 review Finding 3 — see
      // assignSortOrders' doc comment).
      lineItems: assignSortOrders(lineItems.map(({ key: _key, ...rest }) => rest)),
    };

    setSaving(true);
    try {
      // Identity is deliberately not wired yet — the approved contract
      // (docs/superpowers/plans/2026-08-14-no-login-estimator-picker.md)
      // is `createEstimateAction(draft, estimatorName: string)`; this call
      // becomes a one-line change (`createEstimateAction(draft, estimator)`)
      // once that lane merges and this file switches to its
      // `useEstimator()` hook.
      const result = await createEstimateAction(draft);
      if (!result.ok) {
        setSaveError(result.error);
        setFieldErrors(result.fieldErrors ?? []);
        return;
      }
      const previewTotal = outputs.totalBid;
      const savedTotal = result.estimate.total_bid;
      const drift = Math.abs(previewTotal - savedTotal) > 0.01 ? savedTotal - previewTotal : null;
      setSaved({ estimate: result.estimate, drift });
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4">
        <h1 className="text-xl font-semibold">Estimate saved</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Estimate #{saved.estimate.estimate_number} v{saved.estimate.version} for{" "}
          {saved.estimate.client_name ?? "—"}.
        </p>
        <div className="rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
          <p className="text-2xl font-semibold">
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
              saved.estimate.total_bid,
            )}
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {saved.estimate.true_margin_pct.toFixed(1)}% true margin
          </p>
        </div>
        {saved.drift !== null ? (
          <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            Note: the saved total differs from your last on-screen preview by{" "}
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
              Math.abs(saved.drift),
            )}
            . The saved value above is authoritative — pricing rates may have changed since the
            page loaded.
          </p>
        ) : null}
        <div className="flex gap-3">
          <Link
            href={`/estimates/${saved.estimate.id}`}
            className="flex h-12 flex-1 items-center justify-center rounded-lg bg-zinc-900 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            View estimate
          </Link>
          <Link
            href="/estimates/new"
            className="flex h-12 flex-1 items-center justify-center rounded-lg border border-zinc-300 text-sm font-semibold dark:border-zinc-700"
          >
            Create another
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 p-4 pb-8">
        {/* Client */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Client
          </h2>
          <Field label="Client name" htmlFor="clientName">
            <input
              id="clientName"
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className={fieldInputClass}
              required
            />
          </Field>
          <Field label="Client type" htmlFor="clientType">
            <SegmentedControl
              name="Client type"
              value={clientType}
              onChange={(v) => setClientType(v)}
              options={CLIENT_TYPE_OPTIONS}
            />
          </Field>
          <Field label="Email" htmlFor="clientEmail">
            <input
              id="clientEmail"
              type="email"
              inputMode="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              className={fieldInputClass}
            />
          </Field>
          <Field label="Phone" htmlFor="clientPhone">
            <input
              id="clientPhone"
              type="tel"
              inputMode="tel"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              className={fieldInputClass}
            />
          </Field>
        </section>

        {/* Job */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Job
          </h2>
          <Field label="Job name" htmlFor="jobName">
            <input
              id="jobName"
              type="text"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              className={fieldInputClass}
              required
            />
          </Field>
          <Field label="Job address" htmlFor="jobAddress">
            <input
              id="jobAddress"
              type="text"
              value={jobAddress}
              onChange={(e) => setJobAddress(e.target.value)}
              className={fieldInputClass}
            />
          </Field>
          <Field label="City" htmlFor="city">
            <input
              id="city"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={fieldInputClass}
            />
          </Field>
          <Field label="Job type" htmlFor="jobType">
            <SegmentedControl
              name="Job type"
              value={jobType}
              onChange={(v) => setJobType(v)}
              options={JOB_TYPE_OPTIONS}
            />
          </Field>
          <Field label="Estimate date" htmlFor="estimateDate">
            <input
              id="estimateDate"
              type="date"
              value={estimateDate}
              onChange={(e) => setEstimateDate(e.target.value)}
              className={fieldInputClass}
            />
          </Field>
          <Field label="Job details" htmlFor="jobDetails">
            <textarea
              id="jobDetails"
              rows={3}
              value={jobDetails}
              onChange={(e) => setJobDetails(e.target.value)}
              className={fieldTextareaClass}
            />
          </Field>
        </section>

        {/* Scope line items — hidden entirely for days_employees */}
        {laborMethod === "total_hours" ? (
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Scope
              </h2>
              <button
                type="button"
                onClick={() => setScopePickerOpen(true)}
                className="h-10 rounded-full border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
              >
                + Add scope
              </button>
            </div>
            {lineItems.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No scope line items yet — quick mode. Enter hours/dumps/costs directly below, or
                add scope items to switch to itemized mode.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {lineItems.map((item) => (
                  <LineItemCard
                    key={item.key}
                    item={item}
                    onChange={(patch) => updateLineItem(item.key, patch)}
                    onRemove={() => removeLineItem(item.key)}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}

        {/* Labor */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Labor
          </h2>
          <Field label="Method" htmlFor="laborMethod">
            <SegmentedControl
              name="Labor method"
              value={laborMethod}
              onChange={(v) => handleLaborMethodChange(v)}
              options={LABOR_METHOD_OPTIONS}
            />
          </Field>
          {laborMethod === "total_hours" ? (
            <Field
              label="Total job hours"
              htmlFor="totalJobHours"
              hint={mode === "itemized" ? "Sum of scope item hours below." : undefined}
            >
              {mode === "itemized" ? (
                <div id="totalJobHours" className={readOnlyValueClass}>
                  {lineItemSums.laborHours.toFixed(2)} hrs
                </div>
              ) : (
                <input
                  id="totalJobHours"
                  type="text"
                  inputMode="decimal"
                  value={totalJobHoursRaw}
                  onChange={(e) => setTotalJobHoursRaw(e.target.value)}
                  className={fieldInputClass}
                />
              )}
            </Field>
          ) : (
            <>
              <Field label="Days at job" htmlFor="daysAtJob">
                <input
                  id="daysAtJob"
                  type="text"
                  inputMode="decimal"
                  value={daysAtJobRaw}
                  onChange={(e) => setDaysAtJobRaw(e.target.value)}
                  className={fieldInputClass}
                />
              </Field>
              <Field label="Number of employees" htmlFor="numEmployees">
                <input
                  id="numEmployees"
                  type="text"
                  inputMode="numeric"
                  value={numEmployeesRaw}
                  onChange={(e) => setNumEmployeesRaw(e.target.value)}
                  className={fieldInputClass}
                />
              </Field>
            </>
          )}
        </section>

        {/* Dumps */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Dumps
          </h2>
          <Field
            label="Dump loads"
            htmlFor="dumpCount"
            hint={mode === "itemized" ? "Sum of scope item dump loads below." : "Fractional loads allowed (e.g. 0.25)."}
          >
            {mode === "itemized" ? (
              <div id="dumpCount" className={readOnlyValueClass}>
                {lineItemSums.dumpCount.toFixed(2)}
              </div>
            ) : (
              <input
                id="dumpCount"
                type="text"
                inputMode="decimal"
                value={dumpCountRaw}
                onChange={(e) => setDumpCountRaw(e.target.value)}
                className={fieldInputClass}
              />
            )}
          </Field>
        </section>

        {/* Costs */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Costs
          </h2>
          <Field
            label="Job-specific costs"
            htmlFor="jobSpecificCosts"
            hint={
              mode === "itemized"
                ? `Must be at least $${materialsFloor.toFixed(2)} (sum of scope item materials).`
                : "Rentals, permits, and other direct costs."
            }
            error={jobSpecificCostsBelowFloor ? "Below the scope items' materials total." : undefined}
          >
            <input
              id="jobSpecificCosts"
              type="text"
              inputMode="decimal"
              value={jobSpecificCostsRaw}
              onChange={(e) => setJobSpecificCostsRaw(e.target.value)}
              className={fieldInputClass}
            />
          </Field>
        </section>

        {/* Markup */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Markup
          </h2>
          <Field label="Markup %" htmlFor="markupPct">
            <PresetChips
              inputId="markupPct"
              rawValue={markupPctRaw}
              onRawChange={setMarkupPctRaw}
              presets={MARKUP_PRESETS}
            />
          </Field>
        </section>

        {/* Path B */}
        <section className="flex flex-col gap-2">
          <label className="flex items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={isPathB}
              onChange={(e) => setIsPathB(e.target.checked)}
              className="h-5 w-5 rounded border-zinc-300 dark:border-zinc-700"
            />
            Record only — no proposal will be sent
          </label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            For trusted-contractor jobs invoiced at completion. This estimate still becomes the
            job&apos;s variance baseline.
          </p>
        </section>

        {fieldErrors.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            {fieldErrors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <StickyTotalBar
        outputs={outputs}
        markupPct={markupPct}
        markupFloorPct={ratesConfig.markupFloorPct}
        expanded={expanded}
        onToggleExpand={() => setExpanded((v) => !v)}
        onSave={handleSave}
        saving={saving}
        saveError={saveError}
      />

      <ScopePickerSheet
        open={scopePickerOpen}
        onClose={() => setScopePickerOpen(false)}
        items={filteredScopeItems}
        onSelect={addLineItem}
      />
    </div>
  );
}
