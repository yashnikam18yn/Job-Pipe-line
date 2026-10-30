// Browser-safe parsing of uploaded HR lists (Excel/CSV rows or PDF text) into contacts.
export type InternalContact = { email: string; domain: string; name: string | null; company: string | null; title: string | null };

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const FREE = new Set(["gmail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com", "live.com", "rediffmail.com", "icloud.com", "aol.com", "protonmail.com", "ymail.com", "msn.com"]);

export const isFreeMail = (domain: string) => FREE.has(domain.toLowerCase());

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const companyFromDomain = (d: string) => {
  const base = d.split(".").slice(-3).find((p) => !["co", "com", "in", "net", "org", "www", "careers", "mail"].includes(p)) ?? d;
  return base.charAt(0).toUpperCase() + base.slice(1);
};

function push(out: Map<string, InternalContact>, email: string, extra: { name?: string | null | undefined; company?: string | null | undefined; title?: string | undefined }) {
  const e = email.toLowerCase().replace(/[.]+$/, "");
  const domain = e.split("@")[1] ?? "";
  if (!domain || isFreeMail(domain) || out.has(e)) return;
  out.set(e, { email: e, domain, name: extra.name || null, company: extra.company || companyFromDomain(domain), title: extra.title || null });
}

/** Rows from a spreadsheet; the header row (if any) decides which column is name / company / title. */
export function contactsFromRows(rows: unknown[][]): InternalContact[] {
  const out = new Map<string, InternalContact>();
  let col = { name: -1, company: -1, title: -1 };
  for (const raw of rows) {
    const row = raw.map(clean);
    const lower = row.map((c) => c.toLowerCase());
    const emails = row.join(" ").match(EMAIL_RE);
    if (!emails) {
      const find = (re: RegExp) => lower.findIndex((c) => re.test(c));
      const h = { name: find(/^(hr |contact |full )?name|^person/), company: find(/company|organi[sz]ation|employer|firm/), title: find(/title|designation|role|position/) };
      if (h.name >= 0 || h.company >= 0) col = h;
      continue;
    }
    for (const e of emails) push(out, e, { name: row[col.name], company: row[col.company], title: row[col.title] });
  }
  return [...out.values()];
}

/** Free text (e.g. a PDF): each email, with the rest of its line as a company hint when short. */
export function contactsFromText(text: string): InternalContact[] {
  const out = new Map<string, InternalContact>();
  for (const line of text.split(/\n/)) {
    const emails = line.match(EMAIL_RE);
    if (!emails) continue;
    const rest = clean(line.replace(EMAIL_RE, " ").replace(/^\d+[.)]?\s*/, "").replace(/[|,;]+/g, " "));
    for (const e of emails) push(out, e, { name: null, company: rest && rest.length <= 60 ? rest : null });
  }
  return [...out.values()];
}

/** True when an uploaded contact belongs to the job's company domain (subdomains like in.ibm.com count). */
export const sameDomain = (contactDomain: string, jobDomain: string) => {
  const a = contactDomain.toLowerCase(), b = jobDomain.toLowerCase().replace(/^www\./, "");
  return a === b || a.endsWith("." + b) || b.endsWith("." + a);
};

// ---- PDF tables of HR people (name, title, LinkedIn, company, website) without emails ----
export type InternalPerson = { name: string; title: string | null; linkedin_url: string; company: string | null; domain: string };
export type PdfItem = { str: string; x: number; y: number };

const SOCIAL = /linkedin\.com|facebook\.com|twitter\.com|instagram\.com|x\.com\/|youtube\.com/i;
export const domainFromUrl = (u: string) => {
  try { return new URL(u.startsWith("http") ? u : `http://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};

/** Items of one page, in reading order. Rows start with a row number in the first column; columns come from the header row. */
export function peopleFromPdfItems(items: PdfItem[]): InternalPerson[] {
  const head = (re: RegExp) => items.find((i) => re.test(i.str.trim()))?.x;
  const xName = head(/^name$/i), xTitle = head(/^(job title|title|designation)$/i), xLi = head(/^linkedin( url)?$/i), xCo = head(/^company( name)?$/i);
  if (xName === undefined || xCo === undefined) return [];
  const yHead = items.find((i) => /^name$/i.test(i.str.trim()))!.y;
  const headerRow = items.filter((i) => Math.abs(i.y - yHead) < 1.5 && i.str.trim() && i.x >= xName - 3);
  const cols = [...new Set([xName, xTitle ?? xName + 1, xLi ?? xCo - 1, xCo, ...headerRow.map((i) => i.x)])].sort((a, b) => a - b);
  const colOf = (x: number) => { let c = -1; for (const v of cols) if (x >= v - 3) c = v; return c; };
  const out: InternalPerson[] = [];
  let row: PdfItem[] = [];
  const flush = () => {
    if (!row.length) return;
    const text = (x: number | undefined) => x === undefined ? "" : clean(row.filter((i) => colOf(i.x) === x && !/^https?:/i.test(i.str)).map((i) => i.str).join(" "));
    const li = row.find((i) => /linkedin\.com\/in\//i.test(i.str))?.str.trim();
    const site = row.find((i) => /^https?:\/\//i.test(i.str.trim()) && !SOCIAL.test(i.str))?.str.trim();
    const name = text(xName), domain = site ? domainFromUrl(site) : "";
    if (li && name && domain && !isFreeMail(domain)) out.push({ name, title: text(xTitle) || null, linkedin_url: li.replace(/^http:/, "https:"), company: text(xCo) || null, domain });
    row = [];
  };
  for (const it of items) {
    if (!it.str.trim()) continue;
    if (it.x < xName - 3) { flush(); continue; } // row number column starts a new person
    if (headerRow.includes(it)) continue;
    row.push(it);
  }
  flush();
  return out;
}
