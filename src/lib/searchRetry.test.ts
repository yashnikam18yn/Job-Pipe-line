import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSearchText, retryAfterMs } from "./searchRetry";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("bounded read-only search retries", () => {
  it("recovers a 429 and respects Retry-After", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("limited", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response("jobs"));
    const result = fetchSearchText("https://example.com/search", {});
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(251);
    expect(await result).toBe("jobs");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("recovers a connection timeout", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new DOMException("timeout", "TimeoutError")).mockResolvedValueOnce(new Response("recovered"));
    const result = fetchSearchText("https://example.com/search", {});
    await vi.runAllTimersAsync();
    expect(await result).toBe("recovered");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("stops after three attempts on a persistent temporary failure", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    const result = expect(fetchSearchText("https://example.com/search", {})).rejects.toMatchObject({ status: 503, attempts: 3 });
    await vi.runAllTimersAsync();
    await result;
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("does not retry authentication or access failures", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 403 }));
    await expect(fetchSearchText("https://example.com/search", {})).rejects.toMatchObject({ status: 403, attempts: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not ignore a cooldown longer than the request budget", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
    await expect(fetchSearchText("https://example.com/search", {})).rejects.toMatchObject({ attempts: 1, retryAfterMs: 120000 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("parses dated Retry-After headers", () => {
    expect(retryAfterMs("Fri, 30 Oct 2026 04:42:02 GMT", Date.parse("2026-10-30T04:42:00Z"))).toBe(2000);
  });
});