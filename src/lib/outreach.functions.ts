import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const addJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ url: z.string().url().max(2000).optional(), text: z.string().max(20000).optional() })
      .refine((v) => v.url || v.text, "Provide a link or description")
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const m = await import("./outreach.server");
    const id = await m.addJob(context.supabase, context.userId, data);
    return { id };
  });

export const processJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ jobId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const m = await import("./outreach.server");
    const s = await m.getSettings(context.supabase, context.userId);
    await context.supabase.from("jobs").update({ status: "new" }).eq("id", data.jobId);
    const n = await m.processJob(context.supabase, context.userId, data.jobId, s);
    return { contacts: n };
  });

export const sendPendingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { company?: string } | undefined) => ({ company: typeof d?.company === "string" && d.company.trim() ? d.company.trim().slice(0, 200) : null }))
  .handler(async ({ context, data }) => {
    const m = await import("./outreach.server");
    const s = await m.getSettings(context.supabase, context.userId);
    const { count } = await context.supabase.from("contacts").select("id", { count: "exact", head: true })
      .eq("user_id", context.userId).eq("send_status", "sent").gte("sent_at", m.sendCountStart(s as { daily_reset_at?: string | null }));
    const sent = await m.sendPending(context.supabase, context.userId, s, 50, await reqOrigin(), data.company);
    const capReached = !data.company && (count ?? 0) >= s.daily_limit;
    return { sent, capReached, sentToday: count ?? 0, dailyLimit: s.daily_limit };
  });

export const resetDailyLimitFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase.from("outreach_settings")
      .update({ daily_reset_at: new Date().toISOString() }).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const m = await import("./outreach.server");
    return { log: await m.runStep(context.supabase, context.userId, { full: true, origin: await reqOrigin() }) };
  });

export const apolloKeyInfoFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("apollo_keys").select("api_key, updated_at").eq("user_id", context.userId).maybeSingle();
    return data ? { hasKey: true, last4: data.api_key.slice(-4), updatedAt: data.updated_at } : { hasKey: false, last4: null, updatedAt: null };
  });

export const saveApolloKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ apiKey: z.string().trim().min(10).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    // Check the key works before saving it
    const res = await fetch("https://api.apollo.io/v1/auth/health", {
      headers: { "X-Api-Key": data.apiKey, "Cache-Control": "no-cache" },
    });
    const body = (await res.json().catch(() => ({}))) as { is_logged_in?: boolean };
    if (!res.ok || body.is_logged_in === false) {
      throw new Error(`Apollo rejected this key (status ${res.status}). Check it's copied correctly and not expired.`);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("apollo_keys")
      .upsert({ user_id: context.userId, api_key: data.apiKey, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    await supabaseAdmin
      .from("outreach_settings")
      .update({ apollo_status: "ok", apollo_error: null, apollo_checked_at: new Date().toISOString() })
      .eq("user_id", context.userId);
    return { ok: true };
  });

export const removeApolloKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("apollo_keys").delete().eq("user_id", context.userId);
    await supabaseAdmin.from("outreach_settings").update({ apollo_status: "unknown", apollo_error: null }).eq("user_id", context.userId);
    return { ok: true };
  });

export const reviewQueueFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const m = await import("./outreach.server");
    const s = await m.getSettings(context.supabase, context.userId);
    const q = (status: string, limit: number) => context.supabase
      .from("contacts")
      .select("*, jobs(title, url, company)")
      .eq("send_status", status)
      .order("created_at", { ascending: false })
      .limit(limit);
    // Waiting-for-review first so new contacts are never hidden behind approved ones
    const [p, a] = await Promise.all([q("pending", 500), q("approved", 500)]);
    const data = [...(p.data ?? []), ...(a.data ?? [])];
    return data.map((c) => {
      const e = m.composeEmail(s, c as never);
      return {
        id: c.id, name: c.name, title: c.title, company: c.company, email: c.email, status: c.send_status, emailStatus: c.email_status, linkedinUrl: c.linkedin_url,
        jobTitle: (c as unknown as { jobs: { title: string } | null }).jobs?.title ?? "",
        subject: e.subject, body: e.body,
      };
    });
  });

export const updateReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid(),
      email: z.string().trim().email().max(255),
      name: z.string().trim().max(200),
      subject: z.string().trim().min(1).max(300),
      body: z.string().min(1).max(10000),
      status: z.enum(["pending", "approved", "skipped"]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("contacts")
      .update({ email: data.email.toLowerCase(), name: data.name, custom_subject: data.subject, custom_body: data.body, send_status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const approveAllFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Approve all approves everything waiting, including likely (guessed) emails.
    await context.supabase.from("contacts").update({ send_status: "approved" }).eq("send_status", "pending");
    return { ok: true };
  });

export const testSendFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ subject: z.string().min(1).max(300), body: z.string().min(1).max(10000), to: z.string().email().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const m = await import("./outreach.server");
    const s = await m.getSettings(context.supabase, context.userId);
    const to = data.to ?? (context.claims as { email?: string }).email;
    if (!to) throw new Error("No email address to send the test to");
    await m.sendGmail(to, `[TEST] ${data.subject}`, data.body, await m.loadResume(s), null, s.sender_email);
    return { to };
  });

