import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  cleanupPostgres,
  compareTwoPdfs,
  DEFAULT_MAX_SAMPLES,
  formatMatch,
} from "../_shared/pdf_compare.ts";

serve(async (req) => {
  let responseBody = "";
  let responseStatus = 200;
  let supabase: ReturnType<typeof createClient> | null = null;

  try {
    const {
      pathA,
      pathB,
      threshold = 0.7,
      maxSamples = DEFAULT_MAX_SAMPLES,
    } = await req.json();

    if (!pathA || !pathB) {
      responseStatus = 400;
      responseBody = "pathA e pathB sono obbligatori";
      return new Response(responseBody, { status: responseStatus });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY");

    if (!url || !key) {
      responseStatus = 500;
      responseBody = "Supabase env vars not configured";
      return new Response(responseBody, { status: responseStatus });
    }

    supabase = createClient(url, key);
    const match = await compareTwoPdfs(
      supabase,
      pathA,
      pathB,
      threshold,
      maxSamples,
    );

    responseBody = match
      ? [
        "Analizzati 2 PDF in memoria (nessun file salvato su disco).",
        "Pulizia completata: pdf_profiles svuotata, buffer memoria rilasciato.",
        "",
        formatMatch(match),
      ].join("\n")
      : "";
  } catch (error) {
    console.error("leggi_libri_complete_worker error:", error);
    responseStatus = 500;
    responseBody = `Errore in leggi_libri_complete_worker: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (supabase) {
      await cleanupPostgres(supabase);
    }
  }

  return new Response(responseBody, {
    status: responseStatus,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
