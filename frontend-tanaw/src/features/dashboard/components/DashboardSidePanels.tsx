import { Building2, CheckCircle2, ChevronRight, Clock3, Server, Users, Wifi, WifiOff, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { Panel } from "@/shared/components/panel";
import type { DashboardOverview } from "../model";

export function DashboardSidePanels({ overview }: { overview: DashboardOverview }) {
  const hasUnavailableApps = overview.unavailableDesktopAppCount > 0;

  return (
    <div className="grid content-start gap-6">
      <Panel className="tanaw-it-health-card overflow-hidden rounded-3xl border-slate-200/90 dark:border-slate-700/80">
        <div className="border-b border-slate-200/80 bg-linear-to-br from-white to-slate-50 px-6 py-5 dark:border-slate-700/80 dark:from-[#172033] dark:to-[#111b2d]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3.5">
              <span
                className={`flex size-12 shrink-0 items-center justify-center rounded-2xl border ${hasUnavailableApps ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300" : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300"}`}
              >
                {hasUnavailableApps ? <WifiOff size={22} /> : <CheckCircle2 size={22} />}
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-black tracking-[0.15em] text-slate-500 uppercase dark:text-slate-400">System health</p>
                <h2 className="mt-1 font-black text-slate-950 dark:text-slate-50">Desktop Application Status</h2>
              </div>
            </div>
            {overview.summary && (
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black tracking-wide uppercase ${hasUnavailableApps ? "bg-amber-100 text-amber-800 dark:bg-amber-400/12 dark:text-amber-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/12 dark:text-emerald-200"}`}
              >
                {hasUnavailableApps ? `${overview.unavailableDesktopAppCount} unavailable` : "All online"}
              </span>
            )}
          </div>
          <p className="mt-4 text-sm leading-6 font-medium text-slate-600 dark:text-slate-300">
            {overview.summary
              ? `${overview.summary.onlineGateways} online, ${overview.summary.delayedGateways} delayed, and ${overview.summary.offlineGateways} offline.`
              : "Desktop application status will appear when enterprise updates are available."}
          </p>
        </div>
        {overview.summary && (
          <div className="grid grid-cols-3 gap-2.5 bg-white/70 p-4 dark:bg-[#121c31]/72">
            <HealthMetric icon={Wifi} label="Online" value={overview.summary.onlineGateways} tone="online" />
            <HealthMetric icon={Clock3} label="Delayed" value={overview.summary.delayedGateways} tone="delayed" />
            <HealthMetric icon={WifiOff} label="Offline" value={overview.summary.offlineGateways} tone="offline" />
          </div>
        )}
      </Panel>

      <Panel className="overflow-hidden rounded-3xl border-slate-200/90 dark:border-slate-700/80">
        <div className="p-6">
          <div className="flex items-start gap-3.5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300">
              <Server size={20} />
            </span>
            <div>
              <p className="text-[10px] font-black tracking-[0.15em] text-slate-500 uppercase dark:text-slate-400">Reference inventory</p>
              <h2 className="mt-1 font-black text-slate-950 dark:text-slate-50">Account Directory</h2>
            </div>
          </div>
          <p className="mt-4 text-sm leading-5 font-medium text-slate-500 dark:text-slate-400">Account totals are kept here as reference, not as urgent work.</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <DirectoryCount icon={Users} label="LGU Personnel" value={overview.lguAccountCount} />
            <DirectoryCount icon={Building2} label="Enterprises" value={overview.enterpriseAccountCount} />
          </div>
        </div>
        <Link
          to={routes.it.lguAccounts}
          className="group flex min-h-13 items-center justify-between border-t border-slate-200/80 bg-slate-50/75 px-6 text-sm font-black text-emerald-700 transition-colors hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline-offset-[-3px] dark:border-slate-700/80 dark:bg-[#10192b] dark:text-emerald-300 dark:hover:bg-emerald-400/10 dark:hover:text-emerald-200"
        >
          Open Accounts
          <ChevronRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </Panel>
    </div>
  );
}

function HealthMetric({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: "online" | "delayed" | "offline" }) {
  const styles = {
    online: "border-emerald-200/80 text-emerald-700 dark:border-emerald-400/18 dark:text-emerald-300",
    delayed: "border-amber-200/80 text-amber-700 dark:border-amber-400/18 dark:text-amber-300",
    offline: "border-red-200/80 text-red-700 dark:border-red-400/18 dark:text-red-300",
  }[tone];
  return (
    <div className={`min-w-0 rounded-2xl border bg-slate-50/85 p-3 dark:bg-[#0e1728] ${styles}`}>
      <Icon size={15} aria-hidden="true" />
      <p className="mt-2 text-xl font-black text-slate-950 tabular-nums dark:text-slate-50">{value}</p>
      <p className="mt-0.5 truncate text-[10px] font-black tracking-wide uppercase">{label}</p>
    </div>
  );
}

function DirectoryCount({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4 dark:border-slate-700 dark:bg-[#0f192b]">
      <Icon size={17} className="text-emerald-700 dark:text-emerald-300" />
      <p className="mt-3 text-2xl font-black text-slate-950 tabular-nums dark:text-slate-50">{value}</p>
      <p className="mt-0.5 text-xs font-bold text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}
