import { Inbox } from "lucide-react";
import type { PortalNotification } from "../hooks/usePortalNotifications";
import { notificationToneClasses } from "../model";
import { NotificationIcon } from "./NotificationIcon";
import { Skeleton, cn } from "@/shared/ui-kit";
import { toSentenceCase } from "@/shared/utils/sentenceCase";

type NotificationListProps = {
  isLoading: boolean;
  notifications: PortalNotification[];
  onOpen: (notification: PortalNotification) => void;
};

export function NotificationList({ isLoading, notifications, onOpen }: NotificationListProps) {
  if (notifications.length === 0) return isLoading ? <NotificationSkeleton /> : <NotificationEmptyState />;

  return (
    <ul className="m-0 list-none p-0">
      {notifications.map((notification) => (
        <li key={notification.id} className="border-b border-(--tanaw-border-soft) py-0.5 last:border-b-0">
          <NotificationRow notification={notification} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One notification as a quiet row: a tone disc, the title (bold with a dot while unread), the
 * message, and its source, time and status as a 13px caption. Shared by the page and the topbar menu.
 */
export function NotificationRow({ notification, onOpen, compact = false }: { notification: PortalNotification; onOpen: (notification: PortalNotification) => void; compact?: boolean }) {
  const classes = notificationToneClasses[notification.tone];

  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className={cn(
        "group flex w-full gap-3 rounded-tanaw-md text-left transition-colors duration-200 ease-tanaw-out hover:bg-(--tanaw-control-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:bg-(--tanaw-selected-bg)",
        compact ? "px-3 py-3" : "px-4 py-4",
      )}
    >
      <span className={cn("mt-0.5 flex shrink-0 items-center justify-center rounded-full transition-transform duration-200 ease-tanaw-out group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100", compact ? "h-9 w-9" : "h-10 w-10", classes.icon)}>
        <NotificationIcon tone={notification.tone} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-start gap-2">
          <span
            className={cn(
              "text-sm leading-snug transition-colors duration-200 ease-tanaw-out group-hover:text-(--tanaw-accent-ink)",
              compact ? "truncate" : "line-clamp-2",
              notification.read ? "font-medium text-(--tanaw-text-secondary)" : "font-[650] text-(--tanaw-text)",
            )}
          >
            {notification.title}
          </span>
          {!notification.read && <span aria-hidden="true" className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", classes.dot)} />}
        </span>
        <span className="mt-1 line-clamp-2 block text-[13px] leading-relaxed text-(--tanaw-text-secondary)">{notification.message}</span>
        <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-(--tanaw-text-muted)">
          <span>{notification.source}</span>
          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-(--tanaw-border)" />
          <span className="tabular-nums">{notification.time}</span>
          {notification.statusLabel && <span className={cn("rounded-tanaw-sm px-2 py-0.5 font-semibold", classes.badge)}>{toSentenceCase(notification.statusLabel)}</span>}
        </span>
      </span>
    </button>
  );
}

/**
 * Rows in the shape of notifications while they load: the same row padding and disc as
 * NotificationRow (compact in the topbar menu), with each bar in a box of its line's height.
 */
export function NotificationSkeleton({ rows = 4, label = "Loading notifications", compact = false }: { rows?: number; label?: string; compact?: boolean }) {
  return (
    <div role="status" aria-label={label}>
      <div aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <span key={index} className="block border-b border-(--tanaw-border-soft) py-0.5 last:border-b-0">
            <span className={cn("flex gap-3", compact ? "px-3 py-3" : "px-4 py-4")}>
              <Skeleton shape="circle" className={cn("mt-0.5 shrink-0", compact ? "h-9 w-9" : "h-10 w-10")} />
              <span className="min-w-0 flex-1">
                <span className="flex h-[1.203rem] items-center">
                  <Skeleton className="h-3.5 w-3/5" />
                </span>
                <span className="mt-1 flex h-[1.32rem] items-center">
                  <Skeleton className="h-3 w-11/12" />
                </span>
                <span className="mt-2 flex h-5 items-center">
                  <Skeleton className="h-3 w-32" />
                </span>
              </span>
            </span>
          </span>
        ))}
      </div>
      <span className="sr-only">{label}. Checking TANAW activity sources.</span>
    </div>
  );
}

export function NotificationEmptyState({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 text-center", compact ? "min-h-52 py-10" : "min-h-80 py-14")}>
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-(--tanaw-selected-bg) text-(--tanaw-accent-ink)">
        <Inbox size={20} />
      </span>
      <p className="mt-4 text-sm font-[650] text-(--tanaw-text)">No notifications</p>
      <p className="mt-1 max-w-80 text-[13px] leading-relaxed text-(--tanaw-text-secondary)">New activity relevant to your account will appear here.</p>
    </div>
  );
}
