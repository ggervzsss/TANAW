import { describe, expect, it } from "vitest";
import { clampFloatingToolbarPosition, hasExceededDragThreshold } from "./floating-toolbar";

describe("floating tripwire toolbar", () => {
  it("clamps the toolbar inside every container edge", () => {
    expect(clampFloatingToolbarPosition({ x: -20, y: 500 }, { width: 640, height: 360 }, { width: 120, height: 40 })).toEqual({ x: 8, y: 312 });
  });

  it("uses a movement threshold so a click still expands the toolbar", () => {
    expect(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 13, y: 13 }, 5)).toBe(false);
    expect(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 16, y: 10 }, 5)).toBe(true);
  });
});
