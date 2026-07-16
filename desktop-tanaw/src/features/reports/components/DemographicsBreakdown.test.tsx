import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DemoBreakdown } from "../../../types/enterprise";
import { DemographicsBreakdown } from "./DemographicsBreakdown";

describe("DemographicsBreakdown", () => {
  it("offers manual and assisted entry while rendering missing totals as Not provided", () => {
    const markup = renderToStaticMarkup(
      <DemographicsBreakdown demo={emptyDemo()} demographicEvidence={null} isReadOnly={false} setDemo={() => undefined} setDemographicEvidence={() => undefined} uniqueCount={100} />,
    );

    expect(markup).toContain("Manual");
    expect(markup).toContain("Assisted");
    expect(markup).toContain("Not provided");
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
