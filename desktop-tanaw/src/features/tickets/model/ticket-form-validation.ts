import type { SupportTicketCategory } from "../services/tickets";
import { getSupportTicketCategoryConfig, supportTicketCategories } from "./ticket-category-config";

/** The new-request form. `category` holds the group, `subject` the title, `cameraNode` the camera. */
export type TicketFormState = {
  affectedArea: string;
  cameraNode: string;
  category: string;
  description: string;
  subject: string;
};

export type TicketFormField = "category" | "subject" | "affectedArea" | "description";
export type TicketFormErrors = Partial<Record<TicketFormField, string>>;

export const ticketFormFieldOrder: readonly TicketFormField[] = ["category", "subject", "affectedArea", "description"];

const supportedCategories = new Set<string>(supportTicketCategories);

export function isSupportTicketCategory(value: string): value is SupportTicketCategory {
  return supportedCategories.has(value);
}

export function validateTicketForm(form: TicketFormState): TicketFormErrors {
  const errors: TicketFormErrors = {};
  if (!isSupportTicketCategory(form.category)) errors.category = "Choose what the request is about.";
  if (!form.subject.trim()) errors.subject = "Enter a short title for the request.";
  else if (form.subject.trim().length < 3) errors.subject = "The title must be at least 3 characters.";
  if (isSupportTicketCategory(form.category) && getSupportTicketCategoryConfig(form.category).affectedAreaRequired && !form.affectedArea.trim()) {
    errors.affectedArea = "Enter the affected area.";
  }
  if (!form.description.trim()) errors.description = "Describe the problem.";
  else if (form.description.trim().length < 10) errors.description = "Describe the problem in at least 10 characters.";
  return errors;
}
