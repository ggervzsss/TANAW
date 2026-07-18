import { describe, expect, it } from "vitest";
import { chooseAuthenticatedThemePreference, isThemePreference, resolveThemePreference } from "./theme";

describe("theme preference continuity", () => {
  it("keeps an explicit public-page choice when an account preference differs", () => {
    expect(chooseAuthenticatedThemePreference("dark", "light")).toBe("dark");
    expect(chooseAuthenticatedThemePreference("light", "dark")).toBe("light");
  });

  it("uses the account preference only when no local choice exists", () => {
    expect(chooseAuthenticatedThemePreference(null, "dark")).toBe("dark");
    expect(chooseAuthenticatedThemePreference(null, "system")).toBe("system");
  });

  it("accepts only supported persisted values and resolves explicit modes", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
    expect(resolveThemePreference("light")).toBe("light");
    expect(resolveThemePreference("dark")).toBe("dark");
  });
});
