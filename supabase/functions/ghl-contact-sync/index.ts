// ============================================================
// Lost Boys Demolition — GHL to Airtable Client Sync
// Supabase Edge Function: ghl-contact-sync
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const AIRTABLE_BASE_ID    = Deno.env.get('AIRTABLE_BASE_ID')!
const AIRTABLE_API_KEY    = Deno.env.get('AIRTABLE_API_KEY')!
const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET      = Deno.env.get('GHL_WEBHOOK_SECRET')!

const AIRTABLE_CLIENTS_TABLE = 'tblSJkwDdupKzsst7'

const FIELDS = {
  // clientName (fldyIBidorXegZFHf) is a formula field — do not write to it
  firstName:    'fld6jXXgXUEWEvW0H',
  lastName:     'fldng2X0AGhTnxrex',
  clientType:   'fldJoDlrTMUu99YQw',
  companyName:  'fldxc5LB2eKwEuSTX',
  contactName:  'fldI5frhZxRY16DgS',
  email:        'fldMVOoOV9TRdUAyC',
  phone:        'fldzROwSsF7IoYYqN',
  address:      'flduZxnUCTtHJA7rX',
  city:         'fldzZjHtd0GjGva2L',
  state:        'fldtQwUkBuMYQU2Eq',
  zip:          'fldtTY6m3aAvi2CX6',
  ghlContactId: 'fldC4zAieX10BVacc',
  ghlCompanyId: 'fldd3U0I423OVOJER',
}

async function searchAirtableByEmail(email: string) {
  const formula = encodeURIComponent(`{${FIELDS.email}} = "${email}"`)
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENTS_TABLE}?filterByFormula=${formula}&maxRecords=1`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } })
  const data = await res.json()
  return data.records?.[0] ?? null
}

async function searchAirtableByGhlId(ghlContactId: string) {
  const formula = encodeURIComponent(`{${FIELDS.ghlContactId}} = "${ghlContactId}"`)
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENTS_TABLE}?filterByFormula=${formula}&maxRecords=1`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } })
  const data = await res.json()
  return data.records?.[0] ?? null
}

async function createAirtableClient(fields: Record<string, string>) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENTS_TABLE}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  })
  return res.json()
}

async function updateAirtableClient(recordId: string, fields: Record<string, string>) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENTS_TABLE}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  })
  return res.json()
}

function resolveClientType(tags: string[]): string | null {
  if (!tags || tags.length === 0) return null
  const lower = tags.map(t => String(t).toLowerCase())
  if (lower.includes('contractor')) return 'Contractor'
  if (lower.includes('homeowner'))  return 'Homeowner'
  return null
}

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const incomingSecret = req.headers.get('x-webhook-secret')
  if (incomingSecret !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  let payload: any
  try { payload = await req.json() }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }) }

  let triggerEvent: any = 'contact_updated'
  let ghlContactId: any = undefined
  let email: any = undefined
  let clientType: string | null = null

  let matchMethod: string = 'none'
  let actionTaken: string = 'error'
  let airtableRecordId: string | null = null
  let status = 'success'
  let errorMessage: string | null = null

  try {
    triggerEvent = payload.type ?? 'contact_updated'
    ghlContactId = payload.contact_id
    email        = payload.email?.toLowerCase()?.trim()
    const firstName    = payload.first_name ?? ''
    const lastName     = payload.last_name ?? ''
    const clientName   = `${firstName} ${lastName}`.trim() || email
    const phone        = payload.phone ?? ''
    const companyName  = payload.company_name ?? ''
    const ghlCompanyId = payload.company_id ?? ''
    const rawTags = payload.tags
    const tags: string[] = Array.isArray(rawTags)
      ? rawTags.map((t: unknown) => String(t))
      : typeof rawTags === 'string'
        ? rawTags.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0)
        : []
    clientType   = resolveClientType(tags)

    const address = payload.location?.address ?? payload.full_address ?? ''
    const city    = payload.location?.city ?? ''
    const state   = payload.location?.state ?? payload.state ?? ''
    const zip     = payload.location?.postalCode ?? payload.postal_code ?? ''

    const airtableFields: Record<string, string> = {
      [FIELDS.ghlContactId]: ghlContactId,
    }
    if (firstName)    airtableFields[FIELDS.firstName]    = firstName
    if (lastName)     airtableFields[FIELDS.lastName]     = lastName
    if (email)        airtableFields[FIELDS.email]        = email
    if (phone)        airtableFields[FIELDS.phone]        = phone
    if (companyName)  airtableFields[FIELDS.companyName]  = companyName
    if (ghlCompanyId) airtableFields[FIELDS.ghlCompanyId] = ghlCompanyId
    if (clientType)   airtableFields[FIELDS.clientType]   = clientType
    if (address)      airtableFields[FIELDS.address]      = address
    if (city)         airtableFields[FIELDS.city]         = city
    if (state)        airtableFields[FIELDS.state]        = state
    if (zip)          airtableFields[FIELDS.zip]          = zip

    let existingRecord = await searchAirtableByGhlId(ghlContactId)
    if (existingRecord) {
      matchMethod = 'ghl_contact_id'
      airtableRecordId = existingRecord.id
      await updateAirtableClient(existingRecord.id, airtableFields)
      actionTaken = 'updated'
    } else if (email) {
      existingRecord = await searchAirtableByEmail(email)
      if (existingRecord) {
        matchMethod = 'email'
        airtableRecordId = existingRecord.id
        await updateAirtableClient(existingRecord.id, airtableFields)
        actionTaken = 'updated'
      } else {
        matchMethod = 'none'
        const created = await createAirtableClient(airtableFields)
        if (!created.id) {
          throw new Error(
            created.error?.message
              ? `Airtable create failed: ${created.error.message}`
              : 'Airtable create returned no record ID'
          )
        }
        airtableRecordId = created.id
        actionTaken = 'created'
      }
    } else {
      actionTaken = 'skipped'
      errorMessage = 'No email or GHL Contact ID available for matching'
    }

    await supabase.from('client_sync_state').upsert({
      email:              email ?? `no-email-${ghlContactId}`,
      airtable_record_id: airtableRecordId,
      ghl_contact_id:     ghlContactId,
      ghl_company_id:     ghlCompanyId || null,
      client_name:        clientName,
      client_type:        clientType,
      last_synced_at:     new Date().toISOString(),
      last_direction:     'ghl_to_airtable',
    }, { onConflict: 'email', ignoreDuplicates: false })

  } catch (err: any) {
    status = 'error'
    actionTaken = 'error'
    errorMessage = err.message ?? String(err)
  }

  await supabase.from('sync_log').insert({
    direction: 'ghl_to_airtable', trigger_event: triggerEvent,
    email: email ?? null, match_method: matchMethod,
    airtable_record_id: airtableRecordId, ghl_contact_id: ghlContactId ?? null,
    action_taken: actionTaken, status, error_message: errorMessage, payload_in: payload,
  })

  return new Response(
    JSON.stringify({ success: status === 'success', action: actionTaken, airtableRecordId }),
    { status: status === 'success' ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
  )
})
