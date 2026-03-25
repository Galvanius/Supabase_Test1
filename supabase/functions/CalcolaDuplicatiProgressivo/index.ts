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

    // Call Postgres builtin nextval(sequence) via PostgREST RPC.
    // Postgres function signature: nextval(regclass)
    const { data: resData, error: resError } = await supabase.rpc(
      "nextval",
      { regclass: "public.\"SQ_DUPLICATI_PROGRESSIVO\"" } as any,
    );

    if (resError) {
      console.error("nextval rpc error:", resError);
      return new Response(
        JSON.stringify({ error: resError.message ?? String(resError) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // PostgREST may return different shapes depending on function return type.
    // We normalize to a single numeric/string value.
    let value: unknown = resData as any;
    if (Array.isArray(resData)) {
      value = (resData[0] as any)?.value ?? resData[0];
    } else if (resData && typeof resData === "object") {
      value = (resData as any).value ?? resData;
    }

    return new Response(JSON.stringify({ value }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});