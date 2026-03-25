import postgres from "npm:postgres@3";

// This Edge Function returns the next value from the SQ_DUPLICATI_PROGRESSIVO sequence.
// Assumptions:
// - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are available as environment variables.
// - The function uses the service role key because reading sequences requires elevated privileges.

Deno.serve(async (req) => {
  try {
    // Edge functions can connect to Postgres directly using SUPABASE_DB_URL.
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) {
      return new Response(
        JSON.stringify({ error: "Missing SUPABASE_DB_URL" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const sql = postgres(dbUrl, { max: 1, idle_timeout: 5 });
    const rows = await sql`select nextval('public."SQ_DUPLICATI_PROGRESSIVO"') as value;`;
    const value = (rows as any)[0]?.value;
    await sql.end();

    if (value === undefined || value === null) {
      return new Response(
        JSON.stringify({ error: "Could not read sequence value" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ value }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});