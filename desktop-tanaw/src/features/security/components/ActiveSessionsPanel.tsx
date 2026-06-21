import { Monitor, MonitorSmartphone } from "lucide-react";
import { Card } from "../../../components/Card";

export function ActiveSessionsPanel() {
  return (
    <Card className="rounded-[28px] border-emerald-100/80 p-6 shadow-[0_18px_44px_rgba(15,23,42,0.07)]">
      <div className="mb-5 flex items-center justify-between border-b border-emerald-100 pb-3">
        <h3 className="flex items-center gap-2 text-sm font-bold tracking-wider text-[#111827] uppercase">
          <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-emerald-50 text-[#065f46]">
            <MonitorSmartphone size={16} />
          </span>
          Active Sessions
        </h3>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
            <tr>
              <th className="border-b border-gray-200 p-3">Device</th>
              <th className="border-b border-gray-200 p-3">Location</th>
              <th className="border-b border-gray-200 p-3">Last Active</th>
              <th className="border-b border-gray-200 p-3">IP Address</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="flex items-center gap-2 p-3 font-semibold text-[#111827]">
                <Monitor size={14} className="text-[#065f46]" /> Enterprise Desktop (Current)
              </td>
              <td className="p-3 font-medium text-gray-600">Current device</td>
              <td className="p-3 text-xs font-bold text-green-600">Active Now</td>
              <td className="p-3 font-mono text-xs text-gray-500">Unavailable</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
