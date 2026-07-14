import { describe, expect, it } from "vitest";
import { complianceFixture, enterpriseReportFixture } from "../testFixtures";
import { acceptedRevisionIds, buildComplianceRows, deriveBatchReportView, deriveFinalizationScope } from "./reportWorkflow";

describe("report workflow derivation", () => {
  it("derives missing rows only from frozen obligations", () => {
    const rows = buildComplianceRows(complianceFixture(), [enterpriseReportFixture()]);

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.report)?.report?.enterpriseReportId).toBe(enterpriseReportFixture().enterpriseReportId);
    const missing = rows.find((row) => row.obligation.complianceStatus === "not_submitted");
    expect(missing?.report).toBeNull();
    expect(missing?.enterpriseLabel).toBe("Missing Enterprise (ENT-002)");
    expect(missing?.siteLabel).toBe("Missing Site (SITE-002)");
  });

  it("uses exact frozen barangay labels for scope membership", () => {
    const report = enterpriseReportFixture();
    const rows = buildComplianceRows(complianceFixture(), [report]);

    expect(deriveFinalizationScope(rows, { type: "barangay", barangay: "Poblacion" }, new Set()).reports).toEqual([report]);
    expect(deriveFinalizationScope(rows, { type: "barangay", barangay: "poblacion" }, new Set()).reports).toEqual([]);
    expect(deriveFinalizationScope(rows, { type: "enterprise_selection", barangay: null }, new Set([report.enterpriseReportId]))).toEqual({ complete: true, reports: [report] });
    expect(deriveFinalizationScope(rows, { type: "enterprise_selection", barangay: null }, new Set())).toEqual({ complete: false, reports: [] });
  });

  it("derives citywide membership from all frozen obligations, independent of search rows", () => {
    const first = enterpriseReportFixture();
    const second = enterpriseReportFixture({
      enterpriseReportId: "00000000-0000-0000-0000-000000000202",
      currentRevisionId: "00000000-0000-0000-0000-000000000302",
      acceptedRevisionId: "00000000-0000-0000-0000-000000000302",
      obligation: {
        ...enterpriseReportFixture().obligation,
        reportingObligationId: "00000000-0000-0000-0000-000000000402",
      },
      enterprise: {
        enterpriseId: "00000000-0000-0000-0000-000000000502",
        enterpriseCode: "ENT-002",
        enterpriseName: "Second Enterprise",
        category: "Accommodation",
      },
      site: {
        siteId: "00000000-0000-0000-0000-000000000602",
        siteCode: "SITE-002",
        siteName: "Second Site",
        frozenBarangay: "San Jose",
      },
      currentRevision: {
        ...enterpriseReportFixture().currentRevision,
        reportRevisionId: "00000000-0000-0000-0000-000000000302",
      },
    });
    const compliance = complianceFixture({
      summary: {
        totalFrozen: 2,
        eligibleExpected: 2,
        exempt: 0,
        ineligible: 0,
        unresolved: 0,
        notSubmitted: 0,
        submitted: 0,
        returned: 0,
        accepted: 2,
        consolidated: 0,
        complete: true,
      },
      obligations: complianceFixture().obligations.map((obligation, index) => ({
        ...obligation,
        complianceStatus: "accepted",
        enterpriseReportId: index === 0 ? first.enterpriseReportId : second.enterpriseReportId,
        logicalVersion: 2,
      })),
    });
    const allRows = buildComplianceRows(compliance, [first, second]);
    const view = deriveBatchReportView(allRows, "Frozen", { type: "citywide", barangay: null }, new Set());

    expect(view.visibleRows).toHaveLength(1);
    expect(view.complete).toBe(true);
    expect(view.reports).toEqual([first, second]);
  });

  it("blocks target scopes with unknown, blocked, or incomplete eligible obligations", () => {
    const report = enterpriseReportFixture();
    const scope = { type: "citywide" as const, barangay: null };
    const unknownRows = buildComplianceRows(
      complianceFixture({
        obligations: complianceFixture().obligations.map((obligation, index) => (index === 1 ? { ...obligation, eligibilityStatus: "unknown" } : obligation)),
      }),
      [report],
    );
    const blockedRows = buildComplianceRows(
      complianceFixture({
        obligations: complianceFixture().obligations.map((obligation, index) => (index === 0 ? { ...obligation, acceptanceBlocked: true } : obligation)),
      }),
      [report],
    );

    expect(deriveFinalizationScope(unknownRows, scope, new Set()).complete).toBe(false);
    expect(deriveFinalizationScope(blockedRows, scope, new Set()).complete).toBe(false);
    expect(deriveFinalizationScope(buildComplianceRows(complianceFixture(), [report]), scope, new Set()).complete).toBe(false);
  });

  it("sorts exact accepted revision IDs in canonical UUID order", () => {
    const first = enterpriseReportFixture({ acceptedRevisionId: "bbbbbbbb-0000-0000-0000-000000000000" });
    const second = enterpriseReportFixture({ enterpriseReportId: "report-2", acceptedRevisionId: "aaaaaaaa-0000-0000-0000-000000000000" });

    expect(acceptedRevisionIds([first, second])).toEqual(["aaaaaaaa-0000-0000-0000-000000000000", "bbbbbbbb-0000-0000-0000-000000000000"]);
  });
});
