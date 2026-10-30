import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { searchEachKeyword } from "./jobKeywords";
import { resolveSenderEmail } from "./senderEmail";
import { fetchSearchText, SearchRequestError } from "./searchRetry";
import { containsEmailAddress, isAboveExperienceBand, isJobWithinExperiencePolicy, parsePostedAt, remainingQuota, renderTemplate, sendableStatuses, timeAgo } from "./template";

type DB = SupabaseClient<Database>;
type Settings = Database["public"]["Tables"]["outreach_settings"]["Row"];

const GW = "https://connector-gateway.lovable.dev";

function keys(name: string) {
  const lov = process.env["LOVABLE_API_KEY"];
  const conn = process.env[name];
  if (!lov || !conn) throw new Error(`${name} / LOVABLE_API_KEY not configured`);
  return { lov, conn };
}

async function gw(connector: string, envKey: string, path: string, init: RequestInit & { json?: unknown } = {}) {
  const { lov, conn } = keys(envKey);
  const res = await fetch(`${GW}/${connector}${path}`, {
    method: init.method ?? "POST",
    headers: {
      Authorization: `Bearer ${lov}`,
      "X-Connection-Api-Key": conn,
      "Content-Type": "application/json",
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : null,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${connector} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/* ---------- AI extraction ---------- */
async function aiJson<T>(prompt: string): Promise<T> {
  const lov = process.env["LOVABLE_API_KEY"];
  if (!lov) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${lov}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You extract structured data and reply with JSON only." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content.replace(/^```json|```$/g, "").trim()) as T;
}

type Extracted = { title: string; company: string; domain: string | null; is_job: boolean };

export async function extractJob(text: string, url?: string | null): Promise<Extracted> {
  return aiJson<Extracted>(
    `From this job posting, return JSON {"title": job title, "company": hiring company name (not LinkedIn/Naukri), "domain": the company's main website domain like "acme.com" (best guess, or null), "is_job": true if this is a single job posting}.\nURL: ${url ?? "n/a"}\n\n${text.slice(0, 6000)}`,
  );
}

/* ---------- Firecrawl ---------- */
export async function scrapeUrl(url: string): Promise<string> {
  const r = await gw("firecrawl", "FIRECRAWL_API_KEY", "/v2/scrape", {
    json: { url, formats: ["markdown"], onlyMainContent: true },
  });
  return r.markdown ?? r.data?.markdown ?? "";
}

/** Firecrawl refuses some sites (e.g. LinkedIn 403). Fall back to a plain fetch. */
export async function directFetch(url: string): Promise<string> {
  // A LinkedIn search-results link with currentJobId points at one job — resolve it to the job page.
  const m = url.match(/currentJobId=(\d+)/);
  if (m) url = `https://www.linkedin.com/jobs/view/${m[1]}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept-Language": "en-US,en;q=0.9" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Could not read the page (${res.status})`);
  return (await res.text())
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

export type FoundJob = { url: string; title?: string | undefined; company?: string | undefined; location?: string | undefined; description?: string | undefined; posted_at?: string | undefined };

/** Parses LinkedIn's public job-search cards (same listings you see on linkedin.com/jobs). */
export function parseLinkedInCards(html: string): FoundJob[] {
  const clean = (s?: string) => (s ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const out: FoundJob[] = [];
  for (const card of html.split("<li>").slice(1)) {
    const url = card.match(/href="(https:\/\/[a-z]{2,3}\.linkedin\.com\/jobs\/view\/[^"?]+)/)?.[1];
    if (!url) continue;
    const title = clean(card.match(/base-search-card__title">([\s\S]*?)<\/h3>/)?.[1]);
    const company = clean(card.match(/base-search-card__subtitle">([\s\S]*?)<\/h4>/)?.[1]);
    const location = clean(card.match(/job-search-card__location">([\s\S]*?)<\/span>/)?.[1]);
    const ago = clean(card.match(/<time[^>]*>([\s\S]*?)<\/time>/)?.[1]);
    if (!title || !company || !isWithin24h(ago)) continue;
    const posted = parsePostedAt(ago) ?? parsePostedAt(card.match(/<time[^>]*datetime="([^"]+)"/)?.[1]);
    out.push({ url: url.replace(/^https:\/\/[a-z]{2,3}\./, "https://www."), title, company, location, posted_at: posted ?? undefined, description: `${title} at ${company}, ${location}. Posted ${ago}.` });
  }
  return out;
}

export async function linkedinJobs(keywords: string, location: string, pages = 3, warnings: string[] = [], state: { limited?: boolean } = {}): Promise<FoundJob[]> {
  const all: FoundJob[] = [];
  if (state.limited) {
    warnings.push(`LinkedIn search for “${keywords}” deferred because LinkedIn requested a cooldown; retry later. Naukri continues.`);
    return all;
  }
  for (let p = 0; p < pages; p++) {
    const u = new URL("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search");
    u.search = new URLSearchParams({ keywords, location, f_TPR: "r86400", sortBy: "DD", start: String(p * 10) }).toString();
    let html: string;
    try {
      let retried = false;
      html = await fetchSearchText(u, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" } }, () => { retried = true; });
      if (retried) warnings.push(`LinkedIn recovered after automatic retry for “${keywords}” (page ${p + 1}).`);
    } catch (e) {
      console.error("linkedin jobs", keywords, e);
      const limited = e instanceof SearchRequestError && e.status === 429;
      if (limited) state.limited = true;
      warnings.push(limited
        ? `LinkedIn temporarily limited requests for “${keywords}” after ${e instanceof SearchRequestError ? e.attempts : 1} attempt(s); partial results kept. Retry later.`
        : `LinkedIn could not finish the search for “${keywords}” after automatic retries; partial results kept. Try again later.`);
      break;
    }
    const batch = parseLinkedInCards(html);
    if (!batch.length) break;
    all.push(...batch);
  }
  return all;
}

export async function naukriJobs(keywords: string, location: string, warnings: string[] = []): Promise<FoundJob[]> {
  try {
    const { lov, conn } = keys("FIRECRAWL_API_KEY");
    let retried = false;
    const text = await fetchSearchText(`${GW}/firecrawl/v2/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${lov}`, "X-Connection-Api-Key": conn, "Content-Type": "application/json" },
      body: JSON.stringify({ query: `${keywords} ${location} site:naukri.com/job-listings`, limit: 8, tbs: "qdr:d" }),
    }, () => { retried = true; });
    const r = JSON.parse(text);
    if (retried) warnings.push(`Naukri recovered after automatic retry for “${keywords}”.`);
    const list: FoundJob[] = r.data?.web ?? (Array.isArray(r.data) ? r.data : []);
    return list
      .filter((x) => x.url && isWithin24h(`${x.title ?? ""} ${x.description ?? ""}`))
      .map((x) => ({ ...x, title: x.title?.replace(/\s*-\s*Naukri\.com\s*$/i, ""), posted_at: parsePostedAt(`${x.title ?? ""} ${x.description ?? ""}`, new Date(), false) ?? undefined }));
  } catch (e) {
    console.error("naukri search", e);
    warnings.push(`Naukri could not complete the search for “${keywords}”; LinkedIn results are kept. Retry later.`);
    return [];
  }
}

export async function searchJobs(keywords: string, location: string, warnings: string[] = [], onBatch?: (fresh: FoundJob[]) => Promise<void>) {
  const linkedinState: { limited?: boolean } = {};
  return searchEachKeyword(keywords, async (keyword) => {
    const [li, nk] = await Promise.all([linkedinJobs(keyword, location, 3, warnings, linkedinState), naukriJobs(keyword, location, warnings)]);
    return [...li, ...nk];
  }, 1, onBatch);
}

/** Drops postings that say they are older than a day ("2 days ago", "1 week ago", "30+ days ago"). */
export function isWithin24h(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(week|weeks|month|months|year|years)\s+ago\b/.test(t)) return false;
  if (/30\+\s*days/.test(t)) return false;
  const m = t.match(/(\d+)\s*days?\s+ago/);
  if (m && Number(m[1]) >= 2) return false;
  return true;
}

/* ---------- Apollo ---------- */
type ApolloMatch = {
  id: string;
  name?: string;
  first_name?: string;
  title?: string;
  email?: string;
  email_status?: string;
  linkedin_url?: string;
  organization?: { name?: string };
};

export class ApolloKeyError extends Error {}

async function adminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function setApolloStatus(userId: string, status: "ok" | "invalid", error: string | null) {
  const admin = await adminDb();
  await admin
    .from("outreach_settings")
    .update({ apollo_status: status, apollo_error: error, apollo_checked_at: new Date().toISOString() })
    .eq("user_id", userId);
}

/** Uses the user's own pasted Apollo key when present, otherwise the connected Apollo account. */
export async function apollo(userId: string, path: string, json?: unknown) {
  const admin = await adminDb();
  const { data: own } = await admin.from("apollo_keys").select("api_key").eq("user_id", userId).maybeSingle();
  let res: Response;
  if (own?.api_key) {
    res = await fetch(`https://api.apollo.io${path}`, {
      method: "POST",
      headers: { "X-Api-Key": own.api_key, "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: json !== undefined ? JSON.stringify(json) : null,
    });
  } else {
    const { lov, conn } = keys("APOLLO_API_KEY");
    res = await fetch(`${GW}/apollo${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${lov}`, "X-Connection-Api-Key": conn, "Content-Type": "application/json" },
      body: json !== undefined ? JSON.stringify(json) : null,
    });
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      msg = j.error_details?.message ? `${j.error ?? ""} ${j.error_details.message}`.trim() : (j.error ?? j.message ?? msg);
    } catch {}
    if (res.status === 401 || res.status === 403 || res.status === 422 && /api key/i.test(msg)) {
      const reason =
        res.status === 401
          ? `Apollo API key is expired or invalid (${own?.api_key ? "your pasted key" : "connected account"}). Paste a new key in Settings.`
          : `Apollo refused access: ${msg}`;
      await setApolloStatus(userId, "invalid", reason);
      throw new ApolloKeyError(reason);
    }
    throw new Error(`Apollo ${res.status}: ${msg}`);
  }
  await setApolloStatus(userId, "ok", null);
  return text ? JSON.parse(text) : {};
}

export async function findContacts(userId: string, domain: string, titles: string[], max: number): Promise<ApolloMatch[]> {
  const qs = new URLSearchParams({ per_page: String(Math.min(25, max * 3)), page: "1" });
  qs.append("q_organization_domains_list[]", domain);
  titles.forEach((t) => qs.append("person_titles[]", t));
  const search = await apollo(userId, `/api/v1/mixed_people/api_search?${qs}`);
  const people: Array<{ id: string; has_email?: boolean }> = search.people ?? [];
  const ids = people.filter((p) => p.has_email !== false).slice(0, Math.min(10, max * 2)).map((p) => p.id);
  if (!ids.length) return [];
  const enrich = await apollo(userId, "/api/v1/people/bulk_match", {
    details: ids.map((id) => ({ id })),
    reveal_personal_emails: false,
  });
  const matches: ApolloMatch[] = (enrich.matches ?? []).filter(Boolean);
  // Only keep verified work emails
  return matches.filter((m) => m.email && m.email_status === "verified").slice(0, max);
}

/* ---------- Gmail ---------- */
const b64 = (s: string) =>
  btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(""));
const hdr = (v: string) => (/^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`);

export type Attachment = { filename: string; mime: string; data: Uint8Array };

function bytesToB64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function htmlEscape(t: string) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain-text body + HTML twin. With a tracking origin, the HTML gets an open pixel (no resume link — the resume is attached). */
export function trackedHtml(body: string, contactId: string | null, origin: string | null, _hasResume: boolean) {
  let html = `<div style="font-family:Arial,sans-serif;font-size:14px">${htmlEscape(body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>")}`;
  if (origin && contactId) {
    html += `<img src="${origin}/api/public/t/o/${contactId}" width="1" height="1" alt="">`;
  }
  return html + "</div>";
}

export async function gmailSenderEmail(): Promise<string> {
  const profile = await gw("google_mail", "GOOGLE_MAIL_API_KEY", "/gmail/v1/users/me/profile", { method: "GET" });
  if (typeof profile.emailAddress !== "string") throw new Error("Gmail did not return a sender address. Check the Gmail connection.");
  return resolveSenderEmail(null, profile.emailAddress);
}

export async function sendGmail(to: string, subject: string, body: string, attachment?: Attachment | null, html?: string | null, preferredSender?: string | null): Promise<{ id?: string }> {
  const sender = resolveSenderEmail(preferredSender, await gmailSenderEmail());
  let mime: string;
  const textPart = (b: string) => html
    ? (() => {
        const alt = `a_${crypto.randomUUID()}`;
        return [
          `Content-Type: multipart/alternative; boundary="${alt}"`, "",
          `--${alt}`, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", b64(b).replace(/.{76}/g, "$&\r\n"),
          `--${alt}`, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", b64(html).replace(/.{76}/g, "$&\r\n"),
          `--${alt}--`,
        ].join("\r\n");
      })()
    : ['Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", b64(b).replace(/.{76}/g, "$&\r\n")].join("\r\n");
  if (attachment) {
    const boundary = `b_${crypto.randomUUID()}`;
    const fileB64 = bytesToB64(attachment.data).replace(/.{76}/g, "$&\r\n");
    mime = [
      `To: ${to}`,
      `Subject: ${hdr(subject)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      textPart(body),
      `--${boundary}`,
      `Content-Type: ${attachment.mime}; name="${attachment.filename}"`,
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      fileB64,
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    mime = [`To: ${to}`, `Subject: ${hdr(subject)}`, "MIME-Version: 1.0", textPart(body)].join("\r\n");
  }
  const raw = b64(`From: ${sender}\r\n${mime}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return await gw("google_mail", "GOOGLE_MAIL_API_KEY", "/gmail/v1/users/me/messages/send", { json: { raw } });
}

/** Reads Gmail bounce notices (mailer-daemon) and marks matching sent contacts as bounced. */
export async function checkBounces(db: DB, userId: string) {
  const { data: sent } = await db.from("contacts").select("id, email, delivery_status").eq("user_id", userId).eq("send_status", "sent");
  const byEmail = new Map((sent ?? []).map((c) => [c.email.toLowerCase(), c]));
  if (!byEmail.size) return { checked: 0, bounced: 0 };
  const q = encodeURIComponent("(from:(mailer-daemon OR postmaster) OR subject:(undeliverable OR \"delivery status notification\" OR \"not delivered\")) newer_than:60d");
  const list = await gw("google_mail", "GOOGLE_MAIL_API_KEY", `/gmail/v1/users/me/messages?q=${q}&maxResults=100`, { method: "GET" });
  let bounced = 0;
  for (const m of (list.messages ?? []) as Array<{ id: string }>) {
    const msg = await gw("google_mail", "GOOGLE_MAIL_API_KEY", `/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=X-Failed-Recipients`, { method: "GET" });
    const failed = String((msg.payload?.headers ?? []).find((h: { name: string }) => /x-failed-recipients/i.test(h.name))?.value ?? "");
    // "Temporary problem… will retry" is not a bounce yet; only permanent failures count.
    if (/temporary problem|will retry/i.test(String(msg.snippet ?? ""))) continue;
    const hay = `${failed} ${msg.snippet ?? ""}`.toLowerCase();
    for (const [email, c] of byEmail) {
      if (c.delivery_status === "bounced" || !containsEmailAddress(hay, email)) continue;
      const reason = String(msg.snippet ?? "Address not found").replace(/&#39;/g, "'").replace(/&quot;/g, '"').slice(0, 300);
      await db.from("contacts").update({ delivery_status: "bounced", bounce_reason: reason }).eq("id", c.id);
      c.delivery_status = "bounced";
      bounced++;
    }
  }
  return { checked: (list.messages ?? []).length, bounced };
}

/* ---------- Pipeline steps ---------- */
export async function getSettings(db: DB, userId: string): Promise<Settings> {
  const { data } = await db.from("outreach_settings").select("*").eq("user_id", userId).maybeSingle();
  if (data) return data;
  const { data: created, error } = await db.from("outreach_settings").insert({ user_id: userId }).select("*").single();
  if (error) throw error;
  return created;
}

export function startOfDayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Daily send count starts at UTC midnight, or later if you pressed "Reset today's limit". */
export function sendCountStart(s: { daily_reset_at?: string | null }) {
  const day = startOfDayUtc();
  return s.daily_reset_at && s.daily_reset_at > day ? s.daily_reset_at : day;
}

export async function addJob(db: DB, userId: string, input: { url?: string | undefined; text?: string | undefined }, source = "manual") {
  let text = input.text ?? "";
  if (input.url && !text) {
    try {
      text = await scrapeUrl(input.url);
    } catch (e) {
      console.error("scrape failed", e);
    }
    if (!text.trim()) text = await directFetch(input.url);
  }
  if (!text.trim()) throw new Error("Could not read the job description");
  const ex = await extractJob(text, input.url);
  if (!isJobWithinExperiencePolicy(source, ex.title, text)) throw new Error("This looks like a lead or very senior role (above SDE2 / 3–5 years) — it was not added");
  const { data, error } = await db
    .from("jobs")
    .upsert(
      {
        user_id: userId,
        url: input.url ?? `manual:${crypto.randomUUID()}`,
        title: ex.title ?? "",
        company: ex.company ?? "",
        company_domain: ex.domain,
        description: text.slice(0, 8000),
        source,
        posted_at: parsePostedAt(text),
      },
      { onConflict: "user_id,url", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function fetchDailyJobs(db: DB, userId: string, s: Settings, log: string[] = []) {
  const warnings: string[] = [];
  let added = 0, already = 0;
  // Save each keyword's jobs as soon as they are found so the dashboard can show them progressively.
  const results = await searchJobs(s.keywords, s.location, warnings, async (batch) => {
    const r = await saveFoundJobs(db, userId, batch);
    added += r.added; already += r.already;
  });
  log.push(`Retrieved ${results.filter((r) => r.url.includes("linkedin.com")).length} LinkedIn and ${results.filter((r) => r.url.includes("naukri.com")).length} Naukri listings`);
  log.push(...new Set(warnings));
  log.push(`${already} listings already saved`);
  return added;
}

async function saveFoundJobs(db: DB, userId: string, results: FoundJob[]) {
  const have = new Set<string>();
  // Long LinkedIn URLs across many keywords can exceed the read request's URL limit.
  for (let offset = 0; offset < results.length; offset += 20) {
    const { data: existing, error } = await db.from("jobs").select("url").eq("user_id", userId)
      .in("url", results.slice(offset, offset + 20).map((r) => r.url));
    if (error) throw new Error(`Could not check previously saved jobs: ${error.message}`);
    for (const job of existing ?? []) if (job.url) have.add(job.url);
  }
  const fresh = results.filter((r) => !have.has(r.url));
  let added = 0;
  for (let i = 0; i < fresh.length; i += 6) {
    await Promise.all(
      fresh.slice(i, i + 6).map(async (r) => {
        try {
          const ex = await extractJob(`Company: ${r.company ?? ""}\nRole: ${r.title ?? ""}\n${r.description ?? ""}`, r.url);
          const company = r.company || ex.company;
          if (!company || isOwnCompany(company, ex.domain)) return;
          const title = r.title || ex.title || "";
          // Yash's band: SDE2 / 3–5 years and below — lead and above-5-years roles are never added.
          if (isAboveExperienceBand(title, `${title}. ${r.description ?? ""}`)) return;
          const { error } = await db.from("jobs").insert({
            user_id: userId,
            url: r.url,
            title: r.title || ex.title || "",
            company,
            company_domain: ex.domain,
            description: r.description ?? null,
            source: r.url.includes("naukri") ? "naukri" : "linkedin",
            posted_at: r.posted_at ?? null,
          });
          if (!error) added++;
        } catch (e) {
          console.error("extract failed", r.url, e);
        }
      }),
    );
  }
  return { added, already: results.length - fresh.length };
}

/* ---------- Hunter.io (fallback, verified emails only) ---------- */
export class HunterKeyError extends Error {}

export function titleMatches(position: string | null | undefined, titles: string[]): boolean {
  if (!position) return false;
  const p = position.toLowerCase();
  return titles.some((t) => {
    const k = t.toLowerCase().trim();
    if (k === "hr") return /\b(hr|human resources|people)\b/.test(p);
    if (k === "recruiter") return /recruit|talent acquisition|talent partner|hiring/.test(p);
    if (k === "sde 2") return /\b(sde\s*-?\s*(2|ii)|software (development )?engineer\s*(2|ii))\b/.test(p);
    return p.includes(k);
  });
}

async function setHunterStatus(userId: string, status: "ok" | "invalid", error: string | null) {
  const admin = await adminDb();
  await admin.from("outreach_settings").update({ hunter_status: status, hunter_error: error }).eq("user_id", userId);
}

async function hunterGet(userId: string, key: string, path: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ ...params, api_key: key });
  const res = await fetch(`https://api.hunter.io/v2${path}?${qs}`);
  const j = (await res.json().catch(() => ({}))) as { data?: any; errors?: Array<{ details?: string }> };
  if (!res.ok) {
    const msg = j.errors?.[0]?.details ?? `status ${res.status}`;
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      const reason = res.status === 401 ? "Hunter key is invalid or expired. Paste a new one in Settings." : `Hunter: ${msg}`;
      await setHunterStatus(userId, "invalid", reason);
      throw new HunterKeyError(reason);
    }
    throw new Error(`Hunter ${res.status}: ${msg}`);
  }
  await setHunterStatus(userId, "ok", null);
  return j.data;
}

export async function hunterContacts(userId: string, domain: string, titles: string[], max: number) {
  const admin = await adminDb();
  const { data: row } = await admin.from("hunter_keys").select("api_key").eq("user_id", userId).maybeSingle();
  if (!row) return null; // no Hunter key saved
  const data = await hunterGet(userId, row.api_key, "/domain-search", { domain, limit: "10", type: "personal" });
  type HE = { value: string; first_name?: string; last_name?: string; position?: string; linkedin?: string; verification?: { status?: string } };
  const emails: HE[] = data?.emails ?? [];
  const matching = emails.filter((e) => titleMatches(e.position, titles));
  const out: ApolloMatch[] = [];
  for (const e of matching) {
    if (out.length >= max) break;
    let status = e.verification?.status;
    if (status !== "valid") {
      // verify it ourselves; only keep confirmed deliverable addresses
      try {
        const v = await hunterGet(userId, row.api_key, "/email-verifier", { email: e.value });
        status = v?.status;
      } catch (err) {
        if (err instanceof HunterKeyError) throw err;
        continue;
      }
    }
    if (status !== "valid") continue;
    out.push({
      id: `hunter:${e.value}`,
      name: [e.first_name, e.last_name].filter(Boolean).join(" "),
      first_name: e.first_name ?? undefined,
      title: e.position ?? undefined,
      email: e.value,
      email_status: "verified",
      linkedin_url: e.linkedin ?? undefined,
    } as ApolloMatch);
  }
  return out;
}

/* ---------- Snov.io (free, Gmail sign-up OK; verified company emails only) ---------- */
export class SnovKeyError extends Error {}

const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|aol|proton|protonmail|rediffmail|zoho|gmx|mail|yandex)\./i;

/** True only for an address on the company's own domain (or a subdomain of it), never a free mailbox. */
export function isCompanyEmail(email: string | null | undefined, domain: string): boolean {
  if (!email || !domain) return false;
  const e = email.trim().toLowerCase();
  if (FREE_MAIL.test(e)) return false;
  const host = e.split("@")[1];
  if (!host) return false;
  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return host === d || host.endsWith(`.${d}`);
}

async function setSnovStatus(userId: string, status: "ok" | "invalid", error: string | null) {
  const admin = await adminDb();
  await admin.from("outreach_settings").update({ snov_status: status, snov_error: error }).eq("user_id", userId);
}

export async function snovToken(clientId: string, clientSecret: string): Promise<string | null> {
  const res = await fetch("https://api.snov.io/v1/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string };
  return res.ok && j.access_token ? j.access_token : null;
}


/** Real people at the company from public LinkedIn profiles (HR, recruiters, engineering managers). */
export function parsePeopleResults(
  list: Array<{ url?: string; title?: string; description?: string }>,
  company: string,
  titles: string[],
): Array<{ first_name: string; last_name: string; headline: string; linkedin_url: string }> {
  const key = company.toLowerCase().replace(/\b(pvt|private|ltd|limited|inc|llc|technologies|services|solutions|india)\b\.?/g, "").trim().split(/\s+/)[0] ?? "";
  const out: Array<{ first_name: string; last_name: string; headline: string; linkedin_url: string }> = [];
  for (const r of list) {
    if (!r.url?.includes("linkedin.com/in/") || !r.title) continue;
    const [namePart, ...rest] = r.title.replace(/\s*\|\s*LinkedIn.*$/i, "").split(/\s+[-–]\s+/);
    const headline = rest.join(" - ");
    const text = `${headline} ${r.description ?? ""}`.toLowerCase();
    if (key && !text.includes(key)) continue;
    if (!titleMatches(headline, titles) && !titleMatches(r.description, titles)) continue;
    const names = (namePart ?? "").replace(/[^\p{L}\s.'-]/gu, "").trim().split(/\s+/).filter((w) => w.replace(/\./g, "").length > 1);
    if (names.length < 2) continue;
    out.push({ first_name: names[0]!, last_name: names[names.length - 1]!, headline, linkedin_url: r.url });
  }
  return out;
}

async function linkedinPeople(company: string, titles: string[]) {
  const r = await gw("firecrawl", "FIRECRAWL_API_KEY", "/v2/search", {
    json: { query: `site:linkedin.com/in "${company}" ("talent acquisition" OR recruiter OR HR OR "engineering manager") India`, limit: 40 },
  });
  return parsePeopleResults(r.data?.web ?? [], company, titles);
}

export async function snovContacts(userId: string, domain: string, titles: string[], max: number, company = "") {
  const admin = await adminDb();
  const { data: row } = await admin.from("snov_keys").select("client_id, client_secret").eq("user_id", userId).maybeSingle();
  if (!row) return null;
  const token = await snovToken(row.client_id, row.client_secret);
  if (!token) {
    const reason = "Snov.io key is invalid or expired. Paste a new User ID + Secret in Settings.";
    await setSnovStatus(userId, "invalid", reason);
    throw new SnovKeyError(reason);
  }

  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } as const;

  // Snov's new API is asynchronous: POST starts a task, GET polls until status != in_progress.
  const poll = async (url: string, tries = 14) => {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(url, { headers: h });
        const j = await res.json().catch(() => null);
        if (res.ok && j?.status && j.status !== "in_progress") return j;
      } catch { /* network hiccup; keep polling */ }
    }
    return null;
  };

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) });
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = j?.errors?.[0]?.title ?? j?.message ?? j?.error ?? `status ${res.status}`;
      if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429 || /credit|limit|balance|permission/i.test(String(msg))) {
        const reason = `Snov.io: ${msg}`;
        await setSnovStatus(userId, "invalid", reason);
        throw new SnovKeyError(reason);
      }
      throw new Error(`Snov.io ${res.status}: ${msg}`);
    }
    await setSnovStatus(userId, "ok", null);
    return j;
  };

  // 0. Best source: recruiters/HR found on public LinkedIn, then Snov finds their email by name.
  if (company) {
    try {
      const people = (await linkedinPeople(company, titles)).slice(0, Math.max(max * 2, 4));
      if (people.length) {
        const st = await post("https://api.snov.io/v2/emails-by-domain-by-name/start", {
          rows: people.map((p) => ({ first_name: p.first_name, last_name: p.last_name, domain })),
        });
        const t = (st?.data?.task_hash ?? st?.meta?.task_hash) as string | undefined;
        const res = t ? await poll(`https://api.snov.io/v2/emails-by-domain-by-name/result?task_hash=${t}`) : null;
        const found: ApolloMatch[] = [];
        (res?.data ?? []).forEach((row: { result?: Array<{ email?: string; smtp_status?: string }> }, i: number) => {
          const p = people[i];
          const hit = (row.result ?? []).find((e) => e.email && isCompanyEmail(e.email, domain) && (e.smtp_status === "valid" || e.smtp_status === "unknown"));
          if (!p || !hit?.email || found.length >= max) return;
          found.push({
            id: `snov:${hit.email}`,
            name: `${p.first_name} ${p.last_name}`,
            first_name: p.first_name,
            title: p.headline,
            email: hit.email.toLowerCase(),
            email_status: hit.smtp_status === "valid" ? "verified" : "catch-all",
            linkedin_url: p.linkedin_url,
          } as ApolloMatch);
        });
        if (found.length) return found;
      }
    } catch (e) {
      if (e instanceof SnovKeyError) throw e;
      console.error("linkedin people lookup", e);
    }
  }

  // 1. fallback: people Snov knows at the company (positions + LinkedIn pages)
  const pstart = await post("https://api.snov.io/v2/domain-search/prospects/start", { domain, limit: 50, lastId: 0 });
  const ptask = pstart?.meta?.task_hash as string | undefined;
  const presult = ptask ? await poll(`https://api.snov.io/v2/domain-search/prospects/result/${ptask}`) : null;
  type SP = { first_name?: string; last_name?: string; position?: string; source_page?: string; search_emails_start?: string };
  const prospects: SP[] = (presult?.data ?? []) as SP[];
  const selected = prospects.filter((p) => titleMatches(p.position, titles)).slice(0, max);

  // 2. reveal emails for the matching people, all in parallel
  const reveals = await Promise.all(
    selected.map(async (p) => {
      if (!p.search_emails_start) return null;
      try {
        const st = await post(p.search_emails_start, {});
        const t = st?.meta?.task_hash as string | undefined;
        const r = t ? await poll(`https://api.snov.io/v2/domain-search/prospects/search-emails/result/${t}`) : null;
        type RE = { email?: string; smtp_status?: string };
        return { p, emails: (r?.data?.emails ?? []) as RE[] };
      } catch (e) {
        if (e instanceof SnovKeyError) throw e;
        return null; // one failed reveal shouldn't sink the job
      }
    }),
  );

  // 3. keep only deliverable addresses: "valid" from the reveal, plus batch-verified "unknown" ones
  const valid = new Set<string>();
  const bad = new Set<string>();
  const unknown: string[] = [];
  for (const r of reveals) {
    for (const e of r?.emails ?? []) {
      if (!e.email) continue;
      const s = String(e.smtp_status ?? "").toLowerCase();
      if (s === "valid") valid.add(e.email);
      else if (s === "unknown") unknown.push(e.email);
    }
  }
  if (unknown.length) {
    try {
      const vs = await post("https://api.snov.io/v2/email-verification/start", { emails: unknown.slice(0, 10) });
      const vt = (vs?.data?.task_hash ?? vs?.meta?.task_hash) as string | undefined;
      if (vt) {
        const vr = await poll(`https://api.snov.io/v2/email-verification/result?task_hash=${vt}`);
        for (const item of (vr?.data ?? []) as Array<{ email?: string; result?: { smtp_status?: string } }>) {
          const st = item?.result?.smtp_status;
          if (!item?.email) continue;
          if (st === "valid") valid.add(item.email);
          else if (st && st !== "unknown") bad.add(item.email); // confirmed not deliverable
        }
      }
    } catch { /* verification is best-effort; "valid" reveals are already kept */ }
  }

  const out: ApolloMatch[] = [];
  for (const r of reveals) {
    for (const e of r?.emails ?? []) {
      if (out.length >= max) break;
      // keep confirmed addresses, plus catch-all ones Snov found for this real person (marked so you can judge in review)
      if (!e.email || bad.has(e.email) || out.some((o) => o.email === e.email!.toLowerCase())) continue;
      if (!isCompanyEmail(e.email, domain)) continue;
      const confirmed = valid.has(e.email);
      if (!confirmed && String(e.smtp_status ?? "").toLowerCase() !== "unknown") continue;
      const p = r!.p;
      out.push({
        id: `snov:${e.email}`,
        name: [p.first_name, p.last_name].filter(Boolean).join(" "),
        first_name: p.first_name ?? undefined,
        title: p.position ?? undefined,
        email: e.email.toLowerCase(),
        email_status: confirmed ? "verified" : "catch-all",
        linkedin_url: p.source_page?.includes("linkedin.com") ? p.source_page : undefined,
      } as ApolloMatch);
    }
  }
  return out;
}

/** Paid/verified providers only when their key is known to work; otherwise go straight to free likely emails (fast). */
/** Contacts from the user's uploaded HR lists (Internal data tab) for this company's domain. */
/** Main word of a company name ("Caterpillar Inc." -> "caterpillar") for matching lists whose email domain differs (cat.com). */
export function companyKey(company: string) {
  const w = company.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((x) => x.length > 2 && !["the", "inc", "ltd", "llc", "pvt", "private", "limited", "india", "technologies", "solutions", "services", "group", "corp", "corporation"].includes(x));
  return w[0] ?? "";
}

async function internalContacts(userId: string, domain: string, company = "") {
  const admin = await adminDb();
  const d = domain.toLowerCase().replace(/^www\./, "");
  const k = companyKey(company);
  const filter = `domain.eq.${d},domain.like.%.${d}` + (k ? `,company.ilike.${k}%` : "");
  const { data } = await admin.from("internal_contacts").select("email, name, title, company, domain")
    .eq("user_id", userId).or(filter).limit(50);
  return data ?? [];
}

/** The email domain the company really uses, per the user's list (e.g. caterpillar.com jobs -> cat.com). */
function listMailDomain(listed: { domain: string }[], fallback: string) {
  const c: Record<string, number> = {};
  for (const l of listed) c[l.domain] = (c[l.domain] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}

async function findContactsAny(userId: string, domain: string, titles: string[], max: number, company = "") {
  const listed = await internalContacts(userId, domain, company).catch(() => []);
  domain = listMailDomain(listed, domain);
  const admin = await adminDb();
  const { data: st } = await admin.from("outreach_settings").select("use_internal_emails").eq("user_id", userId).maybeSingle();
  // By default list emails only teach the company's email format; they're emailed directly only when the user turns that on.
  if (!st?.use_internal_emails) return findContactsExternal(userId, domain, titles, max, company, listed.map((c) => c.email));
  const own: ApolloMatch[] = listed.slice(0, max).map((c) => ({
    id: `internal:${c.email}`, name: c.name ?? "", first_name: c.name?.split(" ")[0] ?? "", title: c.title ?? "From your HR list",
    email: c.email, email_status: "listed",
  }));
  if (own.length >= max) return own;
  const rest = await findContactsExternal(userId, domain, titles, max - own.length, company, listed.map((c) => c.email));
  return [...own, ...rest.filter((r) => !own.some((o) => o.email === r.email?.toLowerCase()))];
}

async function findContactsExternal(userId: string, domain: string, titles: string[], max: number, company: string, knownEmails: string[]) {
  const admin = await adminDb();
  const { data: st } = await admin.from("outreach_settings").select("apollo_status, snov_status, hunter_status").eq("user_id", userId).maybeSingle();
  const tryProvider = async (status: string | null | undefined, fn: () => Promise<ApolloMatch[] | null>) => {
    if (status === "invalid") return null; // known broken (free plan / out of credits): skip, don't waste time
    try { return await fn(); } catch (e) {
      if (e instanceof ApolloKeyError || e instanceof SnovKeyError || e instanceof HunterKeyError) return null;
      console.error("provider", e); return null;
    }
  };
  const a = await tryProvider(st?.apollo_status, () => findContacts(userId, domain, titles, max));
  if (a?.length) return a.filter((c) => isCompanyEmail(c.email, domain));
  const s = await tryProvider(st?.snov_status, () => snovContacts(userId, domain, titles, max, company));
  if (s?.length) return s;
  const h = await tryProvider(st?.hunter_status, () => hunterContacts(userId, domain, titles, max));
  if (h?.length) return h.filter((c) => isCompanyEmail(c.email, domain));
  // Free fallback: real HR/manager names from LinkedIn + the company's email format (learned from your list first).
  try { return await guessContacts(domain, titles, max, company, knownEmails, userId); } catch (e) { console.error("guess contacts", e); return []; }
}

async function domainHasMail(domain: string) {
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, { headers: { accept: "application/dns-json" } });
    const j = await r.json();
    return Array.isArray(j?.Answer) && j.Answer.length > 0;
  } catch { return true; }
}

async function guessContacts(domain: string, titles: string[], max: number, company: string, knownEmails: string[] = [], userIdForGuess = ""): Promise<ApolloMatch[]> {
  if (!(await domainHasMail(domain))) return [];
  const { inferPattern, buildEmail } = await import("./emailGuess");
  const [people, examples] = await Promise.all([
    company ? linkedinPeople(company, titles) : Promise.resolve([] as Awaited<ReturnType<typeof linkedinPeople>>),
    gw("firecrawl", "FIRECRAWL_API_KEY", "/v2/search", { json: { query: `"@${domain}" email`, limit: 10 } })
      .then((r) => JSON.stringify(r.data?.web ?? []).match(new RegExp(`[a-z0-9._-]+@${domain.replace(/\./g, "\\.")}`, "gi")) ?? [])
      .catch(() => [] as string[]),
  ]);
  const pattern = inferPattern([...knownEmails, ...examples], domain);
  const out: ApolloMatch[] = [];
  // HR people from the user's uploaded PDF list (names, no emails) come first.
  const d = domain.toLowerCase().replace(/^www\./, "");
  const k = companyKey(company);
  const { data: listed } = await (await adminDb()).from("internal_people").select("name, title, linkedin_url")
    .eq("user_id", userIdForGuess).or(`domain.eq.${d},domain.like.%.${d}` + (k ? `,company.ilike.${k}%` : "")).limit(max);
  const listedPeople = (listed ?? []).map((p) => {
    const parts = p.name.trim().split(/\s+/);
    return { first_name: parts[0] ?? "", last_name: parts.length > 1 ? parts[parts.length - 1]! : "", headline: p.title ?? "HR (from your list)", linkedin_url: p.linkedin_url };
  }).filter((p) => p.first_name && p.last_name);
  for (const p of [...listedPeople, ...people]) {
    if (out.length >= max) break;
    const email = buildEmail(pattern, p.first_name, p.last_name, domain);
    if (!email || out.some((o) => o.email === email)) continue;
    out.push({ id: `guess:${email}`, name: `${p.first_name} ${p.last_name}`, first_name: p.first_name, title: p.headline, email, email_status: "guessed", linkedin_url: p.linkedin_url } as ApolloMatch);
  }
  return out;
}

export async function processJob(db: DB, userId: string, jobId: string, s: Settings) {
  const { data: job } = await db.from("jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
  if (!job) return 0;
  if (isOwnCompany(job.company, job.company_domain)) {
    await db.from("jobs").update({ status: "failed", error: "Your current company — skipped" }).eq("id", jobId);
    return 0;
  }
  if (!job.company_domain) {
    await db.from("jobs").update({ status: "failed", error: "No company domain found" }).eq("id", jobId);
    return 0;
  }
  try {
    const people = await findContactsAny(userId, job.company_domain, s.target_titles, s.contacts_per_job, job.company);
    let n = 0;
    for (const p of people) {
      const { error } = await db.from("contacts").insert({
        user_id: userId,
        job_id: jobId,
        apollo_id: p.id,
        name: p.name ?? "",
        first_name: p.first_name ?? null,
        title: p.title ?? null,
        email: p.email!.toLowerCase(),
        email_status: p.email_status ?? null,
        linkedin_url: p.linkedin_url ?? null,
        company: p.organization?.name ?? job.company,
      });
      if (!error) n++; // duplicates (already contacted) are skipped by the unique key
    }
    await db.from("jobs").update({ status: n ? "contacts_found" : "no_contacts", error: null }).eq("id", jobId);
    return n;
  } catch (e) {
    if (e instanceof ApolloKeyError || e instanceof SnovKeyError || e instanceof HunterKeyError) {
      // keep the job queued so it retries once the key is fixed
      await db.from("jobs").update({ status: "new", error: e.message }).eq("id", jobId);
      throw e;
    }
    await db.from("jobs").update({ status: "failed", error: String((e as Error).message).slice(0, 500) }).eq("id", jobId);
    throw e;
  }
}

type ContactWithJob = Database["public"]["Tables"]["contacts"]["Row"] & {
  jobs: { title: string; url: string | null; company: string } | null;
};

export function composeEmail(s: Settings, c: ContactWithJob) {
  const job = c.jobs;
  const vars = {
    first_name: c.first_name ?? c.name.split(" ")[0],
    name: c.name,
    company: c.company ?? job?.company,
    job_title: job?.title,
    job_url: job?.url?.startsWith("manual:") ? "" : job?.url,
    contact_title: c.title,
    linkedin: s.linkedin_url,
  };
  return {
    subject: c.custom_subject ?? renderTemplate(s.template_subject, vars),
    body: c.custom_body ?? renderTemplate(s.template_body, vars),
  };
}

export async function loadResume(s: Settings): Promise<Attachment | null> {
  if (!s.attach_resume || !s.resume_path) return null;
  const admin = await adminDb();
  const { data: file } = await admin.storage.from("resumes").download(s.resume_path);
  if (!file) return null;
  return {
    filename: s.resume_filename || "Resume.pdf",
    mime: file.type || "application/pdf",
    data: new Uint8Array(await file.arrayBuffer()),
  };
}

export async function sendPending(db: DB, userId: string, s: Settings, maxThisRun = 50, origin: string | null = null, company: string | null = null) {
  const { count } = await db
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("send_status", "sent")
    .gte("sent_at", sendCountStart(s as { daily_reset_at?: string | null }));
  // Sending one company on purpose ignores the daily safety cap (still max per-company limit).
  const quota = company
    ? Math.max(1, Math.min(s.contacts_per_job || 15, 15))
    : Math.min(maxThisRun, remainingQuota(s.daily_limit, count ?? 0));
  if (!quota) return 0;
  // With review on, only emails you approved go out
  let q = db
    .from("contacts")
    .select("*, jobs(title, url, company)")
    .eq("user_id", userId)
    .in("send_status", sendableStatuses(s.require_approval))
    .is("sent_at", null);
  if (company) q = q.eq("company", company);
  // Most recently approved/found first, so the contacts you just approved go out first
  const { data: pending } = await q.order("created_at", { ascending: false }).limit(quota);
  // Fail before claiming contacts if the user selected another Gmail account.
  if (!pending?.length) return 0;
  resolveSenderEmail(s.sender_email, await gmailSenderEmail());
  const attachment = await loadResume(s);
  let sent = 0;
  for (const c of (pending ?? []) as ContactWithJob[]) {
    // Claim the row first so two runs at once (scheduled + button) can never email the same person twice.
    const { data: claimed } = await db.from("contacts").update({ send_status: "sending" })
      .eq("id", c.id).in("send_status", sendableStatuses(s.require_approval)).is("sent_at", null).select("id");
    if (!claimed?.length) continue;
    const { subject, body } = composeEmail(s, c);
    try {
      const r = await sendGmail(c.email, subject, body, attachment, trackedHtml(body, c.id, origin, !!attachment), s.sender_email);
      await db.from("contacts").update({ send_status: "sent", sent_at: new Date().toISOString(), error: null, delivery_status: "sent", gmail_message_id: r?.id ?? null }).eq("id", c.id);
      sent++;
    } catch (e) {
      await db.from("contacts").update({ send_status: "failed", error: String((e as Error).message).slice(0, 500) }).eq("id", c.id);
    }
  }
  return sent;
}

/** One small, resumable step. Persists progress after each unit so interrupted runs still advance. */
export async function runStep(db: DB, userId: string, opts: { full?: boolean; origin?: string | null } = {}) {
  const s = await getSettings(db, userId);
  const log: string[] = [];
  const { count: todayJobs } = await db
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("source", "manual")
    .gte("created_at", startOfDayUtc());
  if (!todayJobs || opts.full) {
    const added = await fetchDailyJobs(db, userId, s, log);
    log.push(`Found ${added} new jobs`);
    const { data: freshest } = await db
      .from("jobs")
      .select("posted_at")
      .eq("user_id", userId)
      .not("posted_at", "is", null)
      .order("posted_at", { ascending: false })
      .limit(1);
    if (freshest?.[0]?.posted_at) log.push(`Newest job posted ${timeAgo(freshest[0].posted_at)}`);
    if (!opts.full) return log;
  }
  const { data: next } = await db
    .from("jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "new")
    .order("created_at")
    .limit(opts.full ? 5 : 1);
  for (const j of next ?? []) {
    try {
      const n = await processJob(db, userId, j.id, s);
      log.push(`Found ${n} contacts — check verification in the Review queue`);
    } catch (e) {
      log.push(`Job failed: ${(e as Error).message}`);
      if (e instanceof ApolloKeyError || e instanceof SnovKeyError || e instanceof HunterKeyError) break;
    }
  }
  const sent = await sendPending(db, userId, s, opts.full ? 50 : 5, opts.origin ?? null);
  log.push(`Sent ${sent} emails`);
  return log;
}

/** Never reach out to Yash's current employer (Dassault Systèmes and its brands). */
export function isOwnCompany(company?: string | null, domain?: string | null) {
  const t = `${company ?? ""} ${domain ?? ""}`.toLowerCase();
  return /dassault|3ds\.com|\b3dexperience\b|solidworks|\bcatia\b|\bbiovia\b|\bsimulia\b|\bmedidata\b|\benovia\b/.test(t);
}
