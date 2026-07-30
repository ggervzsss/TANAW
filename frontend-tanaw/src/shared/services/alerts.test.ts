import { describe, expect, it } from "vitest";
import type { PriorityAlert, PriorityAlertStatus, TechnicalIssueUrgency } from "../types";
import { sortRecommendedPriorityAlerts } from "./alerts";

describe("recommended technical issue ordering", () => {
  it("places unresolved issues by urgency and resolved issues last", () => {
    const alerts = [
      alert("resolved-urgent", "Urgent", "Resolved", "2026-07-29T11:00:00Z"),
      alert("normal", "Normal", "New", "2026-07-29T12:00:00Z"),
      alert("important", "Important", "New", "2026-07-29T10:00:00Z"),
      alert("urgent", "Urgent", "New", "2026-07-29T09:00:00Z"),
    ];

    expect(sortRecommendedPriorityAlerts(alerts).map((item) => item.id)).toEqual(["urgent", "important", "normal", "resolved-urgent"]);
    expect(alerts.map((item) => item.id)).toEqual(["resolved-urgent", "normal", "important", "urgent"]);
  });

  it("uses workflow, newest issue time, and stable identifiers as tie breakers", () => {
    const alerts = [
      alert("urgent-in-review", "Urgent", "In Review", "2026-07-29T12:00:00Z"),
      alert("urgent-new-old", "Urgent", "New", "2026-07-29T09:00:00Z"),
      alert("urgent-new-new-b", "Urgent", "New", "2026-07-29T10:00:00Z"),
      alert("urgent-new-new-a", "Urgent", "New", "2026-07-29T10:00:00Z"),
      alert("resolved-old", "Urgent", "Resolved", "2026-07-29T07:00:00Z"),
      alert("resolved-new", "Normal", "Resolved", "2026-07-29T08:00:00Z"),
    ];

    expect(sortRecommendedPriorityAlerts(alerts).map((item) => item.id)).toEqual([
      "urgent-new-new-a",
      "urgent-new-new-b",
      "urgent-new-old",
      "urgent-in-review",
      "resolved-new",
      "resolved-old",
    ]);
  });
});

function alert(id: string, urgency: TechnicalIssueUrgency, status: PriorityAlertStatus, time: string): PriorityAlert {
  return {
    id,
    type: "Maintenance Request",
    severity: urgency === "Urgent" ? "Critical" : "Warning",
    urgency,
    enterprise: "Test Enterprise",
    requester: "Test Enterprise",
    summary: `${id} summary`,
    requiredAction: `${id} action`,
    resolutionMode: "Remote Review",
    status,
    owner: "IT",
    time,
  };
}
