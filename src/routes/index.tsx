import { naukriLocalZipBase64 } from "@/assets/naukriLocalZip";
import { linkedinNote, buildEmail, type Pattern } from "@/lib/emailGuess";
import { contactSummary } from "@/lib/contactSummary";
import { JobKeywordsInput } from "@/components/job-keywords-input";
import { InternalDataTab } from "@/components/internal-data-tab";
import { SetupGuide } from "@/components/setup-guide";
import { SenderEmailSettings } from "@/components/sender-email-settings";
import { dueSlot, fmtBumpDate, fmtDoneAt, istParts, SLOT_WINDOWS, type BumpSlot } from "@/lib/naukriBump";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { exactPosted, isJobWithinExperiencePolicy, postedLabel, renderTemplate } from "@/lib/template";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { snovKeyInfoFn, saveSnovKeyFn, removeSnovKeyFn, hunterKeyInfoFn, saveHunterKeyFn, removeHunterKeyFn, addJobFn, findJobsFn, snovBalanceFn, checkBouncesFn, approveAllFn, reviewQueueFn, testSendFn, updateReviewFn, apolloKeyInfoFn, processJobFn, removeApolloKeyFn, runNowFn, saveApolloKeyFn, sendPendingFn, resetDailyLimitFn, deleteContactFn, deleteApprovedFn } from "@/lib/outreach.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Check, X, FlaskConical, Loader2, Play, Send, Plus, LogOut, ExternalLink, RotateCw, FileText, KeyRound, Trash2, Sun, Moon, BellRing, Undo2 } from "lucide-react";

type Job = Database["public"]["Tables"]["jobs"]["Row"];
type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type Settings = Database["public"]["Tables"]["outreach_settings"]["Row"];
type NaukriBump = Database["public"]["Tables"]["naukri_bumps"]["Row"];

