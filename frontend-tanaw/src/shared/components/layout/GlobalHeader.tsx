import { Bell, ChevronDown, LogOut, Shield, User } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { useAuthStore } from "@/app/store/authStore";
import { useHeaderStore } from "@/app/store/headerStore";
import { logoutService } from "@/features/login/services";
import { getRoleProfilePath, getRoleSecurityPath } from "../../utils";
import type { UserRole } from "../../types/role.types";
import { roleAccessLabel } from "./navigation";

type GlobalHeaderProps = {
  role: UserRole;
};

export function GlobalHeader({ role }: GlobalHeaderProps) {
  const authUser = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const { title, description } = useHeaderStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const profile = {
    name: authUser?.displayName ?? "TANAW User",
    email: authUser?.email ?? "",
    department: authUser?.title ?? "City Tourism Operations",
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
      toast.success("Logout complete.");
      navigate(routes.login, { replace: true });
    }
  };

  const openAccountPage = (page: "profile" | "security") => {
    setShowProfileMenu(false);
    navigate(page === "profile" ? getRoleProfilePath(role) : getRoleSecurityPath(role));
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

  return (
    <header className="z-10 flex h-16 items-center justify-between border-b border-white/70 bg-slate-100/80 px-8 backdrop-blur max-sm:px-4">
      {/* Left Section: Page Title & Subtitle */}
      <div className="flex min-w-0 flex-col pr-4">
        <AnimatePresence mode="wait">
          <motion.div key={title} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.15 }} className="flex flex-col">
            <h1 className="text-tanaw-navy font-display truncate text-base leading-tight font-bold tracking-tight sm:text-lg">{title || "TANAW"}</h1>
            {description && <p className="mt-0.5 truncate text-[10px] font-medium text-gray-500 max-md:hidden sm:text-xs">{description}</p>}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Right Section: Actions & Profile Menu */}
      <div className="flex shrink-0 items-center gap-6 max-sm:gap-3">
        <button
          type="button"
          aria-label="Notifications"
          className="text-tanaw-navy hover:text-tanaw-green relative rounded-full border border-white/80 bg-white p-2 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
        >
          <Bell size={18} />
          <span className="bg-tanaw-red absolute top-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white" />
        </button>

        <div ref={profileMenuRef} className="relative">
          <button
            type="button"
            aria-label="Open account menu"
            onClick={() => setShowProfileMenu((current) => !current)}
            className="flex items-center gap-3 rounded-full border border-white/80 bg-white py-1 pr-3 pl-1.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-md active:translate-y-0"
          >
            <div className="bg-tanaw-green flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white">{initials}</div>
            <div className="hidden text-left md:block">
              <p className="text-tanaw-navy text-sm leading-none font-bold">{profile.name}</p>
              <p className="text-[10px] text-gray-500">{roleAccessLabel[role]}</p>
            </div>
            <ChevronDown size={14} className={`ml-1 text-gray-400 transition-transform duration-200 ${showProfileMenu ? "rotate-180" : ""}`} />
          </button>

          <AnimatePresence>
            {showProfileMenu && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-white/80 bg-white py-2 shadow-xl ring-1 ring-slate-900/4"
              >
                <div className="mb-1 border-b border-slate-100 px-4 py-3">
                  <p className="text-tanaw-navy text-sm font-bold">{profile.name}</p>
                  <p className="text-xs text-gray-500">{profile.email}</p>
                </div>
                <button type="button" onClick={() => openAccountPage("profile")} className="profile-menu-button">
                  <User size={14} /> Profile Settings
                </button>
                <button type="button" onClick={() => openAccountPage("security")} className="profile-menu-button">
                  <Shield size={14} /> Security & Data Control
                </button>
                <button type="button" onClick={handleLogout} className="text-tanaw-red flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold transition-colors hover:bg-red-50">
                  <LogOut size={14} /> Logout
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
