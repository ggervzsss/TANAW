import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SubmitReportDialog } from "../../../../../../src/features/reports/components/SubmitReportDialog";
import type { ReportDay } from "../../../../../../src/features/reports/model/daily-origins";
import type { DemoBreakdown } from "../../../../../../src/types/enterprise";

vi.mock("../../../../../../src/ui-kit/components/ModalPortal", () => ({
  ModalPortal: ({ children }: { children: ReactNode }) => children,
}));

const demo: DemoBreakdown = {
  thisCityMale: "500",
  thisCityFemale: "480",
  thisCityUnspecified: "20",
  thisProvMale: "560",
  thisProvFemale: "540",
  thisProvUnspecified: "20",
  otherProvMale: "60",
  otherProvFemale: "40",
  foreignMale: "8",
  foreignFemale: "6",
};
const days = [{ unique: 40 }, { unique: null }, { unique: 30 }] as ReportDay[];
const props = {
  period: "October 2026",
  metrics: { entries: 1300, exits: 1290, peak: 80, unique: 1234 },
  demo,
  days,
  onCancel: () => undefined,
  onConfirm: () => undefined,
};
const render = (extra: Partial<Parameters<typeof SubmitReportDialog>[0]> = {}) => renderToStaticMarkup(<SubmitReportDialog {...props} isSubmitting={false} {...extra} />);

describe("SubmitReportDialog", () => {
  it("asks in plain words, with the report's real figures and what happens next", () => {
    const markup = render();
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Send your October 2026 report to the LGU?");
    for (const text of ["Reporting period", "Visitors counted", "1,234", "This city", "1,000", "Other cities in the province", "120", "Other provinces", "100", "Foreign", "14"])
      expect(markup).toContain(text);
    expect(markup).toContain("3 days · 2 with visitors counted");
    expect(markup).toContain("After you send it, you can&#x27;t edit this report. If something is wrong, LGU Staff can return it to you for correction.");
    expect(markup).toContain("Staff in the City Tourism Office will review it.");
    // Cancel comes first and takes focus; the one primary action sends.
    expect(markup.indexOf("Cancel")).toBeLessThan(markup.indexOf("Send report"));
    expect(markup).toContain("data-submit-cancel");
    // The old hard-coded colours and thick top border are gone.
    for (const old of ["bg-white", "#111827", "#121c31", "border-t-4"]) expect(markup).not.toContain(old);
  });

  it("names a correction and the version it will be sent as", () => {
    const markup = render({ correction: { version: 2, previousId: "REP-OCT-1" } });
    expect(markup).toContain("Send the corrected October 2026 report?");
    expect(markup).toContain("It corrects REP-OCT-1 and goes as version 2.");
    expect(markup).toContain("Version 2");
  });

  it("cannot be dismissed while sending, and shows why the last attempt failed", () => {
    const sending = render({ isSubmitting: true });
    expect(sending).toMatch(/<button[^>]*aria-label="Close dialog"[^>]*disabled=""/);
    expect(sending).toContain('aria-busy="true"');

    const failed = render({ issue: { message: "Report not sent. TANAW's counting service on this computer is not responding. Wait a moment, then try again.", canRetry: true } });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("is not responding");
    expect(failed).toContain("Try again");
    expect(render({ issue: { message: "Report not sent. The figures changed.", canRetry: false } })).toContain("Send report");
  });
});
