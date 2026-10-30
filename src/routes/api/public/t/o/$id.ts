import { createFileRoute } from "@tanstack/react-router";

const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
const UUID = /^[0-9a-f-]{36}$/i;

// Email open pixel. Only bumps a counter on the matching contact; returns nothing private.
export const Route = createFileRoute("/api/public/t/o/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (UUID.test(params.id)) {
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: c } = await supabaseAdmin.from("contacts").select("open_count, opened_at, send_status").eq("id", params.id).maybeSingle();
            if (c && c.send_status === "sent") {
              await supabaseAdmin.from("contacts").update({ open_count: (c.open_count ?? 0) + 1, opened_at: c.opened_at ?? new Date().toISOString() }).eq("id", params.id);
            }
          } catch (e) { console.error("open pixel", e); }
        }
        return new Response(GIF, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0" } });
      },
    },
  },
});
