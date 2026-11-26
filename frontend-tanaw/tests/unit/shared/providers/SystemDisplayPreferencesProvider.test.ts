import { describe, expect, it } from "vitest";
import {
  defaultDisplayPreferences,
  isDefaultDisplayPreferences,
  normalizeDisplayPreferences,
  sameDisplayPreferences,
  textSizePreferences,
  textSizeRootValue,
} from "../../../../src/shared/providers/systemDisplayPreferences";

describe("display preference root sizing", () => {
  it("keeps the presets ordered and leaves browser zoom available", () => {
    expect(textSizePreferences.map((value) => Number.parseInt(textSizeRootValue(value), 10))).toEqual([14, 16, 18, 20]);
  });
});

describe("display preference normalization", () => {
  it("keeps only the text size, so a retired interface scale is never applied or saved", () => {
    expect(normalizeDisplayPreferences({ textSize: "large", interfaceScale: "comfortable" } as { textSize: string })).toEqual({ textSize: "large" });
  });

  it("falls back to the default text size for a missing or unknown value", () => {
    expect(normalizeDisplayPreferences({})).toEqual(defaultDisplayPreferences);
    expect(normalizeDisplayPreferences({ textSize: null })).toEqual(defaultDisplayPreferences);
    expect(normalizeDisplayPreferences({ textSize: "huge" })).toEqual(defaultDisplayPreferences);
  });

  it("compares and recognises the default by text size", () => {
    expect(sameDisplayPreferences({ textSize: "large" }, { textSize: "large" })).toBe(true);
    expect(sameDisplayPreferences({ textSize: "large" }, { textSize: "small" })).toBe(false);
    expect(isDefaultDisplayPreferences({ textSize: "default" })).toBe(true);
    expect(isDefaultDisplayPreferences({ textSize: "extra-large" })).toBe(false);
  });
});
