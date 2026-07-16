import { describe, expect, it } from "vitest";
import type { DemoBreakdown } from "../../../types/enterprise";
import {
  buildDemographicFacts,
  CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE,
  demographicEvidenceFromFacts,
  formatDemographicValue,
  getDemographicEvidenceStatus,
  getExplicitDemographicTotals,
  ESTIMATED_OPERATOR_DEMOGRAPHIC_EVIDENCE,
} from "./demographics";

describe("demographic evidence", () => {
  it("keeps missing counts unknown instead of converting them to zero or a ratio", () => {
    const demo = emptyDemo();

    expect(getExplicitDemographicTotals(demo)).toEqual({
      female: null,
      foreign: null,
      grandTotal: null,
      male: null,
      otherProvince: null,
      thisProvince: null,
    });
    expect(formatDemographicValue(null)).toBe("Not provided");
    expect(buildDemographicFacts(demo, null)).toEqual([]);
    expect(getDemographicEvidenceStatus(demo)).toMatchObject({
      hasAnyValue: false,
      hasMissingValue: true,
      validationMessage: null,
    });
  });

  it("preserves explicit operator facts, including an observed zero", () => {
    const demo: DemoBreakdown = {
      thisProvMale: "4",
      thisProvFemale: "3",
      otherProvMale: "2",
      otherProvFemale: "1",
      foreignMale: "0",
      foreignFemale: "2",
    };

    const facts = buildDemographicFacts(demo, CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE);

    expect(facts).toHaveLength(6);
    expect(facts).toContainEqual({
      count: 0,
      dimension: "residence_sex",
      provenance: "operator_entered",
      quality: "confirmed",
      value: "foreign_male",
    });
    expect(getExplicitDemographicTotals(demo).grandTotal).toBe(12);
    expect(demographicEvidenceFromFacts(facts, demo)).toEqual(CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE);
  });

  it("does not infer evidence metadata from raw counts", () => {
    const demo: DemoBreakdown = {
      thisProvMale: "1",
      thisProvFemale: "1",
      otherProvMale: "1",
      otherProvFemale: "1",
      foreignMale: "1",
      foreignFemale: "1",
    };

    expect(buildDemographicFacts(demo, null)).toEqual([]);
    expect(demographicEvidenceFromFacts([], demo)).toBeNull();
  });

  it("preserves an assisted allocation as operator-entered estimated facts", () => {
    const demo: DemoBreakdown = {
      thisProvMale: "30",
      thisProvFemale: "30",
      otherProvMale: "15",
      otherProvFemale: "15",
      foreignMale: "5",
      foreignFemale: "5",
    };

    const facts = buildDemographicFacts(demo, ESTIMATED_OPERATOR_DEMOGRAPHIC_EVIDENCE);

    expect(facts).toHaveLength(6);
    expect(facts.every((fact) => fact.provenance === "operator_entered" && fact.quality === "estimated")).toBe(true);
    expect(demographicEvidenceFromFacts(facts, demo)).toEqual(ESTIMATED_OPERATOR_DEMOGRAPHIC_EVIDENCE);
  });

  it("preserves only entered partial facts without allocating the unique-count difference", () => {
    const demo = emptyDemo();
    demo.thisProvFemale = "2";
    demo.foreignMale = "0";

    const facts = buildDemographicFacts(demo, CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE);

    expect(facts).toEqual([
      {
        count: 2,
        dimension: "residence_sex",
        provenance: "operator_entered",
        quality: "confirmed",
        value: "this_province_female",
      },
      {
        count: 0,
        dimension: "residence_sex",
        provenance: "operator_entered",
        quality: "confirmed",
        value: "foreign_male",
      },
    ]);
    expect(getDemographicEvidenceStatus(demo).validationMessage).toBeNull();
    expect(demographicEvidenceFromFacts(facts, demo)).toEqual(CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE);
  });

  it("does not treat the camera unique estimate as a demographic cap", () => {
    const demo = emptyDemo();
    demo.thisProvMale = "900";

    expect(getDemographicEvidenceStatus(demo).validationMessage).toBeNull();
    expect(buildDemographicFacts(demo, CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE)[0]?.count).toBe(900);
  });

  it("rejects counts outside the database integer range", () => {
    const demo = emptyDemo();
    demo.thisProvMale = "2147483648";

    expect(getDemographicEvidenceStatus(demo).validationMessage).toContain("2,147,483,647");
    expect(buildDemographicFacts(demo, CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE)).toEqual([]);
  });
});

function emptyDemo(): DemoBreakdown {
  return {
    thisProvMale: "",
    thisProvFemale: "",
    otherProvMale: "",
    otherProvFemale: "",
    foreignMale: "",
    foreignFemale: "",
  };
}
