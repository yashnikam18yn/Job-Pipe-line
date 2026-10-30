import { describe, expect, it } from "vitest";
import { dueSlot, istParts } from "./naukriBump";

// Fixed instants in UTC; IST = UTC+5:30.
const at = (isoUtc: string) => new Date(isoUtc);

describe("istParts", () => {
  it("converts UTC to the IST date and hour", () => {
    // 2026-10-29 02:00 UTC = 07:30 IST
    expect(istParts(at("2026-10-29T02:00:00Z"))).toEqual({ date: "2026-10-29", hour: 7 });
  });

  it("rolls the date forward after 18:30 UTC (midnight IST)", () => {
    // 2026-10-29 19:00 UTC = 2026-10-30 00:30 IST
    expect(istParts(at("2026-10-29T19:00:00Z")).date).toBe("2026-10-30");
  });
});

describe("dueSlot", () => {
  it("is morning from 6 AM IST", () => {
    expect(dueSlot(at("2026-10-29T00:30:00Z"))).toBe("morning"); // 06:00 IST
    expect(dueSlot(at("2026-10-29T06:29:00Z"))).toBe("morning"); // 11:59 IST
  });

  it("is evening from 5 PM to 11 PM IST", () => {
    expect(dueSlot(at("2026-10-29T11:30:00Z"))).toBe("evening"); // 17:00 IST
    expect(dueSlot(at("2026-10-29T17:29:00Z"))).toBe("evening"); // 22:59 IST
  });

  it("is null outside both windows", () => {
    expect(dueSlot(at("2026-10-29T00:29:00Z"))).toBeNull(); // 05:59 IST
    expect(dueSlot(at("2026-10-29T06:30:00Z"))).toBeNull(); // 12:00 IST
    expect(dueSlot(at("2026-10-29T17:30:00Z"))).toBeNull(); // 23:00 IST
  });
});
