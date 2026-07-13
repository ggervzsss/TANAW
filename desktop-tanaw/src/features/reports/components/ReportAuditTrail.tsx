import { Activity } from "lucide-react";
import type { ReportRecord } from "../../../types/enterprise";

type ReportAuditTrailProps = {
  activeReport: ReportRecord | null;
};

export function ReportAuditTrail({ activeReport }: ReportAuditTrailProps) {
  if (!activeReport) return null;
  const durableEvents = activeReport.auditTrail ?? [];

  return (
    <div className="mt-8 border-t border-gray-200 pt-5">
      <h4 className="mb-4 flex items-center gap-2 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
        <Activity size={12} /> Durable Audit Events
      </h4>
      {durableEvents.length > 0 ? (
        <div className="space-y-4">
          {durableEvents.map((log, index) => (
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
      ) : (
        <p className="rounded-sm border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500">
          Durable server or ledger audit events are not available for this report. TANAW does not construct actors or timestamps on this device.
        </p>
      )}
    </div>
  );
}
