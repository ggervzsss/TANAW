import { describe, expect, it } from "vitest";
import { normalizeAccountPreferences } from "../../../../../src/features/preferences/account-preferences-service";
import {
  defaultDisplayPreferences,
  sameDisplayPreferences,
  textSizeOptions,
  textSizeRootValue,
  toDisplayPreferences,
} from "../../../../../src/features/preferences/system-display-preferences";

describe("display preference root sizing", () => {
  it("keeps text size presets ordered", () => {
    expect(["small", "default", "large", "extra-large"].map((value) => Number.parseInt(textSizeRootValue(value as never), 10))).toEqual([14, 16, 18, 20]);
  });

  it("offers every text size, smallest first", () => {
    expect(textSizeOptions.map((option) => option.value)).toEqual(["small", "default", "large", "extra-large"]);
  });
});

describe("display preferences", () => {
  it("hold only the text size", () => {
    expect(defaultDisplayPreferences).toEqual({ textSize: "default" });
    expect(toDisplayPreferences({ textSize: "large", theme: "dark", interfaceScale: "compact" } as never)).toEqual({ textSize: "large" });
  });

  it("compare by text size", () => {
    expect(sameDisplayPreferences({ textSize: "large" }, { textSize: "large" })).toBe(true);
    expect(sameDisplayPreferences({ textSize: "large" }, { textSize: "small" })).toBe(false);
  });

  it("normalize the stored account preferences without an interface scale", () => {
    expect(normalizeAccountPreferences({})).toEqual({ theme: "system", textSize: "default" });
    expect(normalizeAccountPreferences({ theme: "dark", textSize: "extra-large", interfaceScale: "comfortable" } as never)).toEqual({ theme: "dark", textSize: "extra-large" });
  });
});
