import { describe, expect, it } from "vitest";
import { getEnterpriseSettingsBackPath } from "../../../../../src/app/router/routePaths";

describe("Enterprise General Settings return paths", () => {
  it("keeps the previous Enterprise view and its query", () => {
    const from = "/enterprise/help?article=camera-troubleshooting";
    expect(getEnterpriseSettingsBackPath(from)).toBe(from);
  });

  it.each([undefined, "/login", "/enterprise/settings/profile", "/enterprise/missing"])("uses the dashboard for %s", (from) => {
    expect(getEnterpriseSettingsBackPath(from)).toBe("/enterprise/dashboard");
  });
});
