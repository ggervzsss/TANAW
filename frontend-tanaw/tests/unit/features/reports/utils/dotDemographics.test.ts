import { describe, expect, it } from "vitest";
import { getDotDemographics } from "../../../../../src/features/reports/utils/dotDemographics";

describe("DOT demographics from a submitted report", () => {
  it("counts This Province visitors without a recorded sex in the province total only", () => {
    const demographics = getDotDemographics(50, {
      thisProvMale: 1,
      thisProvFemale: 1,
      thisProvUnspecified: 45,
      otherProvMale: 0,
      otherProvFemale: 2,
      foreignMale: 1,
      foreignFemale: 0,
    });
    expect(demographics).toMatchObject({ provMale: 1, provFemale: 1, provTotal: 47, otherTotal: 2, foreignTotal: 1, grandMale: 2, grandFemale: 3 });
  });

  it("keeps reports without the unspecified count unchanged", () => {
    const demographics = getDotDemographics(6, { thisProvMale: 1, thisProvFemale: 1, otherProvMale: 1, otherProvFemale: 1, foreignMale: 1, foreignFemale: 1 });
    expect(demographics.provTotal).toBe(2);
  });
});
