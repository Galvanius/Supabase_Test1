import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const LEGGI_LIBRI_COMP_PARAM = "LEGGI_LIBRI_COMP";
const CACHE_MS = 1500;

export async function setLeggiLibriCompFlag(
  supabase: SupabaseClient,
  valoreNum: number,
): Promise<void> {
  const { error } = await supabase
    .from("GAL_PARAMETER")
    .upsert(
      { nome: LEGGI_LIBRI_COMP_PARAM, valore_num: valoreNum },
      { onConflict: "nome" },
    );

  if (error) {
    throw new Error(`GAL_PARAMETER update failed: ${error.message}`);
  }
}

export function createLeggiLibriCompController(supabase: SupabaseClient) {
  let cachedContinue = true;
  let lastCheckMs = 0;

  return {
    async shouldContinue(): Promise<boolean> {
      const now = Date.now();
      if (now - lastCheckMs < CACHE_MS) {
        return cachedContinue;
      }

      lastCheckMs = now;
      const { data, error } = await supabase
        .from("GAL_PARAMETER")
        .select("valore_num")
        .eq("nome", LEGGI_LIBRI_COMP_PARAM)
        .maybeSingle();

      if (error) {
        throw new Error(`GAL_PARAMETER read failed: ${error.message}`);
      }

      cachedContinue = (data?.valore_num ?? 0) === 1;
      return cachedContinue;
    },
  };
}
