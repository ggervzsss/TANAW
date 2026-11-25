import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffApi } from "../../../../../../src/lib/axios";
import { canReopenSupportTicket, canReplyToSupportTicket, fetchSupportTicketAttachmentBlob, sortSupportTickets, type SupportTicket, type SupportTicketStatus } from "../../../../../../src/features/tickets/services/tickets";

vi.mock("../../../../../../src/lib/axios", () => ({
  API_BASE_URL: "http://localhost:8000",
  staffApi: {
    defaults: { baseURL: "http://localhost:8000" },
    get: vi.fn(),
  },
}));

describe("request photos", () => {
  beforeEach(() => {
    vi.mocked(staffApi.get).mockReset();
  });

  it("loads photos only through the authenticated request endpoint", async () => {
    const blob = new Blob(["recognizable attachment bytes"], { type: "image/png" });
    vi.mocked(staffApi.get).mockResolvedValue({ data: blob, headers: { "content-type": "image/png" } });

    await expect(fetchSupportTicketAttachmentBlob({ id: "r:0", fileName: "gate.png", mediaType: "image/png", sizeBytes: blob.size, url: "/operational/requests/r/attachments/0" })).resolves.toBe(blob);
    expect(staffApi.get).toHaveBeenCalledWith("/operational/requests/r/attachments/0", { responseType: "blob" });
    await expect(fetchSupportTicketAttachmentBlob({ id: "r:0", fileName: "gate.png", mediaType: "image/png", sizeBytes: 1, url: "https://elsewhere.example/gate.png" })).rejects.toThrow();
  });
});

describe("request order and actions", () => {
  const requests = [
    request("resolved", "Resolved", "2026-07-24T09:00:00Z"),
    request("open-old", "In Progress", "2026-07-24T02:00:00Z"),
    request("approved", "Approved", "2026-07-24T08:00:00Z"),
    request("open-new", "In Progress", "2026-07-24T06:00:00Z"),
  ];

  it("lists open requests first, newest first, without changing the input", () => {
    expect(sortSupportTickets(requests, "recommended").map((item) => item.id)).toEqual(["open-new", "open-old", "resolved", "approved"]);
    expect(sortSupportTickets(requests, "oldest")[0].id).toBe("open-old");
    expect(requests[0].id).toBe("resolved");
  });

  it("closes the conversation once a request is resolved or decided, and reopens only resolved ones", () => {
    expect(canReplyToSupportTicket({ status: "In Progress" })).toBe(true);
    expect(canReplyToSupportTicket({ status: "Resolved" })).toBe(false);
    expect(canReopenSupportTicket({ status: "Resolved", accountChange: null })).toBe(true);
    expect(canReopenSupportTicket({ status: "Approved", accountChange: null })).toBe(false);
    const accountChange = { field: "contactNumber", label: "Contact number", currentValue: null, requestedValue: "09171234567", canApprove: false } as const;
    expect(canReopenSupportTicket({ status: "Resolved", accountChange })).toBe(false);
  });
});

function request(id: string, status: SupportTicketStatus, timestamp: string): SupportTicket {
  return {
    id,
    code: `REQ-${id}`,
    group: "Other",
    title: id,
    description: `${id} description`,
    status,
    enterpriseId: "ENT-001",
    enterpriseName: "Test Enterprise",
    requesterName: "Front desk",
    affectedArea: null,
    camera: null,
    attachments: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    unread: false,
    updated: false,
  };
}
