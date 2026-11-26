import { AlertCircle, AlertTriangle, CheckCircle, CheckCheck, Inbox } from "lucide-react";
import { Card } from "../../../components/Card";
import { Button } from "../../../ui-kit";
import type { EnterpriseNotification } from "../../../types/enterprise";

type NotificationsViewProps = {
  notifications: EnterpriseNotification[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onSelectNotification: (notification: EnterpriseNotification) => void;
};

export function NotificationsView({ notifications, unreadCount, onMarkAllRead, onSelectNotification }: NotificationsViewProps) {
  return (
    <div className="animate-in fade-in mx-auto w-full max-w-290 space-y-6 pt-1 font-sans">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-label text-(--tanaw-gold-ink) uppercase">Enterprise Alerts</p>
          <h2 className="font-display text-2xl leading-tight font-bold text-(--tanaw-text)">Notifications</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-(--tanaw-text-secondary)">Review account, security, report, and monitoring updates for this enterprise.</p>
        </div>
        <div className="flex items-center gap-3">
          <span role="status" className="text-[0.8125rem] text-(--tanaw-text-muted) tabular-nums">
            {unreadCount === 0 ? "All caught up" : `${unreadCount} unread`}
          </span>
          <Button variant="secondary" size="sm" disabled={unreadCount === 0} onClick={onMarkAllRead} leadingIcon={<CheckCheck size={15} aria-hidden="true" />}>
            Mark all read
          </Button>
        </div>
      </div>

      <Card className="enterprise-notifications-view overflow-hidden rounded-tanaw-xl shadow-tanaw-soft">
        {notifications.length > 0 ? (
          <div className="tanaw-stagger divide-y divide-(--tanaw-border-soft)">
            {notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => onSelectNotification(notification)}
                className={`flex w-full items-start gap-4 px-5 py-4 text-left transition-colors duration-150 ease-tanaw-out hover:bg-(--tanaw-interactive-hover-bg) focus-visible:bg-(--tanaw-interactive-hover-bg) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:bg-(--tanaw-interactive-pressed-bg) ${
                  notification.read ? "" : "bg-(--tanaw-interactive-selected-bg)/50"
                }`}
              >
                <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-tanaw-md ${notificationIconClassName(notification.type)}`}>
                  {notificationIcon(notification.type)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm leading-relaxed ${notification.read ? "font-medium text-(--tanaw-text-secondary)" : "font-semibold text-(--tanaw-text)"}`}>{notification.message}</span>
                  <span className="mt-1.5 block text-xs text-(--tanaw-text-muted) tabular-nums">{notification.time}</span>
                </span>
                {!notification.read && (
                  <>
                    <span aria-hidden="true" className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-(--tanaw-accent-ink)" />
                    <span className="sr-only">Unread</span>
                  </>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex min-h-80 flex-col items-center justify-center px-6 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-tanaw-lg bg-(--tanaw-selected-bg) text-(--tanaw-accent-ink)">
              <Inbox size={22} aria-hidden="true" />
            </div>
            <p className="mt-4 text-sm font-semibold text-(--tanaw-text)">No notifications</p>
            <p className="mt-1 max-w-80 text-[0.8125rem] leading-relaxed text-(--tanaw-text-muted)">Account, security, report, and monitoring updates will appear here when TANAW records matching activity.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function notificationIcon(type: EnterpriseNotification["type"]) {
  if (type === "critical") return <AlertTriangle size={17} />;
  if (type === "warning") return <AlertCircle size={17} />;
  return <CheckCircle size={17} />;
}

function notificationIconClassName(type: EnterpriseNotification["type"]) {
  if (type === "critical") return "bg-(--tanaw-danger-bg) text-(--tanaw-danger-text)";
  if (type === "warning") return "bg-(--tanaw-warning-bg) text-(--tanaw-warning-text)";
  if (type === "success") return "bg-(--tanaw-success-bg) text-(--tanaw-success-text)";
  return "bg-(--tanaw-info-bg) text-(--tanaw-info-text)";
}
