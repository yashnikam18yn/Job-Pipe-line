ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS gmail_message_id text,
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS bounce_reason text,
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS open_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resume_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS resume_open_count integer NOT NULL DEFAULT 0;
UPDATE public.contacts SET delivery_status = 'sent' WHERE send_status = 'sent' AND delivery_status IS NULL;