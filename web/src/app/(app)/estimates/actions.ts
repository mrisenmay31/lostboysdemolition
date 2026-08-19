"use server";

import { revalidatePath } from "next/cache";
import { isEstimatorName } from "@/lib/estimator";
import { isValidEstimateId } from "@/lib/estimates/ids";
import {
  EstimateValidationError,
  createEstimate,
  createNewVersion,
  updateQuote,
  updateStatus,
} from "@/lib/estimates/repo";
import {
  EstimateIdentityConflictError,
  OpportunityPipelineMismatchError,
  linkEstimateIdentity,
  presentEstimate,
  recordEstimateAcceptance,
  reverseEstimateAcceptance,
  type ContactCreationFields,
  type RecordAcceptanceInput,
} from "@/lib/estimates/commercialLifecycle";
import type { EstimateActor, EstimateRow, EstimateStatus } from "@/lib/estimates/types";
import { pushEstimateToGhl } from "@/lib/ghl/push";
import type { PushResult } from "@/lib/ghl/push";
import { findContactMatches } from "@/lib/ghl/prefill";
import type { EstimateIdentitySelection } from "@/lib/ghl/prefill";
import type { GhlContact } from "@/lib/ghl/types";

/**
 * Server actions for the estimates data layer. Every action here is a
 * standalone entry point a client component can call directly (not bound
 * to a `<form action={...}>` — the estimate draft is a rich nested object
 * with a dynamic line-item array, so it travels as a plain serializable JS
 * argument the way Next.js server actions support when invoked
 * programmatically, rather than via FormData). Task 11's builder and Task
 * 11b's list/detail pages are the intended callers.
 *
 * IDENTITY (Matt's directive, replacing the Task 6 login gate): there is no
 * login. Who's estimating is a client-side picker (see @/lib/estimator and
 * EstimatorChip.tsx), persisted in localStorage, and passed in as a plain
 * `estimatorName` string on every mutating call below. Each action
 * re-validates that string against the 3-name allowlist itself, via
 * `resolveActor` — these actions ARE the trust boundary in front of the
 * service-role client, since anything past this point writes with an
 * admin connection that bypasses RLS. A name that isn't on the allowlist
 * never reaches repo.ts.
 *
 * Zod validation happens at repo.ts's createEstimate/createNewVersion
 * (validateEstimateDraft parses `unknown` input) — that IS the
 * zod-at-the-trust-boundary check, since these actions are the client's
 * only entry point into repo.ts. updateStatusAction/updateQuoteAction
 * validate their own (much narrower) inputs directly below.
 *
 * None of these actions call `redirect()` — the created/updated row is
 * returned to the caller, which owns navigation (e.g. router.push to the
 * new estimate's detail page after a successful create). Each mutating
 * action does call `revalidatePath` for the pages whose cached data it
 * just invalidated.
 */

export type ActionResult =
  | { ok: true; estimate: EstimateRow; linkWarning?: string }
  | { ok: false; error: string; fieldErrors?: string[] };

function toActionResult(err: unknown): ActionResult {
  if (err instanceof EstimateValidationError) {
    return { ok: false, error: err.message, fieldErrors: err.errors };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: message };
}

/** Allowlist-checks the picker-declared name and shapes it into the
 *  `EstimateActor` the data layer expects. `id` is always null — there is
 *  no auth.users row backing a picker name. Returns null (not a thrown
 *  error) so callers can surface a friendly, uniform message instead of
 *  routing an invalid name through toActionResult's generic Error path. */
function resolveActor(estimatorName: string): EstimateActor | null {
  return isEstimatorName(estimatorName)
    ? { id: null, name: estimatorName }
    : null;
}

/** GHL-first entry identity, carried through from `/estimates/new?ghlOpportunityId=`
 *  (loadPrefillFromOpportunity, @/lib/ghl/prefill) to createEstimateAction —
 *  see that action's doc comment. */
