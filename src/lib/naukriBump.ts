// Browser-safe helpers for the Naukri "profile bump" reminder tab.
// Records manual reviews; unchanged saves do not establish recruiter visibility.
// All times are IST (Asia/Kolkata).

export type BumpSlot = "morning" | "evening";

export const SLOT_WINDOWS: Record<BumpSlot, { start: number; end: number; label: string }> = {
  morning: { start: 6, end: 12, label: "Morning · 6 AM – 12 PM IST" },
  evening: { start: 17, end: 23, label: "Evening · 5 PM – 11 PM IST" },
};

const dtf = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** IST calendar date (YYYY-MM-DD) and hour (0-23) for an instant. */
export function istParts(now: Date): { date: string; hour: number } {
  const parts = dtf.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

/** Which slot's window is open right now, or null outside both windows. */
export function dueSlot(now: Date): BumpSlot | null {
  const { hour } = istParts(now);
  for (const slot of ["morning", "evening"] as const) {
    const w = SLOT_WINDOWS[slot];
    if (hour >= w.start && hour < w.end) return slot;
  }
  return null;
}

/** "8:42 AM" in IST for a stored timestamp. */
export function fmtDoneAt(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
}

/** "28 Oct" in IST for a YYYY-MM-DD bump date. */
export function fmtBumpDate(date: string): string {
  return new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
}
