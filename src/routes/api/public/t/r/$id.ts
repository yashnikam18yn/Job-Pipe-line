import { createFileRoute } from "@tanstack/react-router";

const UUID = /^[0-9a-f-]{36}$/i;

// Tracked "View my resume" link: records the click, then redirects to a short-lived link to the resume.
export const Route = createFileRoute("/api/public/t/r/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!UUID.test(params.id)) return new Response("Not found", { status: 404 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: c } = await supabaseAdmin.from("contacts").select("user_id, send_status, resume_open_count, resume_opened_at").eq("id", params.id).maybeSingle();
        if (!c || c.send_status !== "sent") return new Response("Not found", { status: 404 });
        const { data: s } = await supabaseAdmin.from("outreach_settings").select("resume_path").eq("user_id", c.user_id).maybeSingle();
        if (!s?.resume_path) return new Response("Resume not available", { status: 404 });
        await supabaseAdmin.from("contacts").update({ resume_open_count: (c.resume_open_count ?? 0) + 1, resume_opened_at: c.resume_opened_at ?? new Date().toISOString() }).eq("id", params.id);
        const { data: url } = await supabaseAdmin.storage.from("resumes").createSignedUrl(s.resume_path, 60 * 10);
        if (!url?.signedUrl) return new Response("Resume not available", { status: 404 });
        return Response.redirect(url.signedUrl, 302);
      },
    },
  },
});
