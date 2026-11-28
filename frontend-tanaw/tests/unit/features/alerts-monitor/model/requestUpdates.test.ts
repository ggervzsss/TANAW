import { describe, expect, it } from "vitest";
import { accountChangeSentence, buildRequestUpdates, handledByLabel, requestHandler, requestStatusNote } from "../../../../../src/features/alerts-monitor/model/requestUpdates";
import type { RequestDetail, RequestMessage } from "../../../../../src/shared/services/requests";
import { request } from "../../../fixtures/requests";

function message(overrides: Partial<RequestMessage> & Pick<RequestMessage, "id" | "createdAt">): RequestMessage {
  return { requestId: "r1", authorId: "it-1", authorName: "Carlo Mendoza", authorRole: "it", kind: "message", message: "Checking now.", ...overrides };
}

describe("request timeline", () => {
  const item = request({ id: "r1", status: "In Progress", createdAt: "2026-11-23T05:00:00Z" });
  const detail: RequestDetail = {
    ...item,
    messages: [
      message({ id: "reply", createdAt: "2026-11-23T05:10:00Z" }),
      message({ id: "resolved", kind: "status", message: "Resolved", createdAt: "2026-11-23T05:15:00Z" }),
      message({ id: "reopened", kind: "status", authorName: "Rina Dizon", authorRole: "enterprise", message: "Reopened", createdAt: "2026-11-23T05:20:00Z" }),
      message({ id: "note", kind: "note", authorName: "Ana Reyes", authorRole: "admin", message: "Please update me here.", createdAt: "2026-11-23T05:30:00Z" }),
    ],
  };

  it("lists replies, notes and status changes newest first, ending with when it was sent", () => {
    expect(buildRequestUpdates(item, detail).map((update) => update.title)).toEqual(["Note for IT from Ana Reyes", "Reopened", "Resolved", "Reply from Carlo Mendoza, IT", "Request sent"]);
  });

  it("names who from IT is handling it", () => {
    const handler = requestHandler(detail);
    expect(handler).toEqual({ name: "Carlo Mendoza", at: "2026-11-23T05:10:00Z" });
    expect(handledByLabel(handler)).toBe("Carlo Mendoza, IT");
    expect(requestStatusNote(item, handler, () => "1:10 PM")).toBe("Carlo Mendoza from IT started on this at 1:10 PM.");
    expect(handledByLabel({ name: null })).toBe("IT team");
    expect(requestStatusNote(request({ id: "new" }), { name: null, at: null }, () => "")).toBe("Sent to IT. Nobody in IT has opened it yet.");
    expect(requestStatusNote(request({ id: "seen", seenByIt: true }), { name: null, at: null }, () => "")).toBe("IT has seen this. Nobody has started on it yet.");
    // The summary names the handler before the timeline has loaded.
    expect(requestStatusNote(request({ id: "taken", seenByIt: true, handledBy: { accountId: "it-1", name: "Carlo Mendoza" } }), { name: null, at: null }, () => "")).toBe(
      "Carlo Mendoza from IT is working on this.",
    );
  });

  it("describes an account change and whether the new email is verified", () => {
    const change = request({
      id: "c",
      group: "Account change",
      accountChange: { field: "businessEmail", label: "Business email", currentValue: "old@example.com", requestedValue: "new@example.com", verification: "pending_verification", canApprove: false },
    });
    expect(accountChangeSentence(change)).toBe("Business email from old@example.com to new@example.com. The new address is not verified yet, so IT can't approve it.");
    expect(requestStatusNote(change, { name: null, at: null }, () => "")).toBe("Waiting for IT to approve this change.");
    expect(requestStatusNote({ ...change, seenByIt: true }, { name: null, at: null }, () => "")).toBe("IT has seen this change but has not decided on it yet.");
    expect(requestStatusNote({ ...change, status: "Resolved" }, { name: "Carlo Mendoza", at: null }, () => "")).toBe("Carlo Mendoza from IT resolved this without approving the change.");
  });
});
