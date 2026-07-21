import { describe, expect, it } from "vitest";
import type { BackendNotification } from "@/shared/services/operationalSync";
import { getBackendNotificationTargetPath } from "./usePortalNotifications";

function notification(overrides: Partial<BackendNotification>): BackendNotification {
  return {
    id: "notification-1",
    recipientAccountId: "admin-1",
    title: "Important update",
    message: "Review this item.",
    type: "Operations",
    severity: "Warning",
    sourceType: null,
    sourceId: null,
    createdBy: null,
    recipientRole: "admin",
    recipientEnterpriseId: null,
    createdAt: "2026-07-21T08:00:00Z",
    readAt: null,
    ...overrides,
  };
}

describe("Admin notification destinations", () => {
  it("opens the exact situation in the Operations Center", () => {
    const target = getBackendNotificationTargetPath(
      "admin",
      notification({ sourceType: "operational.alert", sourceId: "ALT-000001" }),
    );

    expect(target).toBe("/admin/operations?view=situations&alert=ALT-000001");
  });

  it("opens escalated support and account requests in their Operations Center views", () => {
    expect(
      getBackendNotificationTargetPath(
        "admin",
        notification({ sourceType: "support.ticket", sourceId: "ticket-1" }),
      ),
    ).toBe("/admin/operations?view=support&ticket=ticket-1");
    expect(
      getBackendNotificationTargetPath(
        "admin",
        notification({ sourceType: "enterprise.profile.contact", sourceId: "account-1" }),
      ),
    ).toBe("/admin/operations?view=accounts");
  });
});

describe("IT notification destinations", () => {
  it("opens the exact technical issue and support request in the Work Center", () => {
    expect(
      getBackendNotificationTargetPath(
        "it",
        notification({ sourceType: "operational.alert", sourceId: "ALT-000002", recipientRole: "it" }),
      ),
    ).toBe("/it/work-center?view=issues&alert=ALT-000002");
    expect(
      getBackendNotificationTargetPath(
        "it",
        notification({ sourceType: "support.ticket", sourceId: "ticket-2", recipientRole: "it" }),
      ),
    ).toBe("/it/work-center?view=support&ticket=ticket-2");
  });

  it("opens account requests and email problems in their Work Center views", () => {
    expect(
      getBackendNotificationTargetPath(
        "it",
        notification({ sourceType: "enterprise.profile.contact", sourceId: "enterprise-1", recipientRole: "it" }),
      ),
    ).toBe("/it/work-center?view=accounts&account=enterprise-1");
    expect(
      getBackendNotificationTargetPath(
        "it",
        notification({ sourceType: "email.delivery", sourceId: "email-1", recipientRole: "it" }),
      ),
    ).toBe("/it/work-center?view=email");
  });
});
