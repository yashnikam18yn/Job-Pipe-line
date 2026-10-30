import { describe, it, expect } from "vitest";
import { buildEmail, inferPattern, linkedinNote } from "./emailGuess";
describe("emailGuess", () => {
  it("defaults to first.last", () => expect(buildEmail(inferPattern([], "cgi.com"), "Priya", "Sharma", "cgi.com")).toBe("priya.sharma@cgi.com"));
  it("learns f.last from examples, ignoring role inboxes", () => expect(inferPattern(["hr@x.com", "a.kumar@x.com", "r.shah@x.com", "john.doe@x.com"], "x.com")).toBe("f.last"));
  it("ignores other domains", () => expect(inferPattern(["a.b@y.com", "a.kumar@y.com"], "x.com")).toBe("first.last"));
  it("note fits LinkedIn 300-char limit", () => expect(linkedinNote("A", "B".repeat(400), null).length).toBeLessThanOrEqual(300));
});
