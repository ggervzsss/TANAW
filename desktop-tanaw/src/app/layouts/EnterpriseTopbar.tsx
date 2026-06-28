import { Activity, Camera, ChevronDown, FileText, LayoutDashboard, LifeBuoy, LogOut, Menu, Moon, Shield, Sun, User, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { NotificationDropdown } from "../../features/notifications/components/NotificationDropdown";
import type { AuthUser } from "../../features/login/types";
import type { EnterpriseNotification, EnterpriseView } from "../../types/enterprise";

type EnterpriseTopbarProps = {
  activeView: EnterpriseView;
  displayName: string;
  initials: string;
  isNotificationsOpen: boolean;
  notifications: EnterpriseNotification[];
  occupancyThreshold: number;
  resolvedTheme: "light" | "dark";
  showNotificationSettings: boolean;
  showSimulation: boolean;
  unreadCount: number;
  user?: AuthUser | null;
  onLogout: () => void;
  onMarkAllRead: () => void;
  onNavigate: (view: EnterpriseView) => void;
  onNotificationSelect: (notification: EnterpriseNotification) => void;
  onNotificationsClose: () => void;
  onNotificationsToggle: () => void;
  onSetOccupancyThreshold: (threshold: number) => void;
  onToggleTheme: () => void;
  onToggleNotificationSettings: () => void;
};

const enterpriseNavigation = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "cameras", label: "Camera Setup", icon: Camera },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "simulation", label: "Simulation Lab", icon: Activity },
] as const satisfies { id: EnterpriseView; label: string; icon: typeof LayoutDashboard }[];

