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

  it("offers no way to reopen a report TANAW accepted, whatever Staff's review says", () => {
    const accepted = { ...sent, reviewStatus: "Ready to Consolidate" as const };
    expect(banner(accepted, [accepted])).toBe("");
    const markup = renderToStaticMarkup(<ReportStatusLine lifecycle={reportLifecycle(accepted, [accepted], "October 2026")} timeFormat="12-hour" />);
    expect(markup).toContain("Accepted by Staff");
    expect(markup).not.toContain("Version");
  });

  it("explains a refused upload with TANAW's message, a fix and a way to ask IT", () => {
    const refused = { ...sent, syncStatus: "upload_rejected", rejectionReason: "Totals do not match the counts." };
    const markup = banner(refused, [refused]);
    expect(markup).toContain("TANAW did not accept this report");
    expect(markup).toContain("<blockquote>Totals do not match the counts.</blockquote>");
    expect(markup.indexOf("Fix and send again")).toBeLessThan(markup.indexOf("Ask IT for help"));
    // While it is fixed, TANAW's reason stays in view without the button.
    const fixing = banner(null, [{ ...refused, reopenedAt: "2026-11-06T00:00:00Z" }]);
    expect(fixing).toContain("You are fixing the October 2026 report TANAW did not accept");
    expect(fixing).toContain("Totals do not match the counts.");
    expect(fixing).not.toContain("Fix and send again");
  });

  it("keeps a submit blocker beside the button instead of in a toast", () => {
    const blocker = "Submission opens on Dec 1, 2026 after the November 2026 reporting period closes.";
    const markup = renderToStaticMarkup(<ReportDraftActions isReadOnly={false} isPeriodChanging={false} metricsError={null} validationError={blocker} onSubmitPrompt={() => undefined} />);
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toMatch(/aria-describedby="([^"]+)"[\s\S]*id="\1"/);
    expect(markup).toContain(blocker);
  });
});
