import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportingPeriodField } from "./ReportingPeriodField";

describe("ReportingPeriodField", () => {
  it("renders the canonical month and year label", () => {
    const markup = renderToStaticMarkup(<ReportingPeriodField description="Prepared counts" label="Current Reporting Period" period="June 2026" />);

    expect(markup).toContain("June 2026");
    expect(markup).not.toContain("Jun 1 - Jun 30, 2026");
  });
});
