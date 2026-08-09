import { describe, expect, it } from "vitest";
import { clearHiddenTicketFields, getSupportTicketCategoryConfig, supportTicketCategories, ticketCategoryPayloadFields } from "./ticket-category-config";

describe("support ticket category field policy", () => {
  it("maps every supported category intentionally", () => {
    expect(supportTicketCategories).toEqual(["Camera Issue", "Report Concern", "Maintenance", "Account & Security", "Other"]);
    expect(getSupportTicketCategoryConfig("Camera Issue")).toEqual({
      affectedAreaRequired: true,
      showAffectedArea: true,
      showCamera: true,
    });
    expect(getSupportTicketCategoryConfig("Maintenance").showCamera).toBe(true);
    expect(getSupportTicketCategoryConfig("Other").showCamera).toBe(false);
  });

  it("clears and omits camera fields for report and account concerns", () => {
    for (const category of ["Report Concern", "Account & Security"] as const) {
      expect(
        clearHiddenTicketFields(category, {
          affectedArea: "Lobby",
          cameraNode: "TAPO C310",
        }),
      ).toEqual({ affectedArea: "", cameraNode: "" });
      expect(
        ticketCategoryPayloadFields(category, {
          affectedArea: "Lobby",
          cameraNode: "TAPO C310",
        }),
      ).toEqual({ affectedArea: undefined, cameraNode: undefined });
    }
  });

  it("preserves camera fields only for relevant categories", () => {
    expect(
      ticketCategoryPayloadFields("Camera Issue", {
        affectedArea: " Lobby ",
        cameraNode: " TAPO C310 ",
      }),
    ).toEqual({ affectedArea: "Lobby", cameraNode: "TAPO C310" });
    expect(
      ticketCategoryPayloadFields("Other", {
        affectedArea: " Account portal ",
        cameraNode: "stale camera",
      }),
    ).toEqual({ affectedArea: "Account portal", cameraNode: undefined });
  });
});