export function EnterpriseTopbar({
  activeView,
  displayName,
  initials,
  isNotificationsOpen,
  notifications,
  occupancyThreshold,
  resolvedTheme,
  showNotificationSettings,
  showSimulation,
  unreadCount,
  user,
  onLogout,
  onMarkAllRead,
  onNavigate,
  onNotificationSelect,
  onNotificationsClose,
  onNotificationsToggle,
  onSetOccupancyThreshold,
  onToggleTheme,
  onToggleNotificationSettings,
}: EnterpriseTopbarProps) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const notificationMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showProfileMenu) return undefined;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [showProfileMenu]);

  useEffect(() => {
    if (!isNotificationsOpen) return undefined;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!notificationMenuRef.current?.contains(event.target as Node)) {
        onNotificationsClose();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [isNotificationsOpen, onNotificationsClose]);

  useEffect(() => {
    if (!showProfileMenu && !showMobileNav && !isNotificationsOpen) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowProfileMenu(false);
      setShowMobileNav(false);
      onNotificationsClose();
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isNotificationsOpen, onNotificationsClose, showMobileNav, showProfileMenu]);

  const profileEmail = user?.email ?? "No account email";
  const roleSubtitle = `${String(user?.role ?? "enterprise").toLowerCase()} Role`;
  const displayImageDataUrl = user?.displayImageDataUrl ?? null;
  const sealUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Seal_of_San_Pedro%2C_Laguna.png/1280px-Seal_of_San_Pedro%2C_Laguna.png";

  const navPillBase = "flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 max-2xl:px-3.5";
  const navPillActive = "bg-white/18 text-white shadow-[0_12px_28px_rgba(8,44,20,0.42)] ring-1 ring-white/22";
  const navPillInactive = "text-white/84 hover:-translate-y-0.5 hover:bg-white/13 hover:text-white hover:shadow-[0_10px_24px_rgba(3,38,16,0.34)]";
  const visibleNavigation = useMemo(() => enterpriseNavigation.filter((item) => item.id !== "simulation" || showSimulation), [showSimulation]);

  const navButtons = useMemo(
    () =>
      visibleNavigation.map((item) => {
        const Icon = item.icon;
        const isActive = activeView === item.id;
        return (
          <button key={item.id} type="button" onClick={() => onNavigate(item.id)} className={[navPillBase, isActive ? navPillActive : navPillInactive].join(" ")}>
            <Icon size={16} className="shrink-0" />
            {item.label}
          </button>
        );
      }),
    [activeView, navPillActive, navPillBase, navPillInactive, onNavigate, visibleNavigation],
  );

  return (
    <div className="sticky top-0 z-1000 w-full text-white">
      <div className="enterprise-topbar relative overflow-visible shadow-[0_16px_40px_rgba(2,20,8,0.34)] ring-1 ring-white/10">
        <div className="relative z-10 flex h-22 items-center gap-5 px-8 max-2xl:gap-4 max-xl:px-6 max-sm:h-18 max-sm:px-4">
          <button type="button" onClick={() => onNavigate("dashboard")} className="flex shrink-0 items-center gap-4">
            <img src={sealUrl} alt="San Pedro Seal" className="h-12 w-12 rounded-full border border-white/25 bg-white/12 p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.26)] max-sm:h-10 max-sm:w-10" />
            <div className="flex items-center gap-4 max-sm:gap-3">
              <span className="font-display text-2xl font-bold tracking-wide drop-shadow-sm max-sm:text-lg">TANAW</span>
              <span className="h-9 w-px bg-white/18 max-sm:h-7" />
              <span className="text-[11px] font-semibold tracking-[0.28em] text-emerald-100/90 uppercase max-sm:hidden">Enterprise Portal</span>
            </div>
          </button>

          <span className="hidden h-9 w-px shrink-0 bg-white/16 xl:block" />

          <nav className="hidden flex-none items-center justify-start gap-3 xl:flex 2xl:gap-4" aria-label="Enterprise navigation">
            {navButtons}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-3 max-sm:gap-2">
            <button
              type="button"
              aria-label={showMobileNav ? "Close navigation" : "Open navigation"}
              onClick={() => setShowMobileNav((current) => !current)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-emerald-100/25 bg-white/8 text-white shadow-sm backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white/[0.14] hover:shadow-lg xl:hidden"
            >
              {showMobileNav ? <X size={18} /> : <Menu size={18} />}
            </button>

            <button
              type="button"
              aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => {
                setShowProfileMenu(false);
                onNotificationsClose();
                onToggleTheme();
              }}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-emerald-100/28 bg-white/8 text-white shadow-sm backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/[0.14] hover:shadow-[0_10px_24px_rgba(3,38,16,0.34)] active:translate-y-0"
            >
              {resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <div ref={notificationMenuRef} className="relative z-1002">
              <NotificationDropdown
                isOpen={isNotificationsOpen}
                notifications={notifications}
                unreadCount={unreadCount}
                showSettings={showNotificationSettings}
                occupancyThreshold={occupancyThreshold}
                triggerVariant="topbar"
                onToggleOpen={() => {
                  setShowProfileMenu(false);
                  onNotificationsToggle();
                }}
                onToggleSettings={onToggleNotificationSettings}
                onMarkAllRead={onMarkAllRead}
                onSelectNotification={onNotificationSelect}
                onSetOccupancyThreshold={onSetOccupancyThreshold}
                onViewAll={() => onNavigate("notifications")}
              />
            </div>

            <div ref={profileMenuRef} className="relative z-1002">
              <button
                type="button"
                aria-label="Open account menu"
                onClick={() => {
                  setShowProfileMenu((current) => !current);
                  onNotificationsClose();
                }}
                className="flex min-w-60.5 items-center gap-3 rounded-full border border-emerald-100/28 bg-white/8 py-2 pr-4 pl-2 text-white shadow-[0_10px_24px_rgba(2,20,8,0.22)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-100/40 hover:bg-white/[0.14] hover:shadow-[0_14px_32px_rgba(2,20,8,0.3)] active:translate-y-0 max-2xl:min-w-56 max-sm:min-w-0 max-sm:pr-2.5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/45 bg-[#087333] text-sm font-bold text-white shadow-inner ring-1 ring-emerald-100/30 max-sm:h-9 max-sm:w-9">
                  {displayImageDataUrl ? <img src={displayImageDataUrl} alt="" className="h-full w-full object-cover" /> : initials}
                </div>
                <div className="hidden min-w-0 flex-1 text-left lg:block">
                  <p className="truncate text-sm leading-tight font-bold text-white drop-shadow-sm">{displayName}</p>
                  <p className="mt-0.5 text-[11px] leading-tight text-emerald-50/78">{roleSubtitle}</p>
                </div>
                <ChevronDown size={15} className={`ml-auto shrink-0 text-emerald-50/75 transition-transform duration-200 ${showProfileMenu ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {showProfileMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="enterprise-profile-menu absolute top-full right-0 z-1003 mt-3 w-72 overflow-hidden rounded-3xl border border-white/85 bg-white py-2 text-slate-700 shadow-[0_24px_64px_rgba(2,20,8,0.24)] ring-1 ring-emerald-950/6"
                  >
                    <div className="enterprise-profile-menu__header mb-1 border-b border-emerald-100 bg-linear-to-r from-emerald-50/90 via-white to-amber-50/70 px-4 py-3.5">
                      <p className="text-tanaw-navy text-sm font-bold">{displayName}</p>
                      <p className="truncate text-xs text-gray-500">{profileEmail}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigateFromMenu("profile")}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-emerald-50 hover:text-[#065f46]"
                    >
                      <User size={14} /> Edit Profile Info
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateFromMenu("security")}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-emerald-50 hover:text-[#065f46]"
                    >
                      <Shield size={14} /> Security & Data Control
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateFromMenu("tickets")}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-emerald-50 hover:text-[#065f46]"
                    >
                      <LifeBuoy size={14} /> Support Tickets
                    </button>
                    <button type="button" onClick={onLogout} className="text-tanaw-red flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-red-50">
                      <LogOut size={14} /> Sign Out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showMobileNav && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="bg-tanaw-green/95 border-t border-white/10 px-6 pb-4 max-sm:px-4"
          >
            <nav className="grid gap-2 pt-4" aria-label="Enterprise mobile navigation">
              {visibleNavigation.map((item) => {
                const Icon = item.icon;
                const isActive = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onNavigate(item.id);
                      setShowMobileNav(false);
                    }}
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all ${isActive ? "bg-[#45a549]/30 text-white shadow-md shadow-black/10" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
                  >
                    <Icon size={16} className="shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  function navigateFromMenu(view: EnterpriseView) {
    setShowProfileMenu(false);
    onNavigate(view);
  }
}
