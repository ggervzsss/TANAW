import type { Dispatch, SetStateAction } from "react";
import type { DemoBreakdown } from "../../../types/enterprise";
import { demographicCount, getDemographicAllocationStatus, getDemographicTotals } from "../utils/demographics";

export const demographicGroups = [
  { id: "thisProvince", description: "Visitors whose residence is within this province.", femaleKey: "thisProvFemale", maleKey: "thisProvMale", title: "This Province", totalKey: "thisProvince" },
  { id: "otherProvince", description: "Visitors from another Philippine province.", femaleKey: "otherProvFemale", maleKey: "otherProvMale", title: "Other Province", totalKey: "otherProvince" },
  { id: "foreign", description: "Visitors whose residence is outside the Philippines.", femaleKey: "foreignFemale", maleKey: "foreignMale", title: "Foreign", totalKey: "foreign" },
] as const;
const groups = demographicGroups;

export type DemographicCategoryId = "thisProvince" | "otherProvince" | "foreign";
export type AssistedSettings = {
  categoryShares: Record<DemographicCategoryId, number>;
  maleShares: Record<DemographicCategoryId, number>;
};

export function updateDemographicValue(
  rawValue: string,
  field: keyof DemoBreakdown,
  setDemo: Dispatch<SetStateAction<DemoBreakdown>>,
  setInputNote: Dispatch<SetStateAction<string>>,
  uniqueCap: number,
) {
  const leadingDigits = rawValue.match(/^\d*/)?.[0] ?? "";
  const hasInvalidCharacters = rawValue !== leadingDigits;
  const hasNegativeSign = rawValue.includes("-");
  const requestedValue = leadingDigits ? Number.parseInt(leadingDigits, 10) : 0;

  setDemo((current) => {
    const currentFieldValue = demographicCount(current[field]);
    const currentTotalWithoutField = getDemographicAllocationStatus(current, uniqueCap).totals.grandTotal - currentFieldValue;
    const remaining = Math.max(0, uniqueCap - currentTotalWithoutField);
    const nextValue = Math.min(requestedValue, remaining);
    const nextDisplayValue = leadingDigits === "" ? "" : String(nextValue);

    if (leadingDigits !== "" && nextValue < requestedValue) {
      setInputNote("Adjusted to stay within the unique visitor count.");
    } else if (hasNegativeSign) {
      setInputNote("Negative values are not allowed.");
    } else if (hasInvalidCharacters) {
      setInputNote("Only whole numbers are allowed.");
    } else {
      setInputNote("");
    }

    return { ...current, [field]: nextDisplayValue };
  });
}

export function buildAssistedDemo(settings: AssistedSettings, uniqueCap: number): DemoBreakdown {
  const categoryTotals = distributeIntegerTotal(
    uniqueCap,
    groups.map((group) => settings.categoryShares[group.id]),
  );
  const nextDemo = emptyDemo();

  groups.forEach((group, index) => {
    const maleShare = settings.maleShares[group.id];
    const [male, female] = distributeIntegerTotal(categoryTotals[index], [maleShare, 100 - maleShare]);
    nextDemo[group.maleKey] = String(male);
    nextDemo[group.femaleKey] = String(female);
  });

  return nextDemo;
}

export function fillRemainingDemographics(demo: DemoBreakdown, settings: AssistedSettings, uniqueCap: number) {
  const lockedFields = new Set<keyof DemoBreakdown>();
  const weights: number[] = [];
  const fields: (keyof DemoBreakdown)[] = [];

  for (const group of groups) {
    const categoryShare = settings.categoryShares[group.id];
    const maleShare = settings.maleShares[group.id];
    fields.push(group.maleKey, group.femaleKey);
    weights.push(categoryShare * maleShare, categoryShare * (100 - maleShare));

    if (demo[group.maleKey].trim() !== "") lockedFields.add(group.maleKey);
    if (demo[group.femaleKey].trim() !== "") lockedFields.add(group.femaleKey);
  }

  const lockedTotal = fields.reduce((total, field) => total + (lockedFields.has(field) ? demographicCount(demo[field]) : 0), 0);
  const remaining = Math.max(0, uniqueCap - lockedTotal);

  if (lockedTotal >= uniqueCap) {
    return {
      demo,
      message: lockedTotal === uniqueCap ? "No remaining visitors to allocate." : "Manual values already exceed the unique visitor count.",
    };
  }

  const unlockedFields = fields.filter((field) => !lockedFields.has(field));
  if (unlockedFields.length === 0) {
    return { demo, message: "Clear a field before filling the remaining visitors." };
  }

  const unlockedWeights = fields.map((field, index) => (lockedFields.has(field) ? 0 : weights[index]));
  const allocatedValues = distributeIntegerTotal(remaining, unlockedWeights);
  const nextDemo = { ...demo };

  fields.forEach((field, index) => {
    if (!lockedFields.has(field)) {
      nextDemo[field] = String(allocatedValues[index]);
    }
  });

  return { demo: nextDemo, message: "Remaining visitors filled from the assisted mix." };
}

export function settingsFromDemo(demo: DemoBreakdown, fallback: AssistedSettings): AssistedSettings {
  const totals = getDemographicTotals(demo);
  if (totals.grandTotal === 0) return fallback;

  return {
    categoryShares: {
      foreign: percentOf(totals.foreign, totals.grandTotal),
      otherProvince: percentOf(totals.otherProvince, totals.grandTotal),
      thisProvince: percentOf(totals.thisProvince, totals.grandTotal),
    },
    maleShares: {
      foreign: percentOf(demographicCount(demo.foreignMale), totals.foreign),
      otherProvince: percentOf(demographicCount(demo.otherProvMale), totals.otherProvince),
      thisProvince: percentOf(demographicCount(demo.thisProvMale), totals.thisProvince),
    },
  };
}

function distributeIntegerTotal(total: number, weights: number[]) {
  const normalizedTotal = Math.max(0, Math.floor(total));
  const positiveWeights = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const weightTotal = groupTotal(positiveWeights);
  const effectiveWeights = weightTotal > 0 ? positiveWeights : weights.map(() => 1);
  const effectiveTotal = groupTotal(effectiveWeights);
  const allocations = effectiveWeights.map((weight, index) => {
    const exact = effectiveTotal > 0 ? (normalizedTotal * weight) / effectiveTotal : 0;
    return {
      floor: Math.floor(exact),
      index,
      remainder: exact - Math.floor(exact),
    };
  });
  let remaining = normalizedTotal - groupTotal(allocations.map((allocation) => allocation.floor));
  const result = allocations.map((allocation) => allocation.floor);
  const byRemainder = [...allocations].sort((first, second) => second.remainder - first.remainder || first.index - second.index);

  for (const allocation of byRemainder) {
    if (remaining <= 0) break;
    result[allocation.index] += 1;
    remaining -= 1;
  }

  return result;
}

function percentOf(value: number, total: number) {
  if (total <= 0) return 50;
  return clampPercentage(Math.round((value / total) * 100));
}

export function groupTotal(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export function clampPercentage(value: string | number) {
  const numericValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.min(100, numericValue));
}

function emptyDemo(): DemoBreakdown {
  return {
    foreignFemale: "",
    foreignMale: "",
    otherProvFemale: "",
    otherProvMale: "",
    thisProvFemale: "",
    thisProvMale: "",
  };
}
