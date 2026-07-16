import type { DemoBreakdown, DemographicEvidence } from "../../../types/enterprise";

export type DemographicTotals = {
  female: number;
  foreign: number;
  grandTotal: number;
  male: number;
  otherProvince: number;
  thisProvince: number;
};

export type ExplicitDemographicTotals = {
  female: number | null;
  foreign: number | null;
  grandTotal: number | null;
  male: number | null;
  otherProvince: number | null;
  thisProvince: number | null;
};

export type DemographicEvidenceStatus = {
  hasAnyValue: boolean;
  hasMissingValue: boolean;
  totals: DemographicTotals;
  validationMessage: string | null;
};

export type DemographicFact = {
  count: number;
  dimension: "residence_sex";
  provenance: DemographicEvidence["provenance"];
  quality: DemographicEvidence["quality"];
  value: (typeof demographicFactDefinitions)[number]["value"];
};

export const MAX_DEMOGRAPHIC_COUNT = 2_147_483_647;

export const CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE: DemographicEvidence = {
  provenance: "operator_entered",
  quality: "confirmed",
};

export const ESTIMATED_OPERATOR_DEMOGRAPHIC_EVIDENCE: DemographicEvidence = {
  provenance: "operator_entered",
  quality: "estimated",
};

const demographicFactDefinitions = [
  { field: "thisProvMale", value: "this_province_male" },
  { field: "thisProvFemale", value: "this_province_female" },
  { field: "otherProvMale", value: "other_province_male" },
  { field: "otherProvFemale", value: "other_province_female" },
  { field: "foreignMale", value: "foreign_male" },
  { field: "foreignFemale", value: "foreign_female" },
] as const satisfies ReadonlyArray<{ field: keyof DemoBreakdown; value: string }>;

export function parseDemographicCount(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const count = Number(normalized);
  return Number.isSafeInteger(count) && count <= MAX_DEMOGRAPHIC_COUNT ? count : null;
}

export function demographicCount(value: string) {
  return parseDemographicCount(value) ?? 0;
}

export function getDemographicTotals(demo: DemoBreakdown): DemographicTotals {
  const thisProvMale = demographicCount(demo.thisProvMale);
  const thisProvFemale = demographicCount(demo.thisProvFemale);
  const otherProvMale = demographicCount(demo.otherProvMale);
  const otherProvFemale = demographicCount(demo.otherProvFemale);
  const foreignMale = demographicCount(demo.foreignMale);
  const foreignFemale = demographicCount(demo.foreignFemale);
  const male = thisProvMale + otherProvMale + foreignMale;
  const female = thisProvFemale + otherProvFemale + foreignFemale;

  return {
    female,
    foreign: foreignMale + foreignFemale,
    grandTotal: male + female,
    male,
    otherProvince: otherProvMale + otherProvFemale,
    thisProvince: thisProvMale + thisProvFemale,
  };
}

export function getExplicitDemographicTotals(demo: DemoBreakdown): ExplicitDemographicTotals {
  const thisProvMale = parseDemographicCount(demo.thisProvMale);
  const thisProvFemale = parseDemographicCount(demo.thisProvFemale);
  const otherProvMale = parseDemographicCount(demo.otherProvMale);
  const otherProvFemale = parseDemographicCount(demo.otherProvFemale);
  const foreignMale = parseDemographicCount(demo.foreignMale);
  const foreignFemale = parseDemographicCount(demo.foreignFemale);
  const male = explicitSum([thisProvMale, otherProvMale, foreignMale]);
  const female = explicitSum([thisProvFemale, otherProvFemale, foreignFemale]);

  return {
    female,
    foreign: explicitSum([foreignMale, foreignFemale]),
    grandTotal: explicitSum([male, female]),
    male,
    otherProvince: explicitSum([otherProvMale, otherProvFemale]),
    thisProvince: explicitSum([thisProvMale, thisProvFemale]),
  };
}

export function formatDemographicValue(value: number | null) {
  return value === null ? "Not provided" : value.toLocaleString();
}

export function hasInvalidDemographicValue(demo: DemoBreakdown) {
  return Object.values(demo).some((value) => value.trim() !== "" && parseDemographicCount(value) === null);
}

export function hasAnyDemographicValue(demo: DemoBreakdown) {
  return Object.values(demo).some((value) => value.trim() !== "");
}

export function buildDemographicFacts(demo: DemoBreakdown, evidence: DemographicEvidence | null): DemographicFact[] {
  if (!evidence) return [];

  return demographicFactDefinitions.flatMap(({ field, value }) => {
    const count = parseDemographicCount(demo[field]);
    if (count === null) return [];
    return [
      {
        count,
        dimension: "residence_sex" as const,
        provenance: evidence.provenance,
        quality: evidence.quality,
        value,
      },
    ];
  });
}

export function demographicEvidenceFromFacts(value: unknown, demo: DemoBreakdown): DemographicEvidence | null {
  if (!Array.isArray(value) || hasInvalidDemographicValue(demo)) return null;

  const facts = value.filter(isDemographicFactCandidate);
  const explicitDefinitions = demographicFactDefinitions.filter(({ field }) => parseDemographicCount(demo[field]) !== null);
  if (explicitDefinitions.length === 0) return null;
  for (const evidence of supportedDemographicEvidence) {
    const matchesAllExplicitValues = explicitDefinitions.every(({ field, value: factValue }) => {
      const count = parseDemographicCount(demo[field]);
      return facts.some(
        (fact) => fact.dimension === "residence_sex" && fact.value === factValue && fact.count === count && fact.provenance === evidence.provenance && fact.quality === evidence.quality,
      );
    });
    if (matchesAllExplicitValues) return evidence;
  }

  return null;
}

export function getDemographicEvidenceStatus(demo: DemoBreakdown): DemographicEvidenceStatus {
  const totals = getDemographicTotals(demo);
  const hasInvalidValue = hasInvalidDemographicValue(demo);
  const hasAnyValue = hasAnyDemographicValue(demo);
  const hasMissingValue = Object.values(demo).some((value) => value.trim() === "");
  let validationMessage: string | null = null;

  if (hasInvalidValue) {
    validationMessage = "Demographic facts must be whole numbers from 0 to 2,147,483,647.";
  }

  return {
    hasAnyValue,
    hasMissingValue,
    totals,
    validationMessage,
  };
}

function explicitSum(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

const supportedDemographicEvidence: DemographicEvidence[] = [CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE, { provenance: "operator_entered", quality: "degraded" }, ESTIMATED_OPERATOR_DEMOGRAPHIC_EVIDENCE];

function isDemographicFactCandidate(value: unknown): value is DemographicFact {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.dimension === "residence_sex" &&
    demographicFactDefinitions.some((definition) => definition.value === candidate.value) &&
    typeof candidate.count === "number" &&
    Number.isInteger(candidate.count) &&
    candidate.count >= 0 &&
    candidate.provenance === "operator_entered" &&
    supportedDemographicEvidence.some((evidence) => evidence.quality === candidate.quality)
  );
}
