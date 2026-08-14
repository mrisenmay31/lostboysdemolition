// ============================================================
// Lost Boys Demolition — web app — GHL estimate-doc payload builder
//
// Builds the CreateEstimatesDto GHL's Estimates API expects
// (POST/PUT /invoices/estimate, Version: 2021-07-28) from a versioned
// `estimates` row + its `estimate_line_items` children, and provides
// thin API wrappers (create/update/delete/find-by-meta) built on top of
// client.ts's `ghlFetch` — no new fetch logic here.
//
// Task 8's estimates data layer isn't merged yet, so the shapes this
// module consumes (EstimateForDoc / EstimateLineItemForDoc /
// EstimateDocContact) are lightweight structural interfaces describing
// only the snake_case fields this builder reads — not the full DB
// types. The push controller (Task 12) reconciles against the real
// `estimates`/`estimate_line_items` rows at merge; because these
// interfaces are structural (not nominal), any object with matching
// field names — including the real DB row shape — satisfies them
// without adaptation.
//
// Payload shape and the allocation rule are pinned by the Task 10
// brief and live-validated against GHL's real /invoices/estimate
// validator via the one-off spike documented in task-10-report.md.
// ============================================================

import { ghlFetch, listEstimateDocs } from "./client";
import { allocateAmounts } from "./allocation";

// Re-exported for callers/tests that import allocateAmounts from this
// module (its historical home) — see allocation.ts's header for why the
// definition itself moved there in task T9f.
export { allocateAmounts };

// ── Env accessor — lazy, called per-request, never at module scope ──────────
// Duplicated (not imported) from client.ts's private getLocationId(): that
// function isn't exported, and this module stays self-contained rather than
// widening client.ts's public surface for a three-line accessor — consistent
// with the "one function/module per concern, no shared routing logic"
// convention documented in the repo's edge functions.

function getLocationId(): string {
  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) throw new Error("GHL_LOCATION_ID is not set");
  return locationId;
}

// ── Input shapes (structural — see header note) ──────────────────────────

/** The subset of an `estimates` row this builder reads. `labor_rate` and
 *  `dump_rate` are the rate-snapshot columns on the estimate header (not
 *  per-line) — every line item's direct cost is computed against these. */
export interface EstimateForDoc {
  id: string;
  estimate_number: number;
  version: number;
  quoted_price: number | null;
  total_bid: number;
  labor_rate: number;
  dump_rate: number;
  /** Date-only ISO string, e.g. "2026-08-14". */
  estimate_date: string;
  job_name?: string | null;
  job_address?: string | null;
}

/** The subset of an `estimate_line_items` row this builder reads. */
export interface EstimateLineItemForDoc {
  id?: string;
  name: string;
  description?: string | null;
  sort_order: number;
  labor_hours?: number | null;
  dump_count?: number | null;
  materials_cost?: number | null;
}

/** The GHL contact this doc attaches to — all four fields are required by
 *  GHL's `contactDetails`; email/phone missing is checked explicitly below
 *  (callers should pre-flight this, this is the backstop). */
