import { describe, expect, it } from "vitest";
import { helpArticles } from "../data/articles";
import { searchHelpArticles } from "./help-articles";

describe("Enterprise Help Center search", () => {
  it("ranks title matches and searches keywords and content", () => {
    expect(searchHelpArticles(helpArticles, "connect configure")[0]?.article.id).toBe("camera-connection");
    expect(searchHelpArticles(helpArticles, "backend connectivity").map((result) => result.article.id)).toContain("reports-and-sync");
  });

  it("returns no results for unrelated text", () => {
    expect(searchHelpArticles(helpArticles, "quantum pineapple")).toEqual([]);
  });
});
