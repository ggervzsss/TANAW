import { describe, expect, it } from "vitest";
import { getNextDropdownIndex } from "./dropdownKeyboard";
import { DROPDOWN_SEARCH_MIN_OPTIONS, shouldShowDropdownSearch } from "./dropdownSearch";

describe("SelectDropdown keyboard navigation", () => {
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

describe("SelectDropdown search visibility", () => {
  it("keeps short lists as standard selectable dropdowns", () => {
    expect(shouldShowDropdownSearch(true, 3)).toBe(false);
    expect(shouldShowDropdownSearch(true, DROPDOWN_SEARCH_MIN_OPTIONS - 1)).toBe(false);
  });

  it("keeps search for explicitly searchable long lists", () => {
    expect(shouldShowDropdownSearch(true, DROPDOWN_SEARCH_MIN_OPTIONS)).toBe(true);
    expect(shouldShowDropdownSearch(false, 30)).toBe(false);
  });
});
