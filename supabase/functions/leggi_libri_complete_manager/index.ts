import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  cleanupPostgres,
  DEFAULT_MAX_SAMPLES,
  listPdfsRecursive,
} from "../_shared/pdf_compare.ts";
import {
  createLeggiLibriCompController,
  setLeggiLibriCompFlag,
} from "../_shared/run_control.ts";

serve(async (req) => {
  let responseBody = "";
  let responseStatus = 200;
  let supabase: ReturnType<typeof createClient> | null = null;

  try {
    const {
      firstPrefix = "FolderA",
      secondPrefix = "FolderB",
      threshold = 0.7,
      maxSamples = DEFAULT_MAX_SAMPLES,
    } = await req.json();

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY");

    if (!url || !key) {
      responseStatus = 500;
      responseBody = "Supabase env vars not configured";
      return new Response(responseBody, { status: responseStatus });
    }

    supabase = createClient(url, key);
    await setLeggiLibriCompFlag(supabase, 1);
    const runControl = createLeggiLibriCompController(supabase);

    const workerUrl = `${url}/functions/v1/leggi_libri_complete_worker`;
    const headers = {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    };

    const [pdfsA, pdfsB] = await Promise.all([
      listPdfsRecursive(supabase, firstPrefix),
      listPdfsRecursive(supabase, secondPrefix),
    ]);

    const aggregated: string[] = [];
    let comparisons = 0;
    let matches = 0;
    let interrupted = false;

    outer:
    for (const pathA of pdfsA) {
      for (const pathB of pdfsB) {
        if (!(await runControl.shouldContinue())) {
          interrupted = true;
          break outer;
        }

        comparisons++;
        const workerResponse = await fetch(workerUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ pathA, pathB, threshold, maxSamples }),
        });

        if (!workerResponse.ok) {
          const errText = await workerResponse.text();
          throw new Error(
            `Worker failed for ${pathA} vs ${pathB}: ${workerResponse.status} ${errText}`,
          );
        }

        const workerOutput = (await workerResponse.text()).trim();
        if (workerOutput) {
          matches++;
          aggregated.push(workerOutput);
        }
      }
    }

    const header = [
      `Scansione ricorsiva: ${pdfsA.length} PDF in ${firstPrefix}, ${pdfsB.length} PDF in ${secondPrefix}.`,
      `Confronti eseguiti: ${comparisons}. Match sopra soglia: ${matches}.`,
      ...(interrupted ? ["Interrotto dall'utente."] : []),
      "",
    ];

    responseBody = [
      ...header,
      ...(aggregated.length > 0
        ? aggregated
        : ["Nessun match sopra la soglia."]),
    ].join("\n");
  } catch (error) {
    console.error("leggi_libri_complete_manager error:", error);
    responseStatus = 500;
    responseBody = `Errore in leggi_libri_complete_manager: ${error instanceof Error ? error.message : String(error)}`;
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
