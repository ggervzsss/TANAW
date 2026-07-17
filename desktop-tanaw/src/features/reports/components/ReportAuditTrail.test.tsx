import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReportRecord } from "../../../types/enterprise";
import { ReportAuditTrail } from "./ReportAuditTrail";

describe("ReportAuditTrail", () => {
  it("shows an unavailable state without inventing an actor or timestamp", () => {
    const markup = renderToStaticMarkup(<ReportAuditTrail activeReport={report()} />);

    expect(markup).toContain("No review history is available");
    expect(markup).not.toContain("Enterprise User");
    expect(markup).not.toContain("LGU Staff");
    expect(markup).not.toContain("Jul 01, 2026");
  });

  it("renders an exact durable event without replacing its actor or timestamp", () => {
    const activeReport = report();
    activeReport.auditTrail = [
      {
        action: "Revision accepted",
        actor: "Maria Santos",
        time: "2026-07-01T02:03:04Z",
      },
    ];

    const markup = renderToStaticMarkup(<ReportAuditTrail activeReport={activeReport} />);

    expect(markup).toContain("Revision accepted");
    expect(markup).toContain("Maria Santos");
    expect(markup).toContain("2026-07-01T02:03:04Z");
  });
});

function report(): ReportRecord {
  return {
    id: "REP-1",
    date: "June 2026",
    status: "Submitted",
    entries: 12,
    unique: 10,
  };
}
