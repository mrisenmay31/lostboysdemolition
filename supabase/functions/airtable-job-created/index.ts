// ============================================================
// Lost Boys Demolition — Airtable Jobs → GHL Opportunity Sync
// Supabase Edge Function: airtable-job-created
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const AIRTABLE_BASE_ID     = Deno.env.get('AIRTABLE_BASE_ID')!
const AIRTABLE_API_KEY     = Deno.env.get('AIRTABLE_API_KEY')!
const GHL_API_KEY          = Deno.env.get('GHL_API_KEY')!
const GHL_LOCATION_ID      = Deno.env.get('GHL_LOCATION_ID')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET       = Deno.env.get('AIRTABLE_WEBHOOK_SECRET')!

const AIRTABLE_JOBS_TABLE    = 'tbl6WcLuLL0uUcpI1'
const AIRTABLE_CLIENTS_TABLE = 'tblSJkwDdupKzsst7'
const GHL_BASE               = 'https://services.leadconnectorhq.com'

const GHL_AUTH = {
  Authorization: `Bearer ${GHL_API_KEY}`,
  Version: '2021-07-28',
}

// ── Airtable field IDs — Jobs table ──────────────────────────────────────────

const JOB_FIELDS = {
  // Core
  jobName:              'fldbKNw609rqD97Gi',
  jobNumber:            'fld1ZeDoChO0h9QXO',  // autoNumber integer
  airtableJobId:        'fldNrP1Z8Ngcsyarz',  // formula → "JOB-1042"
  jobAddress:           'fldSmr1YCORDoagb6',
  jobType:              'fldc1zsXLZTY9fBQm',
  totalBid:             'fldazwdB2mw4Zh0n1',
  estimator:            'fldyyF2DeUFX15sXx',
  readyToSchedule:      'fldG5aRScQOqUXuVE',  // owned by airtable-job-scheduled
  clientLink:           'fldzu6hA8zr9Hjbfz',
  ghlOpportunityId:     'fldc2Od8JX3Se1gJN',
  // Estimate
  estimatedLaborHours:  'fld6Wxf2aFXLi8FEg',
  estimatedLaborCost:   'fldduPjuhcSKbubdn',
  estimatedDumpFees:    'fldkk0jYAocHCeWIX',
  estimatedOverhead:    'flddTODdKQqqiKpMc',
  estimatedProfit:      'fld8qD8jNqeUyA4PQ',
  estimatedProfitMargin:'fldZQOEFLwSyAdHrK',  // formula → percent decimal
  // Future fields — fill in Airtable field ID when the field is created in Airtable
  engagementType:       '',  // TBD — singleSelect: Contractor Job, Homeowner Direct, Subcontract Work
  estimatedMaterials:   '',  // TBD — currency
  jobScope:             '',  // TBD — multiSelect (19 scope options)
  scopeNotes:           '',  // TBD — multilineText
} as const

// ── GHL custom field IDs (from field_mapping.md) ─────────────────────────────

const GHL_CUSTOM_FIELDS = {
  airtableJobId:        'Gtl6ADpbBGOlYYFil4n6',
  airtableRecordId:     'gAcQY14qFpZFPz4bDmii',
  jobAddress:           '4pjFIkOmQFpqZ5bOBI9z',
  jobType:              'Jfb2jEzxdtHY9vhC8Zhj',
  estimator:            '8YGC8Oy2TlRDOSZpN3Mo',
  estimatedLaborHours:  'sN6l01lwT6G8JUBPisDQ',
  estimatedLaborCost:   'KVlUHcvcTtkO3IKlkaJS',
  estimatedDumpFees:    'VgxdlrbEYNsIYCtuuZn3',
  estimatedOverhead:    'be36GDi35Gk6Ji5hUN5Y',
  estimatedProfit:      'zGtPySCTptCicEU51RSZ',
  estimatedProfitMargin:'5u484IDWnOrMGkjC7eoe',
  engagementType:       'MPaRtiCr5OYLmTYEraVz',
  estimatedMaterials:   'XGz8SzkyU0jAx6blrT9t',
  jobScope:             'lm91PNb2dNB2g0GPoUuU',
  scopeNotes:           'PdNTCRzIpYi3IANr71eh',
} as const

