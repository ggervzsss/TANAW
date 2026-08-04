import { Clock3, Inbox } from "lucide-react";
import type { PortalNotification } from "../hooks/usePortalNotifications";
import { notificationToneClasses } from "../model";
import { NotificationIcon } from "./NotificationIcon";

type NotificationListProps = {
  isLoading: boolean;
  notifications: PortalNotification[];
  onOpen: (notification: PortalNotification) => void;
};

export function NotificationList({ isLoading, notifications, onOpen }: NotificationListProps) {
  if (notifications.length === 0) return <NotificationEmptyState isLoading={isLoading} />;

  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-700">
      {notifications.map((notification) => (
        <NotificationRow key={notification.id} notification={notification} onOpen={onOpen} />
      ))}
    </div>
  );
}

function NotificationRow({ notification, onOpen }: { notification: PortalNotification; onOpen: (notification: PortalNotification) => void }) {
  const classes = notificationToneClasses[notification.tone];

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
          <span
            className={`line-clamp-2 text-sm leading-relaxed group-hover:text-emerald-800 dark:group-hover:text-emerald-200 ${notification.read ? "font-semibold text-slate-700 dark:text-slate-200" : "font-black text-slate-950 dark:text-white"}`}
          >
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

function NotificationEmptyState({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-300/20">
        {isLoading ? <Clock3 size={22} /> : <Inbox size={22} />}
      </div>
      <p className="mt-4 text-sm font-black text-slate-900 dark:text-slate-100">{isLoading ? "Loading notifications" : "No notifications"}</p>
      <p className="mt-1 max-w-88 text-xs leading-relaxed text-slate-500 dark:text-slate-300">
        {isLoading ? "Checking TANAW activity sources." : "New activity relevant to your account will appear here."}
      </p>
    </div>
  );
}
