import { describe, expect, it } from "vitest";
import { combineDotDemographics, dotDemographicValue, getDotDemographics } from "./dotDemographics";

describe("getDotDemographics", () => {
  it("keeps absent demographics unknown instead of synthesizing a residence split", () => {
    const result = getDotDemographics(100, null);

    expect(result).toEqual({ status: "not-provided", label: "Not provided", values: null });
    expect(dotDemographicValue(result, "provMale")).toBe("Not provided");
  });

  it("marks partial or non-reconciling demographics incomplete", () => {
    expect(getDotDemographics(100, { thisProvMale: 10 })).toEqual({ status: "incomplete", label: "Incomplete", values: null });
    expect(
      getDotDemographics(100, {
        thisProvMale: 10,
        thisProvFemale: 10,
        otherProvMale: 10,
        otherProvFemale: 10,
        foreignMale: 10,
        foreignFemale: 10,
      }),
    ).toEqual({ status: "incomplete", label: "Incomplete", values: null });
  });

  it("derives DOT totals only from a complete submitted set that reconciles", () => {
    const result = getDotDemographics(100, {
      thisProvMale: 20,
      thisProvFemale: 30,
      otherProvMale: 15,
      otherProvFemale: 10,
      foreignMale: 10,
      foreignFemale: 15,
    });

    expect(result).toEqual({
      status: "recorded",
      label: "Recorded",
      values: {
        provMale: 20,
        provFemale: 30,
        provTotal: 50,
        otherMale: 15,
        otherFemale: 10,
        otherTotal: 25,
        foreignMale: 10,
        foreignFemale: 15,
        foreignTotal: 25,
        grandMale: 45,
        grandFemale: 55,
      },
    });
  });
});

describe("combineDotDemographics", () => {
  it("does not present a partial demographic aggregate as complete", () => {
    const recorded = getDotDemographics(10, {
      thisProvMale: 2,
      thisProvFemale: 2,
      otherProvMale: 2,
      otherProvFemale: 2,
      foreignMale: 1,
      foreignFemale: 1,
    });

    expect(combineDotDemographics([recorded, getDotDemographics(20, null)])).toEqual({ status: "incomplete", label: "Incomplete", values: null });
    expect(combineDotDemographics([getDotDemographics(10, null), getDotDemographics(20, null)])).toEqual({ status: "not-provided", label: "Not provided", values: null });
  });
});
