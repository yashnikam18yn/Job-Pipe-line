CREATE TABLE public.snov_keys (
  user_id uuid PRIMARY KEY,
  client_id text NOT NULL,
  client_secret text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.snov_keys TO service_role;
ALTER TABLE public.snov_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_settings ADD COLUMN IF NOT EXISTS snov_status text NOT NULL DEFAULT 'unknown';
ALTER TABLE public.outreach_settings ADD COLUMN IF NOT EXISTS snov_error text;