import { Shield } from "lucide-react";
import { Card } from "../../../components/Card";

export function EnhancedProtectionPanel() {
  return (
    <Card className="rounded-[28px] border-emerald-100/80 p-6 shadow-[0_18px_44px_rgba(15,23,42,0.07)]">
      <h3 className="mb-4 flex items-center gap-2 border-b border-emerald-100 pb-3 text-sm font-bold tracking-wider text-[#111827] uppercase">
        <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-emerald-50 text-[#065f46]">
          <Shield size={16} />
        </span>
        Enhanced Protection
      </h3>
      <div className="mt-2 flex items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-gray-50/80 p-4">
        <div>
          <p className="text-sm font-bold text-[#111827]">Two-Factor Auth (2FA)</p>
          <p className="mt-1 text-[10px] text-gray-500">Not configured for this local deployment.</p>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-[10px] font-bold tracking-wider text-gray-500 uppercase">Unavailable</span>
      </div>
    </Card>
  );
}
