CREATE TABLE public.outreach_settings (
  user_id uuid PRIMARY KEY,
  keywords text NOT NULL DEFAULT 'Software Engineer',
  location text NOT NULL DEFAULT 'India',
  target_titles text[] NOT NULL DEFAULT ARRAY['HR','Recruiter','Talent Acquisition','Engineering Manager','SDE 2','Senior Software Engineer'],
  daily_limit int NOT NULL DEFAULT 15,
  contacts_per_job int NOT NULL DEFAULT 3,
  auto_enabled boolean NOT NULL DEFAULT false,
  template_subject text NOT NULL DEFAULT 'Application for {{job_title}} at {{company}}',
  template_body text NOT NULL DEFAULT E'Hi {{first_name}},\n\nI came across the {{job_title}} role at {{company}} and I''d love to be considered. I have hands-on experience that matches the job description.\n\nJob link: {{job_url}}\n\nWould you be open to a quick chat or referring me?\n\nThanks,\nYour Name',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outreach_settings TO authenticated;
GRANT ALL ON public.outreach_settings TO service_role;
ALTER TABLE public.outreach_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings" ON public.outreach_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  company_domain text,
  url text,
  source text NOT NULL DEFAULT 'manual',
  description text,
  status text NOT NULL DEFAULT 'new',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, url)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own jobs" ON public.jobs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  apollo_id text,
  name text NOT NULL DEFAULT '',
  first_name text,
  title text,
  email text NOT NULL,
  email_status text,
  linkedin_url text,
  company text,
  send_status text NOT NULL DEFAULT 'pending',
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own contacts" ON public.contacts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX contacts_user_status_idx ON public.contacts(user_id, send_status);
CREATE INDEX jobs_user_status_idx ON public.jobs(user_id, status);