import { describe, expect, it } from "vitest";
import { contactsFromRows, contactsFromText, sameDomain } from "./internalData";

describe("internal data", () => {
  it("reads name and company columns from a sheet and drops gmail", () => {
    const r = contactsFromRows([["HR Name", "Company", "Email"], ["Neha S", "Capgemini", "Neha.S@capgemini.com"], ["X", "Y", "x@gmail.com"]]);
    expect(r).toEqual([{ email: "neha.s@capgemini.com", domain: "capgemini.com", name: "Neha S", company: "Capgemini", title: null }]);
  });
  it("pulls emails out of PDF text and dedupes", () => {
    const r = contactsFromText("1. TCS hr@tcs.com\n2. TCS hr@tcs.com\nInfosys a.b@infosys.com");
    expect(r.map((c) => c.email)).toEqual(["hr@tcs.com", "a.b@infosys.com"]);
    expect(r[0]!.company).toBe("TCS");
  });
  it("matches subdomains", () => {
    expect(sameDomain("in.ibm.com", "ibm.com")).toBe(true);
    expect(sameDomain("tcs.com", "infosys.com")).toBe(false);
  });
});

import { peopleFromPdfItems } from "./internalData";
describe("pdf people table", () => {
  it("reads name, title, LinkedIn, company and website domain per row", () => {
    let y = 100; const I = (str: string, x: number) => { if (x < 80) y -= 10; return { str, x, y }; };
    const r = peopleFromPdfItems([I("2", 69), I("Name", 92), I("Job Title", 156), I("Linkedin URL", 234), I("Company Name", 318), I("Company Website", 481),
      I("3", 69), I("Chetna Gogia", 92), I("Chief Human Resources Officer", 156), I("http://www.linkedin.com/in/chetna-gogia", 234), I("GoKwik", 318), I("http://www.gokwik.co/", 481), I("https://twitter.com/gokwik", 603),
      I("4", 69), I("No Site", 92), I("http://www.linkedin.com/in/x", 234), I("Acme", 318)]);
    expect(r).toEqual([{ name: "Chetna Gogia", title: "Chief Human Resources Officer", linkedin_url: "https://www.linkedin.com/in/chetna-gogia", company: "GoKwik", domain: "gokwik.co" }]);
  });
});
