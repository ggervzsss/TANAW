import type { ReportDemographics } from "@/shared/types";

export type DotDemographics = {
  provMale: number;
  provFemale: number;
  provTotal: number;
  otherMale: number;
  otherFemale: number;
  otherTotal: number;
  foreignMale: number;
  foreignFemale: number;
  foreignTotal: number;
  grandMale: number;
  grandFemale: number;
};

const DEMOGRAPHIC_FIELDS: (keyof ReportDemographics)[] = ["thisProvMale", "thisProvFemale", "otherProvMale", "otherProvFemale", "foreignMale", "foreignFemale"];

export function getDotDemographics(total: number, submitted?: Partial<Record<keyof ReportDemographics, number | string>> | null): DotDemographics {
  return getSubmittedDotDemographics(total, submitted) ?? getEstimatedDotDemographics(total);
}

function getSubmittedDotDemographics(expectedTotal: number, submitted?: Partial<Record<keyof ReportDemographics, number | string>> | null): DotDemographics | null {
  if (!submitted || typeof submitted !== "object") return null;

  const values = DEMOGRAPHIC_FIELDS.reduce<Partial<Record<keyof ReportDemographics, number>>>((next, field) => {
    const value = nonNegativeInteger(submitted[field]);
    if (value !== null) next[field] = value;
    return next;
  }, {});

  if (!DEMOGRAPHIC_FIELDS.every((field) => typeof values[field] === "number")) return null;

  const thisProvMale = values.thisProvMale ?? 0;
  const thisProvFemale = values.thisProvFemale ?? 0;
  const otherProvMale = values.otherProvMale ?? 0;
  const otherProvFemale = values.otherProvFemale ?? 0;
  const foreignMale = values.foreignMale ?? 0;
  const foreignFemale = values.foreignFemale ?? 0;
  const submittedTotal = thisProvMale + thisProvFemale + otherProvMale + otherProvFemale + foreignMale + foreignFemale;

  if (submittedTotal !== expectedTotal) return null;

  return {
    provMale: thisProvMale,
    provFemale: thisProvFemale,
    provTotal: thisProvMale + thisProvFemale,
    otherMale: otherProvMale,
    otherFemale: otherProvFemale,
    otherTotal: otherProvMale + otherProvFemale,
    foreignMale,
    foreignFemale,
    foreignTotal: foreignMale + foreignFemale,
    grandMale: thisProvMale + otherProvMale + foreignMale,
    grandFemale: thisProvFemale + otherProvFemale + foreignFemale,
  };
}

function getEstimatedDotDemographics(total: number): DotDemographics {
  const provMale = Math.floor(total * 0.65 * 0.48);
  const provFemale = Math.floor(total * 0.65 * 0.52);
  const provTotal = provMale + provFemale;
  const otherMale = Math.floor(total * 0.25 * 0.5);
  const otherFemale = Math.floor(total * 0.25 * 0.5);
  const otherTotal = otherMale + otherFemale;
  const foreignMale = Math.floor(total * 0.1 * 0.55);
  const foreignFemale = total - provTotal - otherTotal - foreignMale;
  const foreignTotal = foreignMale + foreignFemale;

  return {
    provMale,
    provFemale,
    provTotal,
    otherMale,
    otherFemale,
    otherTotal,
    foreignMale,
    foreignFemale,
    foreignTotal,
    grandMale: provMale + otherMale + foreignMale,
    grandFemale: provFemale + otherFemale + foreignFemale,
  };
}

function nonNegativeInteger(value: number | string | undefined) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}