export interface GhlFirstIdentity {
  ghlContactId: string | null;
  ghlOpportunityId: string;
}

/**
 * Creates a version-1 estimate from a draft object. When `ghlIdentity` is
 * supplied (the GHL-first entry point — `/estimates/new?ghlOpportunityId=`
 * — see new/page.tsx), also links the new estimate family to that GHL
 * contact/opportunity via `linkEstimateIdentity` (v2 doc: "Creating the
 * first saved estimate for a linked opportunity ensures it sits at
 * Estimate in Progress"). Linking is best-effort and NON-FATAL to the
 * create — the estimate itself is already committed by the time linking
 * runs, and a link failure (e.g. the opportunity has no contactId, or a
 * transient GHL error) is surfaced as `linkWarning` on the result rather
 * than failing the whole action; the estimator can still link manually
 * later via the detail page's identity panel.
 */
export async function createEstimateAction(
  draft: unknown,
  estimatorName: string,
  ghlIdentity?: GhlFirstIdentity,
): Promise<ActionResult> {
  const actor = resolveActor(estimatorName);
  if (!actor) return { ok: false, error: "Pick who's estimating first." };
  try {
    const estimate = await createEstimate(draft, actor);
    revalidatePath("/estimates");

    let linkWarning: string | undefined;
    if (ghlIdentity) {
      try {
        await linkEstimateIdentity({
          estimateId: estimate.id,
          selection: {
            ghlContactId: ghlIdentity.ghlContactId,
            ghlOpportunityId: ghlIdentity.ghlOpportunityId,
            createContact: false,
            createOpportunity: false,
          },
          linkedByName: actor.name,
        });
      } catch (linkErr) {
        const message = linkErr instanceof Error ? linkErr.message : String(linkErr);
        console.error(`createEstimateAction: GHL-first identity link failed for ${estimate.id}:`, linkErr);
        linkWarning = `Estimate saved, but linking it to the GHL opportunity failed: ${message}`;
      }
    }

    return linkWarning ? { ok: true, estimate, linkWarning } : { ok: true, estimate };
  } catch (err) {
    return toActionResult(err);
  }
}

/** Creates a new version of an existing estimate chain (the "revise" flow — Task 11b). */
export async function newVersionAction(
  parentId: string,
  draft: unknown,
  estimatorName: string,
): Promise<ActionResult> {
  const actor = resolveActor(estimatorName);
  if (!actor) return { ok: false, error: "Pick who's estimating first." };
  try {
    const estimate = await createNewVersion(parentId, draft, actor);
    revalidatePath("/estimates");
    revalidatePath(`/estimates/${parentId}`);
    return { ok: true, estimate };
  } catch (err) {
    return toActionResult(err);
  }
}

const ESTIMATE_STATUSES: readonly EstimateStatus[] = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "superseded",
  "historical",
];

/** Flips an estimate's status (Sent/Accepted/Declined buttons on the detail page). */
export async function updateStatusAction(
  id: string,
  status: string,
  estimatorName: string,
): Promise<ActionResult> {
  const actor = resolveActor(estimatorName);
  if (!actor) return { ok: false, error: "Pick who's estimating first." };

  if (!ESTIMATE_STATUSES.includes(status as EstimateStatus)) {
    return { ok: false, error: `invalid status: ${status}` };
  }

  try {
    const estimate = await updateStatus(id, status as EstimateStatus, actor);
    revalidatePath("/estimates");
    revalidatePath(`/estimates/${id}`);
    return { ok: true, estimate };
  } catch (err) {
    return toActionResult(err);
  }
}

/**
 * Sets (or clears, with quotedPrice=null) an estimate's quoted_price. The
 * UI enforces the override-reason rule before calling this (via
 * validateQuoteOverride against the estimate's known total_bid); repo.ts's
 * updateQuote re-checks it against the live DB row regardless, and the RPC
 * itself is the final backstop.
 */
