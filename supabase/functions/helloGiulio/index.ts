import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

serve(() => {
  return new Response("grande Giulio ce l'hai fatta!", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
});