// The ZIP is embedded in the bundle so the button works even where the
// preview access gate blocks static /downloads paths with 401.
function downloadNaukriTool() {
  const bin = atob(naukriLocalZipBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "naukri-local.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Outreach Autopilot — daily job outreach on autopilot" },
      { name: "description", content: "Track fresh LinkedIn and Naukri jobs, review verified or likely contacts, and manage personal job outreach." },
      { property: "og:title", content: "Outreach Autopilot" },
      { property: "og:description", content: "Review fresh jobs and verified or likely contacts, approve outreach, and track send results." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const nav = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [bumps, setBumps] = useState<NaukriBump[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [jobUrl, setJobUrl] = useState("");
  const [jobText, setJobText] = useState("");
  const [tab, setTab] = useState("review");
  const [runLog, setRunLog] = useState<string[]>([]);
  type Bulk = { ids: string[]; done: number; total: number; found: number; current: string; startCredits: number | null; credits: number | null; running: boolean; note?: string | undefined };
  const BULK_KEY = "find-all-contacts-run";
  const [bulk, setBulkState] = useState<Bulk | null>(null);
  const setBulk = (b: Bulk | null) => {
    setBulkState(b);
    if (b) localStorage.setItem(BULK_KEY, JSON.stringify(b));
    else localStorage.removeItem(BULK_KEY);
  };
  const stopBulk = useRef(false);
  const bulkActive = useRef(false);
  const snovBalance = useServerFn(snovBalanceFn);
  const balance = async () => (await snovBalance().catch(() => ({ balance: null }))).balance;

  // Runs in the background, one job at a time. Progress is saved so a refresh picks up where it left off;
  // jobs that already got a result (no longer "new") are never searched again.
  async function findAllContacts(resumeFrom?: Bulk) {
    if (bulkActive.current) return;
    let st: Bulk;
    if (resumeFrom) {
      st = { ...resumeFrom, running: true, note: undefined };
    } else {
      const queue = jobs.filter((j) => j.status === "new");
      if (!queue.length) {
        toast.info("No new jobs waiting for contacts");
        return;
      }
      const start = await balance();
      st = { ids: queue.map((j) => j.id), done: 0, total: queue.length, found: 0, current: "", startCredits: start, credits: start, running: true };
    }
    bulkActive.current = true;
    stopBulk.current = false;
    setBulk(st);
    const { data: fresh } = await supabase.from("jobs").select("id, company, status").in("id", st.ids);
    const byId = new Map((fresh ?? []).map((j) => [j.id, j]));
    const remaining = st.ids.filter((id) => byId.get(id)?.status === "new");
    st = { ...st, done: st.total - remaining.length };
    for (const id of remaining) {
      if (stopBulk.current) { st = { ...st, note: "Stopped by you — click Resume to continue" }; break; }
      st = { ...st, current: byId.get(id)?.company ?? "" };
      setBulk(st);
      try {
        const r = await processJob({ data: { jobId: id } });
        st = { ...st, found: st.found + r.contacts };
      } catch (e) {
        const msg = (e as Error).message;
        if (/key|credit|limit|permission|Snov|Apollo|Hunter/i.test(msg)) {
          st = { ...st, note: `Stopped: ${msg}` };
          toast.error(st.note!);
          break;
        }
      }
      st = { ...st, done: st.done + 1, credits: await balance() };
      setBulk(st);
      await load();
    }
    bulkActive.current = false;
    setBulk({ ...st, running: false, current: "", credits: await balance() });
    await load();
    if (st.done >= st.total) toast.success(`Finished — ${st.found} contacts added to the Review queue`);
  }

  // After a refresh: pick the saved run back up automatically.
  useEffect(() => {
    if (!userId) return;
    const raw = localStorage.getItem(BULK_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as Bulk;
      if (saved.running) {
        toast.info("Resuming Find all contacts where it left off");
        void findAllContacts(saved);
      } else setBulkState(saved);
    } catch {
      localStorage.removeItem(BULK_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const runNow = useServerFn(runNowFn);
  const addJob = useServerFn(addJobFn);
  const findJobs = useServerFn(findJobsFn);
  const processJob = useServerFn(processJobFn);
  const sendPending = useServerFn(sendPendingFn);
  const resetDaily = useServerFn(resetDailyLimitFn);
  const deleteContact = useServerFn(deleteContactFn);
  const deleteApproved = useServerFn(deleteApprovedFn);
  const [contactFilter, setContactFilter] = useState<string>("all");
  const testSend = useServerFn(testSendFn);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) nav({ to: "/auth" });
      else setUserId(data.session.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s) nav({ to: "/auth" });
    });
    return () => sub.subscription.unsubscribe();
  }, [nav]);

  const load = useCallback(async () => {
    if (!userId) return;
    let { data: s } = await supabase.from("outreach_settings").select("*").maybeSingle();
    if (!s) s = (await supabase.from("outreach_settings").insert({ user_id: userId }).select("*").single()).data;
    setSettings(s);
    const allContacts = async () => {
      const rows: Contact[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from("contacts").select("*").order("created_at", { ascending: false }).order("id").range(offset, offset + 499);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 500) return rows;
      }
    };
    const [{ data: j }, c, { data: b }] = await Promise.all([
      supabase.from("jobs").select("*").order("created_at", { ascending: false }).limit(100),
      allContacts(),
      supabase.from("naukri_bumps").select("*").order("bump_date", { ascending: false }).limit(28),
    ]);
    // Intentional manual additions stay visible; discovered jobs retain the experience band.
    setJobs((j ?? []).filter((x) => isJobWithinExperiencePolicy(x.source, x.title, `${x.title} ${x.description ?? ""}`)));
    setContacts(c ?? []);
    setBumps(b ?? []);
  }, [userId]);

  useEffect(() => {
    void load().catch((e) => toast.error((e as Error).message));
  }, [load]);

  // While a search runs, jobs are saved per keyword — refresh so they appear as they arrive.
  const [startJobs, setStartJobs] = useState<number | null>(null);
  useEffect(() => {
    if (busy !== "find" && busy !== "run") { setStartJobs(null); return; }
    setStartJobs((n) => n ?? jobs.length);
    const t = setInterval(() => { void load().catch(() => {}); }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, load]);
  const liveNew = startJobs === null ? 0 : Math.max(0, jobs.length - startJobs);

  async function act<T>(key: string, fn: () => Promise<T>, ok?: (r: T) => string) {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast.success(ok(r));
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    const { error } = await supabase.from("outreach_settings").update(patch).eq("user_id", settings.user_id);
    if (error) toast.error(error.message);
  }

  const { sentToday, pending, verified } = contactSummary(contacts, settings?.daily_reset_at ?? null);

  // Naukri profile bump: is a slot's window open right now and still not marked done today?
  const istToday = istParts(new Date()).date;
  const due = dueSlot(new Date());
  const bumpDue = due && !bumps.some((b) => b.bump_date === istToday && b.slot === due) ? due : null;

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div>
          <p className="label-mono">Outreach Autopilot</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Today's pipeline</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
            <Switch checked={settings.auto_enabled} onCheckedChange={(v) => saveSettings({ auto_enabled: v })} id="auto" />
            <Label htmlFor="auto" className="text-sm">Run automatically every day</Label>
          </div>
          <Button onClick={() => act("run", async () => { setRunLog([]); const r = await runNow(); setRunLog(r.log); return r; }, (r) => r.log.join(" · "))} disabled={!!busy}>
            {busy === "run" ? <Loader2 className="animate-spin" /> : <Play />} Run now
          </Button>
          <Button variant="ghost" size="icon" onClick={() => supabase.auth.signOut()} aria-label="Sign out">
            <LogOut />
          </Button>
        </div>
      </header>

      {runLog.length > 0 && <section aria-label="Last run results" className="mt-4 border-b pb-4"><p className="label-mono">Last run</p><ul className="mt-2 space-y-1 text-sm">{runLog.map((line, i) => <li key={i} className="break-words">{line}</li>)}</ul></section>}

      {settings.apollo_status === "invalid" && settings.hunter_status !== "ok" && settings.snov_status !== "ok" && (
        <div role="status" className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border p-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Free mode: finding likely emails</p>
            <p className="text-sm text-muted-foreground">Apollo (free plan) and Snov.io (out of credits) are skipped. Contacts come from LinkedIn names + the company's email format — check each one in the Review queue.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setTab("settings")}><KeyRound /> Keys</Button>
        </div>
      )}

      {bumpDue && (
        <div role="status" className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <BellRing className="size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Naukri profile bump due — {bumpDue}</p>
            <p className="text-sm text-muted-foreground">A tiny profile edit now pushes you up in recruiter search. Takes 30 seconds.</p>
          </div>
          <Button size="sm" onClick={() => setTab("naukri")}>Open Naukri tab</Button>
        </div>
      )}

      <section className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Sent today" value={`${sentToday}/${settings.daily_limit}`} />
        <Stat label="Waiting to send" value={pending} />
        <Stat label="Jobs tracked" value={jobs.length} />
        <Stat label="Verified contacts" value={verified} />
      </section>

      {bulk && (
        <div className="card-elevated mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <span className="label-mono flex items-center gap-2">
            {bulk.running && <Loader2 className="size-4 animate-spin" />} Find all contacts · {bulk.running ? "running" : "finished"}
          </span>
          <span><b>{bulk.done}</b> done</span>
          <span><b>{bulk.total - bulk.done}</b> remaining</span>
          <span><b>{bulk.found}</b> contacts found</span>
          <span>
            Credits used: <b>{bulk.startCredits != null && bulk.credits != null ? bulk.startCredits - bulk.credits : "—"}</b>
            {bulk.credits != null && <span className="text-muted-foreground"> ({bulk.credits} left)</span>}
          </span>
          {bulk.running && bulk.current && <span className="text-muted-foreground">Now: {bulk.current}</span>}
          {bulk.note && <span className="text-destructive">{bulk.note}</span>}
          <span className="ml-auto flex gap-2">
            {bulk.running ? (
              <Button size="sm" variant="outline" onClick={() => (stopBulk.current = true)}>Stop</Button>
            ) : (
              <>
                {bulk.done < bulk.total && <Button size="sm" onClick={() => findAllContacts(bulk)}>Resume ({bulk.total - bulk.done} left)</Button>}
                <Button size="sm" variant="ghost" onClick={() => setBulk(null)}>Dismiss</Button>
              </>
            )}
          </span>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="mt-8">
        <TabsList>
          <TabsTrigger value="review">Review queue</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="contacts">Contacts & emails</TabsTrigger>
          <TabsTrigger value="sent">Sent ({contacts.filter((c) => c.send_status === "sent" || c.send_status === "failed").length})</TabsTrigger>
          <TabsTrigger value="naukri">Naukri{bumpDue ? " •" : ""}</TabsTrigger>
          <TabsTrigger value="internal">Internal data</TabsTrigger>
          <TabsTrigger value="settings">Search & template</TabsTrigger>
          <TabsTrigger value="guide">Guide</TabsTrigger>
        </TabsList>

        <TabsContent value="review" className="mt-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b py-3">
            <div className="flex items-center gap-2">
            <Switch id="appr" checked={settings.require_approval} onCheckedChange={(v) => saveSettings({ require_approval: v })} />
            <Label htmlFor="appr" className="text-sm">Only send emails I've approved</Label>
            </div>
            <Button variant="outline" disabled={!!busy} onClick={() => act("template-test", () => {
              const job = jobs[0];
              const vars = { first_name: "Yash", company: job?.company, job_title: job?.title, job_url: job?.url, linkedin: settings.linkedin_url };
              return testSend({ data: { subject: renderTemplate(settings.template_subject, vars), body: renderTemplate(settings.template_body, vars) } });
            }, () => "Template test sent to your email")}>
              {busy === "template-test" ? <Loader2 className="animate-spin" /> : <FlaskConical />} Send template test to me
            </Button>
          </div>
          <ReviewQueue key={contacts.map((c) => `${c.id}:${c.send_status}`).join(",")} onChanged={load} />
        </TabsContent>

        <TabsContent value="jobs" className="mt-4 space-y-4">
          <div className="card-elevated flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="label-mono">LinkedIn + Naukri · last 24 hours</p>
              <p className="mt-1 text-sm text-muted-foreground">Pulls fresh postings for your keywords and location. Doesn't email anyone.</p>
              {(busy === "find" || busy === "run") && (
                <p className="mt-2 flex items-center gap-2 text-sm text-primary"><Loader2 className="size-3.5 animate-spin" /> Still searching… {liveNew} new job{liveNew === 1 ? "" : "s"} shown so far</p>
              )}
            </div>
            <Button disabled={!!busy} onClick={() => act("find", async () => { setRunLog([]); const r = await findJobs(); setRunLog(r.log); return r; }, (r) => `${r.added} new jobs added`)}>
              {busy === "find" ? <Loader2 className="animate-spin" /> : <Plus />} Find new jobs
            </Button>
          </div>
          <div className="card-elevated p-5">
            <p className="label-mono">Add a job manually</p>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
              <Input placeholder="Paste a LinkedIn / Naukri / careers page link" value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} />
              <Button
                disabled={!!busy || (!jobUrl && !jobText)}
                onClick={() =>
                  act(
                    "add",
                    async () => {
                      const r = await addJob({ data: jobUrl ? { url: jobUrl } : { text: jobText } });
                      setJobUrl("");
                      setJobText("");
                      return r;
                    },
                    () => "Job added — it'll be processed on the next run",
                  )
                }
              >
                {busy === "add" ? <Loader2 className="animate-spin" /> : <Plus />} Add job
              </Button>
            </div>
            <Textarea className="mt-3" rows={3} placeholder="…or paste the job description text" value={jobText} onChange={(e) => setJobText(e.target.value)} />
          </div>

          <div className="card-elevated flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="label-mono">Find contacts for all new jobs</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {bulk?.running
                  ? `Searching ${bulk.current}… ${bulk.done}/${bulk.total} jobs · ${bulk.found} contacts so far. Progress is saved — it keeps going after a refresh.`
                  : `${jobs.filter((j) => j.status === "new").length} jobs waiting. Runs in the background — keep using the dashboard.`}
              </p>
            </div>
            {bulk?.running ? (
              <Button variant="outline" onClick={() => (stopBulk.current = true)}>Stop</Button>
            ) : (
              <Button onClick={() => findAllContacts()}><RotateCw /> Find all contacts</Button>
            )}
          </div>

          <div className="card-elevated divide-y">
            {jobs.length === 0 && <p className="p-6 text-sm text-muted-foreground">No jobs yet. Click “Run now” or add one above.</p>}
            {jobs.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{j.title || "Untitled role"}</p>
                  <p className="text-sm text-muted-foreground">
                    {j.company} {j.company_domain && <span className="font-mono text-xs">· {j.company_domain}</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground" title={exactPosted(j.posted_at || j.created_at)}>
                    {postedLabel(j.posted_at, j.created_at)}
                    {j.posted_at && <span className="font-mono"> · {exactPosted(j.posted_at)}</span>}
                  </p>
                  {j.error && <p className="mt-1 text-xs text-destructive">{j.error}</p>}
                </div>
                <Badge variant="outline" className="font-mono text-xs">{j.source}</Badge>
                <StatusBadge status={j.status} />
                {j.url && !j.url.startsWith("manual:") && (
                  <a href={j.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Open job">
                    <ExternalLink className="size-4" />
                  </a>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => act(`p-${j.id}`, () => processJob({ data: { jobId: j.id } }), (r) => `Found ${r.contacts} contacts`)}
                >
                  {busy === `p-${j.id}` ? <Loader2 className="animate-spin" /> : <RotateCw />} Find contacts
                </Button>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="contacts" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {Object.entries(
              contacts.filter((c) => c.send_status === "approved" && !c.sent_at && c.company)
                .reduce<Record<string, number>>((a, c) => { a[c.company as string] = (a[c.company as string] ?? 0) + 1; return a; }, {}),
            ).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([co, n]) => (
              <Button key={co} size="sm" variant="outline" disabled={!!busy} onClick={() => act(`send-${co}`, () => sendPending({ data: { company: co } }), (r) => `Sent ${r.sent} emails to ${co}`)}>
                {busy === `send-${co}` ? <Loader2 className="animate-spin" /> : <Send />} Send {co} ({n})
              </Button>
            ))}
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("reset", () => resetDaily(), () => "Today's limit reset — you can send again")}>
              Reset today's limit
            </Button>
            <Button disabled={!!busy || !pending} onClick={() => {
              const ready = contacts.filter((c) => c.send_status === "approved" && !c.sent_at);
              const by = Object.entries(ready.reduce<Record<string, number>>((a, c) => { const k = c.company ?? "?"; a[k] = (a[k] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]);
              const list = by.slice(0, 12).map(([k, n]) => `• ${k}: ${n}`).join("\n") + (by.length > 12 ? `\n…and ${by.length - 12} more companies` : "");
              if (!window.confirm(`This sends up to ${Math.min(50, ready.length)} of ${ready.length} approved · not sent emails:\n\n${list}\n\nTo send just one company, cancel and use its "Send <company>" button.`)) return;
              act("send", () => sendPending({ data: {} }), (r) => {
              if (!r.capReached) return `Sent ${r.sent} emails`;
              const next = new Date(); next.setUTCHours(24, 0, 0, 0);
              const mins = Math.max(1, Math.round((next.getTime() - Date.now()) / 60000));
              const at = next.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
              toast.error(`Daily limit reached (${r.sentToday}/${r.dailyLimit} sent). Click "Reset today's limit" to send now, or wait until ${at} (in ${Math.floor(mins / 60)}h ${mins % 60}m) for it to reset automatically.`, { duration: 12000 });
              return "No emails sent";
            });
            }}>
              {busy === "send" ? <Loader2 className="animate-spin" /> : <Send />} Send waiting emails
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {([["all", "All"], ["approved", "Approved · not sent"], ["pending", "Needs review"], ["sent", "Sent"], ["failed", "Failed"]] as const).map(([k, l]) => (
              <Button key={k} size="sm" variant={contactFilter === k ? "default" : "outline"} onClick={() => setContactFilter(k)}>
                {l} ({k === "all" ? contacts.length : contacts.filter((c) => c.send_status === k).length})
              </Button>
            ))}
            {contactFilter === "approved" && contacts.some((c) => c.send_status === "approved" && !c.sent_at) && (
              <Button size="sm" variant="destructive" disabled={!!busy} onClick={() => {
                const n = contacts.filter((c) => c.send_status === "approved" && !c.sent_at).length;
                if (!window.confirm(`Delete all ${n} approved · not sent contacts? They will never be emailed. This can't be undone.`)) return;
                act("del-approved", () => deleteApproved(), (r) => `Deleted ${r.deleted} approved contacts`);
              }}>
                {busy === "del-approved" ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete all
              </Button>
            )}
          </div>
          <div className="card-elevated overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  {["Name", "Role", "Company", "Email", "Status", ""].map((h) => (
                    <th key={h} className="label-mono p-3 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contacts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-muted-foreground">No contacts yet.</td>
                  </tr>
                )}
                {[...contacts]
                  .filter((c) => contactFilter === "all" || c.send_status === contactFilter)
                  .sort((a, b) => (STATUS_ORDER[a.send_status] ?? 5) - (STATUS_ORDER[b.send_status] ?? 5))
                  .map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="p-3 font-medium">
                      {c.linkedin_url ? <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="hover:text-primary">{c.name}</a> : c.name}
                    </td>
                    <td className="p-3 text-muted-foreground">{c.title}</td>
                    <td className="p-3">{c.company}</td>
                    <td className="p-3 font-mono text-xs">{c.email}{c.email_status === "catch-all" && <span className="ml-2 font-sans text-muted-foreground" title="Snov found this address for this person, but the company's mail server accepts everything so it can't be 100% confirmed">(unconfirmed)</span>}{c.email_status === "guessed" && <span className="ml-2 font-sans text-muted-foreground" title="Built from the company's email format for this real person. Not verified — may bounce.">(likely)</span>}
                      {c.linkedin_url && <button className="ml-2 font-sans text-primary underline" onClick={() => { navigator.clipboard.writeText(linkedinNote(c.first_name, c.company, null)); window.open(c.linkedin_url!, "_blank"); toast.success("LinkedIn note copied — paste it in Connect → Add a note"); }}>LinkedIn note</button>}</td>
                    <td className="p-3" title={c.error ?? ""}><StatusBadge status={c.send_status} /></td>
                    <td className="p-3">
                      {c.send_status !== "sent" && c.send_status !== "sending" && (
                        <button className="text-muted-foreground hover:text-destructive" title="Delete this contact — they will never be emailed" disabled={!!busy}
                          onClick={() => { if (window.confirm(`Delete ${c.name} (${c.email})?`)) act(`del-${c.id}`, () => deleteContact({ data: { id: c.id } }), () => "Contact deleted"); }}>
                          {busy === `del-${c.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="sent" className="mt-4">
          <SentTab contacts={contacts} onChanged={load} />
        </TabsContent>

        <TabsContent value="naukri" className="mt-4">
          <NaukriTab bumps={bumps} userId={userId!} onChanged={load} />
        </TabsContent>

        <TabsContent value="internal" className="mt-4">
          <InternalDataTab userId={userId!} />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <ApolloKeyCard onChanged={load} />
          <div className="mt-4" />
          <SnovKeyCard onChanged={load} />
          <div className="mt-4" />
          <HunterKeyCard onChanged={load} />
          <div className="mt-4" />
          <SettingsForm settings={settings} onReload={load} onSave={async (p, silent) => { await saveSettings(p); if (!silent) toast.success("Saved"); }} />
        </TabsContent>

        <TabsContent value="guide" className="mt-4">
          <SetupGuide />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const STATUS_ORDER: Record<string, number> = { approved: 0, pending: 1, sending: 2, failed: 3, skipped: 4, sent: 6 };

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card-elevated p-4">
      <p className="label-mono">{label}</p>
      <p className="mt-2 font-mono text-2xl font-medium">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    sent: "bg-success text-success-foreground",
    contacts_found: "bg-success text-success-foreground",
    pending: "bg-accent text-accent-foreground",
    approved: "bg-primary text-primary-foreground",
    skipped: "bg-muted text-muted-foreground",
    new: "bg-secondary text-secondary-foreground",
    failed: "bg-destructive text-destructive-foreground",
    no_contacts: "bg-muted text-muted-foreground",
  };
  const labels: Record<string, string> = { pending: "needs review", approved: "approved · not sent", sent: "sent ✓", sending: "sending…" };
  return <span className={`whitespace-nowrap rounded px-2 py-0.5 font-mono text-xs ${map[status] ?? "bg-muted"}`}>{labels[status] ?? status.replace("_", " ")}</span>;
}

function SettingsForm({ settings, onSave, onReload }: { settings: Settings; onSave: (p: Partial<Settings>, silent?: boolean) => Promise<void>; onReload: () => Promise<void> }) {
  const [uploading, setUploading] = useState(false);
  async function uploadResume(file: File) {
    if (file.size > 5 * 1024 * 1024) { toast.error("Resume must be under 5 MB"); return; }
    setUploading(true);
    const path = `${settings.user_id}/${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error } = await supabase.storage.from("resumes").upload(path, file, { upsert: true, contentType: file.type });
    if (error) { setUploading(false); toast.error(error.message); return; }
    await supabase.from("outreach_settings").update({ resume_path: path, resume_filename: file.name }).eq("user_id", settings.user_id);
    setUploading(false);
    toast.success("Resume uploaded");
    await onReload();
  }
  const [f, setF] = useState({
    keywords: settings.keywords,
    location: settings.location,
    titles: settings.target_titles.join(", "),
    daily_limit: settings.daily_limit,
    contacts_per_job: settings.contacts_per_job,
    template_subject: settings.template_subject,
    template_body: settings.template_body,
    linkedin_url: settings.linkedin_url,
  });

  // Auto-save: one second after typing stops, every field (subject, keywords,
  // body, ...) is written to the database, so a refresh never loses edits.
  const firstRender = useRef(true);
  const savePayload = (v: typeof f): Partial<Settings> => ({
    keywords: v.keywords,
    location: v.location,
    target_titles: v.titles.split(",").map((t) => t.trim()).filter(Boolean),
    daily_limit: Math.max(1, Math.min(200, v.daily_limit || 1)),
    contacts_per_job: Math.max(1, Math.min(15, v.contacts_per_job || 1)),
    template_subject: v.template_subject,
    template_body: v.template_body,
    linkedin_url: v.linkedin_url.trim(),
  });
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const t = setTimeout(() => { void onSave(savePayload(f), true); }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card-elevated space-y-4 p-5">
        <p className="label-mono">Job search</p>
        <Field label="Job keywords"><JobKeywordsInput value={f.keywords} onChange={(keywords) => setF((prev) => ({ ...prev, keywords }))} /></Field>
        <Field label="Location"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="People to contact (comma separated)"><Input value={f.titles} onChange={(e) => setF({ ...f, titles: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Emails per day (safety cap)"><Input type="number" min={1} max={200} value={f.daily_limit} onChange={(e) => setF({ ...f, daily_limit: Number(e.target.value) })} /></Field>
          <Field label="Emails per company"><Input type="number" min={1} max={15} value={f.contacts_per_job} onChange={(e) => setF({ ...f, contacts_per_job: Number(e.target.value) })} /></Field>
        </div>
      </div>
      <div className="card-elevated space-y-4 p-5">
        <p className="label-mono">Email template</p>
        <SenderEmailSettings value={settings.sender_email} onSave={async (sender_email) => {
          const { error } = await supabase.from("outreach_settings").update({ sender_email }).eq("user_id", settings.user_id);
          if (error) throw new Error(error.message);
          await onReload();
        }} />
        <Field label="Subject"><Input value={f.template_subject} onChange={(e) => setF({ ...f, template_subject: e.target.value })} /></Field>
        <Field label="Your LinkedIn profile"><Input value={f.linkedin_url} onChange={(e) => setF({ ...f, linkedin_url: e.target.value })} /></Field>
        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm">{settings.resume_filename ?? "No resume uploaded"}</span>
            </div>
            <label className="cursor-pointer text-sm font-medium text-primary hover:underline">
              {uploading ? "Uploading…" : settings.resume_filename ? "Replace" : "Upload PDF"}
              <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => e.target.files?.[0] && uploadResume(e.target.files[0])} />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Switch id="attach" checked={settings.attach_resume} onCheckedChange={(v) => onSave({ attach_resume: v })} />
            <Label htmlFor="attach" className="text-sm">Attach resume to every email</Label>
          </div>
        </div>
        <Field label="Body"><Textarea rows={10} value={f.template_body} onChange={(e) => setF({ ...f, template_body: e.target.value })} /></Field>
        <p className="text-xs text-muted-foreground">
          Placeholders: <span className="font-mono">{"{{first_name}} {{company}} {{job_title}} {{job_reference}} {{job_url}} {{job_id}} {{linkedin}}"}</span>
        </p>
      </div>
      <div className="md:col-span-2">
        <Button
          onClick={() =>
            onSave(savePayload(f))
          }
        >
          Save settings
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ApolloKeyCard({ onChanged }: { onChanged: () => Promise<void> }) {
  const info = useServerFn(apolloKeyInfoFn);
  const save = useServerFn(saveApolloKeyFn);
  const remove = useServerFn(removeApolloKeyFn);
  const [state, setState] = useState<{ hasKey: boolean; last4: string | null } | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => info().then(setState).catch(() => setState({ hasKey: false, last4: null })), [info]);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <div className="card-elevated p-5">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" />
        <p className="label-mono">Apollo API key</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {state?.hasKey ? <>Using your key ending in <span className="font-mono">…{state.last4}</span>.</> : "Using the connected Apollo account."} If it expires, paste a new one here. It's checked before saving and never shown again.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input type="password" className="max-w-md" placeholder="Paste Apollo API key" value={key} onChange={(e) => setKey(e.target.value)} />
        <Button
          disabled={busy || key.trim().length < 10}
          onClick={async () => {
            setBusy(true);
            try { await save({ data: { apiKey: key } }); setKey(""); toast.success("Apollo key saved and working"); await refresh(); await onChanged(); }
            catch (e) { toast.error((e as Error).message); }
            finally { setBusy(false); }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : null} Save key
        </Button>
        {state?.hasKey && (
          <Button variant="outline" disabled={busy} onClick={async () => { await remove(); toast.success("Key removed"); await refresh(); await onChanged(); }}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

type ReviewItem = { id: string; name: string; title: string | null; company: string | null; email: string; status: string; emailStatus: string | null; linkedinUrl: string | null; jobTitle: string; subject: string; body: string };

function ReviewQueue({ onChanged }: { onChanged: () => Promise<void> }) {
  const list = useServerFn(reviewQueueFn);
  const approveAll = useServerFn(approveAllFn);
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const refresh = useCallback(() => list().then(setItems).catch((e) => toast.error((e as Error).message)), [list]);
  useEffect(() => { refresh(); }, [refresh]);
  if (!items) return <Loader2 className="animate-spin text-muted-foreground" />;
  const waiting = items.filter((i) => i.status === "pending").length;
  const likelyWaiting = items.filter((i) => i.status === "pending" && i.emailStatus === "guessed").length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{waiting} waiting for review · {items.length - waiting} approved{likelyWaiting ? ` · ${likelyWaiting} likely emails included` : ""}</p>
        <Button size="sm" variant="outline" disabled={waiting === 0} onClick={async () => { await approveAll(); toast.success(`Approved ${waiting} ${waiting === 1 ? "email" : "emails"}`); await refresh(); await onChanged(); }}>
          <Check /> Approve all
        </Button>
      </div>
      {items.length === 0 && <div className="card-elevated p-6 text-sm text-muted-foreground">Nothing to review. New contacts appear here after a run.</div>}
      {items.map((it) => <ReviewCard key={it.id} item={it} onDone={async () => { await refresh(); await onChanged(); }} />)}
    </div>
  );
}

function ReviewCard({ item, onDone }: { item: ReviewItem; onDone: () => Promise<void> }) {
  const update = useServerFn(updateReviewFn);
  const test = useServerFn(testSendFn);
  const [f, setF] = useState({ email: item.email, name: item.name, subject: item.subject, body: item.body });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const likely = item.emailStatus === "guessed";
  const [checked, setChecked] = useState(false);
  const domain = item.email.split("@")[1] ?? "";
  const [first = "", ...restName] = f.name.trim().split(/\s+/);
  const last = restName[restName.length - 1] ?? "";
  const formats: Pattern[] = ["first.last", "flast", "firstlast", "f.last", "first"];
  const options = [...new Set(formats.map((p) => buildEmail(p, first, last, domain)).filter(Boolean) as string[])];
  async function save(status: "pending" | "approved" | "skipped", msg: string) {
    setBusy(status);
    try { await update({ data: { id: item.id, ...f, status } }); toast.success(msg); await onDone(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  }
  return (
    <div className="card-elevated p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{f.name || "Unknown"} <span className="text-sm font-normal text-muted-foreground">· {item.title} at {item.company}</span></p>
          <p className="font-mono text-xs text-muted-foreground">{f.email}{likely && <span className="ml-1 font-sans">(likely)</span>} · re: {item.jobTitle}</p>
        </div>
        <StatusBadge status={item.status} />
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Close" : "Edit"}</Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => save("skipped", likely ? "Rejected" : "Skipped")}><X /> {likely ? "Reject" : "Skip"}</Button>
        <Button size="sm" disabled={!!busy || (likely && !checked)} title={likely && !checked ? "Tick 'I checked this email' first" : ""} onClick={() => save("approved", "Approved")}>{busy === "approved" ? <Loader2 className="animate-spin" /> : <Check />} Approve</Button>
      </div>
      {likely && item.status === "pending" && (
        <div className="mt-3 space-y-2 rounded-md border border-dashed p-3 text-sm">
          <p><span className="font-medium">Likely email — check before approving.</span> <span className="text-muted-foreground">Built from the company's usual format; it may bounce.</span></p>
          <div className="flex flex-wrap gap-2">
            {item.linkedinUrl && <a className="text-primary underline" href={item.linkedinUrl} target="_blank" rel="noreferrer">Check they still work at {item.company}</a>}
            <a className="text-primary underline" href={`https://www.google.com/search?q=${encodeURIComponent(`"@${domain}" email format`)}`} target="_blank" rel="noreferrer">See {domain} email format</a>
            <a className="text-primary underline" href={`https://www.google.com/search?q=${encodeURIComponent(`"${f.email}"`)}`} target="_blank" rel="noreferrer">Search this exact email</a>
          </div>
          {options.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Other formats:</span>
              {options.map((o) => (
                <Button key={o} size="sm" variant={o === f.email ? "default" : "outline"} className="h-7 font-mono text-xs" onClick={() => setF({ ...f, email: o })}>{o}</Button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I checked this email</label>
        </div>
      )}
      {open && (
        <div className="mt-4 grid gap-3 border-t pt-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Recipient name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Recipient email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          </div>
          <Field label="Subject"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
          <Field label="Email"><Textarea rows={10} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => save("pending", "Changes saved")}>Save changes</Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!!busy}
              onClick={async () => {
                setBusy("test");
                try { const r = await test({ data: { subject: f.subject, body: f.body } }); toast.success(`Test sent to ${r.to}`); }
                catch (e) { toast.error((e as Error).message); }
                finally { setBusy(null); }
              }}
            >
              {busy === "test" ? <Loader2 className="animate-spin" /> : <FlaskConical />} Send test to me
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HunterKeyCard({ onChanged }: { onChanged: () => Promise<void> }) {
  const info = useServerFn(hunterKeyInfoFn);
  const save = useServerFn(saveHunterKeyFn);
  const remove = useServerFn(removeHunterKeyFn);
  const [state, setState] = useState<{ hasKey: boolean; last4: string | null } | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => info().then(setState).catch(() => setState({ hasKey: false, last4: null })), [info]);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <div className="card-elevated p-5">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" />
        <p className="label-mono">Hunter.io API key (backup)</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {state?.hasKey ? <>Using your key ending in <span className="font-mono">…{state.last4}</span>.</> : "Not set."} Used when Apollo can't find people. Only verified emails are kept. Free key at{" "}
        <a href="https://hunter.io/users/sign_up" target="_blank" rel="noreferrer" className="text-primary hover:underline">hunter.io</a> → API.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input type="password" className="max-w-md" placeholder="Paste Hunter API key" value={key} onChange={(e) => setKey(e.target.value)} />
        <Button
          disabled={busy || key.trim().length < 10}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await save({ data: { apiKey: key } });
              setKey("");
              toast.success(r.searchesLeft != null ? `Hunter key saved — ${r.searchesLeft} searches left this month` : "Hunter key saved");
              await refresh(); await onChanged();
            } catch (e) { toast.error((e as Error).message); }
            finally { setBusy(false); }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : null} Save key
        </Button>
        {state?.hasKey && (
          <Button variant="outline" disabled={busy} onClick={async () => { await remove(); toast.success("Key removed"); await refresh(); await onChanged(); }}>Remove</Button>
        )}
      </div>
    </div>
  );
}

function SnovKeyCard({ onChanged }: { onChanged: () => Promise<void> }) {
  const info = useServerFn(snovKeyInfoFn);
  const save = useServerFn(saveSnovKeyFn);
  const remove = useServerFn(removeSnovKeyFn);
  const [state, setState] = useState<{ hasKey: boolean; last4: string | null } | null>(null);
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => info().then(setState).catch(() => setState({ hasKey: false, last4: null })), [info]);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <div className="card-elevated p-5">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" />
        <p className="label-mono">Snov.io API key (free, Gmail sign-up OK)</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {state?.hasKey ? <>Connected (User ID ending <span className="font-mono">…{state.last4}</span>).</> : "Not set."} Used when Apollo can't find people. Only verified emails on the company's own domain are kept. Get both values at{" "}
        <a href="https://app.snov.io/account/api" target="_blank" rel="noreferrer" className="text-primary hover:underline">snov.io → Settings → API</a>.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="API User ID" value={id} onChange={(e) => setId(e.target.value)} />
        <Input type="password" className="max-w-xs" placeholder="API Secret" value={secret} onChange={(e) => setSecret(e.target.value)} />
        <Button
          disabled={busy || id.trim().length < 6 || secret.trim().length < 6}
          onClick={async () => {
            setBusy(true);
            try {
              await save({ data: { clientId: id, clientSecret: secret } });
              setId(""); setSecret("");
              toast.success("Snov.io key saved");
              await refresh(); await onChanged();
            } catch (e) { toast.error((e as Error).message); }
            finally { setBusy(false); }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : null} Save key
        </Button>
        {state?.hasKey && (
          <Button variant="outline" disabled={busy} onClick={async () => { await remove(); toast.success("Key removed"); await refresh(); await onChanged(); }}>Remove</Button>
        )}
      </div>
    </div>
  );
}

function SentTab({ contacts, onChanged }: { contacts: Contact[]; onChanged: () => void | Promise<void> }) {
  const checkBounces = useServerFn(checkBouncesFn);
  const [checking, setChecking] = useState(false);
  const [filter, setFilter] = useState<"all" | "ok" | "bounced" | "failed" | "opened">("all");
  const sent = contacts.filter((c) => c.send_status === "sent");
  const failed = contacts.filter((c) => c.send_status === "failed");
  const bounced = sent.filter((c) => c.delivery_status === "bounced");
  const ok = sent.filter((c) => c.delivery_status !== "bounced");
  const opened = sent.filter((c) => (c.open_count ?? 0) > 0);
  const resume = sent.filter((c) => (c.resume_open_count ?? 0) > 0);
  const run = async (quiet = false) => {
    setChecking(true);
    try {
      const r = await checkBounces();
      if (!quiet) toast.success(r.bounced ? `${r.bounced} new bounced addresses found` : "No new bounces found");
      await onChanged();
    } catch (e) {
      if (!quiet) toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => { if (sent.length) void run(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = [...sent, ...failed]
    .filter((c) => filter === "all" || (filter === "ok" && c.send_status === "sent" && c.delivery_status !== "bounced") || (filter === "bounced" && c.delivery_status === "bounced") || (filter === "failed" && c.send_status === "failed") || (filter === "opened" && (c.open_count ?? 0) > 0))
    .sort((a, b) => String(b.sent_at ?? b.created_at).localeCompare(String(a.sent_at ?? a.created_at)));
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const stats: Array<[typeof filter, string, number, string]> = [
    ["all", "Sent total", contactSummary(contacts, null).sent, ""],
    ["ok", "No bounce yet", ok.length, "Sent, no bounce found in your Gmail so far — bounces can arrive hours later. Not proof it was read."],
    ["bounced", "Address not found", bounced.length, "Bounced back"],
    ["failed", "Failed to send", failed.length, "Gmail refused"],
    ["opened", "Opened", opened.length, `${resume.length} opened resume link`],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map(([k, label, n, sub]) => (
          <button key={k} onClick={() => setFilter(k)} className={`card-elevated p-4 text-left ${filter === k ? "ring-2 ring-primary" : ""}`}>
            <p className="label-mono">{label}</p>
            <p className={`mt-1 text-2xl font-semibold ${k === "bounced" || k === "failed" ? "text-destructive" : ""}`}>{n}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Bounces are read from "address not found" replies in your Gmail. Opens are approximate — some mail apps block images, Gmail may show one open when it scans. The resume is attached to every email and can't be tracked.</p>
        <Button variant="outline" disabled={checking} onClick={() => run()}>
          {checking ? <Loader2 className="animate-spin" /> : <RotateCw />} Check for bounces
        </Button>
      </div>
      <div className="card-elevated overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              {["Name", "Company", "Email", "Sent", "Result", "Opened", "Resume"].map((h) => (
                <th key={h} className="label-mono p-3 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-muted-foreground">Nothing here yet.</td></tr>
            )}
            {rows.map((c) => {
              const result = c.send_status === "failed" ? "failed" : c.delivery_status === "bounced" ? "bounced" : "ok";
              return (
                <tr key={c.id} className="border-b align-top last:border-0">
                  <td className="p-3 font-medium">
                    {c.linkedin_url ? <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="hover:text-primary">{c.name}</a> : c.name}
                    <p className="text-xs font-normal text-muted-foreground">{c.title}</p>
                  </td>
                  <td className="p-3">{c.company}</td>
                  <td className="p-3 font-mono text-xs">{c.email}{c.email_status === "guessed" && <span className="ml-1 font-sans text-muted-foreground">(likely)</span>}</td>
                  <td className="p-3 text-xs text-muted-foreground">{fmt(c.sent_at)}</td>
                  <td className="p-3">
                    {result === "ok" && <Badge variant="outline" className="border-primary text-primary">No bounce yet</Badge>}
                    {result === "bounced" && <Badge variant="destructive">Address not found</Badge>}
                    {result === "failed" && <Badge variant="destructive">Not sent</Badge>}
                    {(c.bounce_reason || (result === "failed" && c.error)) && <p className="mt-1 max-w-xs text-xs text-muted-foreground">{c.bounce_reason || c.error}</p>}
                  </td>
                  <td className="p-3 text-xs">{c.open_count ? <span><b>{c.open_count}×</b> <span className="text-muted-foreground">first {fmt(c.opened_at)}</span></span> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-3 text-xs">{c.resume_open_count ? <span><b>{c.resume_open_count}×</b> <span className="text-muted-foreground">{fmt(c.resume_opened_at)}</span></span> : <span className="text-muted-foreground">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const NAUKRI_PROFILE_URL = "https://www.naukri.com/mnjuser/profile";

function NaukriTab({ bumps, userId, onChanged }: { bumps: NaukriBump[]; userId: string; onChanged: () => Promise<void> }) {
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const now = new Date();
  const today = istParts(now).date;
  const due = dueSlot(now);
  const doneFor = (slot: BumpSlot) => bumps.find((b) => b.bump_date === today && b.slot === slot);

  async function mark(slot: BumpSlot, undo: boolean) {
    setBusySlot(slot);
    try {
      if (undo) {
        const { error } = await supabase.from("naukri_bumps").delete().eq("user_id", userId).eq("bump_date", today).eq("slot", slot);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("naukri_bumps").upsert(
          { user_id: userId, bump_date: today, slot, done_at: new Date().toISOString() },
          { onConflict: "user_id,bump_date,slot" },
        );
        if (error) throw error;
        toast.success(`${slot === "morning" ? "Morning" : "Evening"} bump marked done`);
      }
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusySlot(null);
    }
  }

  // Last 14 days, newest first, grouped by date for the history list.
  const byDate = new Map<string, NaukriBump[]>();
  for (const b of bumps) {
    const list = byDate.get(b.bump_date) ?? [];
    list.push(b);
    byDate.set(b.bump_date, list);
  }
  const days = [...byDate.entries()].slice(0, 14);

  return (
    <div className="space-y-6">
      <div className="card-elevated flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Your Naukri profile</p>
          <p className="text-sm text-muted-foreground">
            Keep your profile accurate. An unchanged save is not proven to improve recruiter visibility.
          </p>
        </div>
        <Button asChild>
          <a href={NAUKRI_PROFILE_URL} target="_blank" rel="noreferrer">
            <ExternalLink /> Open my Naukri profile
          </a>
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-y py-4">
        <div>
          <p className="font-medium">Local automatic saves</p>
          <p className="text-sm text-muted-foreground">8 AM / 9 PM IST · Computer must stay awake · Not connected</p>
          <p className="text-xs text-muted-foreground">Resume headline stays unchanged. Live Naukri save not yet verified; results stay on your computer.</p>
        </div>
        <Button variant="outline" onClick={downloadNaukriTool}><FileText /> Download local tool</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(["morning", "evening"] as const).map((slot) => {
          const done = doneFor(slot);
          const isDue = due === slot && !done;
          const Icon = slot === "morning" ? Sun : Moon;
          return (
            <div key={slot} className={`card-elevated space-y-3 p-5 ${isDue ? "ring-2 ring-primary" : ""}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 font-medium">
                  <Icon className="size-4" /> {slot === "morning" ? "Morning" : "Evening"} bump
                </p>
                <span className="label-mono">{SLOT_WINDOWS[slot].label}</span>
              </div>
              {done ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Badge className="bg-success text-success-foreground">Done at {fmtDoneAt(done.done_at)}</Badge>
                  <Button variant="ghost" size="sm" disabled={busySlot === slot} onClick={() => mark(slot, true)}>
                    <Undo2 /> Undo
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-muted-foreground">{isDue ? "Due now — window is open" : "Not done yet today"}</span>
                  <Button size="sm" variant={isDue ? "default" : "outline"} disabled={busySlot === slot} onClick={() => mark(slot, false)}>
                    {busySlot === slot ? <Loader2 className="animate-spin" /> : <Check />} Mark done
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card-elevated p-5">
        <p className="label-mono">Last 14 days</p>
        {days.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing marked yet. Do your first bump and mark it done above.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {days.map(([date, list]) => (
              <li key={date} className="flex flex-wrap items-center gap-3">
                <span className="w-16 font-mono text-xs text-muted-foreground">{date === today ? "Today" : fmtBumpDate(date)}</span>
                {(["morning", "evening"] as const).map((slot) => {
                  const b = list.find((x) => x.slot === slot);
                  return b ? (
                    <Badge key={slot} variant="outline" className="border-success text-success">
                      {slot === "morning" ? <Sun className="size-3" /> : <Moon className="size-3" />} {fmtDoneAt(b.done_at)}
                    </Badge>
                  ) : (
                    <span key={slot} className="text-xs text-muted-foreground">{slot} —</span>
                  );
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
