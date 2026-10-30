import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { contactsFromRows, contactsFromText, peopleFromPdfItems, type InternalContact, type InternalPerson, type PdfItem } from "@/lib/internalData";

type FileSummary = { source_file: string; count: number };

async function readFile(file: File): Promise<InternalContact[] | { people: InternalPerson[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = "";
    const people: InternalPerson[] = [];
    let header: PdfItem[] | null = null;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let items: PdfItem[] = (tc.items as { str: string; transform: number[] }[]).map((t) => ({ str: t.str, x: t.transform[4] ?? 0, y: t.transform[5] ?? 0 }));
      const nameHead = items.find((t) => /^name$/i.test(t.str.trim()));
      if (nameHead) header = items.filter((t) => Math.abs(t.y - nameHead.y) < 1.5 && t.x >= nameHead.x - 3).map((t) => ({ ...t, y: 1e6 }));
      else if (header) items = [...header, ...items]; // table continues on later pages without its header
      people.push(...peopleFromPdfItems(items));
      let lastY: number | null = null;
      for (const it of tc.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
        const y = it.transform[5] ?? 0;
        text += lastY !== null && Math.abs(y - lastY) > 2 ? "\n" : " ";
        text += it.str;
        lastY = y;
      }
      text += "\n";
    }
    const emails = contactsFromText(text);
    return emails.length ? emails : { people };
  }
  if (/\.(xlsx|xls|csv|ods)$/.test(name)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer());
    const all: InternalContact[] = [];
    for (const sn of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn]!, { header: 1, defval: "" });
      all.push(...contactsFromRows(rows));
    }
    return all;
  }
  return contactsFromText(await file.text());
}

