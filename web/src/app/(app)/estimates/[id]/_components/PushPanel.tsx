"use client";

import { useState, useTransition } from "react";
import type { GhlPushStateRow } from "@/lib/estimates/types";
import { pushEstimateAction } from "../../actions";

interface PushPanelProps {
  estimateId: string;
  isPathB: boolean;
  hasClientEmail: boolean;
  hasClientPhone: boolean;
  pushState: GhlPushStateRow | null;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleString();
}

const DOC_LABEL: Record<string, string> = {
  ok: "sent",
  skipped_path_b: "skipped (Path B — record only)",
  skipped_missing_contact: "skipped (missing client email/phone)",
  not_configured: "skipped (GHL estimates not configured for this account)",
  error: "error",
};

/**
 * GHL push status + Push/Retry (Task 11b binding carry #6). Reads the
 * persisted `ghl_push_state` row for the durable status (survives a page
 * reload); the button calls `pushEstimateAction` (a plain server action —
 * no auth, but the action validates estimateId — see actions.ts) and
 * shows THIS RUN's PushResult as an ephemeral banner, since PushResult
 * carries more granular per-target detail (e.g. which specific reason a
 * doc was skipped for) than the persisted row alone.
 *
 * No local mirror of `pushState` is kept — the prop is rendered directly.
 * `pushEstimateAction` calls `revalidatePath` on success, and Next
 * refreshes this route's server-rendered props as part of the same
 * transition (`startTransition` below), so the persisted section updates
 * on its own without this component trying to guess the new row shape.
 *
 * Retry = the exact same call as Push — pushEstimateToGhl's targets are
 * each independently idempotent (attach-or-create / update-or-replace),
 * so re-running is always safe (see push.ts's module doc comment).
 */
export function PushPanel({
  estimateId,
  isPathB,
  hasClientEmail,
  hasClientPhone,
  pushState,
}: PushPanelProps) {
  const [pending, startTransition] = useTransition();
  const [lastRunError, setLastRunError] = useState<string | null>(null);
  const [lastRunSummary, setLastRunSummary] = useState<string | null>(null);

  const hasPushedBefore = pushState?.fields_pushed_at != null;

  function handlePush() {
    setLastRunError(null);
    setLastRunSummary(null);
    startTransition(async () => {
      const result = await pushEstimateAction(estimateId);
      if (!result.ok) {
        setLastRunError(result.error);
        return;
      }
      const { fields, doc, errors } = result.result;
      setLastRunSummary(
        `Fields: ${fields === "ok" ? "pushed" : "error"} · Doc: ${DOC_LABEL[doc] ?? doc}`,
      );
      if (errors?.fields || errors?.doc) {
        setLastRunError([errors.fields, errors.doc].filter(Boolean).join(" — "));
      }
    });
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        GHL push
      </h2>

      {isPathB ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Record-only (Path B) — pricing fields still push to the GHL opportunity, but no
          customer-facing proposal doc is created.
        </p>
      ) : null}
      {!hasClientEmail || !hasClientPhone ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Missing client email/phone — the proposal doc will be skipped until both are on file.
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        <dt>Fields pushed</dt>
        <dd>{formatTimestamp(pushState?.fields_pushed_at ?? null)}</dd>
        <dt>Doc pushed</dt>
        <dd>{formatTimestamp(pushState?.doc_pushed_at ?? null)}</dd>
        <dt>Attempts</dt>
        <dd>{pushState?.attempts ?? 0}</dd>
        {pushState?.last_error ? (
          <>
            <dt className="text-red-600 dark:text-red-400">Last error</dt>
            <dd className="text-red-600 dark:text-red-400">{pushState.last_error}</dd>
          </>
        ) : null}
      </dl>

      {lastRunSummary ? (
        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{lastRunSummary}</p>
      ) : null}
      {lastRunError ? (
        <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {lastRunError}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handlePush}
        disabled={pending}
        className="h-10 w-fit rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-60 dark:border-zinc-700"
      >
        {pending ? "Pushing…" : hasPushedBefore ? "Retry push" : "Push to GHL"}
      </button>
    </section>
  );
}
