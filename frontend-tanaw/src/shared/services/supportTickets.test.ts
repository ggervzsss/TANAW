import { describe, expect, it } from "vitest";
import { sortRecommendedSupportTickets, type SupportTicket, type SupportTicketPriority, type SupportTicketStatus } from "./supportTickets";

describe("recommended support ticket ordering", () => {
  it("orders active work by priority and keeps resolved tickets last", () => {
    const tickets = [
      ticket("resolved-high", "High", "Resolved", "2026-07-24T04:00:00Z"),
      ticket("low", "Low", "Open", "2026-07-24T05:00:00Z"),
      ticket("normal", "Normal", "Open", "2026-07-24T06:00:00Z"),
      ticket("urgent", "Urgent", "Open", "2026-07-24T02:00:00Z"),
      ticket("high", "High", "In Review", "2026-07-24T03:00:00Z"),
    ];

    expect(sortRecommendedSupportTickets(tickets).map((item) => item.id)).toEqual(["urgent", "high", "normal", "low", "resolved-high"]);
    expect(tickets.map((item) => item.id)).toEqual(["resolved-high", "low", "normal", "urgent", "high"]);
  });

  it("uses workflow, authoritative activity time, and stable identifiers as tie breakers", () => {
    const tickets = [
      ticket("in-review", "High", "In Review", "2026-07-24T05:00:00Z"),
      ticket("open-old", "High", "Open", "2026-07-24T03:00:00Z"),
      ticket("open-new", "High", "Open", "2026-07-24T04:00:00Z"),
      ticket("resolved-old", "Urgent", "Resolved", "2026-07-24T01:00:00Z"),
      ticket("resolved-new", "Low", "Resolved", "2026-07-24T06:00:00Z"),
    ];

    expect(sortRecommendedSupportTickets(tickets).map((item) => item.id)).toEqual(["open-new", "open-old", "in-review", "resolved-new", "resolved-old"]);
  });
});

function ticket(id: string, priority: SupportTicketPriority, status: SupportTicketStatus, timestamp: string): SupportTicket {
  return {
    id,
    code: `TCK-${id}`,
    enterpriseId: "ENT-001",
    enterpriseName: "Test Enterprise",
    submittedBy: "Test Enterprise",
    category: "Other",
    priority,
    subject: id,
    description: `${id} description`,
    affectedArea: "System",
    cameraNode: null,
    attachments: [],
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
