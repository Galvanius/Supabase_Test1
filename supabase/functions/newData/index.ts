// Edge Function: insert-gal
// Assumptions:
// - Uses service role key for DB access (SUPABASE_SERVICE_ROLE_KEY).
// - Table name is "GAL" in public schema.
// - Request body is JSON object with keys matching GAL columns.
// - Returns inserted row on success.

import { createClient } from "npm:@supabase/supabase-js@2.36.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
  },
});

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
    }

    // Parse JSON body
    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return new Response(JSON.stringify({ error: "Invalid JSON body!" }), { status: 400 });
    }

    // Insert into GAL
    const { data, error } = await supabase.from("GAL").insert(payload).select("*").single();

    console.log(data);

    if (error) {
      console.error("Insert error:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ data }), {
      status: 201,
      headers: { "Content-Type": "application/json", "Connection": "keep-alive" },
    });
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
});