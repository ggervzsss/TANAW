import { AlertTriangle, ChevronRight, Inbox, TicketCheck, UserRoundCog, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { Panel } from "@/shared/components/panel";
import type { DashboardOverview } from "../model";

type WorkTone = "danger" | "support" | "account" | "email";

const toneStyles: Record<WorkTone, { icon: string; count: string }> = {
  danger: { icon: "border-red-200 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300", count: "bg-red-100 text-red-700 dark:bg-red-400/12 dark:text-red-200" },
  support: {
    icon: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-300",
    count: "bg-blue-100 text-blue-700 dark:bg-blue-400/12 dark:text-blue-200",
  },
  account: {
    icon: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300",
    count: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/12 dark:text-emerald-200",
  },
  email: {
    icon: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-300",
    count: "bg-violet-100 text-violet-700 dark:bg-violet-400/12 dark:text-violet-200",
  },
};

export function CurrentWorkPanel({ overview }: { overview: DashboardOverview }) {
  return (
    <Panel className="tanaw-it-work-queue overflow-hidden rounded-3xl border-slate-200/90 dark:border-slate-700/80">
      <div className="border-b border-slate-200/90 bg-linear-to-r from-white via-white to-emerald-50/55 px-6 py-5 dark:border-slate-700/80 dark:from-[#172033] dark:via-[#141f32] dark:to-[#132a2a]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black tracking-[0.16em] text-emerald-700 uppercase dark:text-emerald-300">Priority workspace</p>
            <h2 className="mt-1 text-lg font-black text-slate-950 dark:text-slate-50">Current Work</h2>
            <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">Open a group to see what happened and what to do next.</p>
          </div>
          <span className="inline-flex min-h-8 items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-700 tabular-nums dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">
            {overview.currentWorkCount} open
          </span>
        </div>
      </div>
      <div className="divide-y divide-slate-200/75 dark:divide-slate-700/70">
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
          tone="danger"
          urgentCount={overview.urgentIssueCount}
        />
        <WorkItem
          icon={TicketCheck}
          label="Support Requests"
          count={overview.openSupportRequestCount}
          description="Questions and problems sent by enterprises."
          href={`${routes.it.workCenter}?view=support`}
          tone="support"
        />
        <WorkItem
          icon={UserRoundCog}
          label="Account Requests"
          count={overview.pendingAccountRequestCount}
          description="Enterprise details waiting for review."
          href={`${routes.it.workCenter}?view=accounts`}
          tone="account"
        />
        <WorkItem
          icon={Inbox}
          label="Email Problems"
          count={overview.emailProblemCount}
          description="Emails that failed or need a provider check."
          href={`${routes.it.workCenter}?view=email`}
          tone="email"
        />
      </div>
    </Panel>
  );
}

function WorkItem({
  icon: Icon,
  label,
  count,
  description,
  href,
  tone,
  urgentCount = 0,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  description: string;
  href: string;
  tone: WorkTone;
  urgentCount?: number;
}) {
  const styles = toneStyles[tone];
  return (
    <Link
      to={href}
      data-work-tone={tone}
      className="group relative flex min-h-24 items-center gap-4 bg-white/70 px-6 py-5 transition-[background-color,box-shadow] duration-150 hover:bg-slate-50/95 focus-visible:z-10 focus-visible:outline-offset-[-3px] dark:bg-[#121c31]/72 dark:hover:bg-[#182438]"
    >
      <span className={`flex size-12 shrink-0 items-center justify-center rounded-2xl border ${styles.icon}`} aria-hidden="true">
        <Icon size={21} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="font-black text-slate-950 dark:text-slate-50">{label}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-black tabular-nums ${styles.count}`}>{count}</span>
          {urgentCount > 0 && <span className="text-[10px] font-black tracking-[0.08em] text-red-700 uppercase dark:text-red-300">Urgent attention</span>}
        </span>
        <span className="mt-1.5 block text-sm leading-5 font-medium text-slate-500 dark:text-slate-400">{description}</span>
      </span>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-400 transition-[border-color,background-color,color] group-hover:border-emerald-200 group-hover:bg-emerald-50 group-hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-500 dark:group-hover:border-emerald-400/25 dark:group-hover:bg-emerald-400/10 dark:group-hover:text-emerald-300">
        <ChevronRight size={17} aria-hidden="true" />
      </span>
    </Link>
  );
}
