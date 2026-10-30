import { describe, expect, it } from "vitest";
import { normalizeSenderEmail, resolveSenderEmail } from "./senderEmail";

describe("sender email", () => {
  it("keeps Yash's current connected Gmail sender", () => {
    expect(resolveSenderEmail(null, "yashnikam1804@gmail.com")).toBe("yashnikam1804@gmail.com");
  });
  it("allows a future sender after Gmail is connected as that account", () => {
    expect(resolveSenderEmail("future@example.com", "future@example.com")).toBe("future@example.com");
  });
  it("blocks sending with a changed setting but unchanged Gmail account", () => {
    expect(() => resolveSenderEmail("future@example.com", "yashnikam1804@gmail.com")).toThrow("Sending paused");
  });
  it("normalizes addresses and rejects header injection", () => {
    expect(normalizeSenderEmail(" YashNikam1804@gmail.com ")).toBe("yashnikam1804@gmail.com");
    expect(() => normalizeSenderEmail("x@gmail.com\r\nBcc: other@example.com")).toThrow();
  });
});