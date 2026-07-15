-- Profili PDF pre-calcolati: cache tra chiamate worker durante un run del manager.

CREATE TABLE IF NOT EXISTS public.pdf_profiles (
  storage_path text PRIMARY KEY,
  file_size bigint NOT NULL,
  file_hash text NOT NULL,
  page_count integer NOT NULL,
  likely_scanned boolean NOT NULL DEFAULT false,
  total_text_length integer NOT NULL DEFAULT 0,
  sample_count integer NOT NULL DEFAULT 0,
  samples jsonb NOT NULL DEFAULT '[]'::jsonb,
  profiled_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pdf_profiles_file_hash_idx ON public.pdf_profiles (file_hash);
CREATE INDEX IF NOT EXISTS pdf_profiles_page_count_idx ON public.pdf_profiles (page_count);

ALTER TABLE public.pdf_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dev_pdf_profiles_all" ON public.pdf_profiles;
CREATE POLICY "dev_pdf_profiles_all"
ON public.pdf_profiles
FOR ALL
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);
