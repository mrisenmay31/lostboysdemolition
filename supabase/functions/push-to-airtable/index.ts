import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const AIRTABLE_BASE_ID = Deno.env.get('AIRTABLE_BASE_ID')!
const AIRTABLE_API_KEY = Deno.env.get('AIRTABLE_API_KEY')!
const AIRTABLE_JOBS_TABLE = 'tbl6WcLuLL0uUcpI1'

Deno.serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { airtable_job_id, job_id } = await req.json()

    if (!airtable_job_id || !job_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: airtable_job_id and job_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('estimated_hours')
      .eq('id', job_id)
      .single()

    if (jobError) throw new Error(`Failed to fetch job: ${jobError.message}`)

    const { data: entries, error: entriesError } = await supabase
      .from('time_entries')
      .select('duration_minutes, labor_cost')
      .eq('job_id', job_id)
      .not('clock_out', 'is', null)

    if (entriesError) throw new Error(`Failed to fetch time entries: ${entriesError.message}`)

    const totalMinutes = entries.reduce((sum: number, e: any) => sum + (e.duration_minutes ?? 0), 0)
    const totalHours = Math.round((totalMinutes / 60) * 100) / 100
    const totalCost = Math.round(entries.reduce((sum: number, e: any) => sum + (e.labor_cost ?? 0), 0) * 100) / 100
    const estimatedHours = job?.estimated_hours ?? 0
    const varianceHours = Math.round((totalHours - estimatedHours) * 100) / 100

    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable credentials not set. Add AIRTABLE_API_KEY and AIRTABLE_BASE_ID as Edge Function secrets.')
    }

    // Search by Job ID field (formula primary field that produces JOB-XXXX)
    const formula = encodeURIComponent(`{Job ID}="${airtable_job_id}"`)
    const searchRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_JOBS_TABLE}?filterByFormula=${formula}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
    )

    if (!searchRes.ok) {
      const errBody = await searchRes.text()
      throw new Error(`Airtable search failed: ${errBody}`)
    }

    const searchData = await searchRes.json()

    if (!searchData.records || searchData.records.length === 0) {
      throw new Error(`No Airtable record found matching Job ID: ${airtable_job_id}`)
    }

    const recordId = searchData.records[0].id

    // Write actual labor hours and cost — variance fields are Airtable formulas and auto-calculate
    const updateRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_JOBS_TABLE}/${recordId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            'Actual Labor Hours': totalHours,
            'Actual Labor Cost': totalCost,
          }
        })
      }
    )

    if (!updateRes.ok) {
      const errBody = await updateRes.json()
      throw new Error(`Airtable update failed: ${JSON.stringify(errBody)}`)
    }

    await supabase
      .from('time_entries')
      .update({ synced_to_airtable: true })
      .eq('job_id', job_id)

    const result = {
      success: true,
      airtable_job_id,
      actual_labor_hours: totalHours,
      actual_labor_cost: totalCost,
      labor_variance_hours: varianceHours,
    }

    console.log('push-to-airtable success:', result)

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('push-to-airtable error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
