import { Activity, ChevronDown, LogOut, Menu, Moon, Settings, Shield, Sun, TicketCheck, User, Users, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast/headless";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/app/store/authStore";
import { routes } from "@/app/routers/routes";
import { logoutService } from "@/features/login/services";
import { CITY_SEAL } from "../../constants/branding";
import { usePortalNotifications } from "../../hooks/usePortalNotifications";
import { getAccountPreferences, updateAccountPreferences } from "../../services/accountManagement";
import { getRoleDashboardPath, getRoleProfilePath, getRoleSecurityPath } from "../../utils/routeUtils";
import { applyThemePreference, chooseAuthenticatedThemePreference, getStoredThemePreference, getStoredThemePreferenceOrNull, persistThemePreference, resolveThemePreference } from "../../utils/theme";
import type { ResolvedTheme, ThemePreference } from "../../utils/theme";
import type { UserRole } from "../../types/role.types";
import { PortalNotificationDropdown } from "./PortalNotificationDropdown";
import type { NavigationItem } from "./navigation";
import { roleAccessLabel, roleNavigation, rolePortalLabel } from "./navigation";
import { getPortalTopbarThemeClasses } from "./portalTopbarTheme";
import { publishSessionEvent } from "../../utils/sessionSync";

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
  const [theme, setTheme] = useState<ThemePreference>(getStoredThemePreference);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveThemePreference(getStoredThemePreference()));
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const notificationMenuRef = useRef<HTMLDivElement>(null);
  const navMenuRef = useRef<HTMLDivElement>(null);
  const skipNextThemeSaveRef = useRef(true);
  const storedThemeAtMountRef = useRef<ThemePreference | null>(getStoredThemePreferenceOrNull());
  const themeRef = useRef(theme);
  const userSelectedThemeRef = useRef(false);
  const { isLoading: isLoadingNotifications, markAllAsRead, markAsRead, notifications, unreadCount, viewAllPath } = usePortalNotifications(role);

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
      await logoutService();
    } catch {
      toast.error("Logout log was not recorded, but your local session was cleared.");
    } finally {
      queryClient.removeQueries({ queryKey: ["current-user"] });
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

  const openSystemSettings = () => {
    setShowProfileMenu(false);
    navigate(routes.it.systemSettings);
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

  const toggleTheme = () => {
    userSelectedThemeRef.current = true;
    setTheme((currentTheme) => (resolveThemePreference(currentTheme) === "dark" ? "light" : "dark"));
  };

  useEffect(() => {
    let disposed = false;
    void getAccountPreferences()
      .then((preferences) => {
        if (disposed) return;

        const localPreference = userSelectedThemeRef.current ? themeRef.current : storedThemeAtMountRef.current;
        const nextTheme = chooseAuthenticatedThemePreference(localPreference, preferences.theme);
        if (nextTheme !== themeRef.current) {
          themeRef.current = nextTheme;
          setTheme(nextTheme);
        }
        persistThemePreference(nextTheme);
        if (preferences.theme !== nextTheme) {
          void updateAccountPreferences(nextTheme).catch(() => undefined);
        }
        setPreferencesLoaded(true);
      })
      .catch(() => {
        if (!disposed) {
          setPreferencesLoaded(true);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    themeRef.current = theme;
    const applyTheme = () => {
      setResolvedTheme(applyThemePreference(theme));
    };

    persistThemePreference(theme);
    applyTheme();

    if (theme !== "system") return undefined;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    if (skipNextThemeSaveRef.current) {
      skipNextThemeSaveRef.current = false;
      return;
    }
    void updateAccountPreferences(theme).catch(() => toast.error("Unable to save theme preference."));
  }, [preferencesLoaded, theme]);

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

  const navigation = useMemo(() => {
    const items = roleNavigation[role] ?? [];
    if (role !== "it" || showDevLog) return items;
    return items.filter((item) => item.id !== "dev-log");
  }, [role, showDevLog]);

  type TopbarEntry = { type: "link"; item: NavigationItem } | { type: "menu"; id: string; label: string; icon: NavigationItem["icon"]; children: NavigationItem[] };

  const topbarItems = useMemo<TopbarEntry[]>(() => {
    if (role !== "it") {
      return navigation.map((item) => ({ type: "link", item }));
    }

    const getItem = (id: string) => navigation.find((entry) => entry.id === id);
    const dashboard = getItem("dashboard");
    const lguAccounts = getItem("lgu-accounts");
    const enterpriseAccounts = getItem("enterprise-accounts");
    const alerts = getItem("alerts");
    const systemLogs = getItem("system-logs");
    const emailDeliveries = getItem("email-deliveries");
    const devLog = getItem("dev-log");

    const items: TopbarEntry[] = [];

    if (dashboard) {
      items.push({ type: "link", item: dashboard });
    }

    const accountsChildren = [lguAccounts, enterpriseAccounts].filter(Boolean) as NavigationItem[];
    if (accountsChildren.length) {
      items.push({
        type: "menu",
        id: "accounts-management",
        label: "Accounts Management",
        icon: Users,
        children: accountsChildren,
      });
    }

    const monitoringChildren = [alerts, systemLogs, emailDeliveries].filter(Boolean) as NavigationItem[];
    if (monitoringChildren.length) {
      items.push({
        type: "menu",
        id: "monitoring",
        label: "Monitoring",
        icon: Activity,
        children: monitoringChildren,
      });
    }

    if (devLog) {
      items.push({ type: "link", item: devLog });
    }

    return items;
  }, [navigation, role]);

  const isDarkTopbar = resolvedTheme === "dark";
  const topbarThemeClasses = getPortalTopbarThemeClasses(resolvedTheme);
  const navPillBase = "flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-[color,background-color,box-shadow,transform] duration-200 max-2xl:px-3.5";
  const navPillActive = isDarkTopbar
    ? "bg-emerald-300/10 text-white shadow-[0_12px_30px_rgba(0,0,0,0.46)] ring-1 ring-emerald-100/14"
    : "bg-white/18 text-white shadow-[0_12px_28px_rgba(8,44,20,0.42)] ring-1 ring-white/22";
  const navPillInactive = isDarkTopbar
    ? "text-white/72 hover:-translate-y-0.5 hover:bg-white/7 hover:text-white hover:shadow-[0_10px_26px_rgba(0,0,0,0.38)]"
    : "text-white/84 hover:-translate-y-0.5 hover:bg-white/13 hover:text-white hover:shadow-[0_10px_24px_rgba(3,38,16,0.34)]";
  const topbarIconButton = isDarkTopbar
    ? "border-emerald-100/14 bg-black/18 text-white/88 hover:border-emerald-100/24 hover:bg-emerald-200/9"
    : "border-emerald-100/28 bg-white/8 text-white hover:bg-white/[0.14]";
  const accountButtonTheme = isDarkTopbar
    ? "border-emerald-100/14 bg-black/18 hover:border-emerald-100/24 hover:bg-emerald-200/9"
    : "border-emerald-100/28 bg-white/8 hover:border-emerald-100/40 hover:bg-white/[0.14]";
  const profilePath = getRoleProfilePath(role);
  const securityPath = getRoleSecurityPath(role);
  const supportTicketsPath = getRoleSupportTicketsPath(role);
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

          <nav ref={navMenuRef} className="hidden flex-none items-center justify-start gap-3 xl:flex 2xl:gap-4" aria-label={`${rolePortalLabel[role]} navigation`}>
            {topbarItems.map((entry) => {
              if (entry.type === "link") {
                const Icon = entry.item.icon;
                return (
                  <NavLink
                    key={entry.item.id}
                    to={entry.item.path}
                    onClick={() => setOpenMenuId(null)}
                    className={({ isActive }) => [navPillBase, isActive ? navPillActive : navPillInactive].join(" ")}
                  >
                    <Icon size={16} className="shrink-0" />
                    {entry.item.label}
                  </NavLink>
                );
              }

              const isMenuActive = entry.children.some((child) => pathname.startsWith(child.path));
              const isMenuOpen = openMenuId === entry.id;
              const MenuIcon = entry.icon;

              return (
                <div key={entry.id} className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={isMenuOpen}
                    onClick={() => setOpenMenuId((current) => (current === entry.id ? null : entry.id))}
                    className={[navPillBase, isMenuActive || isMenuOpen ? navPillActive : navPillInactive].join(" ")}
                  >
                    <MenuIcon size={16} className="shrink-0" />
                    {entry.label}
                    <ChevronDown size={14} className={`ml-1 transition-transform duration-200 ${isMenuOpen ? "rotate-180" : ""}`} />
                  </button>

                  <AnimatePresence>
                    {isMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.98 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        className="absolute top-full left-0 z-1001 mt-4 w-64 overflow-hidden rounded-2xl border border-white/80 bg-white p-2.5 text-slate-700 shadow-[0_18px_44px_rgba(15,23,42,0.18)] ring-1 ring-slate-900/5"
                      >
                        {entry.children.map((child) => {
                          const ChildIcon = child.icon;
                          return (
                            <NavLink
                              key={child.id}
                              to={child.path}
                              onClick={() => setOpenMenuId(null)}
                              className={({ isActive }) =>
                                [
                                  "flex items-center gap-3 rounded-xl px-4 py-2 text-sm font-semibold transition",
                                  isActive ? "bg-tanaw-green/10 text-tanaw-green" : "hover:text-tanaw-green text-slate-700 hover:bg-slate-50",
                                ].join(" ")
                              }
                            >
                              <ChildIcon size={15} className="shrink-0" />
                              {child.label}
                            </NavLink>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </nav>

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
                    className="absolute right-0 z-1001 mt-3 w-72 overflow-hidden rounded-2xl border border-white/80 bg-white py-2 text-slate-700 shadow-[0_18px_44px_rgba(15,23,42,0.18)] ring-1 ring-slate-900/4"
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
                    {supportTicketsPath && (
                      <button type="button" onClick={openSupportTickets} className={accountMenuButtonClass(supportTicketsPath)}>
                        <TicketCheck size={14} /> Support Tickets
                      </button>
                    )}
                    {role === "it" && (
                      <button type="button" onClick={openSystemSettings} className={accountMenuButtonClass(routes.it.systemSettings)}>
                        <Settings size={14} /> System Settings
                      </button>
                    )}
                    <button type="button" onClick={handleLogout} className="text-tanaw-red flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold transition-colors hover:bg-red-50">
                      <LogOut size={14} /> Logout
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
            className={`border-t px-6 pb-4 max-sm:px-4 ${isDarkTopbar ? "border-emerald-100/10 bg-[#04110f]/98" : "bg-tanaw-green/95 border-white/10"}`}
          >
            <nav className="grid gap-4 pt-4" aria-label={`${rolePortalLabel[role]} mobile navigation`}>
              {topbarItems.map((entry) => {
                if (entry.type === "link") {
                  const Icon = entry.item.icon;
                  return (
                    <NavLink
                      key={entry.item.id}
                      to={entry.item.path}
                      onClick={() => setShowMobileNav(false)}
                      className={({ isActive }) =>
                        [
                          "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-[background-color,color,box-shadow]",
                          isActive ? "bg-tanaw-lime/30 text-white shadow-md shadow-black/10" : "text-white/80 hover:bg-white/10 hover:text-white",
                        ].join(" ")
                      }
                    >
                      <Icon size={16} className="shrink-0" />
                      {entry.item.label}
                    </NavLink>
                  );
                }

                const MenuIcon = entry.icon;
                return (
                  <div key={entry.id} className="space-y-2">
                    <div className="flex items-center gap-2 px-3 text-[11px] font-semibold tracking-[0.2em] text-white/60 uppercase">
                      <MenuIcon size={14} />
                      {entry.label}
                    </div>
                    <div className="grid gap-2">
                      {entry.children.map((child) => {
                        const ChildIcon = child.icon;
                        return (
                          <NavLink
                            key={child.id}
                            to={child.path}
                            onClick={() => setShowMobileNav(false)}
                            className={({ isActive }) =>
                              [
                                "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-[background-color,color,box-shadow]",
                                isActive ? "bg-tanaw-lime/30 text-white shadow-md shadow-black/10" : "text-white/80 hover:bg-white/10 hover:text-white",
                              ].join(" ")
                            }
                          >
                            <ChildIcon size={15} className="shrink-0" />
                            {child.label}
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function getRoleSupportTicketsPath(role: UserRole) {
  if (role === "admin") return routes.admin.supportTickets;
  if (role === "it") return routes.it.supportTickets;
  return null;
}
