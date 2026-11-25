import { Camera, FileText, LayoutDashboard, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { TopbarAccount } from "../../ui-kit/patterns/TopbarAccount";
import { TopbarNavigation } from "../../ui-kit/patterns/TopbarNavigation";
import { NotificationDropdown } from "../../features/notifications/components/NotificationDropdown";
import type { AuthUser } from "../../features/login/types";
import type { EnterpriseNotification, EnterpriseView } from "../../types/enterprise";
import { getEnterpriseTopbarControlClasses } from "./enterpriseTopbarTheme";
import { TANAW_LOGO } from "../../lib/assets";

type EnterpriseTopbarProps = {
  activeView: EnterpriseView;
  displayName: string;
  isNotificationsOpen: boolean;
  notifications: EnterpriseNotification[];
  resolvedTheme: "light" | "dark";
  unreadCount: number;
  user?: AuthUser | null;
  onLogout: () => void;
  onMarkAllRead: () => void;
  onNavigate: (view: EnterpriseView) => void;
  onNavigateIntent: (view: EnterpriseView) => void;
  onNotificationSelect: (notification: EnterpriseNotification) => void;
  onNotificationsClose: () => void;
  onNotificationsToggle: () => void;
  onOpenSettings: (profile?: boolean) => void;
};

const enterpriseNavigation = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "cameras", label: "Camera Setup", icon: Camera },
  { id: "reports", label: "Reports", icon: FileText },
] as const satisfies { id: EnterpriseView; label: string; icon: typeof LayoutDashboard }[];

export function EnterpriseBrand() {
  return (
    <div className="flex shrink-0 items-center gap-4 max-sm:gap-2">
      <div className="flex items-center gap-4 max-sm:gap-2">
        <img src={TANAW_LOGO} alt="" className="h-10 w-14 rounded-lg object-cover max-sm:h-7 max-sm:w-10" />
        <span className="font-display text-2xl font-bold tracking-wide drop-shadow-sm max-sm:text-base">TANAW</span>
      </div>
      <span className="h-9 w-px bg-white/18 max-sm:hidden" aria-hidden="true" />
      <span data-portal-role-label className="text-[11px] font-semibold tracking-[0.28em] text-emerald-100/90 uppercase max-sm:hidden">
        Enterprise Portal
      </span>
    </div>
  );
}

