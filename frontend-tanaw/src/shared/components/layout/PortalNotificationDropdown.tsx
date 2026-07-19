import { AlertCircle, AlertTriangle, Bell, CheckCheck, CheckCircle2, Clock3, Inbox, ShieldAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { PortalNotification, PortalNotificationTone } from "@/shared/hooks/usePortalNotifications";

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

const toneClasses: Record<PortalNotificationTone, { icon: string; badge: string; dot: string; accent: string }> = {
  critical: {
    icon: "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-300/20",
    badge: "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-300/20",
    dot: "bg-red-600",
    accent: "from-red-50 dark:from-red-950/35",
  },
  warning: {
    icon: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/20",
    badge: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/20",
    dot: "bg-amber-500",
    accent: "from-amber-50 dark:from-amber-950/35",
  },
  success: {
    icon: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-300/20",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-300/20",
    dot: "bg-emerald-600",
    accent: "from-emerald-50 dark:from-emerald-950/35",
  },
  info: {
    icon: "bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-300/20",
    badge: "bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-300/20",
    dot: "bg-sky-600",
    accent: "from-sky-50 dark:from-sky-950/35",
  },
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
          <span className="bg-tanaw-red border-tanaw-green absolute -top-1 -right-1 flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 px-1 text-[10px] leading-none font-black text-white shadow-sm">
            {countLabel}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute top-full right-0 z-1002 mt-4 flex w-[min(26rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-3xl border border-white/85 bg-white text-slate-800 shadow-[0_24px_68px_rgba(2,20,8,0.24)] ring-1 ring-emerald-950/6 dark:border-slate-600 dark:bg-[#121c31] dark:text-slate-100 dark:shadow-[0_24px_68px_rgba(0,0,0,0.48)] dark:ring-white/8"
          >
            <div className="border-b border-emerald-100 bg-linear-to-r from-emerald-50 via-white to-amber-50/80 px-5 py-4 dark:border-slate-600 dark:from-[#0f2d3c] dark:via-[#172033] dark:to-[#312638]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-black text-slate-950">Notifications</p>
                  <p className="mt-1 text-xs font-medium text-slate-500">{unreadCount > 0 ? `${unreadCount} unread item${unreadCount === 1 ? "" : "s"}` : "All caught up"}</p>
                </div>
                <button
                  type="button"
                  disabled={notifications.length === 0 || unreadCount === 0}
                  onClick={onMarkAllRead}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-white px-3 py-1.5 text-[10px] font-black tracking-wide text-emerald-700 uppercase shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  <CheckCheck size={13} />
                  Mark all read
                </button>
              </div>
            </div>

            <div className="max-h-112 overflow-y-auto bg-white dark:bg-[#121c31]">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => onSelectNotification(notification)}
                  className={`group flex w-full gap-3 border-b border-slate-100 bg-linear-to-r ${toneClasses[notification.tone].accent} to-white px-5 py-4 text-left transition hover:bg-emerald-50/70 dark:border-slate-700 dark:to-[#121c31] dark:hover:bg-emerald-500/10 ${
                    notification.read ? "opacity-75" : ""
                  }`}
                >
                  <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ring-1 ${toneClasses[notification.tone].icon}`}>
                    <NotificationIcon tone={notification.tone} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`truncate text-sm leading-snug group-hover:text-emerald-800 dark:group-hover:text-emerald-200 ${notification.read ? "font-semibold text-slate-700 dark:text-slate-200" : "font-black text-slate-950 dark:text-white"}`}
                      >
                        {notification.title}
                      </span>
                      {!notification.read && <span className={`h-2 w-2 shrink-0 rounded-full ${toneClasses[notification.tone].dot}`} />}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-xs leading-relaxed font-medium text-slate-600">{notification.message}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black tracking-wide text-slate-400 uppercase">
                      <span>{notification.source}</span>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span>{notification.time}</span>
                      {notification.statusLabel && <span className={`rounded-full px-2 py-0.5 ring-1 ${toneClasses[notification.tone].badge}`}>{notification.statusLabel}</span>}
                    </span>
                  </span>
                </button>
              ))}

              {notifications.length === 0 && (
                <div className="flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                    {isLoading ? <Clock3 size={20} /> : <Inbox size={20} />}
                  </div>
                  <p className="mt-4 text-sm font-black text-slate-900">{isLoading ? "Loading notifications" : "No notifications"}</p>
                  <p className="mt-1 max-w-68 text-xs leading-relaxed text-slate-500">
                    {isLoading ? "Checking TANAW activity sources." : "Role-specific alerts, logs, support requests, and report workflow items will appear here."}
                  </p>
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-center dark:border-slate-700 dark:bg-[#0f172a]">
              <button
                type="button"
                disabled={!viewAllPath}
                onClick={onViewAll}
                className="text-[10px] font-black tracking-wider text-slate-500 uppercase transition hover:text-emerald-700 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                VIEW ALL NOTIFICATIONS
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function NotificationIcon({ tone }: { tone: PortalNotificationTone }) {
  if (tone === "critical") return <ShieldAlert size={17} />;
  if (tone === "warning") return <AlertTriangle size={17} />;
  if (tone === "success") return <CheckCircle2 size={17} />;
  return <AlertCircle size={17} />;
}
