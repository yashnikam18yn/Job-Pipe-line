import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseJobKeywords } from "@/lib/jobKeywords";

export function JobKeywordsInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState("");
  const keywords = parseJobKeywords(value);
  function add() {
    onChange(parseJobKeywords([...keywords, draft].join(", ")).join(", "));
    setDraft("");
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      {keywords.map((keyword) => <span key={keyword} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-secondary px-2 text-sm text-secondary-foreground">
        <span className="min-w-0 break-words">{keyword}</span>
        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" aria-label={`Remove ${keyword}`} title={`Remove ${keyword}`} onClick={() => onChange(keywords.filter((word) => word !== keyword).join(", "))}><X /></Button>
      </span>)}
    </div>
    <div className="flex gap-2">
      <Input aria-label="Job keywords" placeholder="Java Developer, Spring Boot, SDE 2" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
      <Button type="button" variant="outline" size="icon" aria-label="Add keyword" title="Add keyword" disabled={!draft.trim()} onClick={add}><Plus /></Button>
    </div>
  </div>;
}