export function EnterpriseTopbar({
  activeView,
  displayName,
  isNotificationsOpen,
  notifications,
  resolvedTheme,
  unreadCount,
  user,
  onLogout,
  onMarkAllRead,
  onNavigate,
  onNavigateIntent,
  onNotificationSelect,
  onNotificationsClose,
  onNotificationsToggle,
  onOpenSettings,
}: EnterpriseTopbarProps) {
  const [showMobileNav, setShowMobileNav] = useState(false);
  const notificationMenuRef = useRef<HTMLDivElement>(null);

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
    if (!showMobileNav && !isNotificationsOpen) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowMobileNav(false);
      onNotificationsClose();
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isNotificationsOpen, onNotificationsClose, showMobileNav]);

  const isDarkTopbar = resolvedTheme === "dark";
  const controlClasses = getEnterpriseTopbarControlClasses(resolvedTheme);
  const navItemBase = "relative z-10 isolate flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors duration-200 max-2xl:px-3.5";
  const navItemActive = "text-white";
  const navItemInactive = isDarkTopbar ? "text-white/72" : "text-white/84";
  const activeTab = enterpriseNavigation.find((item) => item.id === activeView)?.id ?? null;
  const navButtons = enterpriseNavigation.map((item) => {
    const Icon = item.icon;
    const isActive = activeView === item.id;
    return (
      <button
        key={item.id}
        type="button"
        data-topbar-navigation={item.id}
        aria-current={isActive ? "page" : undefined}
        onClick={() => onNavigate(item.id)}
        onFocus={() => onNavigateIntent(item.id)}
        onPointerEnter={() => onNavigateIntent(item.id)}
        onTouchStart={() => onNavigateIntent(item.id)}
        className={[navItemBase, isActive ? navItemActive : navItemInactive].join(" ")}
      >
        <span className="relative z-10 flex items-center gap-2">
          <Icon size={16} className="shrink-0" />
          <span data-topbar-label>{item.label}</span>
        </span>
      </button>
    );
  });

  return (
    <div className="sticky top-0 z-1000 w-full text-white">
      <div data-topbar-theme={resolvedTheme} className="enterprise-topbar relative overflow-visible shadow-[0_16px_40px_rgba(2,20,8,0.34)] ring-1 ring-white/10">
        <div className="enterprise-topbar__building" aria-hidden="true">
          <div data-topbar-image="day" className="enterprise-topbar__image enterprise-topbar__image--day" />
          <div data-topbar-image="night" className="enterprise-topbar__image enterprise-topbar__image--night" />
        </div>
        <div className="enterprise-topbar__overlay" aria-hidden="true" />
        <div className="relative z-10 flex h-22 items-center gap-5 px-8 max-2xl:gap-4 max-xl:px-6 max-sm:h-18 max-sm:gap-1 max-sm:px-2">
          <EnterpriseBrand />

          <span className="hidden h-9 w-px shrink-0 bg-white/16 xl:block" />

          <TopbarNavigation
            activeId={activeTab}
            className="relative isolate hidden flex-none items-center justify-start gap-3 xl:flex 2xl:gap-4"
            aria-label="Enterprise navigation"
            onDragStart={(event) => event.preventDefault()}
          >
            {navButtons}
          </TopbarNavigation>

          <button
            type="button"
            aria-label={showMobileNav ? "Close navigation" : "Open navigation"}
            onClick={() => setShowMobileNav((current) => !current)}
            className={`tanaw-topbar-compact-control flex h-11 w-11 items-center justify-center rounded-full border shadow-sm backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg xl:hidden ${controlClasses.icon}`}
          >
            {showMobileNav ? <X size={18} /> : <Menu size={18} />}
          </button>

          <div className="relative ml-auto flex shrink-0 items-center gap-2 max-sm:gap-1">
            <div ref={notificationMenuRef} className="sm:relative">
              <NotificationDropdown
                isOpen={isNotificationsOpen}
                notifications={notifications}
                unreadCount={unreadCount}
                triggerVariant={isDarkTopbar ? "topbar-dark" : "topbar"}
                onToggleOpen={onNotificationsToggle}
                onMarkAllRead={onMarkAllRead}
                onSelectNotification={onNotificationSelect}
                onViewAll={() => onNavigate("notifications")}
              />
            </div>

            <TopbarAccount
              account={{ name: displayName, email: user?.email, image: user?.displayImageDataUrl, role: "Enterprise Account" }}
              activeAction={activeView === "settings" || activeView === "help" ? activeView : undefined}
              onEditProfile={() => onOpenSettings(true)}
              onSettings={() => onOpenSettings()}
              onHelp={() => onNavigate("help")}
              onSignOut={onLogout}
              onOpen={() => {
                onNotificationsClose();
                setShowMobileNav(false);
              }}
            />
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
            className={`border-t px-6 pb-4 max-sm:px-4 ${isDarkTopbar ? "border-emerald-100/10 bg-[#04110f]/98" : "bg-tanaw-green/95 border-white/10"}`}
          >
            <TopbarNavigation activeId={activeTab} className="relative isolate grid gap-2 pt-4" aria-label="Enterprise mobile navigation">
              {enterpriseNavigation.map((item) => {
                const Icon = item.icon;
                const isActive = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-topbar-navigation={item.id}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => {
                      onNavigate(item.id);
                      setShowMobileNav(false);
                    }}
                    onFocus={() => onNavigateIntent(item.id)}
                    onPointerEnter={() => onNavigateIntent(item.id)}
                    onTouchStart={() => onNavigateIntent(item.id)}
                    className={`relative z-10 flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${isActive ? "text-white" : "text-white/80"}`}
                  >
                    <Icon size={16} className="shrink-0" />
                    <span data-topbar-label>{item.label}</span>
                  </button>
                );
              })}
            </TopbarNavigation>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