const CLIENT_FIELDS = {
  ghlContactId: 'fldC4zAieX10BVacc',
}

// ── Cold-start: resolve pipeline and user IDs ─────────────────────────────────

interface PipelineCache {
  pipelineId:                string
  estimateInProgressStageId: string
}

interface UserCache {
  matt:    string | null
  dane:    string | null
  jackson: string | null
}

let PIPELINE: PipelineCache | null = null
let USERS: UserCache = { matt: null, dane: null, jackson: null }
let STARTUP_ERROR: string | null = null

try {
  const pipelineRes  = await fetch(
    `${GHL_BASE}/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`,
    { headers: GHL_AUTH }
  )
  const pipelineData = await pipelineRes.json()
  console.log('[startup] GHL pipelines response:', JSON.stringify(pipelineData))

  const list     = pipelineData.pipelines ?? (Array.isArray(pipelineData) ? pipelineData : [])
  const pipeline = list.find((p: any) => p.name === 'Job Pipeline')

  if (!pipeline) {
    STARTUP_ERROR = `Pipeline "Job Pipeline" not found. Available: ${list.map((p: any) => p.name).join(', ') || 'none'}`
    console.error('[startup]', STARTUP_ERROR)
  } else {
    const stages        = pipeline.stages ?? []
    const estimateStage = stages.find((s: any) => s.name === 'Estimate in Progress')
    console.log('[startup] Job Pipeline stages:', JSON.stringify(stages.map((s: any) => ({ id: s.id, name: s.name }))))

    if (!estimateStage) {
      STARTUP_ERROR = `Stage "Estimate in Progress" not found. Found: ${stages.map((s: any) => s.name).join(', ')}`
      console.error('[startup]', STARTUP_ERROR)
    } else {
      PIPELINE = {
        pipelineId:                pipeline.id,
        estimateInProgressStageId: estimateStage.id,
      }
      console.log('[startup] Resolved pipeline:', JSON.stringify(PIPELINE))
    }
  }
} catch (err: any) {
  STARTUP_ERROR = `Pipeline resolution failed: ${err.message ?? String(err)}`
  console.error('[startup]', STARTUP_ERROR)
}

try {
  const usersRes  = await fetch(`${GHL_BASE}/users?locationId=${GHL_LOCATION_ID}`, { headers: GHL_AUTH })
  const usersData = await usersRes.json()
  const users     = usersData.users ?? []
  console.log('[startup] GHL users:', JSON.stringify(users.map((u: any) => ({ id: u.id, email: u.email }))))
  const find = (email: string) => users.find((u: any) => u.email === email)?.id ?? null
  const adminUser = users.find((u: any) =>
    u.roles?.role === 'admin' || u.roles?.type === 'account' || u.type === 'account'
  )
  USERS = {
    matt:    adminUser?.id ?? null,
    dane:    find('dane@lostboysdemolition.com'),
    jackson: find('jackson@lostboysdemolition.com'),
  }
  console.log('[startup] Resolved users:', JSON.stringify(USERS))
} catch (err: any) {
  console.error('[startup] User resolution failed:', err.message ?? String(err))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function num(v: any): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = parseFloat(String(v))
  return isNaN(n) ? undefined : n
}

