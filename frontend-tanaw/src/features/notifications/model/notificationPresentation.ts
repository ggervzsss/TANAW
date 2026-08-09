import type { PortalNotificationTone } from "../hooks/usePortalNotifications";

export type NotificationToneClasses = {
  accent: string;
  badge: string;
  dot: string;
  icon: string;
};

export const notificationToneClasses: Record<PortalNotificationTone, NotificationToneClasses> = {
  critical: {
    accent: "from-red-50 dark:from-red-950/35",
    badge: "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-300/20",
    dot: "bg-red-600",
    icon: "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-300/20",
  },
  warning: {
    accent: "from-amber-50 dark:from-amber-950/35",
    badge: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/20",
    dot: "bg-amber-500",
    icon: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/20",
  },
  success: {
    accent: "from-emerald-50 dark:from-emerald-950/35",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-300/20",
    dot: "bg-emerald-600",
    icon: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-300/20",
  },
  info: {
    accent: "from-sky-50 dark:from-sky-950/35",
    badge: "bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-300/20",
    dot: "bg-sky-600",
    icon: "bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-300/20",
  },
};
