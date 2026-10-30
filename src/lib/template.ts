export type TemplateVars = {
  first_name?: string | null | undefined;
  name?: string | null | undefined;
  company?: string | null | undefined;
  job_title?: string | null | undefined;
  job_url?: string | null | undefined;
  job_id?: string | null | undefined;
  job_reference?: string | null | undefined;
  contact_title?: string | null | undefined;
  linkedin?: string | null | undefined;
};

/** Validate link syntax, not reachability; extract only recognizable recruitment IDs. */
export function jobReference(raw?: string | null): { job_url: string; job_id: string; job_reference: string } {
  const input = raw?.trim() ?? "";
  let job_url = "";
  let job_id = "";
  if (input && !input.startsWith("manual:")) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(input);
      if (["http:", "https:"].includes(parsed.protocol) && parsed.hostname.includes(".") && !parsed.username && !parsed.password && !/\s/.test(input)) {
        job_url = parsed.href;
      }
    } catch { /* A malformed URL may still contain a recognizable job ID. */ }
    for (const key of ["jobId", "job_id", "jobid", "requisitionId", "requisition_id", "reqId", "currentJobId"]) {
      const value = parsed?.searchParams.get(key);
      if (value && /^(?=.*\d)[a-z\d_-]{3,40}$/i.test(value)) { job_id = value; break; }
    }
    if (!job_id) {
      // Workday job slugs end with a requisition ID, not a title or location number.
      try {
        const candidate = parsed ?? new URL(`https://${input}`);
        if (/(^|\.)myworkdayjobs\.com$/i.test(candidate.hostname)) {
          const path = decodeURIComponent(candidate.pathname);
          if (/\/job\//i.test(path)) {
            job_id = path.match(/_((?:JR|R)[-_]?\d{3,}|\d{5,})(?=\/|$)/i)?.[1] ?? "";
          }
        }
      } catch { /* No recognizable Workday path; never invent a requisition. */ }
    }
    if (!job_id) {
      job_id = input.match(/(?:^|[^a-z\d])(JR\d{4,})(?=[^a-z\d]|$)/i)?.[1]
        ?? input.match(/linkedin\.com\/jobs\/view\/(?:[^?#\s]*-)?(\d{6,})(?=[/?#]|$)/i)?.[1]
        ?? input.match(/naukri\.com\/job-listings\/[^?#\s]*-(\d{10,})(?=[/?#]|$)/i)?.[1]
        ?? "";
    }
  }
  return { job_url, job_id, job_reference: [job_url ? `Job URL: ${job_url}` : "", job_id ? `Job ID: ${job_id}` : ""].filter(Boolean).join("\n") };
}

/** Yash's level band: SDE2 / 3–5 years and below. Lead, principal, staff, architect,
 * manager, director-level titles and SDE3+ are out. Plain "Senior Software Engineer"
 * stays in (usually 3–5 yrs in India) unless the text asks for more than 5 years. */
const SENIOR_TITLE =
  /\b(lead|leads|principal|staff|architect|architects|director|directors|head|heads|vp|vice president|chief|fellow|distinguished|manager|managers|sde\s*[-\s]?3\b|sde\s*iii\b|software\s*engineer\s*[-\s]?(3|iii)\b|senior\s+sde|sr\.?\s+sde|senior\s+staff|sr\.?\s*staff|tech lead|technical lead|team lead)\b/i;

/** True when the job title is above the SDE2 / 3–5 years band (lead roles etc.). */
export function isSeniorRole(title?: string | null): boolean {
  return SENIOR_TITLE.test(title ?? "");
}

/** Highest "N years" experience bar mentioned in the text; 0 when none is stated. */
export function maxYearsMentioned(text?: string | null): number {
  let max = 0;
  for (const m of (text ?? "").matchAll(/\b(\d{1,2})\s*\+?\s*years?\b/gi)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Combined check: senior title, or the posting asks for more than 5 years. */
export function isAboveExperienceBand(title?: string | null, text?: string | null): boolean {
  return isSeniorRole(title) || maxYearsMentioned(text) > 5;
}

/** Manual additions are intentional; only discovered jobs use the experience band. */
export function isJobWithinExperiencePolicy(source: string | null | undefined, title?: string | null, text?: string | null): boolean {
  return source === "manual" || !isAboveExperienceBand(title, text);
}

/** Replaces {{var}} placeholders. Unknown/missing vars fall back to sensible defaults. */
export function renderTemplate(tpl: string, vars: TemplateVars): string {
  const resolved = { ...vars, ...jobReference(vars.job_url) };
  const fallback: Record<string, string> = {
    first_name: "there",
    name: "there",
    company: "your company",
    job_title: "the open role",
    job_url: "",
    contact_title: "",
    linkedin: "",
  };
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = (resolved as Record<string, string | null | undefined>)[key];
    if (v && String(v).trim()) return String(v).trim();
    return fallback[key] ?? "";
  });
}

/** How many more emails may go out today given the daily cap. */
export function remainingQuota(dailyLimit: number, sentToday: number): number {
  return Math.max(0, dailyLimit - sentToday);
}

/** Which contacts may be sent: with review on, only approved ones. */
export function sendableStatuses(requireApproval: boolean): string[] {
  return requireApproval ? ["approved"] : ["pending", "approved"];
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** When a job was posted, read from wording like "13 hours ago", "posted yesterday" or a plain date. */
export function parsePostedAt(text?: string | null, now: Date = new Date(), allowDate = true): string | null {
  const t = text ?? "";
  const rel = t.match(/(\d{1,4})\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\s+ago/i);
  if (rel) {
    const n = Number(rel[1] ?? 0);
    const u = (rel[2] ?? "").toLowerCase();
    const unit = /^min/.test(u) ? MINUTE : /^h/.test(u) ? HOUR : /^d/.test(u) ? DAY : 7 * DAY;
    return new Date(now.getTime() - n * unit).toISOString();
  }
  if (/\b(?:posted|published)\s+(?:today|just now)\b/i.test(t)) return now.toISOString();
  if (/\b(?:posted|published)\s+yesterday\b/i.test(t)) return new Date(now.getTime() - DAY).toISOString();
  if (allowDate) {
    const d = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (d) {
      const stamp = new Date(`${d[1]}T00:00:00Z`);
      if (!Number.isNaN(stamp.getTime())) return stamp.toISOString();
    }
  }
  return null;
}

/** "3 hours ago" wording for a saved timestamp; "" when there is nothing to say. */
export function timeAgo(iso?: string | null, now: Date = new Date()): string {
  const then = iso ? new Date(iso) : null;
  if (!then || Number.isNaN(then.getTime())) return "";
  const mins = Math.round((now.getTime() - then.getTime()) / MINUTE);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** The "when posted" line on a job card; falls back to when the app found it. */
export function postedLabel(postedAt?: string | null, createdAt?: string | null, now: Date = new Date()): string {
  const posted = postedAt ? new Date(postedAt) : null;
  if (posted && !Number.isNaN(posted.getTime())) {
    if (posted.getTime() > now.getTime()) return "Posted today";
    if (now.getTime() - posted.getTime() < DAY) return `Posted ${timeAgo(postedAt, now)}`;
    return `Posted ${exactPosted(postedAt)}`;
  }
  return createdAt ? `Added ${timeAgo(createdAt, now)}` : "";
}

/** Date and clock wording for the hover tooltip, in the user's own timezone. */
export function exactPosted(iso?: string | null): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Exact address matching avoids confusing ann@company with joann@company. */
export function containsEmailAddress(text: string, email: string): boolean {
  const addresses: string[] = text.toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/g) ?? [];
  return addresses.includes(email.toLowerCase());
}
