import { BookOpen, ChevronDown, LogOut, Menu, Moon, Settings, Shield, SlidersHorizontal, Sun, TicketCheck, User, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast/headless";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/app/store/authStore";
import { routes } from "@/app/routers/routes";
import { logoutSession } from "@/shared/services/sessionService";
import { CITY_SEAL } from "@/shared/constants/branding";
import { roleAccessLabel, rolePortalLabel } from "@/shared/constants/roleLabels";
import { PortalNotificationDropdown, usePortalNotifications } from "@/features/notifications/portal";
import { getRoleDashboardPath, getRoleDisplayPreferencesPath, getRoleHelpPath, getRoleProfilePath, getRoleSecurityPath } from "@/app/routers/roleRoutes";
import type { UserRole } from "@/shared/types/role.types";
import { getPortalTopbarThemeClasses } from "./portalTopbarTheme";
import { publishSessionEvent } from "@/shared/utils/sessionSync";
import { usePortalThemePreference } from "./hooks/usePortalThemePreference";
import { DesktopPortalNavigation, MobilePortalNavigation } from "./PortalNavigation";
import { getPortalNavigation, getTopbarEntries } from "./portalNavigationModel";

type PortalTopbarProps = {
  role: UserRole;
  showDevLog?: boolean;
};

export function PortalBrand({ role }: { role: UserRole }) {
  return (
    <div className="flex shrink-0 items-center gap-4">
      <Link to={getRoleDashboardPath(role)} aria-label="Open TANAW dashboard" className="flex items-center gap-4">
        <img src={CITY_SEAL} alt="San Pedro Seal" className="h-12 w-12 rounded-full border border-white/25 bg-white/12 p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.26)] max-sm:h-10 max-sm:w-10" />
        <span className="font-display text-2xl font-bold tracking-wide drop-shadow-sm max-sm:text-lg">TANAW</span>
      </Link>
      <span className="h-9 w-px bg-white/18 max-sm:h-7" aria-hidden="true" />
      <span data-portal-role-label className="text-[11px] font-semibold tracking-[0.28em] text-emerald-100/90 uppercase max-sm:hidden">
        {rolePortalLabel[role]}
      </span>
    </div>
  );
}

export function PortalTopbar({ role, showDevLog = false }: PortalTopbarProps) {
  const authUser = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const { resolvedTheme, toggleTheme } = usePortalThemePreference();
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const notificationMenuRef = useRef<HTMLDivElement>(null);
  const navMenuRef = useRef<HTMLDivElement>(null);
  const { isLoading: isLoadingNotifications, markAllAsRead, markAsRead, notifications, unreadCount, viewAllPath } = usePortalNotifications(role);

  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount > 99 ? "99+" : unreadCount}) TANAW Portal` : "TANAW Portal";
    return () => {
      document.title = "TANAW Portal";
    };
  }, [unreadCount]);

  const profile = {
    name: authUser?.displayName ?? "TANAW User",
    email: authUser?.email ?? "",
    department: authUser?.title ?? "City Tourism Operations",
    displayImageDataUrl: authUser?.displayImageDataUrl ?? null,
  };

  const initials = useMemo(
    () =>
      profile.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase(),
    [profile.name],
  );

  const handleLogout = async () => {
    setShowProfileMenu(false);
    try {
      await logoutSession();
    } catch {
      toast.error("Logout log was not recorded, but your local session was cleared.");
    } finally {
      queryClient.clear();
      logout();
      publishSessionEvent({ type: "logout", occurredAt: Date.now() });
      toast.success("Logout complete");
      navigate(routes.login, { replace: true });
    }
  };

  const openAccountPage = (page: "profile" | "security") => {
    setShowProfileMenu(false);
    navigate(page === "profile" ? getRoleProfilePath(role) : getRoleSecurityPath(role));
  };

  const openSupportTickets = () => {
    const supportTicketsPath = getRoleSupportTicketsPath(role);
    if (!supportTicketsPath) return;
    setShowProfileMenu(false);
    navigate(supportTicketsPath);
  };

  const handleNotificationSelect = (notificationId: string, targetPath?: string) => {
    markAsRead(notificationId);
    setShowNotifications(false);
    setOpenMenuId(null);
    setShowMobileNav(false);
    if (targetPath) {
      navigate(targetPath);
    }
  };

  const handleViewAllNotifications = () => {
    setShowNotifications(false);
    setOpenMenuId(null);
    setShowMobileNav(false);
    if (viewAllPath) {
      navigate(viewAllPath);
    }
  };

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
    if (!showNotifications) return undefined;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!notificationMenuRef.current?.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [showNotifications]);

  useEffect(() => {
    if (!openMenuId) return undefined;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!navMenuRef.current?.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [openMenuId]);

  useEffect(() => {
    if (!openMenuId && !showProfileMenu && !showMobileNav && !showNotifications) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      setOpenMenuId(null);
      setShowProfileMenu(false);
      setShowMobileNav(false);
      setShowNotifications(false);
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [openMenuId, showProfileMenu, showMobileNav, showNotifications]);

  const navigation = useMemo(() => getPortalNavigation(role, showDevLog), [role, showDevLog]);
  const topbarItems = useMemo(() => getTopbarEntries(role, navigation), [navigation, role]);

  const isDarkTopbar = resolvedTheme === "dark";
  const topbarThemeClasses = getPortalTopbarThemeClasses(resolvedTheme);
  const topbarIconButton = isDarkTopbar
    ? "border-emerald-100/14 bg-black/18 text-white/88 hover:border-emerald-100/24 hover:bg-emerald-200/9"
    : "border-emerald-100/28 bg-white/8 text-white hover:bg-white/[0.14]";
  const accountButtonTheme = isDarkTopbar
    ? "border-emerald-100/14 bg-black/18 hover:border-emerald-100/24 hover:bg-emerald-200/9"
    : "border-emerald-100/28 bg-white/8 hover:border-emerald-100/40 hover:bg-white/[0.14]";
  const profilePath = getRoleProfilePath(role);
  const securityPath = getRoleSecurityPath(role);
  const supportTicketsPath = getRoleSupportTicketsPath(role);
  const displayPreferencesPath = getRoleDisplayPreferencesPath(role);
  const helpPath = getRoleHelpPath(role);
  const accountMenuButtonClass = (targetPath: string) => ["profile-menu-button", pathname === targetPath ? "bg-tanaw-green/10 text-tanaw-green" : ""].filter(Boolean).join(" ");

  return (
    <div className="sticky top-0 z-1000 w-full text-white">
      <div data-topbar-theme={resolvedTheme} className={`relative overflow-visible ${topbarThemeClasses.frame}`}>
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-[58%] mask-[linear-gradient(90deg,transparent,black_22%,black)] max-lg:w-[76%]">
          <div
            data-topbar-image="day"
            className={`absolute inset-0 bg-cover bg-center mix-blend-screen transition-opacity duration-350 motion-reduce:transition-none ${topbarThemeClasses.imageTreatment} ${topbarThemeClasses.dayImage}`}
            style={{ backgroundImage: "url('/images/it-topbar-building.png')" }}
          />
          <div
            data-topbar-image="night"
            className={`absolute inset-0 bg-cover bg-center mix-blend-screen transition-opacity duration-350 motion-reduce:transition-none ${topbarThemeClasses.imageTreatment} ${topbarThemeClasses.nightImage}`}
            style={{ backgroundImage: "url('/images/it-topbar-building-night.png')" }}
          />
        </div>
        <div className={`pointer-events-none absolute inset-0 ${topbarThemeClasses.overlay}`} />
        <div
          className={`pointer-events-none absolute inset-0 ${isDarkTopbar ? "bg-[radial-gradient(circle_at_top_left,rgba(110,231,183,0.055),transparent_34%),radial-gradient(circle_at_top_right,rgba(52,211,153,0.08),transparent_44%)]" : "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_32%),radial-gradient(circle_at_top_right,rgba(69,165,73,0.2),transparent_42%)]"}`}
        />
        <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-px ${isDarkTopbar ? "bg-emerald-100/10" : "bg-white/18"}`} />

        <div className="relative z-10 flex h-22 items-center gap-5 px-8 max-2xl:gap-4 max-xl:px-6 max-sm:h-18 max-sm:px-4">
          <PortalBrand role={role} />

          <span className="hidden h-9 w-px shrink-0 bg-white/16 xl:block" />

          <div ref={navMenuRef}>
            <DesktopPortalNavigation entries={topbarItems} isDark={isDarkTopbar} openMenuId={openMenuId} pathname={pathname} role={role} onMenuChange={setOpenMenuId} />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-3 max-sm:gap-2">
            <button
              type="button"
              aria-label={showMobileNav ? "Close navigation" : "Open navigation"}
              onClick={() => setShowMobileNav((current) => !current)}
              className={`flex h-11 w-11 items-center justify-center rounded-full border shadow-sm backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg xl:hidden ${topbarIconButton}`}
            >
              {showMobileNav ? <X size={18} /> : <Menu size={18} />}
            </button>

            <button
              type="button"
              aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => {
                setShowProfileMenu(false);
                setShowNotifications(false);
                setOpenMenuId(null);
                toggleTheme();
              }}
              className={`flex h-11 w-11 items-center justify-center rounded-full border shadow-sm backdrop-blur-md transition-[background-color,border-color,color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(3,38,16,0.34)] active:translate-y-0 ${topbarIconButton}`}
            >
              {resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <div ref={notificationMenuRef} className="relative">
              <PortalNotificationDropdown
                isOpen={showNotifications}
                isLoading={isLoadingNotifications}
                notifications={notifications}
                unreadCount={unreadCount}
                viewAllPath={viewAllPath}
                onMarkAllRead={markAllAsRead}
                onSelectNotification={(notification) => handleNotificationSelect(notification.id, notification.targetPath)}
                onToggle={() => {
                  setShowNotifications((current) => !current);
                  setShowProfileMenu(false);
                  setOpenMenuId(null);
                }}
                onViewAll={handleViewAllNotifications}
                triggerClassName={topbarIconButton}
              />
            </div>

            <div ref={profileMenuRef} className="relative">
              <button
                type="button"
                aria-label="Open account menu"
                onClick={() => {
                  setShowProfileMenu((current) => !current);
                  setShowNotifications(false);
                }}
                className={`flex w-60.5 max-w-[28vw] items-center gap-3 rounded-full border py-2 pr-4 pl-2 text-white shadow-[0_10px_24px_rgba(2,20,8,0.22)] backdrop-blur-md transition-[background-color,border-color,color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(2,20,8,0.3)] active:translate-y-0 max-2xl:w-56 max-sm:w-auto max-sm:max-w-none max-sm:pr-2.5 ${accountButtonTheme}`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/45 bg-[#087333] text-sm font-bold text-white shadow-inner ring-1 ring-emerald-100/30 max-sm:h-9 max-sm:w-9">
                  {profile.displayImageDataUrl ? <img src={profile.displayImageDataUrl} alt="" className="h-full w-full object-cover" /> : initials}
                </div>
                <div className="hidden min-w-0 flex-1 text-left lg:block">
                  <p className="truncate text-sm leading-tight font-bold text-white drop-shadow-sm">{profile.name}</p>
                  <p className="mt-0.5 text-[11px] leading-tight text-emerald-50/78">{roleAccessLabel[role]}</p>
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
                    className="absolute right-0 z-1001 mt-3 max-h-[calc(100svh-var(--tanaw-topbar-height)-1rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-white/80 bg-white py-2 text-slate-700 shadow-[0_18px_44px_rgba(15,23,42,0.18)] ring-1 ring-slate-900/4"
                  >
                    <div className="mb-1 border-b border-slate-100 px-4 py-3.5">
                      <p title={profile.name} className="text-tanaw-navy truncate text-sm font-bold">
                        {profile.name}
                      </p>
                      <p title={profile.email} className="truncate text-xs text-gray-500">
                        {profile.email}
                      </p>
                    </div>
                    <button type="button" onClick={() => openAccountPage("profile")} className={accountMenuButtonClass(profilePath)}>
                      <User size={14} /> Profile Settings
                    </button>
                    <button type="button" onClick={() => openAccountPage("security")} className={accountMenuButtonClass(securityPath)}>
                      <Shield size={14} /> Password Settings
                    </button>
                    <button type="button" onClick={() => { setShowProfileMenu(false); navigate(displayPreferencesPath); }} className={accountMenuButtonClass(displayPreferencesPath)}>
                      <SlidersHorizontal size={14} /> Display Preferences
                    </button>
                    <button type="button" onClick={() => { setShowProfileMenu(false); navigate(helpPath); }} className={accountMenuButtonClass(helpPath)}>
                      <BookOpen size={14} /> Help Center
                    </button>
                    {role === "it" && (
                      <button type="button" onClick={() => { setShowProfileMenu(false); navigate(routes.it.systemSettings); }} className={accountMenuButtonClass(routes.it.systemSettings)}>
                        <Settings size={14} /> System Settings
                      </button>
                    )}
                    {supportTicketsPath && (
                      <button type="button" onClick={openSupportTickets} className={accountMenuButtonClass(supportTicketsPath)}>
                        <TicketCheck size={14} /> Support Tickets
                      </button>
                    )}
                    <button type="button" onClick={handleLogout} className="profile-menu-button profile-menu-danger">
                      <LogOut size={14} /> Logout
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>{showMobileNav && <MobilePortalNavigation entries={topbarItems} isDark={isDarkTopbar} role={role} onNavigate={() => setShowMobileNav(false)} />}</AnimatePresence>
    </div>
  );
}

function getRoleSupportTicketsPath(role: UserRole) {
  if (role === "admin") return `${routes.admin.operations}?view=support`;
  return null;
}
