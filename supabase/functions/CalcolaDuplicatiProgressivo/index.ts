import { createClient } from "npm:@supabase/supabase-js@2.33.0";

// This Edge Function returns the next value from the SQ_DUPLICATI_PROGRESSIVO sequence.
// Assumptions:
// - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are available as environment variables.
// - The function uses the service role key because reading sequences requires elevated privileges.

Deno.serve(async (req) => {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) {
      return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Use SQL RPC to get nextval from the sequence
    const sql = `SELECT nextval('public."SQ_DUPLICATI_PROGRESSIVO"') as value;`;
    const res = await supabase.rpc('', { sql }).catch(() => null);

    // If RPC with raw SQL isn't available, use the Postgres REST endpoint
    if (!res || res.error) {
      const dbUrl = Deno.env.get('SUPABASE_DB_URL');
      if (!dbUrl) {
        return new Response(JSON.stringify({ error: 'Cannot run SQL: missing SUPABASE_DB_URL' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      // Use Postgres URL to run "nextval" via simple query using fetch to the Postgres direct URL is not allowed.
      // Instead use the RESTful SQL endpoint
      const jwt = serviceKey;
      const sqlBody = { sql };
      const r = await fetch(`${url}/rest/v1/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(sqlBody),
      });
      const body = await r.text();
      return new Response(body, { status: r.status, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ value: res }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});