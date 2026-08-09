import { AlertCircle, AlertTriangle, CheckCircle, CheckCheck, Inbox } from "lucide-react";
import { Card } from "../../../components/Card";
import type { EnterpriseNotification } from "../../../types/enterprise";

type NotificationsViewProps = {
  notifications: EnterpriseNotification[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onSelectNotification: (notification: EnterpriseNotification) => void;
};

export function NotificationsView({ notifications, unreadCount, onMarkAllRead, onSelectNotification }: NotificationsViewProps) {
  return (
    <div className="animate-in fade-in mx-auto w-full max-w-290 space-y-6 pt-2 font-sans duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-black tracking-[0.24em] text-[#b7952b] uppercase">Enterprise Alerts</p>
          <h2 className="text-2xl font-bold tracking-tight text-[#111827]">Notifications</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500">Review account, security, report, and monitoring updates for this enterprise.</p>
        </div>
        <button
          type="button"
          disabled={unreadCount === 0}
          onClick={onMarkAllRead}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-emerald-100 bg-white px-4 py-2 text-xs font-black tracking-wide text-[#065f46] uppercase shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-gray-300"
        >
          <CheckCheck size={15} />
          Mark all read
        </button>
      </div>

      <Card className="enterprise-notifications-view overflow-hidden rounded-[28px] border-emerald-100/80 shadow-[0_18px_44px_rgba(15,23,42,0.07)]">
        {notifications.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => onSelectNotification(notification)}
                className={`flex w-full gap-4 p-5 text-left transition-colors hover:bg-emerald-50/70 ${notification.read ? "opacity-75" : "bg-blue-50/20"}`}
              >
                <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${notificationIconClassName(notification.type)}`}>{notificationIcon(notification.type)}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm leading-relaxed ${notification.read ? "font-semibold text-gray-700" : "font-black text-[#111827]"}`}>{notification.message}</span>
                  <span className="mt-2 block text-[10px] font-black tracking-wider text-gray-400 uppercase">{notification.time}</span>
                </span>
                {!notification.read && <span className="mt-3 h-2.5 w-2.5 shrink-0 rounded-full bg-[#2d5eff] shadow-sm" />}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex min-h-80 flex-col items-center justify-center px-6 py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <Inbox size={22} />
            </div>
            <p className="mt-4 text-sm font-black text-[#111827]">No notifications</p>
            <p className="mt-1 max-w-80 text-xs leading-relaxed text-gray-500">Account, security, report, and monitoring updates will appear here when TANAW records matching activity.</p>
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
  if (type === "critical") return "bg-red-50 text-red-700 ring-1 ring-red-100";
  if (type === "warning") return "bg-amber-50 text-amber-800 ring-1 ring-amber-100";
  if (type === "success") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100";
  return "bg-blue-50 text-blue-700 ring-1 ring-blue-100";
}
