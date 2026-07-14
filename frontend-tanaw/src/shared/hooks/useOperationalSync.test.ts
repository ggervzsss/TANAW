import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../types";
import { enterpriseReportDetailQueryKey, enterpriseReportListQueryKey, finalReportDetailQueryKey, finalReportListQueryKey, reportComplianceQueryKey } from "../services/reporting";
import { createOperationalQueryKeys, handleOperationalEnvelope, operationalMapEnterprisesQueryKey } from "./useOperationalSync";
import { reportingAccountScope } from "./useReportWorkflow";

vi.mock("@/app/store/authStore", () => ({ useAuthStore: vi.fn() }));
vi.mock("react-hot-toast/headless", () => ({ default: { error: vi.fn() } }));

const user = createUser("account-1", "staff");

describe("operational realtime reconciliation", () => {
  it("scopes protected operational keys by account and authorization context", () => {
    const first = createOperationalQueryKeys(user);
    const otherAccount = createOperationalQueryKeys(createUser("account-2", "staff"));
    const otherRole = createOperationalQueryKeys(createUser("account-1", "admin"));

    expect(first.mapEnterprises).not.toEqual(otherAccount.mapEnterprises);
    expect(first.mapEnterprises).not.toEqual(otherRole.mapEnterprises);
    expect(JSON.stringify(first)).not.toContain("secret-token");
    expect(first.mapEnterprises.slice(0, operationalMapEnterprisesQueryKey.length)).toEqual(operationalMapEnterprisesQueryKey);
    expect(reportingAccountScope(user)).not.toEqual(reportingAccountScope(createUser("account-2", "staff")));
    expect(reportingAccountScope(user)).not.toEqual(reportingAccountScope(createUser("account-1", "admin")));
  });

  it("refetches the target site registry for a version-only live-state event", () => {
    const client = createClient();
    const keys = createOperationalQueryKeys(user);
    client.setQueryData(keys.mapEnterprises, []);

    handleOperationalEnvelope(client, keys, invalidationEnvelope("site_live_state"));

    expect(client.getQueryState(keys.mapEnterprises)?.isInvalidated).toBe(true);
    expect(client.getQueryData(keys.mapEnterprises)).toEqual([]);
  });

  it.each(["enterprise_report", "final_report", "reporting_period_compliance", "reporting_obligation"] as const)(
    "invalidates every v2 reporting list/detail/compliance/final query for %s without manufacturing data",
    (resourceType) => {
      const client = createClient();
      const keys = createOperationalQueryKeys(user);
      const reportingKeys = [
        [...enterpriseReportListQueryKey, { accountId: user.id }],
        [...enterpriseReportDetailQueryKey, { accountId: user.id }, "report-1"],
        [...reportComplianceQueryKey, { accountId: user.id }, "period-1"],
        [...finalReportListQueryKey, { accountId: user.id }],
        [...finalReportDetailQueryKey, { accountId: user.id }, "final-1", "current"],
      ];
      for (const queryKey of reportingKeys) client.setQueryData(queryKey, { preserved: queryKey.join(":") });

      handleOperationalEnvelope(client, keys, invalidationEnvelope(resourceType));

      for (const queryKey of reportingKeys) {
        expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
        expect(client.getQueryData(queryKey)).toEqual({ preserved: queryKey.join(":") });
      }
    },
  );

  it("invalidates alerts when durable sync health changes", () => {
    const client = createClient();
    const keys = createOperationalQueryKeys(user);
    client.setQueryData(keys.alerts, []);

    handleOperationalEnvelope(client, keys, invalidationEnvelope("operational_alert"));

    expect(client.getQueryState(keys.alerts)?.isInvalidated).toBe(true);
  });

  it("ignores simulation invalidations in the official portal cache", () => {
    const client = createClient();
    const keys = createOperationalQueryKeys(user);
    const queryKey = [...enterpriseReportListQueryKey, { accountId: user.id }];
    client.setQueryData(queryKey, []);

    handleOperationalEnvelope(client, keys, invalidationEnvelope("enterprise_report", "simulation"));

    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
  });

});

function invalidationEnvelope(resourceType: "site_live_state" | "operational_alert" | "enterprise_report" | "final_report" | "reporting_period_compliance" | "reporting_obligation", classification: "official" | "simulation" = "official") {
  return JSON.stringify({
    type: "resource.invalidated",
    data: {
      contractVersion: 2,
      eventId: "event-1",
      eventKey: "resource:1",
      eventType: "resource.changed.v2",
      resource: { type: resourceType, id: "resource-1", version: 4 },
      scope: { classification, enterpriseId: "enterprise-1", siteId: "site-1" },
      invalidates: ["/operational/reports/v2"],
      audienceRoles: ["staff"],
      occurredAt: "2026-07-13T08:00:00Z",
      refetchRequired: true,
    },
  });
}

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function createUser(id: string, role: AuthUser["role"]): AuthUser {
  return { id, email: `${id}@example.test`, displayName: id, role, title: "Operator", phone: null, firstName: null, lastName: null, enterpriseId: role === "enterprise" ? "enterprise-1" : null, enterpriseName: null, category: null, managerName: null, barangay: null, address: null, buildingCapacity: 0, displayImageUrl: null };
}