export interface EstimateDocContact {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface BuildEstimateDocOptions {
  /** True when this doc supersedes a prior sent/viewed/accepted/declined
   *  draft that must not be mutated — titles the new doc "ESTIMATE
   *  (REVISED)" instead of "ESTIMATE". */
  isRevision?: boolean;
  /** Rendered into the fallback single line item's description when there
   *  are no line items to allocate across. Defaults to "". */
  jobScopeSummary?: string;
}

// ── Output shape (GHL's CreateEstimatesDto, as validated live) ───────────

export interface EstimateDocItem {
  name: string;
  description: string;
  qty: number;
  amount: number;
  currency: string;
  /** Live-spike finding: required. GHL's validator 500s
   *  ("items.0.type: Path `type` is required") without it. Every real
   *  line item in the 510 live docs the spike inspected uses
   *  "one_time" — the only value this builder ever needs. */
  type: "one_time";
}

export interface CreateEstimatesDto {
  altId: string;
  altType: "location";
  name: string;
  title: string;
  businessDetails: { name: string };
  currency: string;
  items: EstimateDocItem[];
  discount: { type: "percentage"; value: number };
  contactDetails: { id: string; name: string; email: string; phoneNo: string };
  /** Live-spike finding: `schedule` must be `null`, not `{}` — every real
   *  non-recurring doc in the live location stores it that way, and the
   *  spike's successful create used `null`. */
  frequencySettings: { enabled: boolean; schedule: null };
  liveMode: boolean;
  meta: {
    lbd_estimate_id: string;
    lbd_estimate_number: number;
    lbd_version: number;
  };
  issueDate: string;
  expiryDate: string;
}

// ── Allocation — see allocation.ts (moved there by task T9f, re-exported
//    above for existing import paths) ─────────────────────────────────────

function directCost(li: EstimateLineItemForDoc, laborRate: number, dumpRate: number): number {
  return (li.labor_hours ?? 0) * laborRate + (li.dump_count ?? 0) * dumpRate + (li.materials_cost ?? 0);
}

function buildItems(
  estimate: EstimateForDoc,
  lineItems: EstimateLineItemForDoc[],
  docTotal: number,
  jobScopeSummary: string,
): EstimateDocItem[] {
  if (lineItems.length === 0) {
    return [
      {
        name: "Demolition Services",
        description: jobScopeSummary || "",
        qty: 1,
        amount: docTotal,
        currency: "USD",
        type: "one_time",
      },
    ];
  }

  const sorted = [...lineItems].sort((a, b) => a.sort_order - b.sort_order);
  const weights = sorted.map((li) => directCost(li, estimate.labor_rate, estimate.dump_rate));
  const amounts = allocateAmounts(docTotal, weights);

  return sorted.map((li, i) => ({
    name: li.name,
    description: li.description ?? "",
    qty: 1,
    amount: amounts[i],
    currency: "USD",
    type: "one_time",
  }));
}

// ── Date helpers ───────────────────────────────────────────────────────────

/** Adds `days` to a date-only "YYYY-MM-DD" string, returning the same
 *  format. Parses/advances in UTC calendar terms so no local timezone can
 *  shift the date across a midnight boundary. Tolerant of a full ISO
 *  timestamp input (uses just the date portion). */
function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// ── Doc name — GHL's live validator caps this at 40 chars ────────────────
//
// Live-spike finding (see task-10-report.md): GHL's real /invoices/estimate
// validator rejects `name` over 40 characters with a 422
// ("name must be shorter than or equal to 40 characters"). The Task 10
// brief's assumed `Demolition Estimate — ${job_name}` format (22 fixed
// chars of prefix alone) blows that budget for almost any real job name —
// and it doesn't match what the 510 real estimate docs in the live
// location actually use: their `name` field is just the bare job/client
// description (e.g. "Jorge's Interior Demo", "Blue Ridge Builders -
// Interior Demo"), no "Demolition Estimate — " prefix, because the doc's
// `title` field ("ESTIMATE") already says what kind of document it is.
// Adjusted to match: bare job_name/job_address, hard-truncated to 40 chars
// (with a trailing "…" when truncation actually occurs) rather than the
// prefixed form the brief assumed.
const DOC_NAME_MAX_LEN = 40;

function truncateDocName(raw: string): string {
  if (raw.length <= DOC_NAME_MAX_LEN) return raw;
  return `${raw.slice(0, DOC_NAME_MAX_LEN - 1)}…`;
}

// ── Builder ────────────────────────────────────────────────────────────────

/** Pure payload builder — no network calls. Throws if the contact is
 *  missing email or phone (GHL's `contactDetails` requires both; callers
 *  should pre-flight this and treat a throw here as a bug in the caller,
 *  not an expected runtime path). */
export function buildEstimateDocPayload(
  estimate: EstimateForDoc,
  lineItems: EstimateLineItemForDoc[],
  contact: EstimateDocContact,
  options: BuildEstimateDocOptions = {},
): CreateEstimatesDto {
  if (!contact.email) {
    throw new Error(
      `buildEstimateDocPayload: contact ${contact.id} has no email — GHL estimate docs require contactDetails.email`,
    );
  }
  if (!contact.phone) {
    throw new Error(
      `buildEstimateDocPayload: contact ${contact.id} has no phone — GHL estimate docs require contactDetails.phoneNo`,
    );
  }

  const docTotal = estimate.quoted_price ?? estimate.total_bid;
  if (docTotal == null || !Number.isFinite(docTotal)) {
    throw new Error(
      `buildEstimateDocPayload: estimate ${estimate.id} has no usable price — quoted_price and total_bid are both missing/invalid`,
    );
  }
  const items = buildItems(estimate, lineItems, docTotal, options.jobScopeSummary ?? "");

  const issueDate = estimate.estimate_date;
  const expiryDate = addDaysIso(issueDate, 30);

  return {
    altId: getLocationId(),
    altType: "location",
    name: truncateDocName(estimate.job_name || estimate.job_address || `Estimate #${estimate.estimate_number}`),
    title: options.isRevision ? "ESTIMATE (REVISED)" : "ESTIMATE",
    businessDetails: { name: "Lost Boys Demolition" },
    currency: "USD",
    items,
    discount: { type: "percentage", value: 0 },
    contactDetails: {
      id: contact.id,
      name: contact.name ?? "",
      email: contact.email,
      phoneNo: contact.phone,
    },
    frequencySettings: { enabled: false, schedule: null },
    liveMode: true,
    meta: {
      lbd_estimate_id: estimate.id,
      lbd_estimate_number: estimate.estimate_number,
      lbd_version: estimate.version,
    },
    issueDate,
    expiryDate,
  };
}

// ── API wrappers — thin, built on ghlFetch ────────────────────────────────

export interface EstimateDocResult {
  id: string;
  estimateNumber: string | null;
  raw: unknown;
}

/** Defensive extraction mirroring client.ts's extractContactId/
 *  extractOpportunityId pattern — GHL's estimate-doc responses have been
 *  seen to wrap the doc directly at the top level or under `estimate`. */
function extractEstimateDocResult(data: unknown): EstimateDocResult {
  const d = data as
    | { _id?: string; id?: string; estimateNumber?: string; estimate?: { _id?: string; id?: string; estimateNumber?: string } }
    | null
    | undefined;
  const id = d?._id ?? d?.id ?? d?.estimate?._id ?? d?.estimate?.id ?? null;
  const estimateNumber = d?.estimateNumber ?? d?.estimate?.estimateNumber ?? null;
  if (!id) {
    throw new Error(`GHL estimate doc response had no id. Response: ${JSON.stringify(data)}`);
  }
  return { id, estimateNumber, raw: data };
}

/** POST /invoices/estimate — creates a draft estimate doc (GHL drafts by
 *  default; sending is a separate action this module never calls). */
export async function createEstimateDoc(payload: CreateEstimatesDto): Promise<EstimateDocResult> {
  const { data } = await ghlFetch("/invoices/estimate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return extractEstimateDocResult(data);
}

/** PUT /invoices/estimate/{id} — full-replace update. */
export async function updateEstimateDoc(id: string, payload: CreateEstimatesDto): Promise<EstimateDocResult> {
  const { data } = await ghlFetch(`/invoices/estimate/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return extractEstimateDocResult(data);
}

/** DELETE /invoices/estimate/{id} — GHL's delete endpoint takes
 *  altId/altType in the body, same as the list/create endpoints. */
export async function deleteEstimateDoc(id: string): Promise<void> {
  await ghlFetch(`/invoices/estimate/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ altId: getLocationId(), altType: "location" }),
  });
}

