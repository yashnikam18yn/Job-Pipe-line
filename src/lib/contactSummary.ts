type SummaryContact = { send_status: string; sent_at: string | null; email_status: string | null };

/** Count actual sends, not attempts, and honor the same UTC/manual reset as sending. */
export function contactSummary(contacts: SummaryContact[], resetAt: string | null, now = new Date()) {
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  const day = midnight.toISOString();
  const start = resetAt && resetAt > day ? resetAt : day;
  return {
    sent: contacts.filter((c) => c.send_status === "sent").length,
    sentToday: contacts.filter((c) => c.send_status === "sent" && c.sent_at && c.sent_at >= start).length,
    pending: contacts.filter((c) => c.send_status === "approved" && !c.sent_at).length,
    verified: contacts.filter((c) => c.email_status === "verified").length,
  };
}