import { AlertCircle, AlertTriangle, Bell, CheckCheck, CheckCircle2, Clock3, Inbox, ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/shared/components/layout";
import { Panel, PanelHeader } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { usePortalNotifications, type PortalNotification, type PortalNotificationTone } from "@/shared/hooks/usePortalNotifications";
import type { UserRole } from "@/shared/types/role.types";

type NotificationsPageProps = {
  role: Extract<UserRole, "admin" | "it" | "staff">;
};

const roleCopy: Record<NotificationsPageProps["role"], { description: string }> = {
  admin: {
    description: "Review priority alerts, system activity, support requests, and account workflow updates for supervisory visibility.",
  },
  it: {
    description: "Review system activity, enterprise support requests, priority alerts, and technical delivery updates.",
  },
  staff: {
    description: "Review enterprise report submissions and resubmissions that require staff action.",
  },
};

const toneClasses: Record<PortalNotificationTone, { icon: string; dot: string; badge: string }> = {
  critical: {
    icon: "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-300/20",
    dot: "bg-red-600",
    badge: "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-300/20",
  },
  warning: {
    icon: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/20",
    dot: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/20",
  },
  success: {
    icon: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-300/20",
    dot: "bg-emerald-600",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-300/20",
  },
  info: {
    icon: "bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-300/20",
    dot: "bg-sky-600",
    badge: "bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-300/20",
  },
};

export function NotificationsPage({ role }: NotificationsPageProps) {
  const navigate = useNavigate();
  const { allNotifications, isLoading, markAllAsRead, markAsRead, unreadCount } = usePortalNotifications(role);
  const copy = roleCopy[role];
  const totalCount = allNotifications.length;

  const openNotification = (notification: PortalNotification) => {
    markAsRead(notification.id);
    if (notification.targetPath) {
      navigate(notification.targetPath);
    }
  };

  return (
    <PageMotion>
      <PageHeader title="Notifications" description={copy.description} />

      <Panel className="overflow-hidden">
        <PanelHeader
          title="All Notifications"
          icon={Bell}
          right={
            <button
              type="button"
              disabled={totalCount === 0 || unreadCount === 0}
              onClick={markAllAsRead}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-emerald-100 bg-white px-3 py-1.5 text-[10px] font-black tracking-wide text-emerald-700 uppercase shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-300 dark:border-emerald-300/20 dark:bg-[#172033] dark:text-emerald-200 dark:hover:bg-emerald-500/10 dark:disabled:text-slate-600"
            >
              <CheckCheck size={13} />
              Mark all read
            </button>
          }
        />

        {totalCount > 0 ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {allNotifications.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} onOpen={openNotification} />
            ))}
          </div>
        ) : (
          <div className="flex min-h-80 flex-col items-center justify-center px-6 py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-300/20">
              {isLoading ? <Clock3 size={22} /> : <Inbox size={22} />}
            </div>
            <p className="mt-4 text-sm font-black text-slate-900 dark:text-slate-100">{isLoading ? "Loading notifications" : "No notifications"}</p>
            <p className="mt-1 max-w-88 text-xs leading-relaxed text-slate-500 dark:text-slate-300">
              {isLoading ? "Checking TANAW activity sources." : "New activity relevant to your account will appear here."}
            </p>
          </div>
        )}
      </Panel>
    </PageMotion>
  );
}

function NotificationRow({ notification, onOpen }: { notification: PortalNotification; onOpen: (notification: PortalNotification) => void }) {
  const classes = toneClasses[notification.tone];

  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className={`group flex w-full gap-4 px-5 py-4 text-left transition-colors hover:bg-emerald-50/70 dark:hover:bg-emerald-500/10 ${notification.read ? "opacity-75" : "bg-emerald-50/35 dark:bg-emerald-500/5"}`}
    >
      <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${classes.icon}`}>
        <NotificationIcon tone={notification.tone} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-start gap-2">
          <span className={`line-clamp-2 text-sm leading-relaxed group-hover:text-emerald-800 dark:group-hover:text-emerald-200 ${notification.read ? "font-semibold text-slate-700 dark:text-slate-200" : "font-black text-slate-950 dark:text-white"}`}>
            {notification.title}
          </span>
          {!notification.read && <span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full shadow-sm ${classes.dot}`} />}
        </span>
        <span className="mt-1 line-clamp-2 block text-sm leading-relaxed font-medium text-slate-600 dark:text-slate-300">{notification.message}</span>
        <span className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black tracking-wide text-slate-400 uppercase">
          <span>{notification.source}</span>
          <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
          <span>{notification.time}</span>
          {notification.statusLabel && <span className={`rounded-full px-2 py-0.5 ring-1 ${classes.badge}`}>{notification.statusLabel}</span>}
        </span>
      </span>
    </button>
  );
}

function NotificationIcon({ tone }: { tone: PortalNotificationTone }) {
  if (tone === "critical") return <ShieldAlert size={17} />;
  if (tone === "warning") return <AlertTriangle size={17} />;
  if (tone === "success") return <CheckCircle2 size={17} />;
  return <AlertCircle size={17} />;
}
