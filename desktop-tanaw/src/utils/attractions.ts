import { attractionClassifications, otherAttractionCode } from "../contracts/generated/attractions";

export function formatReportAttraction(code: unknown, description: unknown): string | undefined {
  const classification = attractionClassifications.find((row) => row.code === code);
  if (!classification) return undefined;
  const category = code === otherAttractionCode && typeof description === "string" && description.trim() ? description.trim() : classification.category;
  return `${classification.code} - ${category}`;
}
