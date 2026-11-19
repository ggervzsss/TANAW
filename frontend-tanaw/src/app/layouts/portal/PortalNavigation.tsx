import { ChevronDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { matchPath, NavLink } from "react-router-dom";
import { preloadPortalRoute } from "@/app/routers/routeModules";
import { prefetchPortalRouteData } from "@/app/routers/portalDataPrefetch";
import { TopbarGlassNavigation } from "@/design-system/patterns/TopbarGlassIndicator";
import { rolePortalLabel } from "@/shared/constants/roleLabels";
import type { UserRole } from "@/shared/types/role.types";
import type { TopbarEntry } from "./portalNavigationModel";

type DesktopProps = { entries: TopbarEntry[]; isDark: boolean; openMenuId: string | null; pathname: string; role: UserRole; onMenuChange: (id: string | null) => void };

function matchesRoute(path: string, pathname: string) {
  return !!matchPath({ path, end: false }, pathname);
}

export function DesktopPortalNavigation({ entries, isDark, openMenuId, pathname, role, onMenuChange }: DesktopProps) {
  const queryClient = useQueryClient();
  const selected = entries.find((entry) => entry.type === "link" ? matchesRoute(entry.item.path, pathname) : entry.children.some((child) => matchesRoute(child.path, pathname)));
  const activeId = selected?.type === "link" ? selected.item.id : selected?.id ?? null;
  const base =
    "relative z-10 isolate flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors duration-200 max-2xl:px-3.5";
  const active = "text-white";
  const inactive = isDark ? "text-white/72 hover:text-white" : "text-white/84 hover:text-white";
  return (
    <TopbarGlassNavigation
      activeId={activeId}
      isDark={isDark}
      className="relative isolate hidden flex-none items-center justify-start gap-3 xl:flex 2xl:gap-4"
      aria-label={`${rolePortalLabel[role]} navigation`}
      onDragStart={(event) => event.preventDefault()}
    >
      {entries.map((entry) => {
        if (entry.type === "link") {
          const Icon = entry.item.icon;
          return (
            <NavLink
              key={entry.item.id}
              to={entry.item.path}
              data-topbar-navigation={entry.item.id}
              onClick={() => onMenuChange(null)}
              {...routeIntentHandlers(queryClient, entry.item.path)}
              className={({ isActive }) => [base, isActive ? active : inactive].join(" ")}
            >
              <span className="relative z-10 flex items-center gap-2">
                <Icon size={16} className="shrink-0" />
                {entry.item.label}
              </span>
            </NavLink>
          );
        }
        const isActive = activeId === entry.id;
        const isOpen = openMenuId === entry.id;
        const Icon = entry.icon;
        return (
          <div key={entry.id} className="relative z-10">
            <button
              type="button"
              data-topbar-navigation={entry.id}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              aria-current={isActive ? "true" : undefined}
              onClick={() => onMenuChange(isOpen ? null : entry.id)}
              className={[base, isActive || isOpen ? active : inactive].join(" ")}
            >
              <span className="relative z-10 flex items-center gap-2">
                <Icon size={16} />
                {entry.label}
                <ChevronDown size={14} className={`ml-1 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </span>
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
    </TopbarGlassNavigation>
  );
}

export function MobilePortalNavigation({ entries, isDark, pathname, role, onNavigate }: Pick<DesktopProps, "entries" | "isDark" | "pathname" | "role"> & { onNavigate: () => void }) {
  const queryClient = useQueryClient();
  const selected = entries.flatMap((entry) => entry.type === "link" ? [entry.item] : entry.children).find((item) => matchesRoute(item.path, pathname));
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `relative z-10 flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${isActive ? "text-white" : "text-white/80 hover:text-white"}`;
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className={`border-t px-6 pb-4 max-sm:px-4 ${isDark ? "border-emerald-100/10 bg-[#04110f]/98" : "bg-tanaw-green/95 border-white/10"}`}
    >
      <TopbarGlassNavigation activeId={selected?.id ?? null} isDark={isDark} data-topbar-glass-layout="stacked" className="relative isolate grid gap-4 pt-4" aria-label={`${rolePortalLabel[role]} mobile navigation`}>
        {entries.map((entry) =>
          entry.type === "link" ? (
            <NavLink key={entry.item.id} to={entry.item.path} data-topbar-navigation={entry.item.id} onClick={onNavigate} {...routeIntentHandlers(queryClient, entry.item.path)} className={linkClass}>
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
                  <NavLink key={child.id} to={child.path} data-topbar-navigation={child.id} onClick={onNavigate} {...routeIntentHandlers(queryClient, child.path)} className={linkClass}>
                    {<child.icon size={15} />}
                    {child.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ),
        )}
      </TopbarGlassNavigation>
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
