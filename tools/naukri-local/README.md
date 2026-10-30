# Naukri local scheduled saves

Free, runs on your own computer. This is an experimental local helper, not a Naukri integration. Automated actions may cause account restrictions; use only if you accept that risk. No CAPTCHA bypass or automated Google login.

## Windows setup
1. Install Python 3 from https://www.python.org/downloads/ if needed.
2. Extract the ZIP into a folder on your computer.
3. Double-click `setup-windows.bat`. It installs the browser and opens Naukri.
4. Sign in yourself, including Google if Naukri permits it in this browser. Complete any CAPTCHA yourself. Open your profile and press Enter in the command window. If Google refuses this browser, stop; this tool does not bypass that restriction.
5. Double-click `run-once-windows.bat`. Type YES to test one save. Read the result before enabling the schedule.
6. Double-click `start-windows.bat`, type YES, and keep that window open and your computer awake. A browser opens at each due slot.
7. Double-click `status-windows.bat` to see results. Close the watcher window or press Ctrl+C to stop. You must reopen it after restarting your computer.

## macOS / Linux
In the extracted folder:
```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python naukri_local.py login
.venv/bin/python naukri_local.py run
.venv/bin/python naukri_local.py watch
```
Use `.venv/bin/python naukri_local.py status` for results. Linux may need Playwright's system dependencies; follow its installation error instructions.

## Exactly what it does
- Attempts one save in each morning (8 AM–12 PM IST) and evening (9 PM–11 PM IST) window. If open at the start, it runs around 8 AM / 9 PM. Starting late in a window runs the current slot once; closed or sleeping computers cannot run it. Missed windows are not replayed.
- Opens **Resume headline**, reads your current text, and clicks **Save without changing the text**. It never changes your name, experience, skills or resume, and never adds misleading content or whitespace tricks.
- Reloads and reopens the headline to confirm it stayed identical. Result `save_completed_headline_unchanged` confirms this flow only, NOT a changed profile timestamp, recruiter rank, or interview benefit. Naukri may ignore an unchanged save or disable its Save button.
- A missing control, expired login, CAPTCHA, disabled Save, or unconfirmed result becomes `needs_attention`. It stops that slot rather than retrying repeatedly. Run `login` again if needed, then use a manual run to test.
- Browser login cookies and results stay in `~/.naukri-local` on your computer. Treat this folder as private. Never share it or upload it. To sign out and remove stored login, stop the tool and delete this folder. No password is collected by the dashboard.
- Results do **not** sync to the dashboard; its Mark done buttons remain manual.

## Verification limits
Schedule rules and the unchanged-headline flow were tested locally against a simulated page. The live Naukri selectors come from community examples and may have changed. No real Naukri account was edited or verified during development. Your first local run is required to establish whether the current page accepts unchanged saves. There is no proven recruiter-visibility benefit from saving identical content.