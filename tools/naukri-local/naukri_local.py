"""User-operated local Naukri saves. No passwords, CAPTCHA handling or evasion."""
import argparse
import asyncio
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import socket

IST = timezone(timedelta(hours=5, minutes=30))
PROFILE_URL = "https://www.naukri.com/mnjuser/profile"
HOME = Path.home() / ".naukri-local"


def scheduled_slot(now):
    local = now.astimezone(IST)
    if 8 <= local.hour < 12:
        return f"{local.date()}:morning"
    if 21 <= local.hour < 23:
        return f"{local.date()}:evening"
    return None


def read_state():
    path = HOME / "status.json"
    return json.loads(path.read_text()) if path.exists() else {"attempts": {}}


def write_state(state):
    HOME.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = HOME / "status.tmp"
    temp.write_text(json.dumps(state, indent=2))
    temp.replace(HOME / "status.json")


def edit_control(page):
    return page.locator("xpath=//div[contains(@class,'widgetHead')]//span[normalize-space()='Resume headline']/following-sibling::span")


async def save_unchanged_headline(page):
    """Fail closed if candidate selectors differ; never replace the user's text."""
    from playwright.async_api import expect
    edit = edit_control(page)
    await expect(edit).to_have_count(1, timeout=15000)
    await edit.click()
    field = page.locator("#resumeHeadlineTxt")
    await expect(field).to_be_visible()
    original = await field.input_value()
    if not original.strip():
        raise RuntimeError("Empty headline: nothing was saved.")
    save = page.get_by_role("button", name="Save", exact=True)
    await expect(save).to_have_count(1)
    await expect(save).to_be_enabled()
    # Do not append whitespace or change name, experience, or any other profile data.
    await save.click()
    await expect(field).to_be_hidden()
    await page.reload(wait_until="domcontentloaded")
    await expect(edit_control(page)).to_have_count(1, timeout=15000)
    await edit_control(page).click()
    await expect(field).to_be_visible()
    await expect(field).to_have_value(original)
    return "save_completed_headline_unchanged"


async def browser_session(mode):
    from playwright.async_api import async_playwright
    HOME.mkdir(mode=0o700, parents=True, exist_ok=True)
    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            str(HOME / "browser"), headless=False,
            viewport={"width": 1280, "height": 900},
        )
        page = await context.new_page()
        try:
            await page.goto(PROFILE_URL, wait_until="domcontentloaded", timeout=45000)
            if mode == "login":
                print("Sign into Naukri yourself in this window. Complete any CAPTCHA yourself.")
                print("Open your profile, then return here. No profile changes will be made.")
                await asyncio.to_thread(input, "Press Enter when your profile is open: ")
                from playwright.async_api import expect
                await expect(edit_control(page)).to_have_count(1, timeout=15000)
                state = read_state()
                state["login_checked_at"] = datetime.now(timezone.utc).isoformat()
                write_state(state)
                print("Profile access checked. Login stays only on this computer.")
                return "login_checked"
            return await save_unchanged_headline(page)
        finally:
            await context.close()


async def run_once(slot=None):
    state = read_state()
    if slot and slot in state.get("attempts", {}):
        return
    key = slot or f"manual:{datetime.now(timezone.utc).isoformat()}"
    state.setdefault("attempts", {})[key] = {"result": "started", "at": datetime.now(timezone.utc).isoformat()}
    write_state(state)  # Interrupted attempts are not automatically repeated.
    try:
        result = await browser_session("save")
        detail = "Clicked Save and reloaded: headline unchanged. No ranking or timestamp claim."
    except Exception:
        result = "needs_attention"
        detail = "Not confirmed. Check login, CAPTCHA, disabled Save, or changed page controls; no automatic retry this slot."
    state["attempts"][key] = {"result": result, "detail": detail, "at": datetime.now(timezone.utc).isoformat()}
    write_state(state)
    print(f"{key}: {result}. {detail}", flush=True)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["login", "run", "watch", "status"])
    args = parser.parse_args()
    if args.mode == "status":
        print(json.dumps(read_state(), indent=2))
        return
    # Keep two copies from saving the same profile concurrently.
    lock = socket.socket()
    try:
        lock.bind(("127.0.0.1", 47863))
    except OSError:
        raise SystemExit("Another copy may be running (or port 47863 is in use). Close it first.")
    try:
        if args.mode == "login":
            await browser_session("login")
        elif args.mode == "run":
            answer = await asyncio.to_thread(input, "Click Save on your CURRENT resume headline, without changing it? Type YES: ")
            if answer == "YES":
                await run_once()
        else:
            if not read_state().get("login_checked_at"):
                raise SystemExit("Run login first.")
            answer = await asyncio.to_thread(input, "Allow unchanged-headline saves at 8 AM and 9 PM IST while this is open? Type YES: ")
            if answer != "YES":
                return
            print("Watching morning 8 AM–12 PM / evening 9 PM–11 PM IST. Keep computer awake and this window open. Ctrl+C stops.", flush=True)
            while True:
                slot = scheduled_slot(datetime.now(timezone.utc))
                if slot:
                    await run_once(slot)
                await asyncio.sleep(30)
    finally:
        lock.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Stopped.")