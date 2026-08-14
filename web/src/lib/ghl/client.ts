import "server-only";

// ============================================================
// Lost Boys Demolition — web app — GHL API client
//
// Ported from the fetch/auth patterns already live in the Deno edge
// functions (ghl-job-webhook/index.ts + handlers.ts, airtable-job-created/
// index.ts, airtable-client-sync/index.ts) — same base URL, same
// `Version: 2021-07-28` header, same res.ok-throws-status+body wrapper
// style, same tolerant custom-field reading, same case-insensitive
// substring pipeline-stage match, same duplicate-contact 400 handling.
//
// Env vars (GHL_API_KEY, GHL_LOCATION_ID) are read lazily, inside
// functions — never at module top level — so this module has zero
// side effects at import time beyond the `server-only` guard below.
//
// `server-only` IS imported here (task T9f, 2026-08-14) — the parallel-lane
// package.json contention that deferred it during Task 9 is long resolved.
// This throws a build-time error if any client component tries to import
// this module, same guard as push.ts/log.ts; vitest stubs the package (see
// client.test.ts's `vi.mock("server-only", ...)`, same pattern as
// log.test.ts). One consequence: estimateFields.ts declares itself pure/
// server-only-free but imported this module's buildCustomFieldsPayload, so
// that one pure helper moved to estimateFields.ts (its only caller) to
// keep that module transitively guard-free — see estimateFields.ts's
// header. Everything else here is unchanged.
// ============================================================

import type {
  GhlCustomFieldDef,
  GhlCustomFieldRead,
  GhlContact,
  GhlOpportunity,
  ListEstimateDocsParams,
  OpportunityUpdatePayload,
  PipelineResolution,
} from "./types";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const RETRY_DELAY_MS = 2000;

const JOB_PIPELINE_NAME = "Job Pipeline";
const ESTIMATE_STAGE_SUBSTRING = "estimate in progress";

// ── Env accessors — lazy, called per-request, never at module scope ──────────

function getApiKey(): string {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) throw new Error("GHL_API_KEY is not set");
  return apiKey;
}

function getLocationId(): string {
  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) throw new Error("GHL_LOCATION_ID is not set");
  return locationId;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    Version: GHL_VERSION,
  };
}

// ── Errors ─────────────────────────────────────────────────────────────────

/** Thrown when GHL responds with a non-ok HTTP status. Carries the status
 *  and parsed (or raw-text) response body so callers needing to inspect
 *  it — e.g. createContact's duplicate-400 path — don't have to re-fetch
 *  or re-parse anything. */
export class GhlApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "GhlApiError";
    this.status = status;
    this.body = body;
  }
}

/** Thrown when `fetch` itself rejects (DNS failure, connection reset,
 *  timeout, etc.) — distinct from GhlApiError so the retry predicate can
 *  tell "GHL responded with an error" apart from "we couldn't reach GHL
 *  at all". */
export class GhlNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhlNetworkError";
  }
}

// ── Retry predicate — pure, exported for unit testing ────────────────────────

export interface RetryDecisionInput {
  networkError: boolean;
  status?: number;
}

/** Retry-once policy: network errors and 429/5xx responses are retryable;
 *  every other 4xx is not (never retry on a client error like a plain
 *  400/401/404 — retrying won't fix a malformed request or bad auth). */
export function shouldRetry({ networkError, status }: RetryDecisionInput): boolean {
  if (networkError) return true;
  if (typeof status !== "number") return false;
  return status === 429 || status >= 500;
}

