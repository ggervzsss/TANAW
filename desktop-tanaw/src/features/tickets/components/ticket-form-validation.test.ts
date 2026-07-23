import { describe, expect, it } from "vitest";
import { ticketFormFieldOrder, validateTicketForm, type TicketFormState } from "./ticket-form-validation";

const validForm: TicketFormState = {
  affectedArea: "Lobby",
  cameraNode: "",
  category: "Camera Issue",
  description: "The camera feed stopped updating.",
  priority: "Normal",
  subject: "Camera offline",
};

describe("support ticket form validation", () => {
  it("validates required fields in stable logical order", () => {
    const errors = validateTicketForm({
      affectedArea: " ",
      cameraNode: "",
      category: "Stale category",
      description: " ",
      priority: "Stale priority",
      subject: " ",
    });

    expect(ticketFormFieldOrder.filter((field) => errors[field])).toEqual(["category", "priority", "subject", "affectedArea", "description"]);
  });

  it("keeps camera optional and accepts a complete ticket", () => {
    expect(validateTicketForm(validForm)).toEqual({});
  });

  it("enforces useful subject and description lengths", () => {
    expect(validateTicketForm({ ...validForm, subject: "ab" }).subject).toContain("3 characters");
    expect(validateTicketForm({ ...validForm, description: "short" }).description).toContain("10 characters");
  });
});
