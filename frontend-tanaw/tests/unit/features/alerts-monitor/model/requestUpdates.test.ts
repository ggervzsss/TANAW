import { describe, expect, it } from "vitest";
import { alertToRequest, profileChangeToRequest, ticketToRequest } from "@/features/alerts-monitor/model/adminRequests";
import { buildRequestUpdates, handledByLabel, messageRecipientsLabel, requestHandler, requestLogs, requestStatusNote } from "@/features/alerts-monitor/model/requestUpdates";
import type { SupportTicket, SupportTicketDetail } from "@/shared/services/supportTickets";
import type { AccountSummary, PriorityAlert, SystemLog } from "@/shared/types";

const baseTicket: SupportTicket = {
  id: "ticket-1",
  code: "TCK-000123",
  enterpriseId: "ENT-001",
  enterpriseName: "San Pedro Plaza",
  submittedBy: "San Pedro Plaza",
  category: "Camera Issue",
  priority: "Urgent",
  subject: "Entrance camera is offline",
  description: "The entrance camera stopped counting.",
  attachments: [],
  status: "In Review",
  createdAt: "2026-11-23T05:00:00Z",
  updatedAt: "2026-11-23T06:05:00Z",
};

function log(overrides: Partial<SystemLog>): SystemLog {
  return {
    id: "log-1",
    timestamp: "2026-11-23T06:05:00Z",
    category: "IT Activity",
    severity: "Success",
    actor: "Carlo Mendoza",
    actorRole: "IT Personnel",
    action: "Update Support Ticket Status",
    target: "TCK-000123",
    summary: "Carlo Mendoza updated TCK-000123 from Open to In Review.",
    sourceId: "ticket-1",
    metadata: { status: "In Review" },
    ...overrides,
  };
}

const ticketRequest = ticketToRequest(baseTicket);
const message = log({
  id: "log-2",
  timestamp: "2026-11-23T07:00:00Z",
  category: "Admin Operation",
  severity: "Info",
  actor: "LGU Admin",
  actorRole: "Admin",
  action: "Message IT",
  summary: "LGU Admin sent IT a message about TCK-000123.",
  metadata: { sourceType: "support.ticket", message: "Please call Maria today." },
});
const unrelated = log({ id: "log-3", sourceId: "ticket-2" });
const formatTime = (value: string) => value.slice(11, 16);

