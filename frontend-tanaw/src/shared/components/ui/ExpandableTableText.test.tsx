import { describe, expect, it } from "vitest";
import { hasVisualOverflow } from "./overflowMeasurement";

describe("hasVisualOverflow", () => {
  it("reports horizontal overflow only when rendered content exceeds its box", () => {
    expect(hasVisualOverflow({ clientHeight: 20, clientWidth: 120, scrollHeight: 20, scrollWidth: 121 })).toBe(false);
    expect(hasVisualOverflow({ clientHeight: 20, clientWidth: 120, scrollHeight: 20, scrollWidth: 180 })).toBe(true);
  });

  it("reports clipped multiline content using measured height", () => {
    const metrics = { clientHeight: 40, clientWidth: 180, scrollHeight: 76, scrollWidth: 180 };
    expect(hasVisualOverflow(metrics)).toBe(false);
    expect(hasVisualOverflow(metrics, true)).toBe(true);
  });
});
