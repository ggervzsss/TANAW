import type { SupportTicketCategory, SupportTicketPriority } from "../services/tickets";

export type TicketFormState = {
  affectedArea: string;
  cameraNode: string;
  category: string;
  description: string;
  priority: string;
  subject: string;
};

export type TicketFormField = "category" | "priority" | "subject" | "affectedArea" | "description";
export type TicketFormErrors = Partial<Record<TicketFormField, string>>;

export const ticketFormFieldOrder: readonly TicketFormField[] = ["category", "priority", "subject", "affectedArea", "description"];

const supportedCategories = new Set<string>(["Camera Issue", "Report Concern", "Maintenance", "Account & Security", "Other"]);
const supportedPriorities = new Set<string>(["Normal", "High", "Urgent", "Low"]);

export function isSupportTicketCategory(value: string): value is SupportTicketCategory {
  return supportedCategories.has(value);
}

export function isSupportTicketPriority(value: string): value is SupportTicketPriority {
  return supportedPriorities.has(value);
}

export function validateTicketForm(form: TicketFormState): TicketFormErrors {
  const errors: TicketFormErrors = {};
  if (!isSupportTicketCategory(form.category)) errors.category = "Select a valid ticket category.";
  if (!isSupportTicketPriority(form.priority)) errors.priority = "Select a valid ticket priority.";
  if (!form.subject.trim()) errors.subject = "Enter a ticket subject.";
  else if (form.subject.trim().length < 3) errors.subject = "Ticket subject must be at least 3 characters.";
  if (!form.affectedArea.trim()) errors.affectedArea = "Enter the affected area.";
  if (!form.description.trim()) errors.description = "Enter a ticket description.";
  else if (form.description.trim().length < 10) errors.description = "Describe the ticket in at least 10 characters.";
  return errors;
}
