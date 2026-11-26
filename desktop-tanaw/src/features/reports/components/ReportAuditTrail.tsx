import { Activity } from "lucide-react";
import type { ReportRecord } from "../../../types/enterprise";

type ReportAuditTrailProps = {
  activeReport: ReportRecord | null;
};

export function ReportAuditTrail({ activeReport }: ReportAuditTrailProps) {
  if (!activeReport?.auditTrail) return null;

  return (
    <div className="report-audit-trail">
      <h4>
        <Activity size={14} aria-hidden="true" /> Interaction Audit Trail
      </h4>
      <ol>
        {activeReport.auditTrail.map((log, index) => (
          <li key={`${log.time}-${index}`}>
            <p className="report-audit-trail__action">{log.action}</p>
            <p className="report-audit-trail__meta">
              {log.time} • by <span>{log.actor}</span>
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
