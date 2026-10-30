CREATE TABLE public.internal_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text NOT NULL,
  domain text NOT NULL,
  name text,
  company text,
  title text,
  source_file text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, email)
);
CREATE INDEX internal_contacts_user_domain ON public.internal_contacts (user_id, domain);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_contacts TO authenticated;
GRANT ALL ON public.internal_contacts TO service_role;
ALTER TABLE public.internal_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own internal contacts" ON public.internal_contacts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());