import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportDraftActions } from "../../../../../../src/features/reports/components/ReportDraftActions";

const BLOCKED = "Submission opens on Dec 1, 2026 after the November 2026 reporting period closes.";

function render(props: Partial<Parameters<typeof ReportDraftActions>[0]> = {}) {
  return renderToStaticMarkup(<ReportDraftActions isReadOnly={false} isPeriodChanging={false} metricsError={null} validationError={null} onSubmitPrompt={() => undefined} {...props} />);
}

describe("ReportDraftActions", () => {
  it("names the button Submit Report by default and Submit Form in the form preview", () => {
    expect(render()).toContain("Submit Report</button>");
    const preview = render({ label: "Submit Form" });
    expect(preview).toContain("Submit Form</button>");
    expect(preview).not.toContain("Submit Report");
  });

  it("shows the button disabled with the reason beside it while submitting is not possible yet", () => {
    const markup = render({ label: "Submit Form", validationError: BLOCKED });
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain(BLOCKED);
    expect(markup).toMatch(/aria-describedby="[^"]+"/);
  });

  it("puts a metrics problem ahead of the form's own reason", () => {
    const markup = render({ metricsError: "TANAW could not load this month's counts.", validationError: BLOCKED });
    expect(markup).toContain("TANAW could not load this month&#x27;s counts.");
    expect(markup).not.toContain(BLOCKED);
  });

  it("shows nothing for a report already sent", () => {
    expect(render({ isReadOnly: true })).toBe("");
  });
});