function classifyError(err: unknown): RetryDecisionInput {
  if (err instanceof GhlApiError) return { networkError: false, status: err.status };
  return { networkError: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface GhlFetchResult {
  status: number;
  data: unknown;
}

async function performGhlFetch(
  path: string,
  init: RequestInit,
  headers: Record<string, string>,
): Promise<GhlFetchResult> {
  const url = path.startsWith("http") ? path : `${GHL_BASE}${path}`;

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (err) {
    throw new GhlNetworkError(
      `GHL network error for ${init.method ?? "GET"} ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const data = await parseBody(res);

  if (!res.ok) {
    throw new GhlApiError(
      `GHL request failed (${res.status}) for ${init.method ?? "GET"} ${path}: ${JSON.stringify(data)}`,
      res.status,
      data,
    );
  }

  return { status: res.status, data };
}

/** Core HTTP wrapper: throws GhlApiError (status+body) on a non-ok
 *  response, GhlNetworkError if fetch itself fails, and retries the
 *  request exactly once — after a 2s delay — when the failure is
 *  retryable per `shouldRetry` (429, 5xx, or a network error). A plain
 *  4xx (400/401/404/etc.) is never retried. */
export async function ghlFetch(path: string, init: RequestInit = {}): Promise<GhlFetchResult> {
  // Config errors (a missing GHL_API_KEY) must throw immediately, before any
  // retry logic — consistent with how a missing GHL_LOCATION_ID already
  // behaves (every caller reads it via getLocationId() before invoking
  // ghlFetch at all, so it never enters the retry path either). Building the
  // auth headers here, ahead of the try/catch below, rather than inside
  // performGhlFetch's own try block, is what makes that true: a plain config
  // Error now propagates straight to the caller instead of getting wrapped
  // as a GhlNetworkError and retried after a pointless 2s delay (review
  // finding I1).
  const headers: Record<string, string> = {
    ...authHeaders(),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    // Every caller in this module passes a plain object (or nothing) for
    // `init.headers`, never a Headers instance or a string[][] tuple list —
    // narrow the wider HeadersInit type accordingly so this stays a plain
    // Record<string, string> merge, same runtime behavior as before this
    // was hoisted out of the inline object literal fetch() used to accept.
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };

  try {
    return await performGhlFetch(path, init, headers);
  } catch (err) {
    if (!shouldRetry(classifyError(err))) throw err;
    await sleep(RETRY_DELAY_MS);
    return performGhlFetch(path, init, headers);
  }
}

// ── Tolerant custom-field reading (mirrors ghl-job-webhook/handlers.ts's
//    getCustomFieldValue) ─────────────────────────────────────────────────

/** Looks up a GHL custom field value by field ID, tolerant of the several
 *  shapes GHL's API uses for custom fields across read/write payloads:
 *  `id` or `fieldId` for the key, `field_value`/`fieldValue`/`value` for
 *  the payload. */
export function getCustomFieldValue(
  customFields: GhlCustomFieldRead[] | null | undefined,
  fieldId: string,
): unknown {
  if (!Array.isArray(customFields)) return undefined;
  const match = customFields.find((cf) => cf?.id === fieldId || cf?.fieldId === fieldId);
  if (!match) return undefined;
  return match.field_value ?? match.fieldValue ?? match.value ?? undefined;
}

// ── Contacts ───────────────────────────────────────────────────────────────

export function extractContactId(data: unknown): string | null {
  const d = data as { contact?: { id?: string }; id?: string } | null | undefined;
  return d?.contact?.id ?? d?.id ?? null;
}

/** POST /contacts/search — returns the first matching contact, or null if
 *  none exists.
 *
 *  FIXED 2026-08-14 (task T9f). The original implementation called
 *  `GET /contacts/?locationId=...&email=...`, which the live GHL API
 *  rejects with a 422 (`"property email should not exist"`) — that query
 *  shape is no longer accepted (first found during Task 12's live E2E; see
 *  push.ts's resolveContact comment for the workaround that shipped
 *  instead of blocking on this file). Live-probed three replacement
 *  shapes against the real API (2026-08-14): `GET /contacts/?locationId&
 *  query=` returns 200 with a correct result but does a general-purpose
 *  text search, not an email-scoped one; `GET /contacts/lookup?email=`
 *  400s outright; `POST /contacts/search` with a structured
 *  `filters: [{ field: "email", operator: "eq", value }]` returns 200 with
 *  an exact, email-scoped match (empty `contacts: []` for a nonexistent
 *  email, one result for a real one) — this is GHL's documented
 *  contacts-search endpoint and the only one of the three that can't
 *  return a false-positive substring match, so it's the shape used here. */
export async function searchContactByEmail(email: string): Promise<GhlContact | null> {
  const { data } = await ghlFetch("/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      locationId: getLocationId(),
      filters: [{ field: "email", operator: "eq", value: email }],
      page: 1,
      pageLimit: 10,
    }),
  });
  const contacts = (data as { contacts?: GhlContact[] } | null)?.contacts ?? [];
  return contacts[0] ?? null;
}

/** POST /contacts/ — on a plain success, returns the new contact's id. On
 *  a 400 where GHL blocks the create as a duplicate (returning
 *  `meta.contactId`), returns that existing contact's id instead of
 *  throwing — mirrors airtable-client-sync/index.ts's duplicate handling. */
export async function createContact(fields: Record<string, unknown>): Promise<string> {
  try {
    const { data } = await ghlFetch("/contacts/", {
      method: "POST",
      body: JSON.stringify({ locationId: getLocationId(), ...fields }),
    });
    const id = extractContactId(data);
    if (!id) throw new Error(`GHL contact create returned no ID. Response: ${JSON.stringify(data)}`);
    return id;
  } catch (err) {
    if (err instanceof GhlApiError && err.status === 400) {
      const meta = (err.body as { meta?: { contactId?: string } } | null)?.meta;
      if (meta?.contactId) return meta.contactId;
    }
    throw err;
  }
}

// ── Pipeline resolution — cached per process ──────────────────────────────

/** Case-insensitive substring match against live GHL stage names — mirrors
 *  ghl-job-webhook/handlers.ts's findStageId (a May 2026 error log showed
 *  combined stage names like "Deposit Received/Job Scheduled"). */
export function findStageIdBySubstring(
  stages: Array<{ id: string; name: string }>,
  substring: string,
): string | null {
  const needle = substring.toLowerCase();
  const match = stages.find((s) => (s?.name ?? "").toLowerCase().includes(needle));
  return match ? match.id : null;
}

let pipelineCache: Promise<PipelineResolution> | null = null;

async function resolvePipelineUncached(): Promise<PipelineResolution> {
  const { data } = await ghlFetch(`/opportunities/pipelines?locationId=${getLocationId()}`);
  const d = data as { pipelines?: unknown } | unknown[] | null;
  const list = (Array.isArray(d) ? d : (d as { pipelines?: unknown })?.pipelines ?? []) as Array<{
    id: string;
    name: string;
    stages?: Array<{ id: string; name: string }>;
  }>;

  const pipeline = list.find((p) => p.name === JOB_PIPELINE_NAME);
  if (!pipeline) {
    throw new Error(
      `GHL pipeline "${JOB_PIPELINE_NAME}" not found. Available: ${list.map((p) => p.name).join(", ") || "none"}`,
    );
  }

  const stages = pipeline.stages ?? [];
  const stageId = findStageIdBySubstring(stages, ESTIMATE_STAGE_SUBSTRING);
  if (!stageId) {
    throw new Error(
      `GHL stage matching "${ESTIMATE_STAGE_SUBSTRING}" not found in pipeline "${JOB_PIPELINE_NAME}". ` +
        `Found: ${stages.map((s) => s.name).join(", ") || "none"}`,
    );
  }

  return { pipelineId: pipeline.id, estimateInProgressStageId: stageId };
}

/** Resolves the "Job Pipeline" pipeline ID and its "Estimate in Progress"
 *  stage ID (case-insensitive substring match). Cached per process — this
 *  is resolution caching, not secrets caching, same rationale as the
 *  cold-start pipeline resolve in ghl-job-webhook/index.ts and
 *  airtable-job-created/index.ts, just deferred to first call instead of
 *  module load (Next.js server functions don't get a persistent
 *  Deno-style cold start to hang state off of). A failed resolution is
 *  NOT cached, so the next call retries cleanly. */
export function resolvePipeline(): Promise<PipelineResolution> {
  if (!pipelineCache) {
    pipelineCache = resolvePipelineUncached().catch((err) => {
      pipelineCache = null;
      throw err;
    });
  }
  return pipelineCache;
}

/** Test-only escape hatch — clears the module-level pipeline cache. */
export function __resetPipelineCacheForTests(): void {
  pipelineCache = null;
}

// ── Opportunities ──────────────────────────────────────────────────────────

export function extractOpportunityId(data: unknown): string | null {
  const d = data as { opportunity?: { id?: string }; id?: string } | null | undefined;
  return d?.opportunity?.id ?? d?.id ?? null;
}

/** POST /opportunities/ (trailing slash — GHL rejects the bare path on
 *  this endpoint, same as airtable-job-created's createGhlOpportunity). */
export async function createOpportunity(body: Record<string, unknown>): Promise<string> {
  const { data } = await ghlFetch("/opportunities/", {
    method: "POST",
    body: JSON.stringify({ locationId: getLocationId(), ...body }),
  });
  const id = extractOpportunityId(data);
  if (!id) throw new Error(`GHL opportunity create returned no ID. Response: ${JSON.stringify(data)}`);
  return id;
}

/** PUT /opportunities/{id} — partial update; typically `{name,
 *  monetaryValue, customFields}`. */
export async function updateOpportunity(id: string, partial: OpportunityUpdatePayload): Promise<unknown> {
  const { data } = await ghlFetch(`/opportunities/${id}`, {
    method: "PUT",
    body: JSON.stringify(partial),
  });
  return data;
}

/** GET /opportunities/search?contact_id=...&location_id=... — snake_case
 *  query params, unlike every other endpoint in this client (contacts/
 *  pipelines use `locationId`). This is the exact live-verified shape
 *  already shipped in airtable-job-created/index.ts's searchGhlOpportunity
 *  — reused here (as a full list rather than pre-filtered by a specific
 *  field match) for the estimate push's search-before-create idempotency
 *  check. Returns [] on an empty/malformed response rather than throwing,
 *  same tolerant-parse style as resolvePipelineUncached. */
export async function searchOpportunitiesByContact(contactId: string): Promise<GhlOpportunity[]> {
  const qs = new URLSearchParams({ contact_id: contactId, location_id: getLocationId() });
  const { data } = await ghlFetch(`/opportunities/search?${qs.toString()}`);
  const d = data as { opportunities?: GhlOpportunity[] } | GhlOpportunity[] | null;
  return (Array.isArray(d) ? d : (d?.opportunities ?? [])) as GhlOpportunity[];
}

// ── Custom field definitions — cached per process ─────────────────────────

let customFieldDefsCache: Promise<GhlCustomFieldDef[]> | null = null;

async function getCustomFieldDefsUncached(): Promise<GhlCustomFieldDef[]> {
  const { data } = await ghlFetch(`/locations/${getLocationId()}/customFields?model=opportunity`);
  const d = data as { customFields?: GhlCustomFieldDef[] } | GhlCustomFieldDef[] | null;
  return (Array.isArray(d) ? d : (d as { customFields?: GhlCustomFieldDef[] })?.customFields ?? []) as GhlCustomFieldDef[];
}

/** GET /locations/{locationId}/customFields?model=opportunity — used for
 *  Job Scope option matching by the estimate push module. NOTE: live data
 *  shows `picklistOptions` is an array of option VALUES (e.g. "Kitchen
 *  Demo"), not option IDs — match on the value string, don't hunt for an
 *  id that doesn't exist on this shape (review finding M2). Cached per
 *  process, same rationale as resolvePipeline. */
export function getCustomFieldDefs(): Promise<GhlCustomFieldDef[]> {
  if (!customFieldDefsCache) {
    customFieldDefsCache = getCustomFieldDefsUncached().catch((err) => {
      customFieldDefsCache = null;
      throw err;
    });
  }
  return customFieldDefsCache;
}

/** Test-only escape hatch — clears the module-level custom-field-defs cache. */
export function __resetCustomFieldDefsCacheForTests(): void {
  customFieldDefsCache = null;
}

// ── Estimate docs (also the live scope smoke test target) ────────────────

/** GET /invoices/estimate/list?altId=<locationId>&altType=location&limit=
 *  &offset=&contactId= — this is ALSO the live scope smoke test: a 200
 *  means the "invoices.readonly"/estimates scope is granted (doc push is
 *  GO); a 401/403 means it isn't yet (Manual Setup #1 — the estimate push
 *  module runs fields-only until Matt adds the scope). */
export async function listEstimateDocs(params: ListEstimateDocsParams = {}): Promise<unknown> {
  const { contactId, limit = 10, offset = 0 } = params;
  const qs = new URLSearchParams({
    altId: getLocationId(),
    altType: "location",
    limit: String(limit),
    offset: String(offset),
  });
  if (contactId) qs.set("contactId", contactId);
  const { data } = await ghlFetch(`/invoices/estimate/list?${qs.toString()}`);
  return data;
}
