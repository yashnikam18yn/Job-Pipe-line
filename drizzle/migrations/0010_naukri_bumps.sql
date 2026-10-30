CREATE TABLE public.naukri_bumps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bump_date date NOT NULL,
  slot text NOT NULL CHECK (slot IN ('morning','evening')),
  done_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, bump_date, slot)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.naukri_bumps TO authenticated;
GRANT ALL ON public.naukri_bumps TO service_role;
ALTER TABLE public.naukri_bumps ENABLE ROW LEVEL SECURITY;
CREATE POLICY naukri_bumps_owner ON public.naukri_bumps FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());