import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
import { linkedinJobs, parseLinkedInCards, searchJobs } from "@/lib/outreach.server";
const card = (ago: string) => `<li><a href="https://in.linkedin.com/jobs/view/java-dev-at-acme-123?x=1"></a><h3 class="base-search-card__title"> Java Developer </h3><h4 class="base-search-card__subtitle"><a> Acme &amp; Co </a></h4><span class="job-search-card__location">Pune</span><time datetime="x">${ago}</time></li>`;
describe("LinkedIn job cards", () => {
  it("reads real title, company and link", () => {
    expect(parseLinkedInCards(card("5 hours ago"))[0]).toMatchObject({ url: "https://www.linkedin.com/jobs/view/java-dev-at-acme-123", title: "Java Developer", company: "Acme & Co" });
  });
  it("drops jobs older than 24 hours", () => {
    expect(parseLinkedInCards(card("2 days ago"))).toHaveLength(0);
  });
});

describe("LinkedIn search failures", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it("reports a temporary limit instead of silently returning zero jobs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Too many requests", { status: 429 }));
    const warnings: string[] = [];
    try {
      const result = linkedinJobs("Java Developer", "India", 3, warnings);
      await vi.runAllTimersAsync();
      expect(await result).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("temporarily limited");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally { fetchMock.mockRestore(); }
  });
  it("keeps earlier jobs when a later page fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("connection failed"))
      .mockResolvedValueOnce(new Response(card("5 hours ago")));
    const warnings: string[] = [];
    try {
      const result = linkedinJobs("Java Developer", "India", 3, warnings);
      await vi.runAllTimersAsync();
      expect(await result).toHaveLength(1);
      expect(warnings).toHaveLength(1);
    } finally { fetchMock.mockRestore(); }
  });
  it("recovers a temporary failure on the same page without duplicating jobs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(card("5 hours ago")))
      .mockResolvedValueOnce(new Response(""));
    const log: string[] = [];
    const result = linkedinJobs("Java Developer", "India", 3, log);
    await vi.runAllTimersAsync();
    expect(await result).toHaveLength(1);
    expect(log).toEqual([expect.stringContaining("recovered")]);
  });
  it("defers remaining keywords after an exhausted rate limit", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 429 }));
    const state = {};
    const log: string[] = [];
    const first = linkedinJobs("Java", "India", 1, log, state);
    await vi.runAllTimersAsync();
    await first;
    expect(await linkedinJobs("Spring Boot", "India", 1, log, state)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(log).toHaveLength(2);
  });
  it("retains LinkedIn jobs and reports Naukri failures independently", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "test-only");
    vi.stubEnv("FIRECRAWL_API_KEY", "test-only");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("connector-gateway")) return new Response(null, { status: 503 });
      return new Response(String(url).includes("start=0") ? card("5 hours ago") : "");
    });
    try {
      const log: string[] = [];
      const result = searchJobs("Java", "India", log);
      await vi.runAllTimersAsync();
      expect(await result).toHaveLength(1);
      expect(log).toEqual([expect.stringContaining("Naukri could not complete")]);
    } finally { vi.unstubAllEnvs(); }
  });
  it("retains Naukri jobs when LinkedIn remains rate limited", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "test-only");
    vi.stubEnv("FIRECRAWL_API_KEY", "test-only");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("linkedin.com")) return new Response(null, { status: 429 });
      return new Response(JSON.stringify({ data: { web: [{ url: "https://naukri.com/job-listings/java-acme", title: "Java Developer", description: "Posted 3 hours ago" }] } }));
    });
    try {
      const log: string[] = [];
      const result = searchJobs("Java", "India", log);
      await vi.runAllTimersAsync();
      expect(await result).toEqual([expect.objectContaining({ url: "https://naukri.com/job-listings/java-acme" })]);
      expect(log).toEqual([expect.stringContaining("temporarily limited")]);
    } finally { vi.unstubAllEnvs(); }
  });
});

import { parsePeopleResults } from "@/lib/outreach.server";
const titles = ["HR", "Recruiter", "Talent Acquisition", "Engineering Manager"];
describe("LinkedIn people results", () => {
  const list = [
    { url: "https://in.linkedin.com/in/monika", title: "Monika Shah - Talent Acquisition Team Lead at Capco", description: "" },
    { url: "https://in.linkedin.com/in/x", title: "Graphic Designer - Capco", description: "" },
    { url: "https://in.linkedin.com/in/y", title: "Ravi Kumar - Talent Acquisition at Infosys", description: "" },
  ];
  it("keeps recruiters at the right company with their name split", () => {
    expect(parsePeopleResults(list, "Capco", titles)).toEqual([
      { first_name: "Monika", last_name: "Shah", headline: "Talent Acquisition Team Lead at Capco", linkedin_url: "https://in.linkedin.com/in/monika" },
    ]);
  });
});
