// ============================================================
// Lost Boys Demolition — Airtable Jobs → GHL Stage: Job Scheduled
// Supabase Edge Function: airtable-job-scheduled
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const AIRTABLE_BASE_ID     = Deno.env.get('AIRTABLE_BASE_ID')!
const AIRTABLE_API_KEY     = Deno.env.get('AIRTABLE_API_KEY')!
const GHL_API_KEY          = Deno.env.get('GHL_API_KEY')!
const GHL_LOCATION_ID      = Deno.env.get('GHL_LOCATION_ID')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET       = Deno.env.get('AIRTABLE_WEBHOOK_SECRET')!

const AIRTABLE_JOBS_TABLE = 'tbl6WcLuLL0uUcpI1'
const GHL_BASE            = 'https://services.leadconnectorhq.com'

const GHL_AUTH = {
  Authorization: `Bearer ${GHL_API_KEY}`,
  Version: '2021-07-28',
}

const JOB_FIELDS = {
  jobName:          'fldbKNw609rqD97Gi',
  jobNumber:        'fld1ZeDoChO0h9QXO',
  jobAddress:       'fldSmr1YCORDoagb6',
  crew:             'fldkP651iKPZMQ9pe',
  status:           'fldoASoygIp8FpYsd',
  startDate:        'fldOnf1hrnhJNFuRL',
  endDate:          'fldI6lw2qIwgbYE6G',
  ghlOpportunityId: 'fldc2Od8JX3Se1gJN',
}

// ── Cold-start: resolve "Job Scheduled" stage ID ─────────────────────────

let SCHEDULED_STAGE_ID: string | null = null
let STARTUP_ERROR: string | null = null

try {
  const res  = await fetch(
    `${GHL_BASE}/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`,
    { headers: GHL_AUTH }
  )
  const data = await res.json()
  const list     = data.pipelines ?? (Array.isArray(data) ? data : [])
  const pipeline = list.find((p: any) => p.name === 'Job Pipeline')

  if (!pipeline) {
    STARTUP_ERROR = `Pipeline "Job Pipeline" not found. Available: ${list.map((p: any) => p.name).join(', ') || 'none'}`
  } else {
    const stages = pipeline.stages ?? []
    console.log('[startup] Job Pipeline stages:', JSON.stringify(stages.map((s: any) => ({ id: s.id, name: s.name }))))
    const stage = stages.find((s: any) => s.name === 'Job Scheduled')
    if (!stage) {
      STARTUP_ERROR = `Stage "Job Scheduled" not found. Found: ${stages.map((s: any) => s.name).join(', ')}`
    } else {
      SCHEDULED_STAGE_ID = stage.id
      console.log('[startup] Resolved "Job Scheduled" stage ID:', SCHEDULED_STAGE_ID)
    }
  }
} catch (err: any) {
  STARTUP_ERROR = `Pipeline resolution failed: ${err.message ?? String(err)}`
  console.error('[startup]', STARTUP_ERROR)
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function fetchAirtableJob(recordId: string) {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_JOBS_TABLE}/${recordId}?returnFieldsByFieldId=true`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
  )
  const data = await res.json()
  console.log('[airtable] job record:', JSON.stringify(data))
  return data
}

async function moveGhlOpportunityToScheduled(oppId: string) {
  const res = await fetch(`${GHL_BASE}/opportunities/${oppId}`, {
    method: 'PUT',
    headers: { ...GHL_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipelineStageId: SCHEDULED_STAGE_ID }),
  })
  const data = await res.json()
  console.log('[ghl] move opportunity to scheduled response:', JSON.stringify(data))
  return data
}

async function updateAirtableJobStatus(recordId: string, statusValue: string) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_JOBS_TABLE}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [JOB_FIELDS.status]: statusValue } }),
  })
  const data = await res.json()
  console.log('[airtable] update job status response:', JSON.stringify(data))
  return data
}

// ── Main handler ──────────────────────────────────────────────────────────

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

  if (!SCHEDULED_STAGE_ID) {
    const msg = STARTUP_ERROR ?? 'Pipeline stage not resolved — check startup logs'
    console.error('[handler] Aborting:', msg)
    await supabase.from('sync_log').insert({
      direction: 'airtable_to_ghl', trigger_event: 'job_scheduled',
      action_taken: 'error', status: 'error',
      airtable_record_id: airtableRecordId,
      error_message: msg, payload_in: payload,
    })
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 500 })
  }

  let jobRecord: any
  try {
    jobRecord = await fetchAirtableJob(airtableRecordId)
    if (!jobRecord?.fields) throw new Error(`Airtable returned no fields for record ${airtableRecordId}`)
  } catch (err: any) {
    const msg = `Failed to fetch job record: ${err.message ?? String(err)}`
    console.error('[handler]', msg)
    await supabase.from('sync_log').insert({
      direction: 'airtable_to_ghl', trigger_event: 'job_scheduled',
      action_taken: 'error', status: 'error',
      airtable_record_id: airtableRecordId,
      error_message: msg, payload_in: payload,
    })
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 500 })
  }

  const f               = jobRecord.fields
  const jobName         = f[JOB_FIELDS.jobName]    ?? ''
  const jobAddress      = f[JOB_FIELDS.jobAddress]  ?? ''
  const crew            = f[JOB_FIELDS.crew]         ?? ''
  const startDate       = f[JOB_FIELDS.startDate]    ?? ''
  const ghlOpportunityId = f[JOB_FIELDS.ghlOpportunityId] ?? null

  let actionTaken:  string      = 'error'
  let status:       string      = 'success'
  let errorMessage: string|null = null

  try {
    if (!ghlOpportunityId) throw new Error('Job record has no GHL Opportunity ID — cannot move stage')

    await moveGhlOpportunityToScheduled(ghlOpportunityId)
    await updateAirtableJobStatus(airtableRecordId, 'Scheduled')

    // CALENDAR_PLACEHOLDER — pending Google service account setup
    console.log(`CALENDAR_PLACEHOLDER: Would create event for ${jobName} on ${startDate} at ${jobAddress} — pending service account setup`)

    // SLACK_PLACEHOLDER — pending Slack bot token setup
    console.log(`SLACK_PLACEHOLDER: Would notify crew channel for ${crew} — ${jobName} scheduled for ${startDate} — pending bot token setup`)

    actionTaken = 'stage_advanced'

  } catch (err: any) {
    status       = 'error'
    actionTaken  = 'error'
    errorMessage = err.message ?? String(err)
    console.error('[error] airtable-job-scheduled:', errorMessage)
  }

  await supabase.from('sync_log').insert({
    direction:          'airtable_to_ghl',
    trigger_event:      'job_scheduled',
    action_taken:       actionTaken,
    status,
    airtable_record_id: airtableRecordId,
    error_message:      status === 'success'
                          ? (ghlOpportunityId ? `Moved GHL opportunity ${ghlOpportunityId} to Job Scheduled` : null)
                          : errorMessage,
    payload_in:         payload,
  })

  return new Response(
    JSON.stringify({ success: status === 'success', action: actionTaken, ghlOpportunityId }),
    { status: status === 'success' ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
  )
})
