import { describe, expect, it } from "vitest";
import { clearHiddenTicketFields, getSupportTicketCategoryConfig, supportTicketCategories, ticketCategoryPayloadFields } from "../../../../../../src/features/tickets/model/ticket-category-config";

describe("request group field policy", () => {
  it("offers the three groups an enterprise picks from", () => {
    expect(supportTicketCategories).toEqual(["Desktop app or camera problem", "Report problem", "Other"]);
    expect(getSupportTicketCategoryConfig("Desktop app or camera problem")).toEqual({ affectedAreaRequired: false, showAffectedArea: true, showCamera: true });
    expect(getSupportTicketCategoryConfig("Other").showCamera).toBe(false);
  });

  it("clears and omits the area and camera for report problems", () => {
    expect(clearHiddenTicketFields("Report problem", { affectedArea: "Lobby", cameraNode: "TAPO C310" })).toEqual({ affectedArea: "", cameraNode: "" });
    expect(ticketCategoryPayloadFields("Report problem", { affectedArea: "Lobby", cameraNode: "TAPO C310" })).toEqual({ affectedArea: undefined, camera: undefined });
  });

  it("sends the camera only for desktop app or camera problems", () => {
    expect(ticketCategoryPayloadFields("Desktop app or camera problem", { affectedArea: " Lobby ", cameraNode: " TAPO C310 " })).toEqual({ affectedArea: "Lobby", camera: "TAPO C310" });
    expect(ticketCategoryPayloadFields("Other", { affectedArea: " Front desk ", cameraNode: "stale camera" })).toEqual({ affectedArea: "Front desk", camera: undefined });
  });
});
