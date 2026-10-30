import { describe, expect, it } from "vitest";
import { contactSummary } from "@/lib/contactSummary";

const now = new Date("2026-10-28T18:00:00Z");
describe("truthful outreach counts", () => {
  it("counts successful sends separately from failed attempts", () => {
    expect(contactSummary([
      { send_status: "sent", sent_at: "2026-10-28T10:00:00Z", email_status: "guessed" },
      { send_status: "failed", sent_at: null, email_status: "guessed" },
    ], null, now).sent).toBe(1);
  });
  it("does not describe guessed or catch-all contacts as verified", () => {
    expect(contactSummary(["verified", "guessed", "catch-all", null].map((email_status) => ({ email_status, send_status: "pending", sent_at: null })), null, now).verified).toBe(1);
  });
  it("only counts approved and never-sent recipients as waiting", () => {
    expect(contactSummary([
      { send_status: "approved", sent_at: null, email_status: null },
      { send_status: "approved", sent_at: "2026-10-28T10:00:00Z", email_status: null },
      { send_status: "pending", sent_at: null, email_status: null },
    ], null, now).pending).toBe(1);
  });
  it("honors the manual reset without changing historical sent totals", () => {
    const rows = ["2026-10-27T23:00:00Z", "2026-10-28T10:00:00Z", "2026-10-28T16:00:00Z"].map((sent_at) => ({ send_status: "sent", sent_at, email_status: null }));
    expect(contactSummary(rows, "2026-10-28T12:00:00Z", now)).toMatchObject({ sentToday: 1, sent: 3 });
    expect(contactSummary(rows, "2026-10-27T12:00:00Z", now).sentToday).toBe(2);
  });
});