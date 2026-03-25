import postgres from "npm:postgres@3";

// GetDuplicatiProgressivo
// Reads the current value of the SQ_DUPLICATI_PROGRESSIVO sequence
// WITHOUT incrementing it.
//
// Requires SUPABASE_DB_URL in the Edge runtime.

Deno.serve(async (_req) => {
  try {
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) {
      return new Response(
        JSON.stringify({ error: "Missing SUPABASE_DB_URL" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const sql = postgres(dbUrl, { max: 1, idle_timeout: 5 });
    const rows = await sql`
      select last_value as value
      from public."SQ_DUPLICATI_PROGRESSIVO";
    `;
    const value = (rows as any)[0]?.value;
    await sql.end();

    return new Response(JSON.stringify({ value }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

