ALTER TABLE public.outreach_settings
  ADD COLUMN linkedin_url text NOT NULL DEFAULT 'https://www.linkedin.com/in/yash-nikam-3404bb223/',
  ADD COLUMN attach_resume boolean NOT NULL DEFAULT true,
  ADD COLUMN resume_path text,
  ADD COLUMN resume_filename text,
  ADD COLUMN apollo_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN apollo_error text,
  ADD COLUMN apollo_checked_at timestamptz;

ALTER TABLE public.outreach_settings ALTER COLUMN keywords SET DEFAULT 'Java Backend Developer';
ALTER TABLE public.outreach_settings ALTER COLUMN template_subject SET DEFAULT 'Java Backend Engineer (2.5+ yrs) – {{job_title}} at {{company}}';
ALTER TABLE public.outreach_settings ALTER COLUMN template_body SET DEFAULT E'Hi {{first_name}},\n\nI came across the {{job_title}} opening at {{company}} and wanted to reach out directly.\n\nI''m a Software Engineer Specialist at Dassault Systèmes with 2.5+ years in Java, Spring Boot, microservices, Kafka/RabbitMQ, Redis and React. Recently I built a 2D vehicle rendering platform used by 20+ global teams (Redis caching cut load times by 35%) and 3D configurators deployed across 50+ dealerships.\n\nJob link: {{job_url}}\nLinkedIn: {{linkedin}}\n\nI''ve attached my resume. Would you be open to a quick chat, or referring me for this role?\n\nThanks,\nYash Nikam\n+91 9021575657';

CREATE TABLE public.apollo_keys (
  user_id uuid PRIMARY KEY,
  api_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.apollo_keys TO service_role;
ALTER TABLE public.apollo_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own resume read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own resume insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own resume update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own resume delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);