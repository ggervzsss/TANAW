// The UI kit's clickable-row rules (which clicks a row leaves to the control under the pointer, and
// when a text selection keeps the row closed) and the month picker's month arithmetic.
import { describe, expect, it } from "vitest";
import { isMonthInRange, pickerMonthLabel } from "../../../../src/shared/ui-kit/lib/pickerMonth";
import { endsTextSelection, nestedRowControl } from "../../../../src/shared/ui-kit/lib/rowClick";

/** A tiny stand-in for DOM elements: `closest` walks up through parents matching tag names. */
class FakeElement {
  readonly tag: string;
  readonly parent: FakeElement | null;

  constructor(tag: string, parent: FakeElement | null = null) {
    this.tag = tag;
    this.parent = parent;
  }

  closest(selector: string): FakeElement | null {
    const tags = selector.split(",").map((part) => part.trim().split(/[[:]/)[0]);
    if (tags.includes(this.tag)) return this;
    return this.parent ? this.parent.closest(selector) : null;
  }

  contains(other: unknown): boolean {
    for (let node = other as FakeElement | null; node; node = node.parent) if (node === this) return true;
    return false;
  }
}

describe("clickable rows", () => {
  const withElement = <T>(run: () => T) => {
    const previous = (globalThis as { Element?: unknown }).Element;
    (globalThis as { Element?: unknown }).Element = FakeElement;
    try {
      return run();
    } finally {
      (globalThis as { Element?: unknown }).Element = previous;
    }
  };

  it("leaves clicks on buttons and links inside the row to those controls", () =>
    withElement(() => {
      const row = new FakeElement("tr");
      const cell = new FakeElement("td", row);
      const button = new FakeElement("button", cell);
      const icon = new FakeElement("svg", button);
      expect(nestedRowControl({ target: icon as unknown as Element, currentTarget: row as unknown as Element })).toBe(button);
    }));

  it("opens the row for clicks on plain text and cells", () =>
    withElement(() => {
      const row = new FakeElement("tr");
      const cell = new FakeElement("td", row);
      const text = new FakeElement("span", cell);
      expect(nestedRowControl({ target: text as unknown as Element, currentTarget: row as unknown as Element })).toBeNull();
      expect(nestedRowControl({ target: null, currentTarget: row as unknown as Element })).toBeNull();
    }));

  it("does not treat a row that is itself a link as a nested control", () =>
    withElement(() => {
      const row = new FakeElement("a");
      const text = new FakeElement("span", row);
      expect(nestedRowControl({ target: text as unknown as Element, currentTarget: row as unknown as Element })).toBeNull();
    }));

  it("keeps the row closed when a click ends a text selection inside it", () => {
    const row = new FakeElement("tr");
    const text = new FakeElement("span", row);
    const selection = (value: string, anchor: FakeElement | null) => ({ isCollapsed: value === "", anchorNode: anchor as unknown as Node, toString: () => value });
    expect(endsTextSelection(row as unknown as Element, selection("Lolouweng", text))).toBe(true);
    expect(endsTextSelection(row as unknown as Element, selection("", text))).toBe(false);
    expect(endsTextSelection(row as unknown as Element, selection("   ", text))).toBe(false);
    expect(endsTextSelection(row as unknown as Element, selection("Elsewhere", new FakeElement("p")))).toBe(false);
    expect(endsTextSelection(row as unknown as Element, null)).toBe(false);
  });
});

describe("month picker months", () => {
  const october = { year: 2026, monthIndex: 9 };

  it("names a month in full", () => {
    expect(pickerMonthLabel(october)).toBe("October 2026");
    expect(pickerMonthLabel({ year: 2025, monthIndex: 0 })).toBe("January 2025");
  });

  it("checks a month against optional first and last months", () => {
    expect(isMonthInRange(october)).toBe(true);
    expect(isMonthInRange(october, { year: 2026, monthIndex: 9 }, { year: 2026, monthIndex: 9 })).toBe(true);
    expect(isMonthInRange(october, { year: 2026, monthIndex: 10 })).toBe(false);
    expect(isMonthInRange(october, null, { year: 2025, monthIndex: 11 })).toBe(false);
  });
});
