import { describe, expect, it } from "vitest";
import { helpArticles } from "../data/articles";
import { articlesForRole, searchHelpArticles } from "./helpArticles";

describe("Help Center knowledge base", () => {
  it("filters articles by authenticated role", () => {
    expect(articlesForRole(helpArticles, "staff").every((article) => article.roles.includes("staff"))).toBe(true);
    expect(articlesForRole(helpArticles, "staff").some((article) => article.id === "admin-map-navigation")).toBe(false);
  });

  it("ranks title matches above keyword and body-only matches", () => {
    const results = searchHelpArticles(helpArticles, "system settings");
    expect(results[0]?.article.id).toBe("it-system-settings");
  });

  it("searches keywords and article content", () => {
    expect(searchHelpArticles(helpArticles, "barangay").map((result) => result.article.id)).toContain("admin-map-navigation");
    expect(searchHelpArticles(helpArticles, "last confirmed value").map((result) => result.article.id)).toContain("it-system-settings");
  });

  it("returns an empty list when nothing matches", () => {
    expect(searchHelpArticles(helpArticles, "quantum pineapple")).toEqual([]);
  });
});
