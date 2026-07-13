import { describe, expect, it } from "vitest";
import { complianceFixture, enterpriseReportFixture } from "../testFixtures";
import { acceptedRevisionIds, buildComplianceRows, reportMatchesScope } from "./reportWorkflow";

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

    expect(reportMatchesScope(report, { type: "barangay", barangay: "Poblacion" }, new Set())).toBe(true);
    expect(reportMatchesScope(report, { type: "barangay", barangay: "poblacion" }, new Set())).toBe(false);
    expect(reportMatchesScope(report, { type: "enterprise_selection", barangay: null }, new Set([report.enterpriseReportId]))).toBe(true);
    expect(reportMatchesScope(report, { type: "enterprise_selection", barangay: null }, new Set())).toBe(false);
  });

  it("sorts exact accepted revision IDs in canonical UUID order", () => {
    const first = enterpriseReportFixture({ acceptedRevisionId: "bbbbbbbb-0000-0000-0000-000000000000" });
    const second = enterpriseReportFixture({ enterpriseReportId: "report-2", acceptedRevisionId: "aaaaaaaa-0000-0000-0000-000000000000" });

    expect(acceptedRevisionIds([first, second])).toEqual(["aaaaaaaa-0000-0000-0000-000000000000", "bbbbbbbb-0000-0000-0000-000000000000"]);
  });
});
