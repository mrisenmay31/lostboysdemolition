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

const GOOGLE_SERVICE_ACCOUNT_KEY = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY') ?? ''
const GOOGLE_CALENDAR_MAIN       = Deno.env.get('GOOGLE_CALENDAR_MAIN')        ?? ''
const GOOGLE_CALENDAR_CREW1      = Deno.env.get('GOOGLE_CALENDAR_CREW1')       ?? ''
const GOOGLE_CALENDAR_CREW2      = Deno.env.get('GOOGLE_CALENDAR_CREW2')       ?? ''
const GOOGLE_CALENDAR_CREW3      = Deno.env.get('GOOGLE_CALENDAR_CREW3')       ?? ''
const GOOGLE_CALENDAR_CREW4      = Deno.env.get('GOOGLE_CALENDAR_CREW4')       ?? ''

const AIRTABLE_JOBS_TABLE       = 'tbl6WcLuLL0uUcpI1'
const AIRTABLE_CLIENTS_TABLE    = 'tblSJkwDdupKzsst7'
const AIRTABLE_LINE_ITEMS_TABLE = 'tblTwK8K0HkyluBec'
const GHL_BASE                  = 'https://services.leadconnectorhq.com'

const GHL_AUTH = {
  Authorization: `Bearer ${GHL_API_KEY}`,
  Version: '2021-07-28',
}

const JOB_FIELDS = {
  jobName:             'fldbKNw609rqD97Gi',
  jobNumber:           'fld1ZeDoChO0h9QXO',
  jobAddress:          'fldSmr1YCORDoagb6',
  crew:                'fldkP651iKPZMQ9pe',
  status:              'fldoASoygIp8FpYsd',
  startDate:           'fldOnf1hrnhJNFuRL',
  endDate:             'fldI6lw2qIwgbYE6G',
  jobStartTime:        'fld5ROFJNTb36WixD',
  ghlOpportunityId:    'fldc2Od8JX3Se1gJN',
  clientLink:          'fldzu6hA8zr9Hjbfz',
  invoiceLineItems:    'fldD6xumylrVQEVMo',
  finalEstimatedPrice: 'fldO4T2ChPZgL2kCZ',
  gcalEventId:         'fldry3k8ZNGGbm1aJ',
}

const CLIENT_FIELDS = {
  clientName:  'fldyIBidorXegZFHf',
  phone:       'fldzROwSsF7IoYYqN',
  email:       'fldMVOoOV9TRdUAyC',
  clientType:  'fldJoDlrTMUu99YQw',
}

const LINE_ITEM_FIELDS = {
  name:        'fldva3wLkKqJD7t7r',
  description: 'fldWGM7wIVac7rxEy',
  amount:      'fldR0cBZlSC25CXhq',
  sortOrder:   'fld5kCTH3LByLIFT8',
}

// Airtable crew single-select value → Google Calendar env var (lowercase + trimmed)
const CREW_CALENDAR_MAP: Record<string, string> = {
  'crew 1': GOOGLE_CALENDAR_CREW1,
  'crew 2': GOOGLE_CALENDAR_CREW2,
  'crew 3': GOOGLE_CALENDAR_CREW3,
  'crew 4': GOOGLE_CALENDAR_CREW4,
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

// ── Helpers ───────────────────────────────────────────────────────────────

async function fetchAirtableRecord(tableId: string, recordId: string) {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}/${recordId}?returnFieldsByFieldId=true`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
  )
  const data = await res.json()
  console.log(`[airtable] fetch ${tableId}/${recordId}:`, JSON.stringify(data))
  if (!res.ok || data.error) throw new Error(`Airtable GET failed: ${JSON.stringify(data)}`)
  return data
}

async function patchAirtableRecord(tableId: string, recordId: string, fields: Record<string, any>) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  const data = await res.json()
  console.log(`[airtable] patch ${tableId}/${recordId}:`, JSON.stringify(data))
  if (!res.ok || data.error) throw new Error(`Airtable PATCH failed: ${JSON.stringify(data)}`)
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

// ── Google Calendar auth helpers ──────────────────────────────────────────

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function base64urlEncode(input: string | ArrayBuffer): string {
  let bytes: Uint8Array
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input)
  } else {
    bytes = new Uint8Array(input)
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson)
  // replace any double-escaped newlines that survive JSON paste into Supabase env
  const privateKey  = sa.private_key.replace(/\\n/g, '\n')
  const clientEmail = sa.client_email

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // 30s backdating guards against clock skew between Supabase edge runtime and Google
  const now    = Math.floor(Date.now() / 1000) - 30
  const header = base64urlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64urlEncode(JSON.stringify({
    iss:   clientEmail,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }))
  const signingInput = `${header}.${claims}`

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  )
  const jwt = `${signingInput}.${base64urlEncode(signature)}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    throw new Error(`Google token exchange failed: ${JSON.stringify(tokenData)}`)
  }
  return tokenData.access_token
}

