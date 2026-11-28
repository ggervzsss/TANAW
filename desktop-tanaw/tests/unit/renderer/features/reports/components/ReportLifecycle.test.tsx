import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportDraftActions } from "../../../../../../src/features/reports/components/ReportDraftActions";
import { ReportLifecycleBanner, ReportStatusLine } from "../../../../../../src/features/reports/components/ReportLifecycle";
import { reportLifecycle } from "../../../../../../src/features/reports/model/report-lifecycle";
import type { ReportRecord } from "../../../../../../src/types/enterprise";

const sent: ReportRecord = { id: "REP-OCT-1", date: "October 2026", period: "October 2026", status: "Submitted", entries: 10, unique: 8, submittedAt: "2026-11-03T08:12:00Z", syncStatus: "synced" };
const banner = (report: ReportRecord | null, reports: ReportRecord[]) =>
  renderToStaticMarkup(
    <ReportLifecycleBanner
      lifecycle={reportLifecycle(report, reports, "October 2026")}
      reports={reports}
      timeFormat="12-hour"
      reopeningReportId={null}
      reopenIssue={null}
      onCorrect={() => undefined}
      onAskForHelp={() => undefined}
    />,
  );

describe("report lifecycle", () => {
  it("keeps a calm sent confirmation with Staff's review state under the title", () => {
    const markup = renderToStaticMarkup(<ReportStatusLine lifecycle={reportLifecycle(sent, [sent], "October 2026")} timeFormat="12-hour" />).replace(/\s/g, " ");
    expect(markup).toContain("Sent on Nov 3, 2026 at 4:12 PM · Reference REP-OCT-1");
    expect(markup).toContain("Waiting for Staff review");
    expect(banner(sent, [sent])).toBe("");
  });

  it("shows who returned the report and why, with one way to correct it", () => {
    const returned = { ...sent, status: "Returned", reviewStatus: "Returned" as const, returnedBy: "Ana Cruz", returnedAt: "2026-11-05T02:00:00Z", returnedReason: "Foreign visitors look too high." };
    const markup = banner(returned, [returned]);
    expect(markup).toContain("Returned for correction by Ana Cruz on Nov 5, 2026");
    expect(markup).toContain("<blockquote>Foreign visitors look too high.</blockquote>");
    expect(markup).toContain("Correct and send again");
    // While it is corrected, the reason stays in view without the button.
    const correcting = banner(null, [{ ...returned, reopenedAt: "2026-11-06T00:00:00Z" }]);
    expect(correcting).toContain("You are correcting the October 2026 report");
    expect(correcting).toContain("Foreign visitors look too high.");
    expect(correcting).toContain("version 2");
    expect(correcting).not.toContain("Correct and send again");
  });

  it("explains a refused upload with TANAW's message, a fix and a way to ask IT", () => {
    const refused = { ...sent, syncStatus: "upload_rejected", rejectionReason: "Totals do not match the counts." };
    const markup = banner(refused, [refused]);
    expect(markup).toContain("TANAW did not accept this report");
    expect(markup).toContain("Totals do not match the counts.");
    expect(markup.indexOf("Fix and send again")).toBeLessThan(markup.indexOf("Ask IT for help"));
  });

  it("keeps a submit blocker beside the button instead of in a toast", () => {
    const blocker = "Submission opens on Dec 1, 2026 after the November 2026 reporting period closes.";
    const markup = renderToStaticMarkup(<ReportDraftActions isReadOnly={false} isPeriodChanging={false} metricsError={null} validationError={blocker} onSubmitPrompt={() => undefined} />);
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toMatch(/aria-describedby="([^"]+)"[\s\S]*id="\1"/);
    expect(markup).toContain(blocker);
  });
});
