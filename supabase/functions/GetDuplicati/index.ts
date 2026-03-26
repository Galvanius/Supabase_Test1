import postgres from "npm:postgres@3";

type JsonObj = Record<string, unknown>;

function toKey(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

Deno.serve(async (req) => {
  try {
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) {
      return new Response(
        JSON.stringify({ error: "Missing SUPABASE_DB_URL" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const url = new URL(req.url);
    let progressivo: string | null = url.searchParams.get("progressivo");

    if (!progressivo && req.method !== "GET") {
      try {
        const body = await req.json();
        if (body && typeof body === "object" && "progressivo" in body) {
          progressivo = String((body as JsonObj).progressivo ?? "");
        }
      } catch {
        // Ignore JSON parse errors and fall through to validation.
      }
    }

    if (!progressivo) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: progressivo" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const sql = postgres(dbUrl, { max: 1, idle_timeout: 5 });
    const duplicati = await sql`
      select *
      from public."GAL_Duplicati"
      where "Progressivo" = ${progressivo}
    `;

    const keyBList = Array.from(
      new Set(
        (duplicati as JsonObj[])
          .map((r) => r["KeyB"])
          .filter((v) => v !== null && v !== undefined)
          .map((v) => toKey(v)),
      ),
    );

    let istanze: JsonObj[] = [];
    if (keyBList.length > 0) {
      istanze = await sql`
        select *
        from public."GAL_Istanze"
        where "ID" in ${sql(keyBList)}
      ` as unknown as JsonObj[];
    }

    const duplicatiByKeyB = new Map<string, JsonObj[]>();
    for (const d of duplicati as JsonObj[]) {
      const key = toKey(d["KeyB"]);
      if (!duplicatiByKeyB.has(key)) duplicatiByKeyB.set(key, []);
      duplicatiByKeyB.get(key)!.push(d);
    }

    const gruppi = istanze.map((padre) => {
      const id = toKey(padre["ID"]);
      return {
        padre,
        figli: duplicatiByKeyB.get(id) ?? [],
      };
    });

    const padriIds = new Set(istanze.map((p) => toKey(p["ID"])));
    const orfani = (duplicati as JsonObj[]).filter((d) =>
      !padriIds.has(toKey(d["KeyB"]))
    );

    await sql.end();

    return new Response(
      JSON.stringify({
        progressivo,
        totali: {
          duplicati: duplicati.length,
          padri: istanze.length,
          gruppi: gruppi.length,
          orfani: orfani.length,
        },
        gruppi,
        orfani,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

