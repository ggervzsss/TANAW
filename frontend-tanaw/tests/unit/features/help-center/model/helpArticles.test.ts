import { describe, expect, it } from "vitest";
import { helpArticles } from "../../../../../src/features/help-center/data/articles";
import { articlesForRole, searchHelpArticles } from "../../../../../src/features/help-center/model/helpArticles";

describe("Help Center knowledge base", () => {
  it("filters articles by authenticated role", () => {
    expect(articlesForRole(helpArticles, "staff").every((article) => article.roles.includes("staff"))).toBe(true);
    expect(articlesForRole(helpArticles, "staff").some((article) => article.id === "admin-map-navigation")).toBe(false);
  });

  it("provides recommended and common guidance for every web role", () => {
    for (const role of ["admin", "staff", "it"] as const) {
      const articles = articlesForRole(helpArticles, role);
      expect(articles.some((article) => article.recommended)).toBe(true);
      expect(articles.some((article) => article.commonIssue)).toBe(true);
    }
  });

  it("ranks title matches above keyword and body-only matches", () => {
    const results = searchHelpArticles(helpArticles, "system settings");
    expect(results[0]?.article.id).toBe("it-system-settings");
    expect(searchHelpArticles(helpArticles, "Start on it")[0]?.article.id).toBe("it-requests");
  });

  it("searches keywords and article content", () => {
    expect(searchHelpArticles(helpArticles, "barangay").map((result) => result.article.id)).toContain("admin-map-navigation");
    expect(searchHelpArticles(helpArticles, "Remove older activity now").map((result) => result.article.id)).toContain("it-system-settings");
    expect(searchHelpArticles(helpArticles, "date format").map((result) => result.article.id)).toContain("it-system-settings");
  });

  it("describes the redesigned IT screens and not the retired ones", () => {
    const it = articlesForRole(helpArticles, "it");
    const ids = it.map((article) => article.id);
    expect(ids).toEqual(expect.arrayContaining(["it-overview", "it-requests", "it-enterprises", "it-personnel", "it-system-settings", "it-system-activity"]));
    const text = JSON.stringify(it);
    for (const retired of ["Work Center", "System Settings", "Technical Issue Notifications", "System Activity"]) expect(text).not.toContain(retired);
    for (const screen of ["Overview", "Start on it", "Manage", "LGU Personnel", "Activity", "Email log", "Settings"]) expect(text).toContain(screen);
  });

  it("only links related articles that the same role can open", () => {
    for (const role of ["admin", "staff", "it"] as const) {
      const ids = new Set(articlesForRole(helpArticles, role).map((article) => article.id));
      for (const article of articlesForRole(helpArticles, role)) {
        for (const related of article.relatedArticleIds) expect(ids.has(related), `${article.id} links ${related}`).toBe(true);
      }
    }
  });

  it("returns an empty list when nothing matches", () => {
    expect(searchHelpArticles(helpArticles, "quantum pineapple")).toEqual([]);
  });
});
