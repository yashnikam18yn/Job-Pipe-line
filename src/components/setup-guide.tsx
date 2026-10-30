import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const PUBLISHED_URL = "https://role-radar-outreach.lovable.app";

const GUIDE_KEY = "setup-guide-checked";
type GuideState = Record<string, boolean>;

function loadChecks(): GuideState {
  try { return JSON.parse(localStorage.getItem(GUIDE_KEY) ?? "{}") as GuideState; } catch { return {}; }
}

function Step({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const [done, setDone] = useState(false);
  useEffect(() => { setDone(!!loadChecks()[id]); }, [id]);
  const toggle = () => {
    const next = { ...loadChecks(), [id]: !done };
    setDone(!done);
    localStorage.setItem(GUIDE_KEY, JSON.stringify(next));
  };
  return (
    <li className="flex gap-3">
      <button
        aria-label={done ? `Uncheck: ${title}` : `Mark done: ${title}`}
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border ${done ? "border-primary bg-primary text-primary-foreground" : ""}`}
        onClick={toggle}
      >
        {done && <Check className="size-3.5" />}
      </button>
      <div className="min-w-0">
        <p className={`font-medium ${done ? "text-muted-foreground line-through" : ""}`}>{title}</p>
        <div className="mt-1 space-y-1 text-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

export function SetupGuide() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card-elevated space-y-4 p-5">
        <div>
          <p className="label-mono">Use it from another laptop</p>
          <p className="mt-1 text-sm text-muted-foreground">Everything lives in the cloud — jobs, contacts, settings, resume. Sign in and it's all there, including what you left half-finished.</p>
        </div>
        <ol className="space-y-4">
          <Step id="laptop-url" title="Open the published app">
            <p>
              <a href={PUBLISHED_URL} target="_blank" rel="noreferrer" className="text-primary hover:underline">{PUBLISHED_URL}</a>
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={async () => {
                try { await navigator.clipboard.writeText(PUBLISHED_URL); setCopied(true); setTimeout(() => setCopied(false), 2000); toast.success("Link copied"); }
                catch { toast.error("Couldn't copy — select the link and copy it"); }
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
            </Button>
            <p>Works on any laptop's browser — Chrome, Edge, Firefox. No install needed.</p>
          </Step>
          <Step id="laptop-signin" title="Sign in with the same email you use here">
            <p>Use the same account as this dashboard. If you forgot the password, use "Forgot password" on the sign-in page — a reset link arrives by email.</p>
          </Step>
          <Step id="laptop-check" title="Check your data came across">
            <p>Open the Jobs and Review queue tabs — you should see your existing jobs and contacts. If anything looks empty, wait a few seconds and refresh once.</p>
          </Step>
          <Step id="laptop-note" title="Know what stays on this laptop">
            <p>The download-able Naukri local tool only runs on the computer where you installed it. Everything else works from any laptop. Sending, tracking, and settings are shared, so don't run "Send waiting emails" on two laptops at the same time — approve and send from one place to keep counts clean.</p>
          </Step>
        </ol>
      </section>

      <section className="card-elevated space-y-4 p-5">
        <div>
          <p className="label-mono">Connect your GitHub account</p>
          <p className="mt-1 text-sm text-muted-foreground">This is done in the Lovable editor, not inside this dashboard. It creates a private repo and keeps it in sync automatically.</p>
        </div>
        <ol className="space-y-4">
          <Step id="gh-settings" title="Open Project settings → Git">
            <p>In the Lovable editor (where you type requests), open <b>Project settings</b> → <b>Git</b>. You can also use the + menu next to the chat box → Project → GitHub.</p>
          </Step>
          <Step id="gh-connect" title="Connect GitHub">
            <p>Click <b>Connect GitHub</b>. Lovable signs you in to GitHub and creates a new <b>private</b> repository — it can't link a repo that already exists. Authorize when asked.</p>
          </Step>
          <Step id="gh-sync" title="Let it sync">
            <p>After connecting, every change made here is committed to the repo automatically. To get the code on another laptop: sign in to GitHub, open the repo, and clone or download it as a ZIP.</p>
          </Step>
          <Step id="gh-clone" title="Clone on another laptop (optional)">
            <p><span className="font-mono text-xs">{"git clone <repo URL>"}</span> then run it locally with <span className="font-mono text-xs">npm install && npm run dev</span>. The published link above is enough for daily use — cloning is only if you want the raw code.</p>
          </Step>
        </ol>
        <p className="text-xs text-muted-foreground">Both the published link and GitHub stay in sync with each other — no conflict. If Lovable ever says the repo and the app have diverged, merge the newest <span className="font-mono">lovable-sync</span> branch into the main branch on GitHub.</p>
      </section>
    </div>
  );
}

export function GuideLink() {
  return (
    <a href={PUBLISHED_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
      <ExternalLink className="size-3" /> published app
    </a>
  );
}
