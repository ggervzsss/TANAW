import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../../../src/shared/lib/apiClient";
import { canReplyToRequest, fetchRequestAttachmentBlob, markRequestsRead, sortRequests } from "../../../../src/shared/services/requests";
import { request } from "../../fixtures/requests";

vi.mock("../../../../src/shared/lib/apiClient", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));


describe("requests service", () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockReset();
  });

  it("loads photos only through the authenticated request endpoint", async () => {
    const blob = new Blob(["photo"], { type: "image/png" });
    vi.mocked(apiClient.get).mockResolvedValue({ data: blob, headers: { "content-type": "image/png" } });

    await expect(fetchRequestAttachmentBlob({ id: "r:0", fileName: "gate.png", mediaType: "image/png", sizeBytes: blob.size, url: "/operational/requests/r/attachments/0" })).resolves.toBe(blob);
    await expect(fetchRequestAttachmentBlob({ id: "r:0", fileName: "gate.png", mediaType: "image/png", sizeBytes: 1, url: "https://elsewhere.example/photo.png" })).rejects.toThrow();
  });

  it("marks every request read with one call", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { readCount: 3 } });

    await markRequestsRead("all");

    expect(apiClient.post).toHaveBeenCalledWith("/operational/requests/read", { all: true, requestIds: [] });
  });

  it("lists open requests first, urgent ones on top, then newest first", () => {
    const sorted = sortRequests([
      request({ id: "resolved", status: "Resolved", createdAt: "2026-11-23T09:00:00Z" }),
      request({ id: "old", createdAt: "2026-11-21T06:00:00Z" }),
      request({ id: "urgent", urgent: true, createdAt: "2026-11-20T06:00:00Z" }),
      request({ id: "new", createdAt: "2026-11-23T08:00:00Z" }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(["urgent", "new", "old", "resolved"]);
  });

  it("closes the conversation once a request is resolved or decided", () => {
    expect(canReplyToRequest({ status: "In Progress" })).toBe(true);
    expect(canReplyToRequest({ status: "Resolved" })).toBe(false);
    expect(canReplyToRequest({ status: "Approved" })).toBe(false);
  });
});
