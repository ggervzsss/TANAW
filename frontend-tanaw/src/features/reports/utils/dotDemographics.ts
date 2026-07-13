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

export type DotDemographicsResult =
  | {
      status: "recorded";
      label: "Recorded";
      values: DotDemographics;
    }
  | {
      status: "not-provided";
      label: "Not provided";
      values: null;
    }
  | {
      status: "incomplete";
      label: "Incomplete";
      values: null;
    };

const DEMOGRAPHIC_FIELDS: (keyof ReportDemographics)[] = ["thisProvMale", "thisProvFemale", "otherProvMale", "otherProvFemale", "foreignMale", "foreignFemale"];

export function getDotDemographics(total: number, submitted?: Partial<Record<keyof ReportDemographics, number | string>> | null): DotDemographicsResult {
  if (!submitted || !DEMOGRAPHIC_FIELDS.some((field) => submitted[field] !== undefined)) {
    return missingDemographics("not-provided");
  }

  const values = DEMOGRAPHIC_FIELDS.reduce<Partial<Record<keyof ReportDemographics, number>>>((next, field) => {
    const value = nonNegativeInteger(submitted[field]);
    if (value !== null) next[field] = value;
    return next;
  }, {});

  if (!DEMOGRAPHIC_FIELDS.every((field) => typeof values[field] === "number")) {
    return missingDemographics("incomplete");
  }

  const thisProvMale = values.thisProvMale ?? 0;
  const thisProvFemale = values.thisProvFemale ?? 0;
  const otherProvMale = values.otherProvMale ?? 0;
  const otherProvFemale = values.otherProvFemale ?? 0;
  const foreignMale = values.foreignMale ?? 0;
  const foreignFemale = values.foreignFemale ?? 0;
  const submittedTotal = thisProvMale + thisProvFemale + otherProvMale + otherProvFemale + foreignMale + foreignFemale;

  if (!Number.isInteger(total) || total < 0 || submittedTotal !== total) {
    return missingDemographics("incomplete");
  }

  return {
    status: "recorded",
    label: "Recorded",
    values: {
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
    },
  };
}

export function combineDotDemographics(results: DotDemographicsResult[]): DotDemographicsResult {
  if (results.length === 0 || results.every((result) => result.status === "not-provided")) {
    return missingDemographics("not-provided");
  }

  if (!results.every((result): result is Extract<DotDemographicsResult, { status: "recorded" }> => result.status === "recorded")) {
    return missingDemographics("incomplete");
  }

  const values = results.reduce<DotDemographics>(
    (total, result) => ({
      provMale: total.provMale + result.values.provMale,
      provFemale: total.provFemale + result.values.provFemale,
      provTotal: total.provTotal + result.values.provTotal,
      otherMale: total.otherMale + result.values.otherMale,
      otherFemale: total.otherFemale + result.values.otherFemale,
      otherTotal: total.otherTotal + result.values.otherTotal,
      foreignMale: total.foreignMale + result.values.foreignMale,
      foreignFemale: total.foreignFemale + result.values.foreignFemale,
      foreignTotal: total.foreignTotal + result.values.foreignTotal,
      grandMale: total.grandMale + result.values.grandMale,
      grandFemale: total.grandFemale + result.values.grandFemale,
    }),
    emptyDemographics(),
  );

  return { status: "recorded", label: "Recorded", values };
}

export function dotDemographicValue(result: DotDemographicsResult, field: keyof DotDemographics): number | string {
  return result.values?.[field] ?? result.label;
}

function missingDemographics(status: "not-provided" | "incomplete"): DotDemographicsResult {
  return status === "not-provided" ? { status, label: "Not provided", values: null } : { status, label: "Incomplete", values: null };
}

function emptyDemographics(): DotDemographics {
  return {
    provMale: 0,
    provFemale: 0,
    provTotal: 0,
    otherMale: 0,
    otherFemale: 0,
    otherTotal: 0,
    foreignMale: 0,
    foreignFemale: 0,
    foreignTotal: 0,
    grandMale: 0,
    grandFemale: 0,
  };
}

function nonNegativeInteger(value: number | string | undefined) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}