async function createCalendarEvent(calendarId: string, accessToken: string, eventBody: any): Promise<any> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(`Calendar event create failed (${res.status}): ${JSON.stringify(data)}`)
  return data
}

// Google Calendar all-day end dates are exclusive — add 1 day to the actual end
function addOneDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + 1)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function formatCurrency(amount: number): string {
  return `$${(Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function buildEventDescription(opts: {
  clientName:       string
  estimatedRevenue: number
  crew:             string
  jobAddress:       string
  jobStartTime:     string
  clientPhone:      string
  clientType:       string
  lineItems:        Array<{ name: string; description: string; amount: number }>
}): string {
  const lines: string[] = [
    `Name of Client: ${opts.clientName    || '—'}`,
    `Estimated Revenue: ${formatCurrency(opts.estimatedRevenue)}`,
    `Crew: ${opts.crew                    || '—'}`,
    `Address: ${opts.jobAddress           || '—'}`,
    `Job Start Time: ${opts.jobStartTime  || '—'}`,
    `Phone Number: ${opts.clientPhone     || '—'}`,
    `Client Type: ${opts.clientType       || '—'}`,
    '',
    'JOB SCOPE',
  ]
  if (opts.lineItems.length === 0) {
    lines.push('(no line items on record)')
  } else {
    for (const li of opts.lineItems) {
      const desc = li.description ? ` — ${li.description}` : ''
      lines.push(`${li.name}${desc} (${formatCurrency(li.amount)})`)
    }
  }
  return lines.join('\n')
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
    jobRecord = await fetchAirtableRecord(AIRTABLE_JOBS_TABLE, airtableRecordId)
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

  const f                    = jobRecord.fields
  const jobName              = f[JOB_FIELDS.jobName]              ?? ''
  const jobAddress           = f[JOB_FIELDS.jobAddress]           ?? ''
  const crew                 = f[JOB_FIELDS.crew]                 ?? ''
  const startDate            = String(f[JOB_FIELDS.startDate]     ?? '').slice(0, 10)
  const endDate              = String(f[JOB_FIELDS.endDate]       ?? '').slice(0, 10)
  const jobStartTime         = f[JOB_FIELDS.jobStartTime]         ?? ''
  const ghlOpportunityId     = f[JOB_FIELDS.ghlOpportunityId]     ?? null
  const existingCalEventId   = f[JOB_FIELDS.gcalEventId]          ?? null
  const finalEstimatedPrice  = parseFloat(f[JOB_FIELDS.finalEstimatedPrice]) || 0
  const lineItemIds: string[] = (f[JOB_FIELDS.invoiceLineItems] ?? [])
    .map((x: any) => (typeof x === 'string' ? x : x?.id))
    .filter(Boolean)
  const clientLinks: any[]   = f[JOB_FIELDS.clientLink] ?? []
  const clientRecordId       = Array.isArray(clientLinks)
    ? (clientLinks[0]?.id ?? clientLinks[0])
    : null

  let actionTaken:    string      = 'error'
  let status:         string      = 'success'
  let errorMessage:   string|null = null
  let calendarStatus: string      = 'skipped'
  let calendarError:  string|null = null
  let mainEventId:    string|null = null

  try {
    if (!ghlOpportunityId) throw new Error('Job record has no GHL Opportunity ID — cannot move stage')

    await moveGhlOpportunityToScheduled(ghlOpportunityId)
    await patchAirtableRecord(AIRTABLE_JOBS_TABLE, airtableRecordId, {
      [JOB_FIELDS.status]: 'Scheduled',
    })

    actionTaken = 'updated'

    // ── Google Calendar (non-fatal) ────────────────────────────────────────
    if (!GOOGLE_SERVICE_ACCOUNT_KEY || !GOOGLE_CALENDAR_MAIN) {
      console.log('[calendar] Skipping — GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_CALENDAR_MAIN not configured')
    } else if (existingCalEventId) {
      console.log('[calendar] Skipping — event already exists:', existingCalEventId)
      calendarStatus = 'already_exists'
    } else if (!startDate) {
      console.warn('[calendar] Skipping — no Start Date on job')
    } else {
      try {
        // Fetch client (non-fatal — event still creates without client info)
        let clientName  = ''
        let clientPhone = ''
        let clientType  = ''
        if (clientRecordId) {
          try {
            const clientData = await fetchAirtableRecord(AIRTABLE_CLIENTS_TABLE, clientRecordId)
            const cf = clientData?.fields ?? {}
            clientName  = cf[CLIENT_FIELDS.clientName] ?? ''
            clientPhone = cf[CLIENT_FIELDS.phone]       ?? ''
            clientType  = cf[CLIENT_FIELDS.clientType]  ?? ''
          } catch (err: any) {
            console.warn('[calendar] Failed to fetch client (non-fatal):', err.message)
          }
        }

        // Fetch all line items — no include-on-invoice filter, crew needs full scope
        const lineItems: Array<{ name: string; description: string; amount: number; sortOrder: number }> = []
        for (const liId of lineItemIds) {
          try {
            const li = await fetchAirtableRecord(AIRTABLE_LINE_ITEMS_TABLE, liId)
            const lf = li?.fields ?? {}
            lineItems.push({
              name:        lf[LINE_ITEM_FIELDS.name]        ?? 'Line Item',
              description: lf[LINE_ITEM_FIELDS.description] ?? '',
              amount:      parseFloat(lf[LINE_ITEM_FIELDS.amount])   || 0,
              sortOrder:   typeof lf[LINE_ITEM_FIELDS.sortOrder] === 'number'
                             ? lf[LINE_ITEM_FIELDS.sortOrder]
                             : Number.MAX_SAFE_INTEGER,
            })
          } catch (err: any) {
            console.warn(`[calendar] Failed to fetch line item ${liId} (non-fatal):`, err.message)
          }
        }
        lineItems.sort((a, b) => a.sortOrder - b.sortOrder)

        const description = buildEventDescription({
          clientName,
          estimatedRevenue: finalEstimatedPrice,
          crew,
          jobAddress,
          jobStartTime,
          clientPhone,
          clientType,
          lineItems,
        })

        // End date: fall back to single-day if not set; Google requires exclusive end
        const effectiveEnd = endDate || startDate
        const exclusiveEnd = addOneDay(effectiveEnd)

        const eventBody = {
          summary:     jobName,
          description,
          start: { date: startDate },
          end:   { date: exclusiveEnd },
        }

        const accessToken = await getGoogleAccessToken(GOOGLE_SERVICE_ACCOUNT_KEY)

        // Build calendar target list: always main, plus crew calendar if mapped
        const crewKey       = crew.trim().toLowerCase()
        const crewCalendarId = CREW_CALENDAR_MAP[crewKey] ?? ''
        if (crew && !crewCalendarId) {
          console.warn(`[calendar] No crew calendar mapped for crew value: "${crew}" — posting to main only`)
        }

        const calendarTargets: Array<{ label: string; calendarId: string }> = [
          { label: 'main', calendarId: GOOGLE_CALENDAR_MAIN },
        ]
        if (crewCalendarId) {
          calendarTargets.push({ label: `crew (${crew})`, calendarId: crewCalendarId })
        }

        const results = await Promise.allSettled(
          calendarTargets.map(t => createCalendarEvent(t.calendarId, accessToken, eventBody))
        )

        const calendarErrors: string[] = []
        results.forEach((r, i) => {
          const t = calendarTargets[i]
          if (r.status === 'fulfilled') {
            console.log(`[calendar] ${t.label} event created: ${r.value.id}`)
            if (t.label === 'main') mainEventId = r.value.id
          } else {
            const msg = `${t.label} FAILED: ${r.reason?.message ?? String(r.reason)}`
            console.error('[calendar]', msg)
            calendarErrors.push(msg)
          }
        })

        // Write main event ID back to Airtable (idempotency anchor for future runs)
        if (mainEventId) {
          await patchAirtableRecord(AIRTABLE_JOBS_TABLE, airtableRecordId, {
            [JOB_FIELDS.gcalEventId]: mainEventId,
          })
        }

        calendarStatus = calendarErrors.length === 0
          ? 'success'
          : (mainEventId ? 'partial' : 'failed')

        if (calendarErrors.length > 0) {
          calendarError = calendarErrors.join('; ')
          console.warn('[calendar] errors:', calendarError)
        }

      } catch (err: any) {
        calendarStatus = 'failed'
        calendarError  = err.message ?? String(err)
        console.error('[calendar] Non-fatal error:', calendarError)
      }
    }

    // Write to job_events audit log
    const jobEventsResult = await supabase.from('job_events').insert({
      job_id:             airtableRecordId,
      job_number:         f[JOB_FIELDS.jobNumber] ?? null,
      stage_from:         5,
      stage_to:           6,
      function_name:      'airtable-job-scheduled',
      trigger_source:     'airtable_automation',
      ghl_opportunity_id: ghlOpportunityId,
      action_summary:     `Job "${jobName}" advanced to Job Scheduled | calendar: ${calendarStatus}${mainEventId ? ` (${mainEventId})` : ''}`,
      status:             'success',
      error_message:      null,
      payload_in:         payload,
    })
    if (jobEventsResult.error) {
      console.error('[job_events] insert failed:', JSON.stringify(jobEventsResult.error))
    }

    // SLACK_PLACEHOLDER — pending Slack bot token setup
    console.log(`SLACK_PLACEHOLDER: Would notify crew channel for ${crew} — ${jobName} scheduled for ${startDate} — pending bot token setup`)

  } catch (err: any) {
    status       = 'error'
    actionTaken  = 'error'
    errorMessage = err.message ?? String(err)
    console.error('[error] airtable-job-scheduled:', errorMessage)
  }

  try {
    const { error: slErr } = await supabase.from('sync_log').insert({
      direction:          'airtable_to_ghl',
      trigger_event:      'job_scheduled',
      action_taken:       actionTaken,
      status,
      airtable_record_id: airtableRecordId,
      error_message:      status === 'success'
                            ? `GHL opp ${ghlOpportunityId} → Job Scheduled | calendar: ${calendarStatus}${mainEventId ? ` (${mainEventId})` : ''}${calendarError ? ` | calErr: ${calendarError}` : ''}`
                            : errorMessage,
      payload_in:         payload,
    })
    if (slErr) console.error('[sync_log] insert failed:', JSON.stringify(slErr))
  } catch (slErr: any) {
    console.error('[sync_log] insert threw:', slErr.message ?? String(slErr))
  }

  return new Response(
    JSON.stringify({
      success:        status === 'success',
      action:         actionTaken,
      ghlOpportunityId,
      calendarStatus,
      mainEventId,
    }),
    { status: status === 'success' ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
  )
})