interface GhlEstimateDocListItem {
  _id?: string;
  id?: string;
  estimateNumber?: string;
  status?: string;
  contactId?: string;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Create-then-crash recovery lookup: lists this contact's estimate docs
 *  (`listEstimateDocs` from client.ts — no new fetch logic) and returns
 *  the one whose `meta` breadcrumb matches, or null if none does.
 *  Confirmed live response shape (task-9 report):
 *  `{ estimates: [...], total, traceId }`.
 *
 *  Live-spike finding: GHL round-trips `meta` keys CAMEL-CASED — a doc
 *  created with `meta: { lbd_estimate_id: "..." }` comes back (on both
 *  the create response and every subsequent list/get) as
 *  `meta: { lbdEstimateId: "..." }`. This lookup matches on the
 *  camelCase key GHL actually returns, not the snake_case key this
 *  module sends on create. */
export async function findDocByMeta(
  contactId: string,
  lbdEstimateId: string,
): Promise<EstimateDocResult | null> {
  const data = await listEstimateDocs({ contactId });
  const d = data as { estimates?: GhlEstimateDocListItem[] } | GhlEstimateDocListItem[] | null;
  const list = (Array.isArray(d) ? d : d?.estimates ?? []) as GhlEstimateDocListItem[];

  const match = list.find((item) => item.meta?.lbdEstimateId === lbdEstimateId);
  if (!match) return null;

  const id = match._id ?? match.id ?? null;
  if (!id) return null;
  return { id, estimateNumber: match.estimateNumber ?? null, raw: match };
}
