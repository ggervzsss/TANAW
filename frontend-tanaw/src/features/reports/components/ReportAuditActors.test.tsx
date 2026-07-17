import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { EnterpriseReportDetail, FinalReportDetail } from "@/shared/types";
import { enterpriseReportDetailFixture, finalReportDetailFixture } from "../testFixtures";
import { FinalReportViewer } from "./FinalReportViewer";
import { ReportReviewModal } from "./ReportReviewModal";

const detailState = vi.hoisted(() => ({
  enterprise: null as EnterpriseReportDetail | null,
  final: null as FinalReportDetail | null,
}));

vi.mock("@/shared/components/ui", () => ({ ModalPortal: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/shared/hooks/useReportWorkflow", () => ({
  useEnterpriseReportDetail: () => ({ data: detailState.enterprise, isLoading: false, isError: false }),
  useFinalReportDetail: () => ({ data: detailState.final, isLoading: false, isError: false }),
}));
vi.mock("react-hot-toast/headless", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

describe("report audit actor presentation", () => {
  it("does not manufacture a system actor for missing report-review metadata", () => {
    const report = enterpriseReportDetailFixture();
    report.reviewEvents[0]!.actor = { accountId: null, displayName: null, role: null };
    detailState.enterprise = report;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ReportReviewModal enterpriseReportId={report.enterpriseReportId} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(html).toContain("Staff member not recorded");
    expect(html).toContain("Role not recorded");
    expect(html).not.toContain("System actor");
  });

  it("does not manufacture a system actor for missing finalization metadata", () => {
    const report = finalReportDetailFixture();
    report.events[0] = { ...report.events[0]!, actorAccountId: null, actorDisplayName: null, actorRole: null };
    detailState.final = report;

    const html = renderToStaticMarkup(<FinalReportViewer reportFinalizationId={report.reportFinalizationId} onClose={vi.fn()} />);

    expect(html).toContain("Actor not recorded");
    expect(html).toContain("Role not recorded");
    expect(html).not.toContain("System actor");
    expect(html).toContain("Official PDF");
    expect(html).toContain("Download verified official PDF");
    expect(html).not.toContain("Snapshot PDF");
  });
});
