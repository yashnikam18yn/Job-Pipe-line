# Roadmap
- [x] Allow manual jobs above the seniority/experience band and keep them visible; automatic filters retained, 30 tests passed, real lead/8+ years addition persisted after refresh; temporary job removed, no emails sent.
- [x] Add persistent sender-email setting with connected Gmail verification and prevent sends from a mismatched account; save/refresh checked, current sender restored, no emails sent.
- [x] Prepare free local Naukri scheduled saves with user-controlled login, safe unchanged-headline save, local outcomes and download; schedule tests, simulated save and dashboard download verified.
- [ ] Verify live Naukri saves — parked by user ("forgot as of now"); resume only if asked.
- [x] Multiple job keywords: add/remove entries, save together, search separately without duplicate jobs; tests and save/refresh verified.

- [x] Level filter: hide lead/principal/staff/architect/manager titles and >5-year asks; keep SDE2/3–5 yrs and below (template helper + server + dashboard).
- [x] Manual add fallback: Firecrawl 403 on LinkedIn URLs — direct fetch with currentJobId resolution (tested with the user's Wells Fargo link).
- [x] New/added jobs appear at the top of the Jobs list (created_at desc — verified).
- [x] Tests for the level filter pass (20 tests).
- [x] Send waiting emails: per-company send (Wells Fargo) + clear message when daily limit reached
- [x] Manual "Reset today's limit" button
- [x] Correct truncated contact totals, manual-reset counts, verified labels, delivery labels, and exact bounce recipient matching; verify without sending emails.
- [x] Assess value using real sent/bounced totals, not assumed delivery or interview promises.
- [x] Naukri reminders supersede the auto-bump request: morning/evening reminders, profile link, manual completion and undo; no credentials or automation.
- [x] Diagnose missing LinkedIn jobs: live search added 149 LinkedIn jobs; expose temporary request limits and retrieved/duplicate counts instead of silent zero results; tests and signed-in search verified without sending emails.

- [x] Add bounded LinkedIn/Naukri retries, cooldown protection, partial-result recovery and failure tests; 17 tests passed and signed-in Find retrieved 172 LinkedIn + 20 Naukri listings with a real Naukri retry recovery, without sending emails.
