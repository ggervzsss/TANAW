import { Building2, CheckCircle2, ChevronRight, Users, WifiOff, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { Panel } from "@/shared/components/panel";
import type { DashboardOverview } from "../model";

export function DashboardSidePanels({ overview }: { overview: DashboardOverview }) {
  return (
    <div className="grid content-start gap-6">
      <Panel className="p-6">
        <div className="flex items-start gap-3">
          <span
            className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${overview.unavailableDesktopAppCount > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}
          >
            {overview.unavailableDesktopAppCount > 0 ? <WifiOff size={21} /> : <CheckCircle2 size={21} />}
          </span>
          <div>
            <h2 className="font-black text-slate-950">Desktop Application Status</h2>
            <p className="mt-1 text-sm leading-6 font-medium text-slate-600">
              {overview.summary
                ? `${overview.summary.onlineGateways} online, ${overview.summary.delayedGateways} delayed, and ${overview.summary.offlineGateways} offline.`
                : "Desktop application status will appear when enterprise updates are available."}
            </p>
          </div>
        </div>
      </Panel>
      <Panel className="p-6">
        <h2 className="font-black text-slate-950">Account Directory</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Account totals are kept here as reference, not as urgent work.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <DirectoryCount icon={Users} label="LGU Personnel" value={overview.lguAccountCount} />
          <DirectoryCount icon={Building2} label="Enterprises" value={overview.enterpriseAccountCount} />
        </div>
        <Link to={routes.it.lguAccounts} className="mt-4 inline-flex items-center gap-1 text-sm font-black text-emerald-700 hover:text-emerald-800">
          Open Accounts <ChevronRight size={16} />
        </Link>
      </Panel>
    </div>
  );
}

function DirectoryCount({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <Icon size={16} className="text-emerald-700" />
      <p className="mt-2 text-xl font-black text-slate-950">{value}</p>
      <p className="text-xs font-bold text-slate-500">{label}</p>
    </div>
  );
}
