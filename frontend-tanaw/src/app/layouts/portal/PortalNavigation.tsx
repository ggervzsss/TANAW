import { ChevronDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { NavLink } from "react-router-dom";
import { preloadPortalRoute } from "@/app/routers/routeModules";
import { prefetchPortalRouteData } from "@/app/routers/portalDataPrefetch";
import { rolePortalLabel } from "@/shared/constants/roleLabels";
import type { UserRole } from "@/shared/types/role.types";
import type { TopbarEntry } from "./portalNavigationModel";

type DesktopProps = { entries: TopbarEntry[]; isDark: boolean; openMenuId: string | null; pathname: string; role: UserRole; onMenuChange: (id: string | null) => void };

export function DesktopPortalNavigation({ entries, isDark, openMenuId, pathname, role, onMenuChange }: DesktopProps) {
  const queryClient = useQueryClient();
  const base = "flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-[color,background-color,box-shadow,transform] duration-200 max-2xl:px-3.5";
  const active = isDark
    ? "bg-emerald-300/10 text-white shadow-[0_12px_30px_rgba(0,0,0,0.46)] ring-1 ring-emerald-100/14"
    : "bg-white/18 text-white shadow-[0_12px_28px_rgba(8,44,20,0.42)] ring-1 ring-white/22";
  const inactive = isDark
    ? "text-white/72 hover:-translate-y-0.5 hover:bg-white/7 hover:text-white hover:shadow-[0_10px_26px_rgba(0,0,0,0.38)]"
    : "text-white/84 hover:-translate-y-0.5 hover:bg-white/13 hover:text-white hover:shadow-[0_10px_24px_rgba(3,38,16,0.34)]";
  return (
    <nav className="hidden flex-none items-center justify-start gap-3 xl:flex 2xl:gap-4" aria-label={`${rolePortalLabel[role]} navigation`}>
      {entries.map((entry) => {
        if (entry.type === "link") {
          const Icon = entry.item.icon;
          return (
            <NavLink
              key={entry.item.id}
              to={entry.item.path}
              onClick={() => onMenuChange(null)}
              {...routeIntentHandlers(queryClient, entry.item.path)}
              className={({ isActive }) => [base, isActive ? active : inactive].join(" ")}
            >
              <Icon size={16} className="shrink-0" />
              {entry.item.label}
            </NavLink>
          );
        }
        const isActive = entry.children.some((child) => pathname.startsWith(child.path));
        const isOpen = openMenuId === entry.id;
        const Icon = entry.icon;
        return (
          <div key={entry.id} className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={() => onMenuChange(isOpen ? null : entry.id)}
              className={[base, isActive || isOpen ? active : inactive].join(" ")}
            >
              <Icon size={16} />
              {entry.label}
              <ChevronDown size={14} className={`ml-1 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  className="absolute top-full left-0 z-1001 mt-4 w-64 overflow-hidden rounded-2xl border border-white/80 bg-white p-2.5 text-slate-700 shadow-[0_18px_44px_rgba(15,23,42,0.18)]"
                >
                  {entry.children.map((child) => {
                    const ChildIcon = child.icon;
                    return (
                      <NavLink
                        key={child.id}
                        to={child.path}
                        onClick={() => onMenuChange(null)}
                        {...routeIntentHandlers(queryClient, child.path)}
                        className={({ isActive }) =>
                          `flex items-center gap-3 rounded-xl px-4 py-2 text-sm font-semibold transition ${isActive ? "bg-tanaw-green/10 text-tanaw-green" : "hover:text-tanaw-green text-slate-700 hover:bg-slate-50"}`
                        }
                      >
                        <ChildIcon size={15} />
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
  );
}

export function MobilePortalNavigation({ entries, isDark, role, onNavigate }: { entries: TopbarEntry[]; isDark: boolean; role: UserRole; onNavigate: () => void }) {
  const queryClient = useQueryClient();
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${isActive ? "bg-tanaw-lime/30 text-white shadow-md shadow-black/10" : "text-white/80 hover:bg-white/10 hover:text-white"}`;
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className={`border-t px-6 pb-4 max-sm:px-4 ${isDark ? "border-emerald-100/10 bg-[#04110f]/98" : "bg-tanaw-green/95 border-white/10"}`}
    >
      <nav className="grid gap-4 pt-4" aria-label={`${rolePortalLabel[role]} mobile navigation`}>
        {entries.map((entry) =>
          entry.type === "link" ? (
            <NavLink key={entry.item.id} to={entry.item.path} onClick={onNavigate} {...routeIntentHandlers(queryClient, entry.item.path)} className={linkClass}>
              {<entry.item.icon size={16} />}
              {entry.item.label}
            </NavLink>
          ) : (
            <div key={entry.id} className="space-y-2">
              <div className="flex items-center gap-2 px-3 text-[11px] font-semibold tracking-[0.2em] text-white/60 uppercase">
                <entry.icon size={14} />
                {entry.label}
              </div>
              <div className="grid gap-2">
                {entry.children.map((child) => (
                  <NavLink key={child.id} to={child.path} onClick={onNavigate} {...routeIntentHandlers(queryClient, child.path)} className={linkClass}>
                    {<child.icon size={15} />}
                    {child.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ),
        )}
      </nav>
    </motion.div>
  );
}

function routeIntentHandlers(queryClient: ReturnType<typeof useQueryClient>, path: string) {
  const preload = () => {
    void preloadPortalRoute(path);
    void prefetchPortalRouteData(queryClient, path);
  };
  return {
    onFocus: preload,
    onPointerEnter: preload,
    onTouchStart: preload,
  };
}
