import { Bell, CheckCheck } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { PortalNotification } from "../hooks/usePortalNotifications";
import { NotificationEmptyState, NotificationRow, NotificationSkeleton } from "./NotificationList";

type PortalNotificationDropdownProps = {
  isOpen: boolean;
  isLoading: boolean;
  notifications: PortalNotification[];
  unreadCount: number;
  viewAllPath?: string;
  onMarkAllRead: () => void;
  onSelectNotification: (notification: PortalNotification) => void;
  onToggle: () => void;
  onViewAll: () => void;
  triggerClassName?: string;
};

export function PortalNotificationDropdown({
  isOpen,
  isLoading,
  notifications,
  unreadCount,
  viewAllPath,
  onMarkAllRead,
  onSelectNotification,
  onToggle,
  onViewAll,
  triggerClassName = "border-emerald-100/28 bg-white/8 text-white hover:bg-white/15",
}: PortalNotificationDropdownProps) {
  const countLabel = unreadCount > 99 ? "99+" : String(unreadCount);
  const reduceMotion = useReducedMotion();

  return (
    <>
      <button
        type="button"
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
        aria-expanded={isOpen}
        onClick={onToggle}
        className={`relative flex h-11 w-11 items-center justify-center rounded-full border shadow-sm backdrop-blur-md transition-[background-color,border-color,color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(3,38,16,0.34)] active:translate-y-0 ${triggerClassName}`}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="bg-tanaw-red border-tanaw-green absolute -top-1 -right-1 flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 px-1 text-xs leading-none font-bold text-white shadow-sm">
            {countLabel}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute top-full right-0 z-1002 mt-4 flex w-[min(26rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] max-md:fixed max-md:top-20 max-md:right-4 max-md:left-4 max-md:mt-0 max-md:w-auto max-md:max-h-[calc(100dvh-6rem)] origin-top-right flex-col overflow-hidden rounded-tanaw-lg border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) text-(--tanaw-text) shadow-tanaw-raised"
          >
            <div className="flex items-start justify-between gap-4 border-b border-(--tanaw-border-soft) px-4 py-3.5">
              <div>
                <p className="text-base font-[650] text-(--tanaw-text)">Notifications</p>
                <p className="mt-0.5 text-[13px] text-(--tanaw-text-secondary)">{unreadCount > 0 ? `${unreadCount} unread item${unreadCount === 1 ? "" : "s"}` : "All caught up"}</p>
              </div>
              <button
                type="button"
                disabled={notifications.length === 0 || unreadCount === 0}
                onClick={onMarkAllRead}
                className="group inline-flex min-h-8 items-center gap-1.5 rounded-tanaw-sm px-2.5 text-[13px] max-md:min-h-11 font-semibold text-(--tanaw-accent-ink) transition-[background-color,color,scale] duration-200 ease-tanaw-out hover:bg-(--tanaw-control-bg-hover) enabled:active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring) disabled:cursor-not-allowed disabled:text-(--tanaw-interactive-disabled-text) disabled:hover:bg-transparent"
              >
                <CheckCheck size={14} aria-hidden="true" className="transition-transform duration-200 ease-tanaw-out group-enabled:group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
                Mark all read
              </button>
            </div>

            <div className="max-h-112 overflow-y-auto p-1.5">
              {notifications.length === 0 ? (
                isLoading ? (
                  <NotificationSkeleton rows={3} compact />
                ) : (
                  <NotificationEmptyState compact />
                )
              ) : (
                <ul className="m-0 list-none p-0">
                  {notifications.map((notification) => (
                    <li key={notification.id} className="border-b border-(--tanaw-border-soft) py-0.5 last:border-b-0">
                      <NotificationRow notification={notification} onOpen={onSelectNotification} compact />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-(--tanaw-border-soft) px-4 py-2 text-center">
              <button
                type="button"
                disabled={!viewAllPath}
                onClick={onViewAll}
                className="inline-flex min-h-9 items-center rounded-tanaw-sm px-3 text-[13px] max-md:min-h-11 font-semibold text-(--tanaw-accent-ink) transition-[background-color,color,scale] duration-200 ease-tanaw-out hover:bg-(--tanaw-control-bg-hover) enabled:active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring) disabled:cursor-not-allowed disabled:text-(--tanaw-interactive-disabled-text) disabled:hover:bg-transparent"
              >
                View all notifications
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
