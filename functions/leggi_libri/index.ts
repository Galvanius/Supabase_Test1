import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type FileInfo = {
  path: string;
  name: string;
  size: number;
};

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  const distance = dp[m][n];
  const maxLen = Math.max(m, n);
  return 1 - distance / maxLen;
}

function sizeSimilarity(sizeA: number, sizeB: number): number {
  if (sizeA === 0 || sizeB === 0) return 0;
  return Math.min(sizeA, sizeB) / Math.max(sizeA, sizeB);
}

function fileSimilarity(a: FileInfo, b: FileInfo): number {
  const nameSim = stringSimilarity(a.name.toLowerCase(), b.name.toLowerCase());
  const sizeSim = sizeSimilarity(a.size, b.size);
  return 0.5 * nameSim + 0.5 * sizeSim;
}

serve(async (req) => {
  try {
    const {
      firstPrefix,
      secondPrefix,
      threshold = 0.7,
    } = await req.json();

    const bucket = "Repository";
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY");

    if (!url || !key) {
      console.error("Missing SUPABASE_URL or service/anon key in environment");
      return new Response("Supabase env vars not configured", { status: 500 });
    }

    const supabase = createClient(url, key);

    const { data: list1, error: err1 } = await supabase.storage
      .from(bucket)
      .list(firstPrefix, {
        limit: 1000,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      });

    if (err1) {
      console.error("Error listing firstPrefix:", err1);
      throw err1;
    }

    const { data: list2, error: err2 } = await supabase.storage
      .from(bucket)
      .list(secondPrefix, {
        limit: 1000,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      });

    if (err2) {
      console.error("Error listing secondPrefix:", err2);
      throw err2;
    }

    const files1: FileInfo[] =
      (list1 ?? [])
        .filter((f) => f.name.toLowerCase().endsWith(".pdf"))
        .map((f) => ({
          path: `${firstPrefix}/${f.name}`,
          name: f.name,
          size: (f as any).metadata?.size ?? 0,
        }));

    const files2: FileInfo[] =
      (list2 ?? [])
        .filter((f) => f.name.toLowerCase().endsWith(".pdf"))
        .map((f) => ({
          path: `${secondPrefix}/${f.name}`,
          name: f.name,
          size: (f as any).metadata?.size ?? 0,
        }));

    const lines: string[] = [];

    for (const fa of files1) {
      let bestScore = 0;
      let bestB: FileInfo | null = null;

      for (const fb of files2) {
        const score = fileSimilarity(fa, fb);
        if (score > bestScore) {
          bestScore = score;
          bestB = fb;
        }
      }

      if (bestB && bestScore >= threshold) {
        lines.push(fa.path);
        lines.push(bestB.path);
        lines.push("----------------");
      }
    }

    return new Response(lines.join("\n"), {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    console.error("leggi_libri error:", e);
    return new Response("Errore in leggi_libri edge function", { status: 500 });
  }
});

