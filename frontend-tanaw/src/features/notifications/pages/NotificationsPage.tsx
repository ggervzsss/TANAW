import { Bell, CheckCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/shared/components/layout";
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
  staff: "Review enterprise report submissions that require staff action.",
};

/** Every notification for the signed-in role, as one open list of quiet rows (no card around it). */
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
      <section aria-labelledby="all-notifications-title" className="border-t border-(--tanaw-border-soft)">
        <div className="flex items-center justify-between gap-3 border-b border-(--tanaw-border-soft) py-3">
          <h2 id="all-notifications-title" className="flex items-center gap-2 text-base font-[650] text-(--tanaw-text)">
            <Bell size={16} className="text-(--tanaw-accent-ink)" aria-hidden="true" />
            All Notifications
          </h2>
          <button
            type="button"
            disabled={allNotifications.length === 0 || unreadCount === 0}
            onClick={markAllAsRead}
            className="group inline-flex min-h-9 shrink-0 items-center gap-2 rounded-tanaw-md px-3 text-[13px] max-md:-mr-3 max-md:min-h-11 font-semibold text-(--tanaw-accent-ink) transition-[background-color,color,scale] duration-200 ease-tanaw-out hover:bg-(--tanaw-control-bg-hover) enabled:active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) disabled:cursor-not-allowed disabled:text-(--tanaw-interactive-disabled-text) disabled:hover:bg-transparent"
          >
            <CheckCheck size={14} aria-hidden="true" className="transition-transform duration-200 ease-tanaw-out group-enabled:group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
            Mark all read
          </button>
        </div>
        <div className="py-1">
          <NotificationList notifications={allNotifications} isLoading={isLoading} onOpen={openNotification} />
        </div>
      </section>
    </PageMotion>
  );
}
