import { describe, expect, it } from "vitest";
import { getNextDropdownIndex } from "./dropdownKeyboard";

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
