import { describe, expect, it } from "vitest";
import type { IntakeReport, ReportEnterprise } from "@/shared/types";
import { getBatchReportQueues, searchBatchReportRows } from "../../../../../src/features/reports/model/batchReportQueues";
import { getEnterpriseReportRows, reportMatchesPeriod } from "../../../../../src/features/reports/utils/reportPeriods";

const enterprises: ReportEnterprise[] = ["missing", "pending", "returned", "ready", "completed"].map((id) => ({
  id,
  name: `${id} establishment`,
  category: "Attraction",
  barangay: "Poblacion",
  complianceOwner: "Operator",
}));

function report(enterpriseId: string, status: IntakeReport["status"], month = "October"): IntakeReport {
  return {
    id: `${enterpriseId}-${month}`,
    enterpriseId,
    enterprise: `${enterpriseId} establishment`,
    category: "Parks",
    attraction: { code: "411", typeCode: "4", type: "Sports and Recreational Facilities", category: "Parks", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD409" },
    barangay: "Poblacion",
    month,
    period: `${month} 2026`,
    submitted: "2026-10-31",
    status,
    code: `REP-${enterpriseId.toUpperCase()}`,
    metrics: { entry: null, exit: null, unique: 12, peak: "12" },
  };
}

describe("Batch Report queues", () => {
  it("places each establishment in the queue for its current submission", () => {
    const reports = [
      report("missing", "Ready to Consolidate", "September"),
      report("pending", "Pending Review"),
      report("returned", "Returned"),
      report("ready", "Ready to Consolidate"),
      report("completed", "Consolidated"),
    ];
    const current = reports.filter((item) => reportMatchesPeriod(item, "October", "2026"));
    const queues = getBatchReportQueues(getEnterpriseReportRows(enterprises, current));

    expect(queues.pending.map((row) => row.enterprise.id)).toEqual(["pending"]);
    expect(queues.followUp.map((row) => row.status)).toEqual(["Missing", "Returned"]);
    expect(queues.ready.map((row) => row.currentReport?.id)).toEqual(["ready-October"]);
    expect(queues.completed.map((row) => row.currentReport?.id)).toEqual(["completed-October"]);
    expect(searchBatchReportRows(queues.followUp, " rep-returned ").map((row) => row.enterprise.id)).toEqual(["returned"]);
    expect(queues.followUp).toHaveLength(2);
  });
});
