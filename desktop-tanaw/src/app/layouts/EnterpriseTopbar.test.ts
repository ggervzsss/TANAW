import { describe, expect, it } from "vitest";
import { getEnterpriseTopbarControlClasses } from "./enterpriseTopbarTheme";

describe("enterprise topbar theme treatment", () => {
  it("uses darker translucent controls only in dark mode", () => {
    const light = getEnterpriseTopbarControlClasses("light");
    const dark = getEnterpriseTopbarControlClasses("dark");
    expect(light.icon).toContain("bg-white/8");
    expect(dark.icon).toContain("bg-black/18");
    expect(dark.account).not.toBe(light.account);
  });
});
