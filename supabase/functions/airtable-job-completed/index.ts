// ============================================================
// Lost Boys Demolition — Stage 8: Job Completed → Invoice Draft
// Supabase Edge Function: airtable-job-completed
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const AIRTABLE_BASE_ID     = Deno.env.get('AIRTABLE_BASE_ID')!
const AIRTABLE_API_KEY     = Deno.env.get('AIRTABLE_API_KEY')!
const GHL_API_KEY          = Deno.env.get('GHL_API_KEY')!
const GHL_LOCATION_ID      = Deno.env.get('GHL_LOCATION_ID')!
const STRIPE_SECRET_KEY    = Deno.env.get('STRIPE_SECRET_KEY')!
const SLACK_BOT_TOKEN      = Deno.env.get('SLACK_BOT_TOKEN') ?? ''
const SLACK_NOTIFICATIONS_ENABLED = false  // set true to re-enable
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET       = Deno.env.get('AIRTABLE_WEBHOOK_SECRET')!

const AIRTABLE_JOBS_TABLE       = 'tbl6WcLuLL0uUcpI1'
const AIRTABLE_CLIENTS_TABLE    = 'tblSJkwDdupKzsst7'
const AIRTABLE_LINE_ITEMS_TABLE = 'tblTwK8K0HkyluBec'
const GHL_BASE                  = 'https://services.leadconnectorhq.com'
const STRIPE_BASE               = 'https://api.stripe.com/v1'
const DANE_GHL_USER_ID          = 'RP8dbByEBwoK2aR1A0AW'
const DANE_SLACK_ID             = 'U07EXR7CWE4'

const GHL_AUTH = {
  Authorization: `Bearer ${GHL_API_KEY}`,
  Version: '2021-07-28',
}

const JOB_FIELDS = {
  jobName:            'fldbKNw609rqD97Gi',
  jobAddress:         'fldSmr1YCORDoagb6',
  jobNumber:          'fld1ZeDoChO0h9QXO',
  ghlOpportunityId:   'fldc2Od8JX3Se1gJN',
  clientLink:         'fldzu6hA8zr9Hjbfz',
  invoiceLineItems:   'fldD6xumylrVQEVMo',
  invoiceNotes:       'fldpMa3sJUkbBVrS2',
  invoiceAmtOverride: 'fldcQtMmSTGv9vNw3',
  totalBid:           'fldazwdB2mw4Zh0n1',
  paymentTerms:       'flddscDgnajyoq23N',
  stripeInvoiceId:    'fldScCm7AZJsqu6qF',
  invoiceReviewUrl:   'fldriMNZ1cSNpMirs',
  invoiceStatus:      'fldHvc478qRXRfeuU',
}

const CLIENT_FIELDS = {
  clientName:       'fldyIBidorXegZFHf',
  email:            'fldMVOoOV9TRdUAyC',
  ghlContactId:     'fldC4zAieX10BVacc',
  stripeCustomerId: 'fldAdwzgPB6iM94lg',
}

const LINE_ITEM_FIELDS = {
  name:             'fldva3wLkKqJD7t7r',
  description:      'fldWGM7wIVac7rxEy',
  amount:           'fldR0cBZlSC25CXhq',
  quantity:         'fldLP3TR2pveYKFOc',
  sortOrder:        'fld5kCTH3LByLIFT8',
  includeOnInvoice: 'fldBo2XaZZHFIzJT5',
}

// ── Cold-start: resolve GHL "Invoice Review" stage ID ────────────────────

