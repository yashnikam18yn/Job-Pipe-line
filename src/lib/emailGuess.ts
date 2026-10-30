// Free "likely email" builder: infers a company's email format from public examples.
export type Pattern = "first.last" | "firstlast" | "first" | "flast" | "first_last" | "f.last" | "firstl";

const clean = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");

export function buildEmail(p: Pattern, first: string, last: string, domain: string): string | null {
  const f = clean(first), l = clean(last);
  if (!f || !l || !domain) return null;
  const local = {
    "first.last": `${f}.${l}`,
    firstlast: `${f}${l}`,
    first: f,
    flast: `${f[0]}${l}`,
    first_last: `${f}_${l}`,
    "f.last": `${f[0]}.${l}`,
    firstl: `${f}${l[0]}`,
  }[p];
  return `${local}@${domain.toLowerCase()}`;
}

/** Pick the most common format among real addresses seen at this domain; defaults to first.last. */
export function inferPattern(emails: string[], domain: string): Pattern {
  const counts: Record<string, number> = {};
  const d = `@${domain.toLowerCase()}`;
  for (const raw of emails) {
    const e = raw.toLowerCase();
    if (!e.endsWith(d)) continue;
    const local = e.slice(0, -d.length);
    if (/^(info|hr|careers?|jobs|contact|support|sales|hello|admin|recruit\w*|talent|noreply|no-reply)$/.test(local)) continue;
    let p: Pattern | null = null;
    if (/^[a-z]{2,}\.[a-z]{2,}$/.test(local)) p = "first.last";
    else if (/^[a-z]\.[a-z]{2,}$/.test(local)) p = "f.last";
    else if (/^[a-z]{2,}_[a-z]{2,}$/.test(local)) p = "first_last";
    if (p) counts[p] = (counts[p] ?? 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return (best?.[0] as Pattern) ?? "first.last";
}

export function linkedinNote(firstName: string | null | undefined, company: string | null | undefined, role: string | null | undefined): string {
  const hi = firstName ? `Hi ${firstName},` : "Hi,";
  const r = role ? ` for the ${role} role` : "";
  const note = `${hi} I'm a Java backend engineer (2.5+ yrs, Dassault Systèmes) interested in opportunities at ${company ?? "your company"}${r}. Could I share my resume or be referred to the hiring team? Thanks!`;
  return note.slice(0, 300); // LinkedIn connection-note limit
}
