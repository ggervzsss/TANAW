import { AlertCircle, AlertTriangle, Bell, CheckCircle, Inbox, Settings } from "lucide-react";
import type { EnterpriseNotification, EnterpriseView } from "../../../types/enterprise";

type NotificationDropdownProps = {
  isOpen: boolean;
  notifications: EnterpriseNotification[];
  unreadCount: number;
  showSettings: boolean;
  occupancyThreshold: number;
  onToggleOpen: () => void;
  onToggleSettings: () => void;
  onMarkAllRead: () => void;
  onSelectNotification: (notification: EnterpriseNotification) => void;
  onSetOccupancyThreshold: (threshold: number) => void;
  onViewAll: () => void;
  triggerVariant?: "default" | "topbar";
};

const notificationIconByType = (type: EnterpriseNotification["type"]) => {
  if (type === "critical") return <AlertTriangle size={16} className="text-tanaw-red" />;
  if (type === "warning") return <AlertCircle size={16} className="text-[#ffd200]" />;
  return <CheckCircle size={16} className="text-[#2d5eff]" />;
};

export function NotificationDropdown({
  isOpen,
  notifications,
  unreadCount,
  showSettings,
  occupancyThreshold,
  onToggleOpen,
  onToggleSettings,
  onMarkAllRead,
  onSelectNotification,
  onSetOccupancyThreshold,
  onViewAll,
  triggerVariant = "default",
}: NotificationDropdownProps) {
  const countLabel = unreadCount > 99 ? "99+" : String(unreadCount);
  const triggerClassName =
    triggerVariant === "topbar"
      ? "relative flex h-11 w-11 items-center justify-center rounded-full border border-emerald-100/28 bg-white/8 text-white shadow-sm backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/15 hover:shadow-[0_10px_24px_rgba(3,38,16,0.34)] active:translate-y-0"
      : `relative rounded-full p-2.5 transition-colors ${isOpen ? "bg-gray-100 text-[#065f46]" : "border border-gray-100 bg-white text-gray-500 shadow-sm hover:bg-gray-50"}`;

  return (
    <div className="relative">
      <button onClick={onToggleOpen} className={triggerClassName} aria-label="Notifications">
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            className={`bg-tanaw-red absolute flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 px-1 text-[10px] leading-none font-black text-white shadow-sm ${
              triggerVariant === "topbar" ? "border-tanaw-green -top-1 -right-1" : "-top-1 -right-1 border-white"
            }`}
          >
            {countLabel}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="enterprise-notification-menu animate-in slide-in-from-top-2 absolute top-full right-0 z-1003 mt-4 flex max-h-136 w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-white/85 bg-white shadow-[0_24px_64px_rgba(2,20,8,0.24)] ring-1 ring-emerald-950/6 duration-200">
          <div className="enterprise-notification-menu__header flex shrink-0 items-center justify-between border-b border-emerald-100 bg-linear-to-r from-emerald-50 via-white to-amber-50/70 p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-[#111827]">
              Notifications
              {unreadCount > 0 && <span className="bg-tanaw-red rounded-sm px-1.5 py-0.5 text-[10px] leading-none text-white shadow-sm">{unreadCount}</span>}
            </h3>
            <div className="flex items-center gap-3">
              <button
                disabled={unreadCount === 0}
                onClick={onMarkAllRead}
                className="text-[10px] font-bold tracking-wider text-[#065f46] uppercase hover:underline disabled:cursor-not-allowed disabled:text-gray-300"
              >
                Mark all read
              </button>
              <button onClick={onToggleSettings} className={`rounded-sm p-1 transition-colors ${showSettings ? "bg-[#065f46] text-white" : "text-gray-400 hover:bg-gray-200 hover:text-[#065f46]"}`}>
                <Settings size={14} />
              </button>
            </div>
          </div>

          {showSettings && (
            <div className="shrink-0 border-b border-[#065f46]/10 bg-[#065f46]/5 p-4 shadow-inner">
              <label className="flex items-center justify-between text-xs font-bold text-[#111827]">
                Overcrowding Threshold
                <select
                  value={occupancyThreshold}
                  onChange={(event) => onSetOccupancyThreshold(Number(event.target.value))}
                  className="ml-2 rounded-sm border border-gray-300 p-1.5 text-xs font-medium outline-none focus:border-[#065f46]"
                >
                  <option value={80}>80% Capacity</option>
                  <option value={90}>90% Capacity</option>
                  <option value={100}>100% Capacity</option>
                </select>
              </label>
              <p className="mt-2 text-[10px] leading-relaxed font-medium text-gray-500">System will trigger a critical alert and push a toast notification when node occupancy surpasses this value.</p>
            </div>
          )}

          <div className="enterprise-notification-menu__body flex-1 overflow-y-auto bg-white">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                onClick={() => onSelectNotification(notification)}
                className={`group flex cursor-pointer gap-3 border-b border-gray-50 p-4 transition-colors hover:bg-gray-50 ${!notification.read ? "bg-blue-50/20" : "opacity-80"}`}
              >
                <div className="mt-0.5 shrink-0">{notificationIconByType(notification.type)}</div>
                <div className="flex-1">
                  <p className={`text-sm leading-snug transition-colors group-hover:text-[#065f46] ${!notification.read ? "font-bold text-[#111827]" : "font-medium text-gray-700"}`}>
                    {notification.message}
                  </p>
                  <p className="mt-1.5 text-[10px] font-bold tracking-wider text-gray-400 uppercase">{notification.time}</p>
                </div>
                {!notification.read && <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#2d5eff] shadow-sm"></div>}
              </div>
            ))}
            {notifications.length === 0 && (
              <div className="flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                  <Inbox size={20} />
                </div>
                <p className="mt-4 text-sm font-black text-[#111827]">No notifications</p>
                <p className="mt-1 max-w-68 text-xs leading-relaxed text-gray-500">Report deadline and submission workflow alerts will appear here when the ledger has matching data.</p>
              </div>
            )}
          </div>
          <div className="enterprise-notification-menu__footer shrink-0 border-t border-gray-100 bg-gray-50 p-2.5 text-center">
            <button onClick={onViewAll} className="text-[10px] font-bold tracking-wider text-gray-500 uppercase hover:text-[#065f46]">
              VIEW ALL NOTIFICATIONS
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export type NotificationTarget = EnterpriseView;