let INVOICE_REVIEW_STAGE_ID: string | null = null
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
    console.error('[startup]', STARTUP_ERROR)
  } else {
    const stages = pipeline.stages ?? []
    console.log('[startup] Job Pipeline stages:', JSON.stringify(stages.map((s: any) => ({ id: s.id, name: s.name }))))
    const stage = stages.find((s: any) => s.name === 'Invoice Review')
    if (!stage) {
      STARTUP_ERROR = `Stage "Invoice Review" not found. Found: ${stages.map((s: any) => s.name).join(', ')}`
      console.error('[startup]', STARTUP_ERROR)
    } else {
      INVOICE_REVIEW_STAGE_ID = stage.id
      console.log('[startup] Resolved "Invoice Review" stage ID:', INVOICE_REVIEW_STAGE_ID)
    }
  }
} catch (err: any) {
  STARTUP_ERROR = `Pipeline resolution failed: ${err.message ?? String(err)}`
  console.error('[startup]', STARTUP_ERROR)
}

// ── Helpers ───────────────────────────────────────────────────────────────

function nextBusinessDay(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const dow = d.getDay()
  if (dow === 6) d.setDate(d.getDate() + 2)      // Saturday → Monday
  else if (dow === 0) d.setDate(d.getDate() + 1)  // Sunday → Monday
  return d.toISOString()
}

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

async function fetchAirtableRecord(tableId: string, recordId: string) {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}/${recordId}?returnFieldsByFieldId=true`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
  )
  const data = await res.json()
  console.log(`[airtable] fetch ${tableId}/${recordId}:`, JSON.stringify(data))
  if (!res.ok || data.error) {
    throw new Error(`Airtable GET failed: ${JSON.stringify(data)}`)
  }
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
  if (!res.ok || data.error) {
    throw new Error(`Airtable PATCH failed: ${JSON.stringify(data)}`)
  }
  return data
}

async function stripePost(path: string, params: Record<string, string | number | boolean>) {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) body.append(k, String(v))
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Stripe POST ${path}: ${data.error.message}`)
  return data
}

async function stripeGet(path: string) {
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  })
  const data = await res.json()
  if (data.error) throw new Error(`Stripe GET ${path}: ${data.error.message}`)
  return data
}

