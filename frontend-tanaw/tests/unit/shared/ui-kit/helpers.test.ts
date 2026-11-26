// Behavior of the portal's UI-kit helpers: dropdown keyboard movement, when a dropdown shows its
// search field, and sentence-case status labels.
import { describe, expect, it } from "vitest";
import { DROPDOWN_SEARCH_MIN_OPTIONS, getNextDropdownIndex, shouldShowDropdownSearch } from "../../../../src/shared/ui-kit/lib/dropdown";
import { toSentenceCase } from "../../../../src/shared/ui-kit/lib/sentence-case";

describe("dropdown keyboard navigation", () => {
  it("moves through options without escaping the available range", () => {
    expect(getNextDropdownIndex(0, 4, "ArrowDown")).toBe(1);
    expect(getNextDropdownIndex(3, 4, "ArrowDown")).toBe(3);
    expect(getNextDropdownIndex(2, 4, "ArrowUp")).toBe(1);
    expect(getNextDropdownIndex(0, 4, "ArrowUp")).toBe(0);
  });

  it("supports Home and End and safely handles empty option sets", () => {
    expect(getNextDropdownIndex(2, 4, "Home")).toBe(0);
    expect(getNextDropdownIndex(0, 4, "End")).toBe(3);
    expect(getNextDropdownIndex(0, 0, "End")).toBe(0);
  });
});

describe("dropdown search visibility", () => {
  it("keeps short lists as standard selectable dropdowns", () => {
    expect(shouldShowDropdownSearch(true, 3)).toBe(false);
    expect(shouldShowDropdownSearch(true, DROPDOWN_SEARCH_MIN_OPTIONS - 1)).toBe(false);
  });

  it("keeps search for explicitly searchable long lists", () => {
    expect(shouldShowDropdownSearch(true, DROPDOWN_SEARCH_MIN_OPTIONS)).toBe(true);
    expect(shouldShowDropdownSearch(false, 30)).toBe(false);
  });
});

describe("toSentenceCase", () => {
  it("lowercases every word after the first", () => {
    expect(toSentenceCase("In Review")).toBe("In review");
    expect(toSentenceCase("Ready to Consolidate")).toBe("Ready to consolidate");
    expect(toSentenceCase("People in Area: 3")).toBe("People in area: 3");
  });

  it("capitalizes machine values and turns underscores into spaces", () => {
    expect(toSentenceCase("running")).toBe("Running");
    expect(toSentenceCase("retry_scheduled")).toBe("Retry scheduled");
  });

  it("keeps acronyms and mixed-case words", () => {
    expect(toSentenceCase("ML Service Running")).toBe("ML service running");
    expect(toSentenceCase("Fix in TANAW")).toBe("Fix in TANAW");
    expect(toSentenceCase("LGU Staff Account")).toBe("LGU staff account");
  });

  it("keeps hyphenated words and spacing", () => {
    expect(toSentenceCase("Staff Follow-up")).toBe("Staff follow-up");
    expect(toSentenceCase("  Not Configured ")).toBe("Not configured");
  });
});
