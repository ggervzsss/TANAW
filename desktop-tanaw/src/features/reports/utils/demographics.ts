import type { DemoBreakdown } from "../../../types/enterprise";

export type DemographicTotals = {
  female: number;
  foreign: number;
  grandTotal: number;
  male: number;
  otherProvince: number;
  thisProvince: number;
};

export type DemographicAllocationStatus = {
  cap: number;
  excess: number;
  isComplete: boolean;
  isOverCap: boolean;
  remaining: number;
  totals: DemographicTotals;
  validationMessage: string | null;
};

export function demographicCount(value: string) {
  const normalized = value.trim();
  return /^\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : 0;
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

export function hasInvalidDemographicValue(demo: DemoBreakdown) {
  return Object.values(demo).some((value) => value.trim() !== "" && !/^\d+$/.test(value.trim()));
}

export function getDemographicAllocationStatus(demo: DemoBreakdown, uniqueCap: number): DemographicAllocationStatus {
  const cap = Math.max(0, uniqueCap);
  const totals = getDemographicTotals(demo);
  const remaining = Math.max(0, cap - totals.grandTotal);
  const excess = Math.max(0, totals.grandTotal - cap);
  const hasInvalidValue = hasInvalidDemographicValue(demo);
  let validationMessage: string | null = null;

  if (hasInvalidValue) {
    validationMessage = "Demographics values must be non-negative whole numbers.";
  } else if (excess > 0) {
    validationMessage = "Demographic totals cannot exceed the unique visitor count.";
  } else if (remaining > 0) {
    validationMessage = `Allocate all unique visitors before finalizing this report. Remaining to allocate: ${remaining.toLocaleString()}.`;
  }

  return {
    cap,
    excess,
    isComplete: !hasInvalidValue && totals.grandTotal === cap,
    isOverCap: excess > 0,
    remaining,
    totals,
    validationMessage,
  };
}
