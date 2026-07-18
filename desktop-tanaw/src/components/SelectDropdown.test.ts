import { describe, expect, it } from "vitest";
import { getNextDropdownIndex } from "./dropdownKeyboard";

describe("SelectDropdown keyboard navigation", () => {
  it("supports arrows, Home, and End within bounds", () => {
    expect(getNextDropdownIndex(0, 3, "ArrowDown")).toBe(1);
    expect(getNextDropdownIndex(2, 3, "ArrowDown")).toBe(2);
    expect(getNextDropdownIndex(1, 3, "ArrowUp")).toBe(0);
    expect(getNextDropdownIndex(2, 3, "Home")).toBe(0);
    expect(getNextDropdownIndex(0, 3, "End")).toBe(2);
    expect(getNextDropdownIndex(0, 0, "End")).toBe(0);
  });
});
