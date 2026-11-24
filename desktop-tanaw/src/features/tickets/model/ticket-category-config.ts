import type { SupportTicketCategory } from "../services/tickets";

export type SupportTicketCategoryConfig = {
  affectedAreaRequired: boolean;
  showAffectedArea: boolean;
  showCamera: boolean;
};

/** The groups an enterprise picks from. Sign-in help and Account change are set by TANAW. */
export const supportTicketCategories: readonly SupportTicketCategory[] = ["Desktop app or camera problem", "Report problem", "Other"];

const categoryConfig: Record<SupportTicketCategory, SupportTicketCategoryConfig> = {
  "Desktop app or camera problem": { affectedAreaRequired: false, showAffectedArea: true, showCamera: true },
  "Report problem": { affectedAreaRequired: false, showAffectedArea: false, showCamera: false },
  Other: { affectedAreaRequired: false, showAffectedArea: true, showCamera: false },
};

export function getSupportTicketCategoryConfig(category: SupportTicketCategory) {
  return categoryConfig[category];
}

export function clearHiddenTicketFields(category: SupportTicketCategory, fields: { affectedArea: string; cameraNode: string }) {
  const config = getSupportTicketCategoryConfig(category);
  return {
    affectedArea: config.showAffectedArea ? fields.affectedArea : "",
    cameraNode: config.showCamera ? fields.cameraNode : "",
  };
}

/** The group's optional fields for the request payload: `affectedArea` and `camera`. */
export function ticketCategoryPayloadFields(category: SupportTicketCategory, fields: { affectedArea: string; cameraNode: string }) {
  const config = getSupportTicketCategoryConfig(category);
  const normalized = clearHiddenTicketFields(category, fields);
  return {
    affectedArea: config.showAffectedArea ? trimOptional(normalized.affectedArea) : undefined,
    camera: config.showCamera ? trimOptional(normalized.cameraNode) : undefined,
  };
}

function trimOptional(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}
