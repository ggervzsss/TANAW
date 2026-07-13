import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DemoBreakdown } from "../../../types/enterprise";
import { DemographicsBreakdown } from "./DemographicsBreakdown";

describe("DemographicsBreakdown", () => {
  it("offers manual facts only and renders missing totals as Not provided", () => {
    const markup = renderToStaticMarkup(<DemographicsBreakdown demo={emptyDemo()} demographicEvidence={null} isReadOnly={false} setDemo={() => undefined} setDemographicEvidence={() => undefined} />);

    expect(markup).toContain("Leave unknown values blank");
    expect(markup).toContain("Not provided");
    expect(markup).not.toContain("Assisted");
    expect(markup).not.toContain("Fill Remaining");
    expect(markup).not.toContain("50%");
    expect(markup).not.toContain("Unique cap");
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
