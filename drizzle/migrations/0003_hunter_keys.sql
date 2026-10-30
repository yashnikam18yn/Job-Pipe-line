CREATE TABLE public.hunter_keys (
  user_id uuid PRIMARY KEY,
  api_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.hunter_keys TO service_role;
ALTER TABLE public.hunter_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_settings ADD COLUMN hunter_status text NOT NULL DEFAULT 'unknown', ADD COLUMN hunter_error text;