function buildCustomFields(f: Record<string, any>, airtableRecordId: string): Array<{ id: string; field_value: any }> {
  const out: Array<{ id: string; field_value: any }> = []

  function push(ghlId: string, value: any) {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value) && value.length === 0) return
    out.push({ id: ghlId, field_value: value })
  }

  // Integration
  push(GHL_CUSTOM_FIELDS.airtableJobId,    f[JOB_FIELDS.airtableJobId])
  push(GHL_CUSTOM_FIELDS.airtableRecordId, airtableRecordId)

  // Job info
  push(GHL_CUSTOM_FIELDS.jobAddress, f[JOB_FIELDS.jobAddress])
  push(GHL_CUSTOM_FIELDS.jobType,    f[JOB_FIELDS.jobType])
  push(GHL_CUSTOM_FIELDS.estimator,  f[JOB_FIELDS.estimator])

  // Estimate
  push(GHL_CUSTOM_FIELDS.estimatedLaborHours,   num(f[JOB_FIELDS.estimatedLaborHours]))
  push(GHL_CUSTOM_FIELDS.estimatedLaborCost,    num(f[JOB_FIELDS.estimatedLaborCost]))
  push(GHL_CUSTOM_FIELDS.estimatedDumpFees,     num(f[JOB_FIELDS.estimatedDumpFees]))
  push(GHL_CUSTOM_FIELDS.estimatedOverhead,     num(f[JOB_FIELDS.estimatedOverhead]))
  push(GHL_CUSTOM_FIELDS.estimatedProfit,       num(f[JOB_FIELDS.estimatedProfit]))
  push(GHL_CUSTOM_FIELDS.estimatedProfitMargin, num(f[JOB_FIELDS.estimatedProfitMargin]))

  // Future-slot fields — uncomment the JOB_FIELDS entry when the Airtable field is created
  if (JOB_FIELDS.engagementType)     push(GHL_CUSTOM_FIELDS.engagementType,    f[JOB_FIELDS.engagementType])
  if (JOB_FIELDS.estimatedMaterials) push(GHL_CUSTOM_FIELDS.estimatedMaterials, num(f[JOB_FIELDS.estimatedMaterials]))
  if (JOB_FIELDS.jobScope)           push(GHL_CUSTOM_FIELDS.jobScope,          f[JOB_FIELDS.jobScope])
  if (JOB_FIELDS.scopeNotes)         push(GHL_CUSTOM_FIELDS.scopeNotes,        f[JOB_FIELDS.scopeNotes])

  return out
}

async function fetchAirtableJob(recordId: string) {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_JOBS_TABLE}/${recordId}?returnFieldsByFieldId=true`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
  )
  const data = await res.json()
  console.log('[airtable] job record:', JSON.stringify(data))
  return data
}

async function fetchAirtableClient(recordId: string) {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENTS_TABLE}/${recordId}?returnFieldsByFieldId=true`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
  )
  const data = await res.json()
  console.log('[airtable] client record:', JSON.stringify(data))
  return data
}

async function searchGhlOpportunity(contactId: string, airtableJobId: string): Promise<any | null> {
  const res  = await fetch(
    `${GHL_BASE}/opportunities/search?contact_id=${contactId}&location_id=${GHL_LOCATION_ID}`,
    { headers: GHL_AUTH }
  )
  const data = await res.json()
  const opps = data.opportunities ?? []
  return opps.find((o: any) =>
    (o.customFields ?? o.custom_fields ?? []).some((cf: any) => {
      const matchValue = cf.field_value === airtableJobId
      const matchId    = cf.id === GHL_CUSTOM_FIELDS.airtableJobId || cf.fieldId === GHL_CUSTOM_FIELDS.airtableJobId
      const matchKey   = cf.key === 'job_id' || cf.fieldKey === 'job_id'
      return matchValue && (matchId || matchKey)
    })
  ) ?? null
}

