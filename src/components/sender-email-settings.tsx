import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { gmailSenderInfoFn } from "@/lib/outreach.functions";
import { normalizeSenderEmail } from "@/lib/senderEmail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, RotateCw, Check } from "lucide-react";
import { toast } from "sonner";

export function SenderEmailSettings({ value, onSave }: { value: string | null; onSave: (email: string) => Promise<void> }) {
  const info = useServerFn(gmailSenderInfoFn);
  const [connected, setConnected] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try { const result = await info(); setConnected(result.email); setError(""); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [info]);
  useEffect(() => { void refresh(); }, [refresh]);
  const currentDraft = draft ?? value ?? connected ?? "";
  const changed = currentDraft.trim().toLowerCase() !== (value ?? connected ?? "").toLowerCase();
  const mismatch = value && connected && value.toLowerCase() !== connected.toLowerCase();
  return (
    <section className="space-y-3 border-b pb-4">
      <div className="space-y-1.5">
        <Label htmlFor="sender-email">From email</Label>
        <Input id="sender-email" type="email" autoComplete="email" value={currentDraft} onChange={(e) => setDraft(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !changed || !currentDraft.trim()} onClick={async () => {
          let email: string;
          try { email = normalizeSenderEmail(currentDraft); } catch { toast.error("Enter a valid sender email"); return; }
          setBusy(true);
          try { await onSave(email); setDraft(email); toast.success(email === connected ? "Sender email saved" : "Sender saved — reconnect Gmail before sending"); }
          catch (e) { toast.error((e as Error).message); }
          finally { setBusy(false); }
        }}><Check /> Save sender</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>{busy ? <Loader2 className="animate-spin" /> : <RotateCw />} Check Gmail connection</Button>
      </div>
      {connected && <p className="break-all text-xs text-muted-foreground">Connected Gmail: {connected}</p>}
      {mismatch && <p role="status" className="text-sm text-destructive">Sending paused until Gmail is connected as {value}.</p>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">To switch accounts, save the new address, then ask Lovable to reconnect Gmail with that Google account. Changing this address does not change your dashboard sign-in.</p>
    </section>
  );
}