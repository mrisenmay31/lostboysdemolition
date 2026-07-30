import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.json()
    const { airtable_job_id, job_name, job_start_date, estimated_hours, status } = body

    if (!airtable_job_id || !status) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: airtable_job_id and status are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const jobIdRegex = /^JOB-\d{4}$/
    if (!jobIdRegex.test(airtable_job_id)) {
      return new Response(
        JSON.stringify({ error: `Invalid airtable_job_id format. Expected JOB-XXXX (e.g. JOB-0042), received: ${airtable_job_id}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (status === 'Scheduled') {
      const { data, error } = await supabase
        .from('jobs')
        .upsert(
          {
            airtable_job_id,
            job_name: job_name ?? 'Unnamed Job',
            job_start_date: job_start_date ?? null,
            estimated_hours: estimated_hours ? parseFloat(estimated_hours) : null,
            status: 'active',
            airtable_status: status,
          },
          { onConflict: 'airtable_job_id' }
        )
        .select()

      if (error) throw error

      return new Response(
        JSON.stringify({ success: true, action: 'job_created', job: data }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (status === 'Invoiced') {
      const { data, error } = await supabase
        .from('jobs')
        .update({
          status: 'archived',
          airtable_status: status,
          archived_at: new Date().toISOString(),
        })
        .eq('airtable_job_id', airtable_job_id)
        .select()

      if (error) throw error

      if (!data || data.length === 0) {
        return new Response(
          JSON.stringify({ error: `No active job found with airtable_job_id: ${airtable_job_id}` }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: true, action: 'job_archived', job: data }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true, action: 'ignored', reason: `Status '${status}' requires no action` }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('receive-airtable-webhook error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
