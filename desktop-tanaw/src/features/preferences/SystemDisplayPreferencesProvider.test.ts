import { describe, expect, it } from "vitest";
import { textSizeRootValue } from "./system-display-preferences";

describe("display preference root sizing", () => {
  it("keeps text size presets ordered", () => {
    expect(["small", "default", "large", "extra-large"].map((value) => Number.parseInt(textSizeRootValue(value as never), 10))).toEqual([14, 16, 18, 20]);
  });
});