describe("latest updates", () => {
  it("lists status changes, Admin messages and ticket replies newest first, ending with the request", () => {
    const detail: SupportTicketDetail = {
      ...baseTicket,
      messages: [{ id: "m1", ticketId: "ticket-1", authorId: "it-1", authorName: "Carlo Mendoza", authorRole: "it", message: "Checking the camera now.", createdAt: "2026-11-23T06:30:00Z" }],
    };
    const updates = buildRequestUpdates(ticketRequest, [log({}), message, unrelated], detail);
    expect(updates.map((update) => update.title)).toEqual(["Message from LGU Admin", "Reply from Carlo Mendoza, IT", "In progress", "Request sent"]);
    expect(updates[0]).toMatchObject({ detail: "Please call Maria today.", kind: "sent" });
    expect(updates.at(-1)).toMatchObject({ detail: "San Pedro Plaza sent this request.", at: "2026-11-23T05:00:00Z" });
  });

  it("ignores another ticket's conversation", () => {
    const other: SupportTicketDetail = { ...baseTicket, id: "ticket-2", messages: [{ id: "m1", ticketId: "ticket-2", authorId: "x", authorName: "X", authorRole: "it", message: "Hi", createdAt: "2026-11-23T06:30:00Z" }] };
    expect(buildRequestUpdates(ticketRequest, [], other).map((update) => update.title)).toEqual(["Request sent"]);
  });

  it("matches alert status logs by the alert code in their summary", () => {
    const alert: PriorityAlert = {
      id: "ALT-000007",
      type: "Foot Traffic Alert",
      severity: "Warning",
      urgency: "Important",
      enterprise: "San Pedro Plaza",
      requester: "San Pedro Plaza",
      summary: "Busy.",
      requiredAction: "Review the live map.",
      resolutionMode: "Admin Monitoring",
      status: "Resolved",
      owner: "Admin",
      time: "2026-11-23T02:00:00Z",
    };
    const request = alertToRequest(alert);
    const statusLog = log({ id: "a1", category: "Admin Operation", actor: "LGU Admin", actorRole: "Admin", action: "Alert Resolved", summary: "LGU Admin marked ALT-000007 as Resolved.", sourceId: "internal-id" });
    const created = log({ id: "a2", category: "Admin Operation", actor: "TANAW", actorRole: "System", action: "Alert Created", summary: "Busy.", sourceId: "ALT-000007" });
    expect(requestLogs(request, [statusLog, created, unrelated]).map((item) => item.id)).toEqual(["a1", "a2"]);
    expect(buildRequestUpdates(request, [statusLog, created]).map((update) => update.title)).toEqual(["Resolved", "Alert raised"]);
    const handler = requestHandler(request, [statusLog]);
    expect(handler).toEqual({ name: "LGU Admin", at: "2026-11-23T06:05:00Z" });
    expect(requestStatusNote(request, handler, formatTime)).toBe("Resolved by LGU Admin at 06:05.");
  });

  it("keeps only profile decisions and messages made after the change was requested", () => {
    const account = { id: "account-1", enterpriseName: "San Pedro Plaza", displayName: "San Pedro Plaza", managerName: null, enterpriseId: "ENT-001" } as AccountSummary;
    const request = profileChangeToRequest(account, {
      type: "contactNumber",
      label: "Contact Number",
      requestedValue: "0917",
      requestedAt: "2026-11-23T00:00:00Z",
      requestId: null,
      status: "pending_review",
      isVerified: false,
      canApprove: true,
      expiresAt: null,
    });
    const older = log({ id: "p1", action: "Decline Enterprise Profile Change", sourceId: "account-1", timestamp: "2026-11-01T00:00:00Z" });
    const statusChange = log({ id: "p2", action: "Update Account Status", sourceId: "account-1" });
    const profileMessage = { ...message, id: "p3", sourceId: "account-1", metadata: { sourceType: "enterprise.profile", message: "Please check." } };
    expect(requestLogs(request, [older, statusChange, profileMessage]).map((item) => item.id)).toEqual(["p3"]);
  });
});

describe("who is handling a request", () => {
  it("names the IT person who started it and when", () => {
    const handler = requestHandler(ticketRequest, [log({})]);
    expect(handler).toEqual({ name: "Carlo Mendoza", at: "2026-11-23T06:05:00Z" });
    expect(handledByLabel(ticketRequest, handler)).toBe("Carlo Mendoza, IT");
    expect(messageRecipientsLabel(ticketRequest, handler)).toBe("Carlo Mendoza and the IT team");
    expect(requestStatusNote(ticketRequest, handler, formatTime)).toBe("Carlo Mendoza from IT started on this at 06:05 and is working on it.");
  });

  it("falls back to the first IT reply when no status change is recorded", () => {
    const detail: SupportTicketDetail = {
      ...baseTicket,
      messages: [
        { id: "m2", ticketId: "ticket-1", authorId: "it-2", authorName: "Ana Cruz", authorRole: "it", message: "Later", createdAt: "2026-11-23T07:00:00Z" },
        { id: "m1", ticketId: "ticket-1", authorId: "it-1", authorName: "Carlo Mendoza", authorRole: "it", message: "First", createdAt: "2026-11-23T06:30:00Z" },
      ],
    };
    expect(requestHandler(ticketRequest, [], detail)).toEqual({ name: "Carlo Mendoza", at: "2026-11-23T06:30:00Z" });
  });

  it("says nobody has accepted a request IT has not started", () => {
    const open = ticketToRequest({ ...baseTicket, status: "Open" });
    const handler = requestHandler(open, []);
    expect(handledByLabel(open, handler)).toBe("Not accepted yet");
    expect(messageRecipientsLabel(open, handler)).toBe("the IT team");
    expect(requestStatusNote(open, handler, formatTime)).toBe("Sent to IT. The status changes to In progress as soon as IT starts on it.");
    const inProgress = ticketToRequest(baseTicket);
    expect(handledByLabel(inProgress, { name: null, at: null })).toBe("IT team");
    expect(requestStatusNote(inProgress, { name: null, at: null }, formatTime)).toBe("IT is working on this.");
  });
});