// ── Main handler ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Step 1 — Auth
  const incomingSecret = req.headers.get('x-webhook-secret')
  if (incomingSecret !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  // Step 2 — Parse
  let payload: any
  try { payload = await req.json() }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }) }

  const recordId = payload.recordId
  if (!recordId) {
    return new Response(JSON.stringify({ error: 'Missing recordId' }), { status: 400 })
  }

  if (!INVOICE_REVIEW_STAGE_ID) {
    const msg = STARTUP_ERROR ?? 'Invoice Review stage not resolved — check startup logs'
    console.error('[handler] Aborting:', msg)
    await supabase.from('sync_log').insert({
      direction: 'airtable_to_ghl', trigger_event: 'job_completed',
      action_taken: 'error', status: 'error',
      airtable_record_id: recordId, error_message: msg, payload_in: payload,
    })
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 500 })
  }

  let ghlTaskCreated  = false
  let slackSent       = false
  let stripeInvoiceId: string | null = null
  let invoiceReviewUrl: string | null = null

  try {
    // Step 3 — Fetch Job Record
    const jobData = await fetchAirtableRecord(AIRTABLE_JOBS_TABLE, recordId)
    if (!jobData?.fields) throw new Error(`Airtable returned no fields for record ${recordId}`)
    const f = jobData.fields
    console.log('[step3] job fields:', JSON.stringify(f))

    const jobName            = f[JOB_FIELDS.jobName]           ?? ''
    const jobAddress         = f[JOB_FIELDS.jobAddress]         ?? ''
    const ghlOpportunityId   = f[JOB_FIELDS.ghlOpportunityId]  ?? null
    const invoiceNotes       = f[JOB_FIELDS.invoiceNotes]       ?? null
    const invoiceAmtOverride = typeof f[JOB_FIELDS.invoiceAmtOverride] === 'number'
                                 ? f[JOB_FIELDS.invoiceAmtOverride] : null
    const totalBid           = parseFloat(f[JOB_FIELDS.totalBid]) || 0
    const paymentTerms       = f[JOB_FIELDS.paymentTerms]       ?? ''
    const lineItemIds: string[] = (f[JOB_FIELDS.invoiceLineItems] ?? [])
      .map((x: any) => (typeof x === 'string' ? x : x?.id))
      .filter(Boolean)
    const clientLinks: any[] = f[JOB_FIELDS.clientLink] ?? []
    const clientRecordId = Array.isArray(clientLinks)
      ? (clientLinks[0]?.id ?? clientLinks[0])
      : null

    const invoiceAmount = invoiceAmtOverride ?? totalBid
    console.log(`[step3] invoiceAmtOverride=${invoiceAmtOverride} totalBid=${totalBid} invoiceAmount=${invoiceAmount}`)
    console.log(`[step3] lineItemIds count=${lineItemIds.length}:`, JSON.stringify(lineItemIds))
    console.log(`[step3] ghlOpportunityId=${ghlOpportunityId} clientRecordId=${clientRecordId}`)

    if (!clientRecordId) throw new Error('No linked Client record on job')

    // Step 4 — Fetch Invoice Line Items (Include on Invoice = true only)
    const lineItems: Array<{ name: string; description: string; amount: number; quantity: number; sortOrder: number }> = []
    for (const liId of lineItemIds) {
      try {
        const li = await fetchAirtableRecord(AIRTABLE_LINE_ITEMS_TABLE, liId)
        const lf = li?.fields ?? {}
        const included    = !!lf[LINE_ITEM_FIELDS.includeOnInvoice]
        const name        = lf[LINE_ITEM_FIELDS.name]        ?? 'Line Item'
        const description = lf[LINE_ITEM_FIELDS.description] ?? ''
        const amount      = parseFloat(lf[LINE_ITEM_FIELDS.amount])   || 0
        const quantity    = parseFloat(lf[LINE_ITEM_FIELDS.quantity])  || 1
        const sortOrder   = typeof lf[LINE_ITEM_FIELDS.sortOrder] === 'number'
                              ? lf[LINE_ITEM_FIELDS.sortOrder]
                              : Number.MAX_SAFE_INTEGER
        console.log(`[step4] line item ${liId}: name="${name}" amount=${amount} qty=${quantity} sort=${sortOrder} included=${included}`)
        if (!included) continue
        lineItems.push({ name, description, amount, quantity, sortOrder })
      } catch (err: any) {
        console.warn(`[warn] Failed to fetch line item ${liId}:`, err.message)
      }
    }
    lineItems.sort((a, b) => a.sortOrder - b.sortOrder)
    console.log(`[step4] lineItems passing filter (${lineItems.length}):`, JSON.stringify(lineItems))

    // Step 5 — Fetch Client Record
    const clientData = await fetchAirtableRecord(AIRTABLE_CLIENTS_TABLE, clientRecordId)
    if (!clientData?.fields) throw new Error(`No client data for record ${clientRecordId}`)
    const cf = clientData.fields

    const clientName      = cf[CLIENT_FIELDS.clientName]       ?? ''
    const clientEmail     = cf[CLIENT_FIELDS.email]            ?? null
    const ghlContactId    = cf[CLIENT_FIELDS.ghlContactId]     ?? null
    let   stripeCustomerId = cf[CLIENT_FIELDS.stripeCustomerId] ?? null

    if (!clientEmail) throw new Error('Client record has no email address')

    // Step 6 — Stripe Customer Lookup / Create
    if (!stripeCustomerId) {
      const search = await stripeGet(`/customers?email=${encodeURIComponent(clientEmail)}&limit=1`)
      if (search.data?.length > 0) {
        stripeCustomerId = search.data[0].id
        console.log('[stripe] Found existing customer:', stripeCustomerId)
      } else {
        const created = await stripePost('/customers', {
          email: clientEmail,
          name:  clientName,
          description: `Lost Boys Demolition — ${clientName}`,
        })
        stripeCustomerId = created.id
        console.log('[stripe] Created new customer:', stripeCustomerId)
      }
      await patchAirtableRecord(AIRTABLE_CLIENTS_TABLE, clientRecordId, {
        [CLIENT_FIELDS.stripeCustomerId]: stripeCustomerId,
      })
    }

    // Step 7 — Resolve Payment Terms → days_until_due
    const termDays: Record<string, number> = { 'Net 15': 15, 'Net 30': 30, 'Net 60': 60 }
    const daysUntilDue = termDays[paymentTerms] ?? 0

    // Step 8 — Create Stripe Invoice (DRAFT)
    // Fallback: no Invoice Line Items linked → single total line
    const baseItems = lineItems.length > 0
      ? lineItems
      : [{ name: jobName || 'Demolition Services', description: '', amount: invoiceAmount, quantity: 1, sortOrder: 0 }]

    // Each named item appears at its actual amount (including $0 — name/desc still visible on invoice).
    // If the sum of line item amounts does not equal the Total Bid (invoiceAmount), append a
    // "Project Total" line for the difference so the invoice always totals to the Total Bid.
    const lineItemTotal = baseItems.reduce((sum, li) => sum + (li.amount * li.quantity), 0)
    const gap = Math.round((invoiceAmount - lineItemTotal) * 100) / 100

    const itemsToAdd = [...baseItems]
    if (gap > 0) {
      console.log(`[step8] lineItemTotal=${lineItemTotal} invoiceAmount=${invoiceAmount} gap=${gap} — appending "Project Total" line`)
      itemsToAdd.push({ name: 'Project Total', description: '', amount: gap, quantity: 1, sortOrder: 9999 })
    } else if (gap < 0) {
      console.warn(`[step8] Line item sum (${lineItemTotal}) exceeds Total Bid (${invoiceAmount}) — using items as-is`)
    }

    console.log(`[step8] invoiceAmount=${invoiceAmount} paymentTerms="${paymentTerms}" daysUntilDue=${daysUntilDue}`)
    console.log('[step8] itemsToAdd:', JSON.stringify(itemsToAdd))

    if (!invoiceAmount || invoiceAmount <= 0) {
      throw new Error('Cannot create invoice — no amount resolved from line items or Total Bid field.')
    }

    const invoiceParams: Record<string, string | number | boolean> = {
      customer:          stripeCustomerId,
      collection_method: 'send_invoice',
      days_until_due:    daysUntilDue,
      auto_advance:      false,
    }
    if (invoiceNotes) invoiceParams.description = invoiceNotes

    const invoice = await stripePost('/invoices', invoiceParams)
    stripeInvoiceId = invoice.id
    console.log('[stripe] Created invoice:', stripeInvoiceId)

    for (const li of itemsToAdd) {
      const qty = Math.max(1, Math.round(Number(li.quantity) || 1))
      const unitAmountCents = Math.round((Number(li.amount) || 0) * 100)
      console.log(`[step8] adding invoice item: "${li.name}" unit_amount=${li.amount} qty=${qty} cents=${unitAmountCents}`)

      // Create a Stripe Product so the name renders bold and description renders below it
      const productParams: Record<string, string | number | boolean> = { name: li.name }
      if (li.description) productParams.description = li.description
      const product = await stripePost('/products', productParams)

      const invoiceItemParams: Record<string, string | number | boolean> = {
        customer:                  stripeCustomerId,
        invoice:                   stripeInvoiceId!,
        quantity:                  qty,
        'price_data[currency]':    'usd',
        'price_data[unit_amount]': unitAmountCents,
        'price_data[product]':     product.id,
      }
      if (li.description) invoiceItemParams.description = li.description

      await stripePost('/invoiceitems', invoiceItemParams)
    }

    // Step 9 — Capture Invoice ID and Review URL
    invoiceReviewUrl = `https://dashboard.stripe.com/invoices/${stripeInvoiceId}`

    // Step 10 — Write Back to Airtable Job Record
    await patchAirtableRecord(AIRTABLE_JOBS_TABLE, recordId, {
      [JOB_FIELDS.stripeInvoiceId]:  stripeInvoiceId,
      [JOB_FIELDS.invoiceReviewUrl]: invoiceReviewUrl,
      [JOB_FIELDS.invoiceStatus]:    'Draft',
    })

    // Step 11 — Update GHL Opportunity to Stage 9 (Invoice Review)
    console.log(`[step11] ghlOpportunityId=${ghlOpportunityId} invoiceReviewUrl=${invoiceReviewUrl}`)
    if (ghlOpportunityId) {
      const ghlRes = await fetch(`${GHL_BASE}/opportunities/${ghlOpportunityId}`, {
        method: 'PUT',
        headers: { ...GHL_AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipelineStageId: INVOICE_REVIEW_STAGE_ID,
          customFields: [
            { key: 'invoice_review_url', field_value: invoiceReviewUrl },
          ],
        }),
      })
      const ghlData = await ghlRes.json()
      console.log('[ghl] opportunity update response:', JSON.stringify(ghlData))
    } else {
      console.warn('[warn] No GHL Opportunity ID on job — skipping GHL stage advance')
    }

    // Step 12 — Create GHL Task for Dane
    if (ghlContactId) {
      const taskRes = await fetch(`${GHL_BASE}/contacts/${ghlContactId}/tasks`, {
        method: 'POST',
        headers: { ...GHL_AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:      `Review & send invoice: ${jobName}`,
          dueDate:    nextBusinessDay(),
          assignedTo: DANE_GHL_USER_ID,
          body:       `Job: ${jobName} | ${jobAddress}\nInvoice Amount: ${formatCurrency(invoiceAmount)}\nClient: ${clientName}\nReview in Stripe: ${invoiceReviewUrl}`,
          status:     'incompleted',
        }),
      })
      const taskData = await taskRes.json()
      console.log('[ghl] task create response:', JSON.stringify(taskData))
      ghlTaskCreated = !!(taskData.task?.id ?? taskData.id)
    } else {
      console.warn('[warn] No GHL Contact ID on client — skipping task creation')
    }

    // Step 13 — Slack DM to Dane (non-fatal if token missing or call fails)
    if (SLACK_NOTIFICATIONS_ENABLED && SLACK_BOT_TOKEN) {
      try {
        const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            channel: DANE_SLACK_ID,
            text: [
              `📋 Invoice Ready for Review — ${jobName}`,
              '',
              `Job: ${jobName} | ${jobAddress}`,
              `Invoice Amount: ${formatCurrency(invoiceAmount)}`,
              `Client: ${clientName}`,
              '',
              `Review in Stripe → ${invoiceReviewUrl}`,
              '',
              'React with ✅ when sent. Task also created in GHL.',
            ].join('\n'),
          }),
        })
        const slackData = await slackRes.json()
        console.log('[slack] post message response:', JSON.stringify(slackData))
        slackSent = slackData.ok === true
        if (!slackData.ok) console.warn('[slack] API error:', slackData.error)
      } catch (err: any) {
        console.warn('[slack] Failed to send DM (non-fatal):', err.message)
      }
    } else {
      console.log('[slack] SLACK_BOT_TOKEN not set — skipping Slack notification')
    }

  } catch (err: any) {
    const msg = err.message ?? String(err)
    console.error('[error] airtable-job-completed:', msg)
    await supabase.from('sync_log').insert({
      direction:          'airtable_to_ghl',
      trigger_event:      'job_completed',
      action_taken:       'error',
      status:             'error',
      airtable_record_id: recordId,
      error_message:      msg,
      payload_in:         payload,
    })
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Step 14 — Log to sync_log
  await supabase.from('sync_log').insert({
    direction:          'airtable_to_ghl',
    trigger_event:      'job_completed',
    action_taken:       'invoice_draft_created',
    status:             'success',
    airtable_record_id: recordId,
    error_message:      `Stripe Invoice: ${stripeInvoiceId}`,
    payload_in:         payload,
  })

  return new Response(JSON.stringify({
    success:          true,
    stripeInvoiceId,
    invoiceReviewUrl,
    ghlTaskCreated,
    slackSent,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