export async function updateQuoteAction(
  id: string,
  quotedPrice: number | null,
  reason: string | null,
  estimatorName: string,
): Promise<ActionResult> {
  const actor = resolveActor(estimatorName);
  if (!actor) return { ok: false, error: "Pick who's estimating first." };
  try {
    const estimate = await updateQuote(id, quotedPrice, reason, actor);
    revalidatePath("/estimates");
    revalidatePath(`/estimates/${id}`);
    return { ok: true, estimate };
  } catch (err) {
    return toActionResult(err);
  }
}

export type PushActionResult = { ok: true; result: PushResult } | { ok: false; error: string };

/**
 * Pushes one estimate version to GHL (Task 11b's detail-page Push/Retry
 * button). Unlike every other action in this file, this one takes no
 * `estimatorName` — there is no attribution to record (pushEstimateToGhl
 * sources the "Estimator" GHL field from the estimate row's own
 * created_by_name snapshot, per the Task 12 ruling), so there is nothing
 * here for the picker allowlist to gate. The action is still the trust
 * boundary for its one real input, `estimateId` — isValidEstimateId
 * rejects anything that isn't UUID-shaped before it can reach
 * getEstimate()'s query (see lib/estimates/ids.ts's doc comment).
 *
 * Never throws: pushEstimateToGhl's own contract is "no target's
 * try/catch escapes" (see push.ts's module doc comment), and any error
 * that somehow still escapes (e.g. getEstimate() itself failing) is
 * caught here the same way every other action in this file handles it.
 */
