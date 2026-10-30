ALTER TABLE public.outreach_settings ADD COLUMN require_approval boolean NOT NULL DEFAULT true;
ALTER TABLE public.contacts ADD COLUMN custom_subject text, ADD COLUMN custom_body text;