async function createGhlOpportunity(body: Record<string, any>) {
  const res = await fetch(`${GHL_BASE}/opportunities/`, {
    method: 'POST',
    headers: { ...GHL_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function updateGhlOpportunity(id: string, body: Record<string, any>) {
  const res = await fetch(`${GHL_BASE}/opportunities/${id}`, {
    method: 'PUT',
    headers: { ...GHL_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function writeOpportunityIdToAirtable(recordId: string, oppId: string) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_JOBS_TABLE}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [JOB_FIELDS.ghlOpportunityId]: oppId } }),
  })
  const data = await res.json()
  console.log('[airtable] write opportunity ID response:', JSON.stringify(data))
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const incomingSecret = req.headers.get('x-webhook-secret')
  if (incomingSecret !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  let payload: any
  try { payload = await req.json() }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }) }

  const airtableRecordId = payload.recordId
  if (!airtableRecordId) {
    return new Response(JSON.stringify({ error: 'Missing recordId' }), { status: 400 })
  }

  if (!PIPELINE) {
    const msg = STARTUP_ERROR ?? 'Pipeline not resolved — check startup logs'
    console.error('[handler] Aborting: pipeline not ready.', msg)
    try {
      await supabase.from('job_events').insert({
        job_id: airtableRecordId, stage_from: null, stage_to: 3,
        function_name: 'airtable-job-created', trigger_source: 'airtable_automation',
        action_summary: 'Aborted — pipeline not resolved at cold start',
        status: 'error', error_message: msg, payload_in: payload,
      })
    } catch (e: any) { console.error('[job_events] insert failed:', e.message) }
    await supabase.from('sync_log').insert({
      direction: 'airtable_to_ghl', trigger_event: 'job_created',
      action_taken: 'error', status: 'error',
      airtable_record_id: airtableRecordId,
      error_message: msg, payload_in: payload,
    })
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  let jobRecord: any
  try {
    jobRecord = await fetchAirtableJob(airtableRecordId)
    if (!jobRecord?.fields) throw new Error(`Airtable returned no fields for record ${airtableRecordId}`)
  } catch (err: any) {
    const msg = `Failed to fetch job record: ${err.message ?? String(err)}`
    console.error('[handler]', msg)
    try {
      await supabase.from('job_events').insert({
        job_id: airtableRecordId, stage_from: null, stage_to: 3,
        function_name: 'airtable-job-created', trigger_source: 'airtable_automation',
        action_summary: 'Aborted — Airtable fetch failed',
        status: 'error', error_message: msg, payload_in: payload,
      })
    } catch (e: any) { console.error('[job_events] insert failed:', e.message) }
    await supabase.from('sync_log').insert({
      direction: 'airtable_to_ghl', trigger_event: 'job_created',
      action_taken: 'error', status: 'error',
      airtable_record_id: airtableRecordId,
      error_message: msg, payload_in: payload,
    })
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 500 })
  }

  const f = jobRecord.fields

  const jobName               = f[JOB_FIELDS.jobName] ?? ''
  const jobId                 = f[JOB_FIELDS.airtableJobId] ?? null   // "JOB-1042" from formula
  const totalBid              = parseFloat(f[JOB_FIELDS.totalBid]) || 0
  const estimator             = f[JOB_FIELDS.estimator] ?? ''
  const clientLinks           = f[JOB_FIELDS.clientLink] ?? []
  const clientRecordId        = Array.isArray(clientLinks)
    ? (clientLinks[0]?.id ?? clientLinks[0])
    : null
  const existingGhlOpportunityId = f[JOB_FIELDS.ghlOpportunityId] ?? null

  let actionTaken:      string      = 'error'
  let status:           string      = 'success'
  let errorMessage:     string|null = null
  let ghlOpportunityId: string|null = null

  try {
    if (!clientRecordId) throw new Error('No linked Client record in payload')

    const clientRecord = await fetchAirtableClient(clientRecordId)
    const ghlContactId = clientRecord.fields?.[CLIENT_FIELDS.ghlContactId]

    if (!ghlContactId) {
      console.warn(`[warn] Client ${clientRecordId} has no GHL Contact ID — skipping`)
      try {
        await supabase.from('job_events').insert({
          job_id: airtableRecordId, job_number: jobId, stage_from: null, stage_to: 3,
          function_name: 'airtable-job-created', trigger_source: 'airtable_automation',
          action_summary: 'Skipped — client missing GHL Contact ID',
          status: 'success', error_message: null, payload_in: payload,
        })
      } catch (e: any) { console.error('[job_events] insert failed:', e.message) }
      await supabase.from('sync_log').insert({
        direction: 'airtable_to_ghl', trigger_event: 'job_created',
        action_taken: 'skipped', status: 'success',
        airtable_record_id: airtableRecordId,
        error_message: 'Client has no GHL Contact ID — opportunity not created',
        payload_in: payload,
      })
      return new Response(
        JSON.stringify({ success: true, action: 'skipped', reason: 'Client missing GHL Contact ID' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const assignedTo = estimator === 'Matt'    ? USERS.matt
                     : estimator === 'Dane'    ? USERS.dane
                     : estimator === 'Jackson' ? USERS.jackson
                     : null

    const oppBody: Record<string, any> = {
      name:            jobName,
      status:          'open',
      pipelineId:      PIPELINE.pipelineId,
      pipelineStageId: PIPELINE.estimateInProgressStageId,
      contactId:       ghlContactId,
      monetaryValue:   totalBid,
      locationId:      GHL_LOCATION_ID,
      customFields:    buildCustomFields(f, airtableRecordId),
    }
    if (assignedTo) oppBody.assignedTo = assignedTo

    console.log('[info] GHL customFields being sent:', JSON.stringify(oppBody.customFields))

    if (existingGhlOpportunityId) {
      console.log(`[info] Existing GHL Opportunity ID found on Airtable record: ${existingGhlOpportunityId}`)
      const updated    = await updateGhlOpportunity(existingGhlOpportunityId, oppBody)
      ghlOpportunityId = updated.opportunity?.id ?? updated.id ?? existingGhlOpportunityId
      actionTaken      = 'opportunity_updated'
      console.log(`[info] Updated GHL opportunity ${ghlOpportunityId} for ${jobId}`)
    } else {
      const existing = jobId ? await searchGhlOpportunity(ghlContactId, jobId) : null

      if (existing) {
        const updated    = await updateGhlOpportunity(existing.id, oppBody)
        ghlOpportunityId = updated.opportunity?.id ?? updated.id ?? existing.id
        actionTaken      = 'opportunity_updated'
        console.log(`[info] Found existing GHL opportunity via search: ${ghlOpportunityId} for ${jobId}`)
      } else {
        const created    = await createGhlOpportunity(oppBody)
        console.log('[info] GHL create response:', JSON.stringify(created))
        ghlOpportunityId = created.opportunity?.id ?? created.id
        if (!ghlOpportunityId) {
          throw new Error(`GHL opportunity create returned no ID. Response: ${JSON.stringify(created)}`)
        }
        actionTaken = 'opportunity_created'
        console.log(`[info] Created GHL opportunity ${ghlOpportunityId} for ${jobId}`)
      }
    }

    if (ghlOpportunityId && airtableRecordId) {
      await writeOpportunityIdToAirtable(airtableRecordId, ghlOpportunityId)
    }

  } catch (err: any) {
    status       = 'error'
    actionTaken  = 'error'
    errorMessage = err.message ?? String(err)
    console.error('[error] airtable-job-created:', errorMessage)
  }

  try {
    await supabase.from('job_events').insert({
      job_id:             airtableRecordId,
      job_number:         jobId,
      stage_from:         null,
      stage_to:           3,
      function_name:      'airtable-job-created',
      trigger_source:     'airtable_automation',
      ghl_opportunity_id: ghlOpportunityId,
      action_summary:     status === 'success'
                            ? `GHL opportunity ${actionTaken} with estimate fields`
                            : 'GHL opportunity create/update failed',
      status,
      error_message:      status === 'success' ? null : errorMessage,
      payload_in:         payload,
    })
  } catch (e: any) { console.error('[job_events] insert failed:', e.message) }

  await supabase.from('sync_log').insert({
    direction:          'airtable_to_ghl',
    trigger_event:      'job_created',
    action_taken:       actionTaken,
    status,
    airtable_record_id: airtableRecordId ?? null,
    error_message:      status === 'success'
                          ? (ghlOpportunityId ? `GHL Opportunity ID: ${ghlOpportunityId}` : null)
                          : errorMessage,
    payload_in:         payload,
  })

  return new Response(
    JSON.stringify({ success: status === 'success', action: actionTaken, ghlOpportunityId }),
    { status: status === 'success' ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
  )
})
