import { describe, expect, it } from "vitest";
import { ticketFormFieldOrder, validateTicketForm, type TicketFormState } from "../../../../../../src/features/tickets/model/ticket-form-validation";

const validForm: TicketFormState = {
  affectedArea: "Lobby",
  cameraNode: "",
  category: "Desktop app or camera problem",
  description: "The camera feed stopped updating.",
  subject: "Camera offline",
};

describe("request form validation", () => {
  it("validates required fields in stable logical order", () => {
    const errors = validateTicketForm({
      affectedArea: " ",
      cameraNode: "",
      category: "Stale category",
      description: " ",
      subject: " ",
    });

    expect(ticketFormFieldOrder.filter((field) => errors[field])).toEqual(["category", "subject", "description"]);
  });

  it("keeps camera optional and accepts a complete request", () => {
    expect(validateTicketForm(validForm)).toEqual({});
  });

  it("enforces useful subject and description lengths", () => {
    expect(validateTicketForm({ ...validForm, subject: "ab" }).subject).toContain("3 characters");
    expect(validateTicketForm({ ...validForm, description: "short" }).description).toContain("10 characters");
  });

  it("never requires the affected area, and rejects the groups TANAW sets itself", () => {
    for (const category of ["Desktop app or camera problem", "Report problem", "Other"]) {
      expect(validateTicketForm({ ...validForm, affectedArea: "", cameraNode: "", category })).toEqual({});
    }
    expect(validateTicketForm({ ...validForm, category: "Account change" }).category).toBe("Choose what the request is about.");
  });
});
