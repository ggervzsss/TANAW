import { describe, expect, it } from "vitest";
import { portalPageShape } from "@/app/layouts/portal/portalPageShape";

describe("portal page skeleton shapes", () => {
  it("sketches each page in its own layout", () => {
    expect(portalPageShape("/admin/dashboard").variant).toBe("dashboard");
    expect(portalPageShape("/it/dashboard").variant).toBe("overview");
    expect(portalPageShape("/admin/requests").variant).toBe("split");
    expect(portalPageShape("/it/requests").variant).toBe("split");
    expect(portalPageShape("/it/notifications").variant).toBe("list");
    expect(portalPageShape("/staff/notifications").variant).toBe("list");
  });

  it("keeps a table page's figures, filters and page size", () => {
    expect(portalPageShape("/admin/enterprises")).toMatchObject({ variant: "page", figures: 3, filters: 5, rows: 10 });
    expect(portalPageShape("/staff/consolidated-reports")).toMatchObject({ variant: "page", tabs: 2 });
  });

  it("tells a record page from its list", () => {
    expect(portalPageShape("/admin/enterprises/ENT-001")).toMatchObject({ variant: "detail", back: true });
    expect(portalPageShape("/it/enterprises/ENT-001")).toMatchObject({ variant: "page", back: true, tabs: 3 });
  });

  it("uses the settings frame and the Help Center for every role and section", () => {
    expect(portalPageShape("/admin/settings").variant).toBe("settings");
    expect(portalPageShape("/staff/settings/appearance").variant).toBe("settings");
    expect(portalPageShape("/it/help").variant).toBe("help");
    expect(portalPageShape("/admin/help/admin-operations-center").variant).toBe("help");
  });

  it("falls back to a plain table page for an unknown address", () => {
    expect(portalPageShape("/admin/somewhere-new")).toEqual({ variant: "page" });
  });
});
