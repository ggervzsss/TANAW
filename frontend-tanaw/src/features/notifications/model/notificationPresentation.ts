import type { PortalNotificationTone } from "../hooks/usePortalNotifications";

/** Token classes for a notification's tone: its icon disc, unread dot and status tag. */
export type NotificationToneClasses = {
  badge: string;
  dot: string;
  icon: string;
};

export const notificationToneClasses: Record<PortalNotificationTone, NotificationToneClasses> = {
  critical: {
    badge: "bg-(--tanaw-danger-bg) text-(--tanaw-danger-text)",
    dot: "bg-(--tanaw-danger)",
    icon: "bg-(--tanaw-danger-bg) text-(--tanaw-danger-text)",
  },
  warning: {
    badge: "bg-(--tanaw-warning-bg) text-(--tanaw-warning-text)",
    dot: "bg-(--tanaw-warn-ink)",
    icon: "bg-(--tanaw-warning-bg) text-(--tanaw-warning-text)",
  },
  success: {
    badge: "bg-(--tanaw-success-bg) text-(--tanaw-success-text)",
    dot: "bg-(--tanaw-action)",
    icon: "bg-(--tanaw-success-bg) text-(--tanaw-success-text)",
  },
  info: {
    badge: "bg-(--tanaw-info-bg) text-(--tanaw-info-text)",
    dot: "bg-(--tanaw-info-text)",
    icon: "bg-(--tanaw-info-bg) text-(--tanaw-info-text)",
  },
};
