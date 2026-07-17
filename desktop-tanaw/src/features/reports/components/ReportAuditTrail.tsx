import { Activity } from "lucide-react";
import type { ReportRecord } from "../../../types/enterprise";

type ReportAuditTrailProps = {
  activeReport: ReportRecord | null;
};

export function ReportAuditTrail({ activeReport }: ReportAuditTrailProps) {
  if (!activeReport) return null;
  const durableEvents = activeReport.auditTrail ?? [];

  return (
    <details className="mt-6 rounded-sm border border-gray-200 bg-gray-50">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[10px] font-bold tracking-wider text-gray-600 uppercase">
        <Activity size={12} /> Audit details
      </summary>
      <div className="border-t border-gray-200 bg-white p-3">
        {durableEvents.length > 0 ? (
          <div className="space-y-4">
            {durableEvents.map((log, index) => (
              <div key={`${log.time}-${index}`} className="flex gap-3 text-xs">
                <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#065f46]"></div>
                <div>
                  <p className="font-semibold text-[#111827]">{log.action}</p>
                  <p className="mt-0.5 text-gray-500">
                    {log.time} • by <span className="font-medium text-gray-700">{log.actor}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs font-semibold text-gray-500">No review history is available for this report.</p>
        )}
      </div>
    </details>
  );
}
