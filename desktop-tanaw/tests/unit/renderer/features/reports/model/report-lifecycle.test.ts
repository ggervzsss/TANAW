import { describe, expect, it } from "vitest";
import {
  canReopenReport,
  correctionSource,
  correctionVersion,
  latestReportVersion,
  originSplit,
  reportsNeedingAction,
  rejectedUploadTicketDraft,
  reportLifecycle,
  returnedHeadline,
  reviewState,
  sentConfirmationText,
  submitDialogTitle,
} from "../../../../../../src/features/reports/model/report-lifecycle";
import { emptyDemo } from "../../../../../../src/features/reports/model/report-workspace";
import type { ReportRecord } from "../../../../../../src/types/enterprise";

const base: ReportRecord = { id: "REP-OCT-1", date: "October 2026", period: "October 2026", status: "Submitted", entries: 10, unique: 8, submittedAt: "2026-11-03T08:12:00Z", syncStatus: "synced" };
const report = (changes: Partial<ReportRecord>): ReportRecord => ({ ...base, ...changes });
const squash = (text: string) => text.replace(/\s/g, " ");

describe("latest version selection", () => {
  it("takes the month's highest version, and a live version over the one it replaced", () => {
    const first = report({ version: 1, reopenedAt: "2026-11-06T00:00:00Z", status: "Returned", reviewStatus: "Returned" });
    const second = report({ id: "REP-OCT-2", version: 2, submittedAt: "2026-11-07T00:00:00Z" });
    const november = report({ id: "REP-NOV", period: "November 2026", date: "November 2026", version: 5 });
    expect(latestReportVersion([second, first, november], "October 2026")?.id).toBe("REP-OCT-2");
    expect(latestReportVersion([first, november], "October 2026")?.id).toBe("REP-OCT-1");
    expect(latestReportVersion([november], "October 2026")).toBeNull();
    // A fix of a refused upload keeps the number; the live one wins.
    const refused = report({ syncStatus: "upload_rejected", reopenedAt: "2026-11-04T00:00:00Z" });
    const fixed = report({ id: "REP-OCT-FIX", submittedAt: "2026-11-02T00:00:00Z" });
    expect(latestReportVersion([refused, fixed], "October 2026")?.id).toBe("REP-OCT-FIX");
  });
});

describe("returned → editable", () => {
  const returned = report({ version: 1, status: "Returned", reviewStatus: "Returned", returnedReason: "Foreign visitors look too high.", returnedBy: "Ana Cruz", returnedAt: "2026-11-05T02:00:00Z" });

  it("shows the returned version until it is reopened, then opens the month as a correction", () => {
    expect(reportLifecycle(returned, [returned], "October 2026")).toEqual({ kind: "returned", report: returned });
    expect(canReopenReport(returned, [returned])).toBe(true);

    const reopened = { ...returned, reopenedAt: "2026-11-06T00:00:00Z" };
    expect(canReopenReport(reopened, [reopened])).toBe(false);
    expect(correctionSource([reopened], "October 2026")).toBe(reopened);
    expect(reportLifecycle(null, [reopened], "October 2026")).toEqual({ kind: "correcting", cause: "returned", previous: reopened, version: 2 });
    // Once the corrected version is sent, the month holds it again.
    const corrected = report({ id: "REP-OCT-2", version: 2, submittedAt: "2026-11-07T00:00:00Z" });
    expect(correctionSource([reopened, corrected], "October 2026")).toBeNull();
    expect(reportLifecycle(null, [reopened, corrected], "October 2026")).toEqual({ kind: "draft" });
  });

  it("says who returned it, when, and asks to send the corrected report", () => {
    expect(returnedHeadline(returned, "12-hour")).toBe("Returned for correction by Ana Cruz on Nov 5, 2026");
    expect(returnedHeadline({ ...returned, returnedBy: null, returnedAt: null }, "12-hour")).toBe("Returned for correction by LGU Staff");
    expect(submitDialogTitle("October 2026", true)).toBe("Send the corrected October 2026 report?");
    expect(submitDialogTitle("October 2026", false)).toBe("Send your October 2026 report to the LGU?");
  });
});

