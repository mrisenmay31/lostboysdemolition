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

// Set this to the Airtable field ID for "Schedule Job Link" once the formula field is live.
// While empty, the value is skipped and a placeholder is logged instead.
const FIELD_SCHEDULE_LINK = ''

const JOB_FIELDS = {
  jobName:          'fldbKNw609rqD97Gi',
  jobNumber:        'fld1ZeDoChO0h9QXO',
  jobAddress:       'fldSmr1YCORDoagb6',
  jobType:          'fldc1zsXLZTY9fBQm',
  totalBid:         'fldazwdB2mw4Zh0n1',
  estimator:        'fldyyF2DeUFX15sXx',
  readyToSchedule:  'fldG5aRScQOqUXuVE',
  clientLink:       'fldzu6hA8zr9Hjbfz',
  ghlOpportunityId: 'fldc2Od8JX3Se1gJN',
}

const CLIENT_FIELDS = {
  ghlContactId: 'fldC4zAieX10BVacc',
}

// ── Cold-start: resolve pipeline and user IDs ─────────────────────────────

interface PipelineCache {
  pipelineId:       string
  quoteStageId:     string
  scheduledStageId: string
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
    STARTUP_ERROR = `Pipeline "Job Pipeline" not found. Available pipelines: ${list.map((p: any) => p.name).join(', ') || 'none'}`
    console.error('[startup]', STARTUP_ERROR)
  } else {
    const stages         = pipeline.stages ?? []
    const quoteStage     = stages.find((s: any) => s.name === 'Quote Sent')
    const scheduledStage = stages.find((s: any) => s.name === 'Job Scheduled')
    console.log('[startup] Job Pipeline stages:', JSON.stringify(stages.map((s: any) => ({ id: s.id, name: s.name }))))

    if (!quoteStage || !scheduledStage) {
      STARTUP_ERROR = `Missing stage(s). Found: ${stages.map((s: any) => s.name).join(', ')}. Need: "Quote Sent", "Job Scheduled"`
      console.error('[startup]', STARTUP_ERROR)
    } else {
      PIPELINE = {
        pipelineId:       pipeline.id,
        quoteStageId:     quoteStage.id,
        scheduledStageId: scheduledStage.id,
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

// ── Helpers ─────────────────────────────────────────────────────────────

function formatJobNumber(n: number | string): string {
  return `JOB-${String(n).padStart(4, '0')}`
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

async function searchGhlOpportunity(contactId: string, jobNumber: string): Promise<any | null> {
  const res  = await fetch(
    `${GHL_BASE}/opportunities/search?contact_id=${contactId}&location_id=${GHL_LOCATION_ID}`,
    { headers: GHL_AUTH }
  )
  const data = await res.json()
  const opps = data.opportunities ?? []
  return opps.find((o: any) =>
    (o.customFields ?? o.custom_fields ?? []).some(
      (f: any) => (f.key === 'job_id' || f.fieldKey === 'job_id') && f.field_value === jobNumber
    )
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

// ── Main handler ─────────────────────────────────────────────────────────────

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
    await supabase.from('sync_log').insert({
      direction: 'airtable_to_ghl', trigger_event: 'job_created',
      action_taken: 'error', status: 'error',
      airtable_record_id: airtableRecordId,
      error_message: msg, payload_in: payload,
    })
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 500 })
  }

  const f = jobRecord.fields

  const jobName         = f[JOB_FIELDS.jobName] ?? ''
  const jobNumberRaw    = f[JOB_FIELDS.jobNumber]
  const jobNumber       = jobNumberRaw != null ? formatJobNumber(jobNumberRaw) : null
  const jobAddress      = f[JOB_FIELDS.jobAddress] ?? ''
  const jobType         = f[JOB_FIELDS.jobType] ?? ''
  const totalBid        = parseFloat(f[JOB_FIELDS.totalBid]) || 0
  const estimator       = f[JOB_FIELDS.estimator] ?? ''
  const readyToSchedule = f[JOB_FIELDS.readyToSchedule] ?? ''
  const clientLinks     = f[JOB_FIELDS.clientLink] ?? []
  const clientRecordId  = Array.isArray(clientLinks)
    ? (clientLinks[0]?.id ?? clientLinks[0])
    : null
  const scheduleJobLink = FIELD_SCHEDULE_LINK ? (f[FIELD_SCHEDULE_LINK] ?? '') : ''

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

    const stageId    = readyToSchedule === 'Yes' ? PIPELINE.scheduledStageId : PIPELINE.quoteStageId
    const assignedTo = estimator === 'Matt' ? USERS.matt
                     : estimator === 'Dane' ? USERS.dane
                     : estimator === 'Jackson' ? USERS.jackson
                     : null

    const oppBody: Record<string, any> = {
      name:            jobName,
      status:          'open',
      pipelineId:      PIPELINE.pipelineId,
      pipelineStageId: stageId,
      contactId:       ghlContactId,
      monetaryValue:   totalBid,
      locationId:      GHL_LOCATION_ID,
      customFields: [
        { key: 'job_id',      field_value: jobNumber   ?? '' },
        { key: 'job_address', field_value: jobAddress },
        { key: 'job_type',    field_value: jobType },
      ],
    }
    if (FIELD_SCHEDULE_LINK && scheduleJobLink) {
      oppBody.customFields.push({ key: 'schedule_job_link', field_value: scheduleJobLink })
    } else if (!FIELD_SCHEDULE_LINK) {
      console.log('SCHEDULE_LINK_PLACEHOLDER: field ID not yet configured')
    }
    if (assignedTo) oppBody.assignedTo = assignedTo

    const existing = jobNumber ? await searchGhlOpportunity(ghlContactId, jobNumber) : null

    if (existing) {
      const updated    = await updateGhlOpportunity(existing.id, oppBody)
      ghlOpportunityId = updated.opportunity?.id ?? updated.id ?? existing.id
      actionTaken      = 'opportunity_updated'
      console.log(`[info] Updated GHL opportunity ${ghlOpportunityId} for ${jobNumber}`)
    } else {
      const created    = await createGhlOpportunity(oppBody)
      console.log('[info] GHL create response:', JSON.stringify(created))
      ghlOpportunityId = created.opportunity?.id ?? created.id
      if (!ghlOpportunityId) {
        throw new Error(`GHL opportunity create returned no ID. Response: ${JSON.stringify(created)}`)
      }
      actionTaken = 'opportunity_created'
      console.log(`[info] Created GHL opportunity ${ghlOpportunityId} for ${jobNumber}`)
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
