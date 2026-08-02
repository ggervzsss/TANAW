import type { SupportTicketCategory } from "../services/tickets";

export type SupportTicketCategoryConfig = {
  affectedAreaRequired: boolean;
  showAffectedArea: boolean;
  showCamera: boolean;
};

export const supportTicketCategories: readonly SupportTicketCategory[] = ["Camera Issue", "Report Concern", "Maintenance", "Account & Security", "Other"];

const categoryConfig: Record<SupportTicketCategory, SupportTicketCategoryConfig> = {
  "Camera Issue": {
    affectedAreaRequired: true,
    showAffectedArea: true,
    showCamera: true,
  },
  "Report Concern": {
    affectedAreaRequired: false,
    showAffectedArea: false,
    showCamera: false,
  },
  Maintenance: {
    affectedAreaRequired: true,
    showAffectedArea: true,
    showCamera: true,
  },
  "Account & Security": {
    affectedAreaRequired: false,
    showAffectedArea: false,
    showCamera: false,
  },
  Other: {
    affectedAreaRequired: true,
    showAffectedArea: true,
    showCamera: false,
  },
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

export function ticketCategoryPayloadFields(category: SupportTicketCategory, fields: { affectedArea: string; cameraNode: string }) {
  const config = getSupportTicketCategoryConfig(category);
  const normalized = clearHiddenTicketFields(category, fields);
  return {
    affectedArea: config.showAffectedArea ? trimOptional(normalized.affectedArea) : undefined,
    cameraNode: config.showCamera ? trimOptional(normalized.cameraNode) : undefined,
  };
}

function trimOptional(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}
