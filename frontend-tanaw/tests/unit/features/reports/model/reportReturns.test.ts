import { describe, expect, it } from "vitest";
import { canReturnReport, replacedVersionNote, returnReasonCount, returnReasonError, returnReportExplanation } from "@/features/reports/model/reportReturns";

describe("the return reason", () => {
  it("is required and takes 10 to 500 characters once trimmed", () => {
    expect(returnReasonError("", "Daisy Resort")).toBe("Say what Daisy Resort needs to correct.");
    expect(returnReasonError("   \n  ", "Daisy Resort")).toBe("Say what Daisy Resort needs to correct.");
    expect(returnReasonError("  too short  ", "Daisy Resort")).toBe("Write at least 10 characters so Daisy Resort knows what to correct.");
    expect(returnReasonError("  Recount Oct 31.  ", "Daisy Resort")).toBeNull();
    expect(returnReasonError("x".repeat(500), "Daisy Resort")).toBeNull();
    expect(returnReasonError("x".repeat(501), "Daisy Resort")).toBe("Keep the reason to 500 characters or fewer.");
  });

  it("counts what was typed against the limit", () => {
    expect(returnReasonCount("")).toBe("0 of 500 characters");
    expect(returnReasonCount("Recount Oct 31.")).toBe("15 of 500 characters");
  });

  it("explains what returning does before staff confirm", () => {
    expect(returnReportExplanation("Daisy Resort")).toBe(
      "Daisy Resort will see your reason in the desktop app and can send a corrected version. This report will not be included in the consolidated report until then.",
    );
  });
});

describe("which reports can be returned", () => {
  it("is a report waiting for review or accepted, never one consolidated or already returned", () => {
    expect(canReturnReport({ status: "Pending Review" })).toBe(true);
    expect(canReturnReport({ status: "Ready to Consolidate" })).toBe(true);
    expect(canReturnReport({ status: "Consolidated" })).toBe(false);
    expect(canReturnReport({ status: "Returned" })).toBe(false);
  });
});

describe("a corrected version", () => {
  it("names the version it replaces and why that one was returned", () => {
    expect(replacedVersionNote({ version: 1 }, undefined)).toBeNull();
    expect(replacedVersionNote({ version: 2 }, { version: 1, returnedReason: "Recount the visitor origins." })).toBe("Replaces version 1 (returned: Recount the visitor origins.)");
    expect(replacedVersionNote({ version: 3 }, undefined)).toBe("Replaces version 2, which was returned for correction.");
  });
});
