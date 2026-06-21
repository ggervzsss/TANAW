import { Activity } from "lucide-react";
import type { ReportRecord } from "../../../types/enterprise";

type ReportAuditTrailProps = {
  activeReport: ReportRecord | null;
};

export function ReportAuditTrail({ activeReport }: ReportAuditTrailProps) {
  if (!activeReport?.auditTrail) return null;

  return (
    <div className="mt-8 border-t border-gray-200 pt-5">
      <h4 className="mb-4 flex items-center gap-2 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
        <Activity size={12} /> Interaction Audit Trail
      </h4>
      <div className="space-y-4">
        {activeReport.auditTrail.map((log, index) => (
          <div key={`${log.time}-${index}`} className="flex gap-3 text-xs">
            <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#065f46] shadow-[0_0_4px_#065f46]"></div>
            <div>
              <p className="font-semibold text-[#111827]">{log.action}</p>
              <p className="mt-0.5 text-gray-500">
                {log.time} • by <span className="font-medium text-gray-700">{log.actor}</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
