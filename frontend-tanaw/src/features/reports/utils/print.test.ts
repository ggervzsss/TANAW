import { describe, expect, it } from "vitest";
import { buildOfficialReportPrintDocument } from "./print";

describe("official report printing", () => {
  it("builds an isolated light document without inheriting the portal theme", () => {
    const html = buildOfficialReportPrintDocument({
      markup: '<section class="official-report-document dark:bg-slate-950">Official totals</section>',
      title: "CON-JUN-2026",
    });

    expect(html).toContain('data-report-theme="light"');
    expect(html).toContain("background: #ffffff !important");
    expect(html).toContain("color: #111827 !important");
    expect(html).toContain("size: A4 landscape");
    expect(html).toContain("tanaw-report-final-total-cell");
    expect(html).toContain("Official totals");
    expect(html).not.toContain('<html class="dark"');
  });
});
