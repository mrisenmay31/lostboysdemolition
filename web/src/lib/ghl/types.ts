// ============================================================
// Lost Boys Demolition — web app — GHL API types
//
// Deliberately loose: GHL's public API returns several shapes across
// endpoints/versions for the same conceptual object (see
// GhlCustomFieldRead below). Fields here document what this client reads
// or writes, not a full GHL schema.
// ============================================================

/** A GHL custom-field entry as read back from opportunities/contacts —
 *  tolerant of the `id`/`fieldId` and `field_value`/`fieldValue`/`value`
 *  shape drift seen across GHL API versions and webhook payloads. */
export interface GhlCustomFieldRead {
  id?: string;
  fieldId?: string;
  field_value?: unknown;
  fieldValue?: unknown;
  value?: unknown;
  [key: string]: unknown;
}

/** A GHL custom-field entry as sent on create/update — GHL's write shape
 *  is `{id, field_value}`, unlike the several read shapes above. */
export interface GhlCustomFieldWrite {
  id: string;
  field_value: unknown;
}

export interface GhlContact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  tags?: string[] | string | null;
  [key: string]: unknown;
}

export interface GhlOpportunity {
  id: string;
  name?: string;
  contactId?: string;
  monetaryValue?: number;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: string;
  assignedTo?: string;
  customFields?: GhlCustomFieldRead[];
  custom_fields?: GhlCustomFieldRead[];
  [key: string]: unknown;
}

export interface OpportunityUpdatePayload {
  name?: string;
  monetaryValue?: number;
  customFields?: GhlCustomFieldWrite[];
  [key: string]: unknown;
}

export interface GhlPipelineStage {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface GhlPipeline {
  id: string;
  name: string;
  stages?: GhlPipelineStage[];
  [key: string]: unknown;
}

export interface PipelineResolution {
  pipelineId: string;
  estimateInProgressStageId: string;
}

export interface GhlCustomFieldDef {
  id: string;
  name?: string;
  fieldKey?: string;
  dataType?: string;
  model?: string;
  picklistOptions?: string[];
  [key: string]: unknown;
}

export interface ListEstimateDocsParams {
  contactId?: string;
  limit?: number;
  offset?: number;
}