export async function pushEstimateAction(estimateId: string): Promise<PushActionResult> {
  if (!isValidEstimateId(estimateId)) {
    return { ok: false, error: "invalid estimate id" };
  }
  try {
    const result = await pushEstimateToGhl(estimateId);
    revalidatePath(`/estimates/${estimateId}`);
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// ============================================================
// Commercial lifecycle actions (Phase 1, v2 Task 2 / Session 2 lane 2d).
// Thin server-action wrappers over @/lib/estimates/commercialLifecycle —
// same allowlist-gate pattern as every mutating action above.
// ============================================================

// Fix round F2: `warning` is set only when the underlying DB write already
// succeeded but a follow-on GHL stage move failed (commercialLifecycle.ts's
// `LifecycleActionOutcome`) — a non-blocking notice, never a failure. Only
// ever present alongside `ok: true`, mirroring `ActionResult`'s
// `linkWarning` above.
export type SimpleActionResult = { ok: true; warning?: string } | { ok: false; error: string };

/** Estimate in Progress -> Quote Sent (detail-page "Present" button). */
export async function presentEstimateAction(
  estimateId: string,
  estimatorName: string,
): Promise<SimpleActionResult> {
  const actor = resolveActor(estimatorName);
  if (!actor) return { ok: false, error: "Pick who's estimating first." };
  if (!isValidEstimateId(estimateId)) return { ok: false, error: "invalid estimate id" };
  try {
    const outcome = await presentEstimate(estimateId, actor.name);
    revalidatePath(`/estimates/${estimateId}`);
    return outcome.warning ? { ok: true, warning: outcome.warning } : { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** -> Quote Accepted (detail-page acceptance form). */
export async function recordEstimateAcceptanceAction(
  input: Omit<RecordAcceptanceInput, "recordedByName">,
  estimatorName: string,
): Promise<SimpleActionResult> {
  const actor = resolveActor(estimatorName);
  if (!actor) return { ok: false, error: "Pick who's estimating first." };
  if (!isValidEstimateId(input.estimateId)) return { ok: false, error: "invalid estimate id" };
  try {
    const outcome = await recordEstimateAcceptance({ ...input, recordedByName: actor.name });
    revalidatePath(`/estimates/${input.estimateId}`);
    return outcome.warning ? { ok: true, warning: outcome.warning } : { ok: true };
  } catch (err) {
    // Handoff #5: surface RecordAcceptanceEventError's classified message
    // as-is (RPC guard conditions are real and permanent, not transient —
    // never suggest a retry here). Any other error falls through to the
    // same generic message shape.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Reverses the current acceptance -> Quote Sent | Closed Lost (Declined).
 *  `estimateId` is the REVERSAL TARGET (fix round F3) — the caller
 *  (CommercialLifecyclePanel) is responsible for passing the family's
 *  `acceptanceState.current_estimate_id`, not necessarily the id of the
 *  version currently being viewed; see `resolveAcceptancePresentation` and
 *  `reverseEstimateAcceptance`'s own doc comment for why. */
export async function reverseEstimateAcceptanceAction(
  estimateId: string,
  destination: "quote_sent" | "closed_lost",
  reason: string,
  estimatorName: string,
): Promise<SimpleActionResult> {
  const actor = resolveActor(estimatorName);
  if (!actor) return { ok: false, error: "Pick who's estimating first." };
  if (!isValidEstimateId(estimateId)) return { ok: false, error: "invalid estimate id" };
  try {
    const outcome = await reverseEstimateAcceptance({ estimateId, destination, reason, recordedByName: actor.name });
    revalidatePath(`/estimates/${estimateId}`);
    return outcome.warning ? { ok: true, warning: outcome.warning } : { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type ContactMatchesActionResult =
  | { ok: true; contacts: GhlContact[] }
  | { ok: false; error: string };

/** App-first identity search (detail page's "Link to GHL" panel) — never
 *  auto-picks, just returns candidates for the estimator to choose from.
 *
 *  Fix round F4: this was the only action in this file with no
 *  `resolveActor` gate — it returns live GHL contact records (name,
 *  email, phone, address) to anyone who could reach the action, no
 *  attribution check at all. Gated the same way every other action here
 *  is, even though a search itself writes nothing — the actions in this
 *  file are the trust boundary in front of the service-role GHL client
 *  (see this file's module doc comment), and that boundary should not
 *  have a read-only exception. */
export async function findContactMatchesAction(
  email: string | null,
  phone: string | null,
  estimatorName: string,
): Promise<ContactMatchesActionResult> {
  const actor = resolveActor(estimatorName);
  if (!actor) return { ok: false, error: "Pick who's estimating first." };
  try {
    const contacts = await findContactMatches({ email, phone });
    return { ok: true, contacts };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface LinkEstimateIdentityActionInput {
  estimateId: string;
  selection: EstimateIdentitySelection;
  contactFields?: ContactCreationFields;
  opportunityName?: string;
}

export type LinkIdentityActionResult =
  | { ok: true }
  | { ok: false; error: string; conflictingEstimateNumber?: number };

/** Persists the estimator's explicit identity selection (or "create new")
 *  to estimate_identity_links — see commercialLifecycle.ts's
 *  linkEstimateIdentity for the conflict/pipeline-mismatch handling this
 *  wraps. */
export async function linkEstimateIdentityAction(
  input: LinkEstimateIdentityActionInput,
  estimatorName: string,
): Promise<LinkIdentityActionResult> {
  const actor = resolveActor(estimatorName);
  if (!actor) return { ok: false, error: "Pick who's estimating first." };
  if (!isValidEstimateId(input.estimateId)) return { ok: false, error: "invalid estimate id" };
  try {
    await linkEstimateIdentity({
      estimateId: input.estimateId,
      selection: input.selection,
      linkedByName: actor.name,
      contactFields: input.contactFields,
      opportunityName: input.opportunityName,
    });
    revalidatePath(`/estimates/${input.estimateId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof EstimateIdentityConflictError) {
      return {
        ok: false,
        error: err.message,
        conflictingEstimateNumber: err.conflictingEstimateNumber ?? undefined,
      };
    }
    if (err instanceof OpportunityPipelineMismatchError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
