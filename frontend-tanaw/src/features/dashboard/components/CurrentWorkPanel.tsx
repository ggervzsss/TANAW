import { AlertTriangle, ChevronRight, Inbox, TicketCheck, UserRoundCog, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { Panel } from "@/shared/components/panel";
import type { DashboardOverview } from "../model";

export function CurrentWorkPanel({ overview }: { overview: DashboardOverview }) {
  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-slate-200 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">Current Work</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">Open a group to see what happened and what to do next.</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{overview.currentWorkCount} open</span>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        <WorkItem
          icon={AlertTriangle}
          label="Technical Issues"
          count={overview.itIssueCount}
          description={
            overview.urgentIssueCount > 0
              ? `${overview.urgentIssueCount} urgent ${overview.urgentIssueCount === 1 ? "issue needs" : "issues need"} immediate attention.`
              : "Camera, desktop application, and data update problems."
          }
          href={`${routes.it.workCenter}?view=issues`}
          urgent={overview.urgentIssueCount > 0}
        />
        <WorkItem
          icon={TicketCheck}
          label="Support Requests"
          count={overview.openSupportRequestCount}
          description="Questions and problems sent by enterprises."
          href={`${routes.it.workCenter}?view=support`}
        />
        <WorkItem
          icon={UserRoundCog}
          label="Account Requests"
          count={overview.pendingAccountRequestCount}
          description="Enterprise details waiting for review."
          href={`${routes.it.workCenter}?view=accounts`}
        />
        <WorkItem icon={Inbox} label="Email Problems" count={overview.emailProblemCount} description="Emails that failed or need a provider check." href={`${routes.it.workCenter}?view=email`} />
      </div>
    </Panel>
  );
}

function WorkItem({ icon: Icon, label, count, description, href, urgent = false }: { icon: LucideIcon; label: string; count: number; description: string; href: string; urgent?: boolean }) {
  return (
    <Link to={href} className="tanaw-interactive-row group flex items-center gap-4 px-6 py-5">
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${urgent ? "bg-red-100 text-red-700" : "tanaw-work-item-icon bg-slate-100 text-slate-600"}`}>
        <Icon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-black text-slate-950">{label}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-black ${urgent ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}`}>{count}</span>
        </span>
        <span className="mt-1 block text-sm font-medium text-slate-500">{description}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-emerald-700" />
    </Link>
  );
}
