import { describe, expect, it } from "vitest";
import { containsEmailAddress } from "@/lib/template";
import { jobReference, remainingQuota, renderTemplate } from "@/lib/template";

describe("job references", () => {
  it("keeps a valid HTTP(S) job URL", () => {
    const url = "https://copeland.wd5.myworkdayjobs.com/en-US/Copeland/job/Engineer_JR110063";
    expect(jobReference(url).job_url).toBe(url);
    expect(jobReference(url).job_id).toBe("JR110063");
  });
  it("extracts JR110063 when a URL is malformed", () => {
    const ref = jobReference("copeland.wd5.myworkdayjobs.com/job/Engineer_JR110063");
    expect(ref.job_url).toBe("");
    expect(ref.job_id).toBe("JR110063");
  });
  it("extracts job IDs from LinkedIn and query parameters", () => {
    expect(jobReference("in.linkedin.com/jobs/view/java-developer-at-tekwissen-india-4484072016").job_id).toBe("4484072016");
    expect(jobReference("https://careers.example.com/job?jobId=JR110063").job_id).toBe("JR110063");
  });
  it("extracts Workday requisition IDs from the job path", () => {
    for (const id of ["JR110063", "R-123456", "R123456", "123456", "JR_110063"]) {
      const url = `https://company.wd5.myworkdayjobs.com/en-US/External/job/India/Software-Engineer_${id}`;
      expect(jobReference(url).job_id).toBe(id);
    }
    expect(jobReference("https://company.wd5.myworkdayjobs.com/job/India/Software-Engineer%5FR123456/apply").job_id).toBe("R123456");
  });
  it("includes both the job URL and its identifiable Job ID in the email", () => {
    const url = "https://copeland.wd5.myworkdayjobs.com/en-US/Copeland/job/Engineer_JR110063";
    expect(renderTemplate("{{job_reference}}", { job_url: url })).toBe(`Job URL: ${url}\nJob ID: JR110063`);
  });
  it("omits Job ID when the URL has no recognizable requisition", () => {
    for (const url of [
      "https://company.wd5.myworkdayjobs.com/job/India/Software-Engineer",
      "https://company.wd5.myworkdayjobs.com/job/India/Engineer-2",
      "https://careers.example.com/job/software-engineer?trackingId=123456",
      "https://example.com/job/Software-Engineer_123456",
    ]) {
      expect(renderTemplate("{{job_reference}}", { job_url: url, job_id: "internal-uuid" })).toBe(`Job URL: ${url}`);
      expect(jobReference(url).job_id).toBe("");
    }
  });
  it("does not include unsafe links or invent IDs for manual jobs", () => {
    for (const value of ["javascript:alert(1)", "manual:49d46990-bcb3-4dfc-a9e1-1408bd7b868d", "not a link", "https://user:pass@example.com/job", null]) {
      expect(jobReference(value)).toEqual({ job_url: "", job_id: "", job_reference: "" });
    }
  });
});

describe("bounce recipient matching", () => {
  it("does not mark a different recipient bounced based on a substring", () => {
    expect(containsEmailAddress("Address not found: joann@example.com", "ann@example.com")).toBe(false);
    expect(containsEmailAddress("Failed recipient: <ANN@example.com>", "ann@example.com")).toBe(true);
    expect(containsEmailAddress("ann@example.com.au failed", "ann@example.com")).toBe(false);
  });
});

describe("email template", () => {
  it("fills placeholders", () => {
    expect(renderTemplate("Hi {{first_name}}, {{job_title}} at {{company}}", { first_name: "Asha", job_title: "SDE 2", company: "Acme" })).toBe(
      "Hi Asha, SDE 2 at Acme",
    );
  });
  it("falls back when a name is missing", () => {
    expect(renderTemplate("Hi {{first_name}}", {})).toBe("Hi there");
  });
});

describe("daily limit", () => {
  it("allows up to the daily cap of 15", () => {
    expect(remainingQuota(15, 0)).toBe(15);
    expect(remainingQuota(15, 12)).toBe(3);
  });
  it("never goes negative once the cap is reached", () => {
    expect(remainingQuota(15, 15)).toBe(0);
    expect(remainingQuota(15, 20)).toBe(0);
  });
});

import { isWithin24h } from "@/lib/outreach.server";
describe("only jobs from the past 24 hours", () => {
  it("keeps fresh postings", () => {
    expect(isWithin24h("Posted 5 hours ago")).toBe(true);
    expect(isWithin24h("1 day ago")).toBe(true);
  });
  it("drops older postings", () => {
    expect(isWithin24h("Posted 3 days ago")).toBe(false);
    expect(isWithin24h("1 week ago")).toBe(false);
    expect(isWithin24h("30+ days ago")).toBe(false);
  });
});
describe("linkedin placeholder", () => {
  it("inserts the LinkedIn link", () => {
    expect(renderTemplate("LinkedIn: {{linkedin}}", { linkedin: "https://www.linkedin.com/in/yash-nikam-3404bb223/" })).toBe(
      "LinkedIn: https://www.linkedin.com/in/yash-nikam-3404bb223/",
    );
  });
});

import { sendableStatuses } from "@/lib/template";
describe("review queue", () => {
  it("only sends approved emails when review is on", () => {
    expect(sendableStatuses(true)).toEqual(["approved"]);
  });
  it("sends waiting emails too when review is off", () => {
    expect(sendableStatuses(false)).toContain("pending");
  });
});