export function InternalDataTab({ userId }: { userId: string }) {
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [companies, setCompanies] = useState(0);
  const [peopleFiles, setPeopleFiles] = useState<FileSummary[]>([]);
  const [peopleCompanies, setPeopleCompanies] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [useDirect, setUseDirect] = useState(false);
  useEffect(() => {
    void supabase.from("outreach_settings").select("use_internal_emails").eq("user_id", userId).maybeSingle()
      .then(({ data }) => setUseDirect(!!data?.use_internal_emails));
  }, [userId]);
  async function toggleDirect(v: boolean) {
    setUseDirect(v);
    const { error } = await supabase.from("outreach_settings").update({ use_internal_emails: v }).eq("user_id", userId);
    if (error) { setUseDirect(!v); toast.error(error.message); } else toast.success(v ? "List emails will be used directly" : "List emails used only to learn email formats");
  }
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ email: string; name: string | null; company: string | null }[]>([]);

  const load = useCallback(async () => {
    const rows: { source_file: string | null; domain: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("internal_contacts").select("source_file, domain").range(from, from + 999);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(r.source_file ?? "?", (m.get(r.source_file ?? "?") ?? 0) + 1));
    const ppl: { source_file: string | null; domain: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("internal_people").select("source_file, domain").range(from, from + 999);
      ppl.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const pm = new Map<string, number>();
    ppl.forEach((r) => pm.set(r.source_file ?? "?", (pm.get(r.source_file ?? "?") ?? 0) + 1));
    setPeopleFiles([...pm].map(([source_file, count]) => ({ source_file, count })));
    setPeopleCompanies(new Set(ppl.map((r) => r.domain)).size);
    setFiles([...m].map(([source_file, count]) => ({ source_file, count })));
    setTotal(rows.length);
    setCompanies(new Set(rows.map((r) => r.domain)).size);
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) return setHits([]);
      const s = q.trim().replace(/[%,()]/g, "");
      const { data } = await supabase.from("internal_contacts").select("email, name, company")
        .or(`company.ilike.%${s}%,domain.ilike.%${s}%,email.ilike.%${s}%`).limit(30);
      setHits(data ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const [preview, setPreview] = useState<{ file: string; rows: (InternalContact & { keep: boolean })[] } | null>(null);

  async function save(fileName: string, found: InternalContact[]) {
        for (let i = 0; i < found.length; i += 500) {
          const chunk = found.slice(i, i + 500).map((c) => ({ ...c, user_id: userId, source_file: fileName }));
          const { error } = await supabase.from("internal_contacts").upsert(chunk, { onConflict: "user_id,email", ignoreDuplicates: true });
          if (error) throw error;
        }
        toast.success(`${fileName}: ${found.length} company emails saved`);
  }

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    for (const file of Array.from(list)) {
      setBusy(file.name);
      try {
        const found = await readFile(file);
        if (!Array.isArray(found)) {
          if (!found.people.length) { toast.error(`${file.name}: no emails or HR people table found (scanned PDFs can't be read)`); continue; }
          setPeoplePreview({ file: file.name, rows: found.people.map((r) => ({ ...r, keep: true })) });
          continue;
        }
        if (!found.length) { toast.error(`${file.name}: no company emails found`); continue; }
        if (file.name.toLowerCase().endsWith(".pdf")) { setPreview({ file: file.name, rows: found.map((r) => ({ ...r, keep: true })) }); continue; }
        await save(file.name, found);
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : "could not read"}`);
      }
    }
    setBusy(null);
    await load();
  }

  const [peoplePreview, setPeoplePreview] = useState<{ file: string; rows: (InternalPerson & { keep: boolean })[] } | null>(null);
  async function confirmPeople() {
    if (!peoplePreview) return;
    setBusy(peoplePreview.file);
    try {
      const keep = peoplePreview.rows.filter((r) => r.keep).map(({ keep: _k, ...r }) => ({ ...r, company: r.company?.trim() || null, user_id: userId, source_file: peoplePreview.file }));
      for (let i = 0; i < keep.length; i += 500) {
        const { error } = await supabase.from("internal_people").upsert(keep.slice(i, i + 500), { onConflict: "user_id,linkedin_url", ignoreDuplicates: true });
        if (error) throw error;
      }
      toast.success(`${peoplePreview.file}: ${keep.length} HR people saved`);
      setPeoplePreview(null);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Save failed"); }
    setBusy(null);
  }
  const editPerson = (i: number, patch: Partial<InternalPerson & { keep: boolean }>) =>
    setPeoplePreview((p) => p && { ...p, rows: p.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  async function confirmPreview() {
    if (!preview) return;
    setBusy(preview.file);
    try {
      await save(preview.file, preview.rows.filter((r) => r.keep).map(({ keep: _k, ...r }) => ({ ...r, company: r.company?.trim() || null })));
      setPreview(null);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Save failed"); }
    setBusy(null);
  }
  const editRow = (i: number, patch: Partial<InternalContact & { keep: boolean }>) =>
    setPreview((p) => p && { ...p, rows: p.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  async function removePeopleFile(f: string) {
    if (!confirm(`Remove all ${peopleFiles.find((x) => x.source_file === f)?.count ?? ""} HR people from ${f}?`)) return;
    await supabase.from("internal_people").delete().eq("source_file", f);
    await load();
  }

  async function removeFile(f: string) {
    if (!confirm(`Remove all ${files.find((x) => x.source_file === f)?.count ?? ""} emails from ${f}?`)) return;
    await supabase.from("internal_contacts").delete().eq("source_file", f);
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-semibold">Your HR lists</h3>
        <p className="text-sm text-muted-foreground">
          Upload Excel, CSV or PDF files with HR emails. When a new job is from a company in your list, the company's email format
          (e.g. first.last@) is learned from them for likely emails. Personal addresses (Gmail, Yahoo…) are skipped.
        </p>
        <label className="flex items-start gap-2 rounded border p-3 text-sm">
          <Switch checked={useDirect} onCheckedChange={toggleDirect} aria-label="Email people from my list directly" />
          <span><b>Email people from my list directly</b><br /><span className="text-muted-foreground">
            Off: list emails are never emailed, only used to find the format. On: matching list emails are added to the Review queue first.</span></span>
        </label>
        <div className="flex flex-wrap gap-2">
        <label className="inline-flex">
          <input type="file" multiple accept=".xlsx,.xls,.csv,.ods,.txt" className="hidden" disabled={!!busy}
            onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
          <span className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? `Reading ${busy}…` : "Upload Excel / CSV"}
          </span>
        </label>
        <label className="inline-flex">
          <input type="file" multiple accept=".pdf,application/pdf" className="hidden" disabled={!!busy}
            onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
          <span className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? `Reading ${busy}…` : "Upload PDF"}
          </span>
        </label>
        </div>
        <p className="text-sm"><b>{total}</b> emails across <b>{companies}</b> companies</p>
        {files.map((f) => (
          <div key={f.source_file} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
            <span>{f.source_file} · {f.count} emails</span>
            <Button size="sm" variant="ghost" onClick={() => removeFile(f.source_file)} aria-label={`Remove ${f.source_file}`}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <p className="text-sm"><b>{peopleFiles.reduce((a, f) => a + f.count, 0)}</b> HR people (no email) across <b>{peopleCompanies}</b> companies — their emails are built from each company's format and marked likely.</p>
        {peopleFiles.map((f) => (
          <div key={"p" + f.source_file} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
            <span>{f.source_file} · {f.count} HR people</span>
            <Button size="sm" variant="ghost" onClick={() => removePeopleFile(f.source_file)} aria-label={`Remove people from ${f.source_file}`}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
      {peoplePreview && (
        <div className="rounded-lg border-2 border-primary bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Check {peoplePreview.file} before saving — {peoplePreview.rows.length} HR people, {new Set(peoplePreview.rows.map((r) => r.domain)).size} companies</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPeoplePreview(null)}>Cancel</Button>
              <Button size="sm" disabled={!!busy || !peoplePreview.rows.some((r) => r.keep)} onClick={confirmPeople}>
                Save {peoplePreview.rows.filter((r) => r.keep).length} of {peoplePreview.rows.length}
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">This PDF has names, titles, LinkedIn and company websites but no emails. Untick wrong rows and fix company names. Nothing is saved until you click Save.</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPeoplePreview((p) => p && { ...p, rows: p.rows.map((r) => ({ ...r, keep: true })) })}>Tick all</Button>
            <Button variant="ghost" size="sm" onClick={() => setPeoplePreview((p) => p && { ...p, rows: p.rows.map((r) => ({ ...r, keep: false })) })}>Untick all</Button>
          </div>
          <div className="max-h-[480px] overflow-auto rounded border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted"><tr><th className="p-2 w-8" /><th className="p-2 text-left">Name</th><th className="p-2 text-left">Title</th><th className="p-2 text-left">Company</th><th className="p-2 text-left">Website</th></tr></thead>
              <tbody>
                {peoplePreview.rows.map((r, i) => (
                  <tr key={r.linkedin_url} className={r.keep ? "" : "opacity-50"}>
                    <td className="p-2"><input type="checkbox" aria-label={`Keep ${r.name}`} checked={r.keep} onChange={(e) => editPerson(i, { keep: e.target.checked })} /></td>
                    <td className="p-2"><a className="underline" href={r.linkedin_url} target="_blank" rel="noreferrer">{r.name}</a></td>
                    <td className="p-2">{r.title}</td>
                    <td className="p-1"><Input className="h-8" value={r.company ?? ""} onChange={(e) => editPerson(i, { company: e.target.value })} /></td>
                    <td className="p-2">{r.domain}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {preview && (
        <div className="rounded-lg border-2 border-primary bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Check {preview.file} before saving</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>Cancel</Button>
              <Button size="sm" disabled={!!busy || !preview.rows.some((r) => r.keep)} onClick={confirmPreview}>
                Save {preview.rows.filter((r) => r.keep).length} of {preview.rows.length}
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Untick wrong emails and fix company names. Nothing is saved until you click Save.</p>
          <div className="flex gap-2 text-sm">
            <Button variant="ghost" size="sm" onClick={() => setPreview((p) => p && { ...p, rows: p.rows.map((r) => ({ ...r, keep: true })) })}>Tick all</Button>
            <Button variant="ghost" size="sm" onClick={() => setPreview((p) => p && { ...p, rows: p.rows.map((r) => ({ ...r, keep: false })) })}>Untick all</Button>
          </div>
          <div className="max-h-[480px] overflow-auto rounded border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted"><tr><th className="p-2 w-8" /><th className="p-2 text-left">Email</th><th className="p-2 text-left">Company</th></tr></thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={r.email} className={r.keep ? "" : "opacity-50"}>
                    <td className="p-2"><input type="checkbox" aria-label={`Keep ${r.email}`} checked={r.keep} onChange={(e) => editRow(i, { keep: e.target.checked })} /></td>
                    <td className="p-2">{r.email}</td>
                    <td className="p-1"><Input className="h-8" value={r.company ?? ""} onChange={(e) => editRow(i, { company: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="rounded-lg border bg-card p-4 space-y-2">
        <h3 className="font-semibold">Search your list</h3>
        <Input placeholder="Company name or domain, e.g. capgemini" value={q} onChange={(e) => setQ(e.target.value)} />
        {hits.map((h) => (
          <div key={h.email} className="text-sm"><b>{h.company}</b> · {h.name ? `${h.name} · ` : ""}{h.email}</div>
        ))}
      </div>
    </div>
  );
}
