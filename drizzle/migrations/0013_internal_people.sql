CREATE TABLE public.internal_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  title text,
  linkedin_url text NOT NULL,
  company text,
  domain text NOT NULL,
  source_file text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, linkedin_url)
);
CREATE INDEX internal_people_user_domain ON public.internal_people (user_id, domain);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_people TO authenticated;
GRANT ALL ON public.internal_people TO service_role;
ALTER TABLE public.internal_people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own internal people" ON public.internal_people FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());