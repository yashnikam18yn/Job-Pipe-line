import { describe, expect, it, vi } from "vitest";
import { parseJobKeywords, searchEachKeyword } from "./jobKeywords";

describe("multiple job keywords", () => {
  it("keeps multi-word roles and removes empty or duplicate entries", () => {
    expect(parseJobKeywords("Java Developer, Spring Boot\nSDE 2, java developer, ,")).toEqual(["Java Developer", "Spring Boot", "SDE 2"]);
  });
  it("searches each keyword separately and includes a shared job only once", async () => {
    const search = vi.fn(async (keyword: string) => [{ url: "shared" }, { url: keyword }]);
    expect(await searchEachKeyword("Java Developer, Spring Boot", search)).toEqual([{ url: "shared" }, { url: "Java Developer" }, { url: "Spring Boot" }]);
    expect(search.mock.calls).toEqual([["Java Developer"], ["Spring Boot"]]);
  });
});