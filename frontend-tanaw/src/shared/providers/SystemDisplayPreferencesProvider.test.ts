import { describe, expect, it } from "vitest";
import { textSizeRootValue } from "./systemDisplayPreferences";

describe("display preference root sizing", () => {
  it("keeps the presets ordered and leaves browser zoom available", () => {
    expect(["small", "default", "large", "extra-large"].map((value) => Number.parseInt(textSizeRootValue(value as never), 10))).toEqual([14, 16, 18, 20]);
  });
});