export const hunterKeyInfoFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("hunter_keys").select("api_key").eq("user_id", context.userId).maybeSingle();
    return data ? { hasKey: true, last4: data.api_key.slice(-4) } : { hasKey: false, last4: null };
  });

export const saveHunterKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ apiKey: z.string().trim().min(10).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    const res = await fetch(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(data.apiKey)}`);
    const j = (await res.json().catch(() => ({}))) as { data?: { requests?: { searches?: { used: number; available: number } } } };
    if (!res.ok) throw new Error(`Hunter rejected this key (status ${res.status}). Check it's copied correctly.`);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("hunter_keys")
      .upsert({ user_id: context.userId, api_key: data.apiKey, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("outreach_settings").update({ hunter_status: "ok", hunter_error: null }).eq("user_id", context.userId);
    // jobs held back by a key problem get another go
    await supabaseAdmin.from("jobs").update({ error: null }).eq("user_id", context.userId).eq("status", "new");
    const sr = j.data?.requests?.searches;
    return { searchesLeft: sr ? sr.available - sr.used : null };
  });

export const removeHunterKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("hunter_keys").delete().eq("user_id", context.userId);
    await supabaseAdmin.from("outreach_settings").update({ hunter_status: "unknown", hunter_error: null }).eq("user_id", context.userId);
    return { ok: true };
  });

export const snovKeyInfoFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("snov_keys").select("client_id").eq("user_id", context.userId).maybeSingle();
    return data ? { hasKey: true, last4: data.client_id.slice(-4) } : { hasKey: false, last4: null };
  });

export const saveSnovKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ clientId: z.string().trim().min(6).max(200), clientSecret: z.string().trim().min(6).max(200) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/outreach.server");
    const token = await m.snovToken(data.clientId, data.clientSecret);
    if (!token) throw new Error("Snov.io rejected this User ID / Secret. Copy both again from Snov.io → Settings → API.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("snov_keys").upsert({
      user_id: context.userId,
      client_id: data.clientId,
      client_secret: data.clientSecret,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("outreach_settings").update({ snov_status: "ok", snov_error: null }).eq("user_id", context.userId);
    await supabaseAdmin.from("jobs").update({ error: null }).eq("user_id", context.userId).eq("status", "new");
    return { ok: true };
  });

export const removeSnovKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("snov_keys").delete().eq("user_id", context.userId);
    await supabaseAdmin.from("outreach_settings").update({ snov_status: "unknown", snov_error: null }).eq("user_id", context.userId);
    return { ok: true };
  });

export const findJobsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const m = await import("./outreach.server");
    const s = await m.getSettings(context.supabase, context.userId);
    const log: string[] = [];
    const added = await m.fetchDailyJobs(context.supabase, context.userId, s, log);
    return { added, log };
  });

export const snovBalanceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("snov_keys").select("client_id, client_secret").eq("user_id", context.userId).maybeSingle();
    if (!data) return { balance: null as number | null };
    const m = await import("./outreach.server");
    const token = await m.snovToken(data.client_id, data.client_secret);
    if (!token) return { balance: null as number | null };
    const res = await fetch("https://api.snov.io/v1/get-balance", { headers: { Authorization: `Bearer ${token}` } });
    const j = (await res.json().catch(() => null)) as { data?: { balance?: string } } | null;
    const b = Number(j?.data?.balance);
    return { balance: Number.isFinite(b) ? b : null };
  });

async function reqOrigin() {
  const { getRequest } = await import("@tanstack/react-start/server");
  try { return new URL(getRequest().url).origin; } catch { return null; }
}

export const checkBouncesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const m = await import("./outreach.server");
    return await m.checkBounces(context.supabase, context.userId);
  });

export const deleteContactFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    // Never delete a contact that was already emailed — sent rows are the send history.
    const { error } = await context.supabase.from("contacts").delete()
      .eq("id", data.id).eq("user_id", context.userId).is("sent_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteApprovedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count, error } = await context.supabase.from("contacts").delete({ count: "exact" })
      .eq("user_id", context.userId).eq("send_status", "approved").is("sent_at", null);
    if (error) throw new Error(error.message);
    return { deleted: count ?? 0 };
  });

export const gmailSenderInfoFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const m = await import("./outreach.server");
    return { email: await m.gmailSenderEmail() };
  });
