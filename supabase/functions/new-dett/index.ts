import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || Deno.env.get("PROJECT_URL") || "";
const SERVICE_ROLE =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await req.json().catch(() => ({}));
    const { KeyB, itemB1, itemB2 } = body;
    if (KeyB === undefined) {
      return new Response(JSON.stringify({ error: "KeyB is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const headers = {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    };

    // 1) Verifica esistenza record in GAL
    const galRes = await fetch(
      `${SUPABASE_URL}/rest/v1/GAL?id=eq.${encodeURIComponent(KeyB)}`,
      { headers }
    );
    if (!galRes.ok) {
      const txt = await galRes.text();
      console.error("Error fetching GAL:", txt);
      return new Response(JSON.stringify({ error: "Error checking GAL", detail: txt }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
    const galRows = await galRes.json();
    if (!Array.isArray(galRows) || galRows.length === 0) {
      const msg = `record GAL non trovato con Id = ${KeyB}`;
      console.error(msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    // 2) Inserisce in GAL_2
    const insertBody = { KeyB, itemB1, itemB2 };
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/GAL_2`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(insertBody),
    });
    if (!insRes.ok) {
      const txt = await insRes.text();
      console.error("Error inserting GAL_2:", txt);
      return new Response(JSON.stringify({ error: "Error inserting GAL_2", detail: txt }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
    const inserted = await insRes.json();

    // 3) Aggiorna UltimaModifica in GAL
    const now = new Date().toISOString();
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/GAL?id=eq.${encodeURIComponent(KeyB)}`,
      {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({ UltimaModifica: now }),
      }
    );
    if (!patchRes.ok) {
      const txt = await patchRes.text();
      console.error("Error updating GAL UltimaModifica:", txt);
      return new Response(
        JSON.stringify({ inserted, warning: "Failed to update UltimaModifica", detail: txt }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    }
    const updated = await patchRes.json();

    return new Response(JSON.stringify({ inserted, updated }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "internal_error", detail: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});

