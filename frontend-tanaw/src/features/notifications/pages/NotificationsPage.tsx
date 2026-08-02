import { Bell, CheckCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/shared/components/layout";
import { Panel, PanelHeader } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import type { UserRole } from "@/shared/types/role.types";
import { NotificationList } from "../components";
import { usePortalNotifications, type PortalNotification } from "../hooks";

type NotificationsPageProps = {
  role: Extract<UserRole, "admin" | "it" | "staff">;
};

const roleDescription: Record<NotificationsPageProps["role"], string> = {
  admin: "Review important situations and escalated requests that may need an Admin decision.",
  it: "Review system activity, enterprise support requests, priority alerts, and technical delivery updates.",
  staff: "Review enterprise report submissions and resubmissions that require staff action.",
};

export function NotificationsPage({ role }: NotificationsPageProps) {
  const navigate = useNavigate();
  const { allNotifications, isLoading, markAllAsRead, markAsRead, unreadCount } = usePortalNotifications(role);

  const openNotification = (notification: PortalNotification) => {
    markAsRead(notification.id);
    if (notification.targetPath) navigate(notification.targetPath);
  };

  return (
    <PageMotion>
      <PageHeader title="Notifications" description={roleDescription[role]} />
      <Panel className="overflow-hidden">
        <PanelHeader
          title="All Notifications"
          icon={Bell}
          right={
            <button
              type="button"
              disabled={allNotifications.length === 0 || unreadCount === 0}
              onClick={markAllAsRead}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-emerald-100 bg-white px-3 py-1.5 text-[10px] font-black tracking-wide text-emerald-700 uppercase shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-300 dark:border-emerald-300/20 dark:bg-[#172033] dark:text-emerald-200 dark:hover:bg-emerald-500/10 dark:disabled:text-slate-600"
            >
              <CheckCheck size={13} />
              Mark all read
            </button>
          }
        />
        <NotificationList notifications={allNotifications} isLoading={isLoading} onOpen={openNotification} />
      </Panel>
    </PageMotion>
  );
}
