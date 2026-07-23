import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SubmitReportDialog } from "./SubmitReportDialog";

vi.mock("../../../components/ModalPortal", () => ({
  ModalPortal: ({ children }: { children: React.ReactNode }) => children,
}));

describe("SubmitReportDialog", () => {
  it("contains semantic light and dark confirmation styles without changing its actions", () => {
    const markup = renderToStaticMarkup(<SubmitReportDialog isSubmitting={false} onCancel={() => undefined} onConfirm={() => undefined} />);
    expect(markup).toContain("aria-modal=\"true\"");
    expect(markup).toContain("dark:bg-[#121c31]");
    expect(markup).toContain("dark:text-slate-100");
    expect(markup).toContain("Edit Draft");
    expect(markup).toContain("Yes, Submit");
  });
});
