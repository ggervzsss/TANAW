import { describe, expect, it } from "vitest";
import type { FinalReport, IntakeReport, SystemLog } from "@/shared/types";
import { buildMonthEntry, indexReports } from "../../../../../src/features/admin-reports/model/enterpriseReports";
import { buildReportLog, formatLogTime } from "../../../../../src/features/admin-reports/model/reportLog";

const today = new Date(2026, 10, 24, 9, 0);
const october = { year: 2026, monthIndex: 9 };

const intake: IntakeReport = {
  id: "r-oct",
  enterpriseId: "market",
  enterprise: "San Pedro Public Market",
  category: "Public Market",
  attraction: { code: "411", typeCode: "4", type: "Sports and Recreational Facilities", category: "Parks", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD409" },
  barangay: "Poblacion",
  month: "October",
  period: "October 2026",
  submitted: "",
  submittedAt: "2026-11-01T08:30:00",
  status: "Consolidated",
  code: "RPT-2026-10-001",
  version: 1,
  metrics: { entry: null, exit: null, unique: 10, peak: null },
};

function log(action: string, actor: string, timestamp: string, metadata?: SystemLog["metadata"]): SystemLog {
  return { id: `${action}-${timestamp}`, timestamp, group: "Reports", severity: "Success", actor, actorRole: "LGU Staff", action, target: "", summary: "", sourceId: "r-oct", metadata };
}

const entryFor = (reports: IntakeReport[]) => buildMonthEntry("market", october, indexReports(reports), new Map(), today);

describe("formatLogTime", () => {
  it("writes a short date with a 12-hour time", () => {
    expect(formatLogTime(new Date(2026, 10, 6, 9, 14))).toBe("Nov 6, 9:14 AM");
    expect(formatLogTime(new Date(2026, 10, 6, 0, 5))).toBe("Nov 6, 12:05 AM");
    expect(formatLogTime(new Date(2026, 10, 6, 15, 0))).toBe("Nov 6, 3:00 PM");
  });
});

describe("buildReportLog", () => {
  it("uses the report's own sent time when the activity log has no submission", () => {
    const events = buildReportLog(entryFor([intake]), "San Pedro Public Market", [], []);
    expect(events).toEqual([{ id: "r-oct-sent", title: "Report submitted", when: "Nov 1, 8:30 AM", detail: "San Pedro Public Market sent RPT-2026-10-001.", tone: "submitted" }]);
  });

  it("orders logged submissions, review decisions and the city summary newest first", () => {
    const finalReport = { id: "FR-2026-10", generatedOn: "2026-11-21", preparedBy: "Jose Cruz", sources: [{ id: "r-oct" }] } as unknown as FinalReport;
    const events = buildReportLog(
      entryFor([intake]),
      "San Pedro Public Market",
      [
        log("Submit Enterprise Report", "San Pedro Public Market", "2026-11-01T08:30:00"),
        log("Report Ready to Consolidate", "Maria Santos", "2026-11-12T14:20:00", { remarks: "Totals checked." }),
        { ...log("Report Consolidated", "Other", "2026-11-04T10:00:00"), sourceId: "another-report" },
      ],
      [finalReport],
    );
    expect(events.map((event) => [event.title, event.when])).toEqual([
      ["Added to city summary", "Nov 21"],
      ["Review completed", "Nov 12, 2:20 PM"],
      ["Report submitted", "Nov 1, 8:30 AM"],
    ]);
    expect(events[0]).toMatchObject({ detail: "Included in FR-2026-10, prepared by Jose Cruz.", tone: "submitted" });
    expect(events[1].detail).toBe("Maria Santos marked it ready for the city summary. Totals checked.");
    expect(events[2].detail).toBe("San Pedro Public Market sent RPT-2026-10-001.");
    expect(events.slice(1).every((event) => event.tone === "earlier")).toBe(true);
  });

  it("follows a returned report through its corrected version, newest first", () => {
    const first: IntakeReport = { ...intake, id: "r-oct", status: "Returned", returnedBy: "Maria Santos", returnedReason: "Recount Oct 31.", returnedAt: "2026-11-03T10:00:00" };
    const corrected: IntakeReport = { ...intake, id: "r-oct-v2", status: "Pending Review", code: "RPT-2026-10-001-v2", version: 2, previousVersionId: "r-oct", submittedAt: "2026-11-05T09:00:00" };
    const events = buildReportLog(
      entryFor([first, corrected]),
      "San Pedro Public Market",
      [
        log("Submit Enterprise Report", "San Pedro Public Market", "2026-11-01T08:30:00"),
        { ...log("Return Enterprise Report", "Ana Reyes", "2026-11-03T10:00:00", { reason: "Recount Oct 31 and Nov 1." }), sourceId: "r-oct" },
      ],
      [],
    );
    expect(events.map((event) => [event.title, event.when, event.detail])).toEqual([
      ["Corrected report submitted", "Nov 5, 9:00 AM", "San Pedro Public Market sent RPT-2026-10-001-v2 (version 2)."],
      ["Returned for correction", "Nov 3, 10:00 AM", "Ana Reyes returned RPT-2026-10-001: Recount Oct 31 and Nov 1."],
      ["Report submitted", "Nov 1, 8:30 AM", "San Pedro Public Market sent RPT-2026-10-001."],
    ]);
    expect(events.map((event) => event.tone)).toEqual(["submitted", "earlier", "earlier"]);
  });

  it("leads with the return, from the report itself, while the correction has not arrived", () => {
    const returned: IntakeReport = { ...intake, status: "Returned", returnedBy: "Maria Santos", returnedReason: "Recount Oct 31.", returnedAt: "2026-11-03T10:00:00" };
    const [latest] = buildReportLog(entryFor([returned]), "San Pedro Public Market", [], []);
    expect(latest).toEqual({ id: "r-oct-returned", title: "Returned for correction", when: "Nov 3, 10:00 AM", detail: "Maria Santos returned RPT-2026-10-001: Recount Oct 31.", tone: "pending" });
  });

  it("shows the passed due date for a missing month", () => {
    const [event] = buildReportLog(entryFor([]), "San Pedro Public Market", [], []);
    expect(event).toMatchObject({ title: "Due date passed", when: "Nov 10", detail: "No report was received by Nov 10, 2026.", tone: "missing" });
  });

  it("shows the coming due date for a pending month", () => {
    const entry = buildMonthEntry("market", { year: 2026, monthIndex: 10 }, indexReports([]), new Map(), today);
    const [event] = buildReportLog(entry, "San Pedro Public Market", [], []);
    expect(event).toMatchObject({ title: "Not sent yet", when: "Due Dec 10", detail: "The report is due Dec 10, 2026.", tone: "pending" });
  });
});