import { titleMatches } from "@/lib/outreach.server";
describe("who gets contacted", () => {
  const titles = ["HR", "Recruiter", "Talent Acquisition", "Engineering Manager", "SDE 2"];
  it("matches HR, recruiters, managers and SDE2s", () => {
    expect(titleMatches("Senior Technical Recruiter", titles)).toBe(true);
    expect(titleMatches("HR Business Partner", titles)).toBe(true);
    expect(titleMatches("Engineering Manager, Payments", titles)).toBe(true);
    expect(titleMatches("SDE II", titles)).toBe(true);
  });
  it("skips unrelated roles", () => {
    expect(titleMatches("Sales Director", titles)).toBe(false);
  });
});

import { isCompanyEmail } from "@/lib/outreach.server";
describe("isCompanyEmail", () => {
  it("keeps company-domain addresses", () => {
    expect(isCompanyEmail("priya@questglobal.com", "questglobal.com")).toBe(true);
    expect(isCompanyEmail("hr@in.questglobal.com", "www.questglobal.com")).toBe(true);
  });
  it("drops free mailboxes and other domains", () => {
    expect(isCompanyEmail("priya@gmail.com", "questglobal.com")).toBe(false);
    expect(isCompanyEmail("priya@otherco.com", "questglobal.com")).toBe(false);
    expect(isCompanyEmail("x@notquestglobal.com", "questglobal.com")).toBe(false);
  });
});

import { isAboveExperienceBand, isSeniorRole, isJobWithinExperiencePolicy } from "@/lib/template";
describe("manual job experience exception", () => {
  it("allows manually added lead roles", () => {
    expect(isJobWithinExperiencePolicy("manual", "Technical Lead – Java", "3-5 years")).toBe(true);
    expect(isJobWithinExperiencePolicy("linkedin", "Technical Lead – Java", "3-5 years")).toBe(false);
  });
  it("allows manually added jobs requiring more than five years", () => {
    expect(isJobWithinExperiencePolicy("manual", "Software Engineer", "8+ years of experience")).toBe(true);
    expect(isJobWithinExperiencePolicy("naukri", "Software Engineer", "8+ years of experience")).toBe(false);
    expect(isJobWithinExperiencePolicy(null, "Software Engineer", "8+ years of experience")).toBe(false);
    expect(isJobWithinExperiencePolicy("linkedin", "SDE 2", "3-5 years of experience")).toBe(true);
  });
});
describe("job level filter", () => {
  it("keeps SDE2, engineer and junior roles", () => {
    for (const t of ["SDE 2", "SDE II", "Software Engineer", "Engineer I Software Development", "Java Backend Developer", "Junior Developer", "Graduate Engineer Trainee"]) {
      expect(isSeniorRole(t)).toBe(false);
    }
  });

  it("hides lead and above-SDE2 titles", () => {
    for (const t of ["Lead Engineer", "Technical Lead – Java", "Principal Engineer", "Staff Software Engineer", "Engineering Manager", "Solution Architect", "SDE III", "Software Engineer 3", "Director of Engineering", "Head of Engineering", "VP Engineering", "Senior SDE"]) {
      expect(isSeniorRole(t)).toBe(true);
    }
  });
  it("hides jobs that ask for more than 5 years", () => {
    expect(isAboveExperienceBand("Software Engineer", "Looking for 8+ years of experience")).toBe(true);
    expect(isAboveExperienceBand("Java Developer", "Experience: 6 to 10 years")).toBe(true);
    expect(isAboveExperienceBand("Senior Software Engineer", "3-5 years of experience")).toBe(false);
    expect(isAboveExperienceBand("Software Engineer", "0-2 years")).toBe(false);
  });
});


import { parsePostedAt, postedLabel, timeAgo } from "@/lib/template";
describe("when a job was posted", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  it("reads '13 hours ago' and '52 minutes ago' wording", () => {
    expect(parsePostedAt("Posted 13 hours ago", now)).toBe(new Date(now.getTime() - 13 * 3_600_000).toISOString());
    expect(parsePostedAt("52 minutes ago", now)).toBe(new Date(now.getTime() - 52 * 60_000).toISOString());
    expect(parsePostedAt("posted yesterday", now)).toBe(new Date(now.getTime() - 86_400_000).toISOString());
  });
  it("uses a plain date unless told to ignore it", () => {
    expect(parsePostedAt("2026-10-28", now)).toBe("2026-10-28T00:00:00.000Z");
    expect(parsePostedAt("2026-10-28", now, false)).toBeNull();
  });
  it("says nothing when the text carries no time", () => {
    expect(parsePostedAt("Java Developer at Acme", now)).toBeNull();
  });
  it("labels recent postings relatively, older ones by date, and falls back to when we added them", () => {
    expect(timeAgo(new Date(now.getTime() - 90 * 60_000).toISOString(), now)).toBe("2 hours ago");
    expect(postedLabel(new Date(now.getTime() - 3 * 3_600_000).toISOString(), null, now)).toBe("Posted 3 hours ago");
    expect(postedLabel(new Date(now.getTime() - 3 * 86_400_000).toISOString(), null, now).startsWith("Posted ")).toBe(true);
    expect(postedLabel(null, new Date(now.getTime() - 20 * 60_000).toISOString(), now)).toBe("Added 20 min ago");
    expect(postedLabel(null, null, now)).toBe("");
  });
});