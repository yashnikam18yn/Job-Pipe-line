import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/jobs/daily-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runStep } = await import("@/lib/outreach.server");
        const { data: users } = await supabaseAdmin
          .from("outreach_settings")
          .select("user_id")
          .eq("auto_enabled", true);
        const results: Record<string, string[]> = {};
        for (const u of users ?? []) {
          try {
            results[u.user_id] = await runStep(supabaseAdmin, u.user_id, { origin: new URL(request.url).origin });
          } catch (e) {
            console.error("daily-run failed", u.user_id, e);
          }
        }
        return Response.json({ ok: true, users: Object.keys(results).length });
      },
    },
  },
});
