import { describe, expect, it } from "vitest";
import { getRoleSettingsBackPath } from "@/app/routers/roleRoutes";

describe("General Settings return paths", () => {
  it("keeps the previous portal destination, including its query and anchor", () => {
    const from = "/admin/help/admin-operations-center?tab=reference#actions";
    expect(getRoleSettingsBackPath("admin", from)).toBe(from);
  });

  it("uses the portal landing page for missing, cross-portal, or settings destinations", () => {
    expect(getRoleSettingsBackPath("admin", undefined)).toBe("/admin/mapview");
    expect(getRoleSettingsBackPath("it", "/admin/mapview")).toBe("/it/dashboard");
    expect(getRoleSettingsBackPath("it", "/it/settings/profile")).toBe("/it/dashboard");
    expect(getRoleSettingsBackPath("staff", "/staff/missing")).toBe("/staff/analytics");
  });
});