describe("upload_rejected → editable", () => {
  const refused = report({ syncStatus: "upload_rejected", rejectionReason: "A report for October 2026 has already been sent." });

  it("is a dead end only until the person chooses to fix it; the fix keeps the version", () => {
    expect(reportLifecycle(refused, [refused], "October 2026")).toEqual({ kind: "upload_rejected", report: refused });
    expect(reviewState(refused)).toEqual({ text: "Not accepted by TANAW", tone: "rejected" });
    const reopened = { ...refused, reopenedAt: "2026-11-04T00:00:00Z" };
    expect(correctionVersion(reopened)).toBe(1);
    expect(reportLifecycle(null, [reopened], "October 2026")).toEqual({ kind: "correcting", cause: "upload_rejected", previous: reopened, version: 1 });
  });

  it("prefills a request to IT with the month, reference and TANAW's message", () => {
    const draft = rejectedUploadTicketDraft(refused, "12-hour");
    expect(draft.category).toBe("Report problem");
    expect(draft.subject).toBe("TANAW did not accept the October 2026 report");
    expect(draft.description).toContain("Reference: REP-OCT-1");
    expect(draft.description).toContain("Reporting period: October 2026");
    expect(draft.description).toContain("Message from TANAW: A report for October 2026 has already been sent.");
    expect(rejectedUploadTicketDraft({ ...refused, rejectionReason: null }, "12-hour").description).toContain("TANAW did not give a reason.");
  });
});

describe("sent confirmation", () => {
  it("names when it was sent, its reference and, for a correction, its version", () => {
    expect(squash(sentConfirmationText(base, "12-hour"))).toBe("Sent on Nov 3, 2026 at 4:12 PM · Reference REP-OCT-1");
    expect(squash(sentConfirmationText(report({ id: "REP-OCT-2", version: 2 }), "12-hour"))).toBe("Sent on Nov 3, 2026 at 4:12 PM · Reference REP-OCT-2 · Version 2");
    expect(squash(sentConfirmationText(report({ syncStatus: "pending_cloud_sync" }), "12-hour"))).toBe("Saved on this computer on Nov 3, 2026 at 4:12 PM · Reference REP-OCT-1");
    expect(reportLifecycle(report({ syncStatus: "pending_cloud_sync" }), [], "October 2026").kind).toBe("waiting_to_send");
    expect(reportLifecycle(base, [base], "October 2026").kind).toBe("sent");
  });

  it("follows Staff's review in front-desk words", () => {
    expect(reviewState(base).text).toBe("Waiting for Staff review");
    expect(reviewState(report({ reviewStatus: "Pending Review" })).text).toBe("Waiting for Staff review");
    expect(reviewState(report({ reviewStatus: "Ready to Consolidate" })).text).toBe("Accepted by Staff");
    expect(reviewState(report({ status: "Consolidated", reviewStatus: "Consolidated" })).text).toBe("Included in the October consolidated report");
    expect(reviewState(report({ syncStatus: "pending_cloud_sync" })).text).toBe("Waiting to send");
  });
});

describe("reports needing action", () => {
  it("lists months whose latest version was returned or refused and not reopened yet", () => {
    const returned = report({ status: "Returned", reviewStatus: "Returned" });
    const refused = report({ id: "REP-SEP", period: "September 2026", date: "September 2026", syncStatus: "upload_rejected" });
    const august = report({ id: "REP-AUG-1", period: "August 2026", date: "August 2026", status: "Returned", reviewStatus: "Returned", reopenedAt: "2026-09-04T00:00:00Z" });
    const augustFixed = report({ id: "REP-AUG-2", period: "August 2026", date: "August 2026", version: 2 });
    expect(reportsNeedingAction([august, augustFixed, refused, returned]).map((item) => item.id)).toEqual(["REP-OCT-1", "REP-SEP"]);
    expect(reportsNeedingAction([{ ...returned, reopenedAt: "2026-11-06T00:00:00Z" }])).toEqual([]);
  });
});

describe("origin split", () => {
  it("separates This City from the rest of the province and ignores blanks", () => {
    expect(originSplit({ ...emptyDemo(), thisCityMale: "3", thisCityFemale: "2", thisProvMale: "4", thisProvFemale: "2", foreignFemale: "1" })).toEqual({
      thisCity: 5,
      otherCities: 1,
      otherProvinces: 0,
      foreign: 1,
    });
  });
});
