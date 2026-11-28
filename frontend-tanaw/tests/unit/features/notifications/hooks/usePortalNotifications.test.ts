import { describe, expect, it } from "vitest";
import type { BackendNotification } from "@/shared/services/operationalSync";
import { getBackendNotificationTargetPath } from "../../../../../src/features/notifications/hooks/usePortalNotifications";

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
  it("opens a request's notification on the Requests page", () => {
    expect(getBackendNotificationTargetPath("admin", notification({ sourceType: "request", sourceId: "request-1" }))).toBe("/admin/requests?request=request-1");
  });

  it("opens anything else on the Dashboard, since the Admin has no notification bell", () => {
    expect(getBackendNotificationTargetPath("admin", notification({ sourceType: "operational.alert", sourceId: "ALT-000003" }))).toBe("/admin/dashboard");
  });
});

describe("IT notification destinations", () => {
  it("opens the exact request on Requests", () => {
    expect(getBackendNotificationTargetPath("it", notification({ sourceType: "request", sourceId: "request-2", recipientRole: "it" }))).toBe("/it/requests?request=request-2");
  });

  it("opens account changes, email problems and offline places where IT handles them", () => {
    expect(getBackendNotificationTargetPath("it", notification({ sourceType: "enterprise.profile.contact", sourceId: "enterprise-1", recipientRole: "it" }))).toBe("/it/requests");
    expect(getBackendNotificationTargetPath("it", notification({ sourceType: "email.delivery", sourceId: "email-1", recipientRole: "it" }))).toBe("/it/system?tab=email");
    expect(getBackendNotificationTargetPath("it", notification({ sourceType: "enterprise.offline", sourceId: "e:2026-11-23", recipientRole: "it" }))).toBe("/it/enterprises");
  });
});
