<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules
- Sender preferences live in outreach settings; all outreach and test sends verify the connected Gmail profile and set the same From header, so account changes cannot silently send from the old address.
- Multiple job keywords use the shared browser-safe keyword parser and bounded per-keyword searches, preserving multi-word roles and deduplicating job URLs.
- Job searches pass per-source diagnostics through the existing run log; temporary LinkedIn failures retain partial results and must not appear as successful empty searches.
- Read-only job searches use the shared bounded retry helper; search keyword pairs sequentially and stop further LinkedIn requests after an exhausted rate limit to avoid request storms. Never apply these retries to email sending.
- Job reference validation and URL-derived IDs live in the browser-safe template helper so review, template tests, and outgoing emails use the same rules.
- Outreach pipeline logic lives in `src/lib/outreach.server.ts` (imported dynamically inside handlers) so connector keys never reach the browser.
- The scheduled run calls `/api/public/jobs/daily-run` hourly in a window; each call does one small resumable step because scheduler calls can be cut short.
- Only Apollo `verified` emails are stored; contacts are unique per user+email so nobody is emailed twice.
- Job experience policy lives in browser-safe `src/lib/template.ts`: use `isJobWithinExperiencePolicy` for manual insertion and dashboard visibility so intentional manual additions bypass the band; automatically discovered jobs retain `isAboveExperienceBand` filtering.
- Contact discovery: find HR/recruiter names via public LinkedIn search, then Snov.io name+domain email lookup; Snov's domain prospect list is only a fallback because free plans return few relevant people.
- When no verified provider works, contacts fall back to LinkedIn names + inferred company email format (email_status 'guessed', shown as likely) so the free plan still yields reviewable contacts.
- Dashboard contact counts use the browser-safe contact summary helper and load all contact pages so totals do not silently truncate; no bounce is not proof of delivery.
- Naukri dashboard reviews remain manual; the separately downloadable local Python tool runs scheduled unchanged-headline saves on the user's computer with local session/results only, never on the server or with dashboard credentials.
- Uploaded HR lists (Internal data tab) are parsed in the browser into internal_contacts; they always teach the company email format, and are added as contacts only when outreach_settings.use_internal_emails is on.
- PDF HR tables without emails (name, title, LinkedIn, company website) go to internal_people; their names are used first in likely-email guessing for the matching company domain.
