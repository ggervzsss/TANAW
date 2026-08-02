import { describe, expect, it } from "vitest";
import { sortSupportTickets, type SupportTicket, type SupportTicketPriority, type SupportTicketStatus } from "./tickets";

describe("enterprise support ticket sorting", () => {
  const tickets = [
    ticket("resolved-high", "High", "Resolved", "2026-07-24T04:00:00Z"),
    ticket("low", "Low", "Open", "2026-07-24T05:00:00Z"),
    ticket("normal", "Normal", "Open", "2026-07-24T06:00:00Z"),
    ticket("urgent", "Urgent", "Open", "2026-07-24T02:00:00Z"),
    ticket("high", "High", "In Review", "2026-07-24T03:00:00Z"),
  ];

  it("uses canonical recommended ordering with resolved tickets last", () => {
    expect(sortSupportTickets(tickets, "recommended").map((item) => item.id)).toEqual(["urgent", "high", "normal", "low", "resolved-high"]);
  });

  it("orders resolved tickets by update time without reapplying their old priority", () => {
    const resolved = [ticket("resolved-new-low", "Low", "Resolved", "2026-07-24T06:00:00Z"), ticket("resolved-old-urgent", "Urgent", "Resolved", "2026-07-24T01:00:00Z")];
    expect(sortSupportTickets(resolved, "recommended").map((item) => item.id)).toEqual(["resolved-new-low", "resolved-old-urgent"]);
  });

  it("supports chronological, priority, status, and update options without mutating records", () => {
    expect(sortSupportTickets(tickets, "newest")[0].id).toBe("normal");
    expect(sortSupportTickets(tickets, "oldest")[0].id).toBe("urgent");
    expect(sortSupportTickets(tickets, "priority-high")[0].id).toBe("urgent");
    expect(sortSupportTickets(tickets, "priority-low")[0].id).toBe("low");
    const byStatus = sortSupportTickets(tickets, "status");
    expect(byStatus[byStatus.length - 1]?.id).toBe("resolved-high");
    expect(sortSupportTickets(tickets, "recently-updated")[0].id).toBe("normal");
    expect(tickets[0].id).toBe("resolved-high");
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
