import { ChevronDown } from "lucide-react";
import type { SyntheticEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useMotionValue } from "motion/react";
import { NavLink } from "react-router-dom";
import { preloadPortalRoute } from "@/app/routers/routeModules";
import { prefetchPortalRouteData } from "@/app/routers/portalDataPrefetch";
import { rolePortalLabel } from "@/shared/constants/roleLabels";
import type { UserRole } from "@/shared/types/role.types";
import type { TopbarEntry } from "./portalNavigationModel";
import { TopbarActiveUnderline, TopbarLiquidGlass } from "./TopbarGlassIndicator";
import type { TopbarGlassTarget } from "./TopbarGlassIndicator";
import { useTopbarGlassPointer } from "./useTopbarGlassPointer";

type DesktopProps = { entries: TopbarEntry[]; isDark: boolean; openMenuId: string | null; pathname: string; role: UserRole; onMenuChange: (id: string | null) => void };

export function DesktopPortalNavigation({ entries, isDark, openMenuId, pathname, role, onMenuChange }: DesktopProps) {
  const queryClient = useQueryClient();
  const glassTarget = useMotionValue<TopbarGlassTarget | null>(null);
  const { onPointerDown: handleGlassPointerDown, onPointerLeave: handleGlassPointerLeave, onPointerMove: handleGlassPointerMove, setNavigationElement } = useTopbarGlassPointer(glassTarget);
  const base =
    "relative z-10 isolate flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-white/65 focus-visible:outline-none max-2xl:px-3.5";
  const active = "text-white";
  const inactive = isDark ? "text-white/72 hover:text-white" : "text-white/84 hover:text-white";
  const showGlass = (id: string, element: HTMLElement) => {
    const currentTarget = glassTarget.get();
    if (currentTarget?.mode === "drag" || currentTarget?.mode === "pull" || currentTarget?.mode === "recoil") return;
    const navigation = element.closest<HTMLElement>("[data-liquid-glass-navigation]");
    if (!navigation) return;
    const navigationRect = navigation.getBoundingClientRect();
    const itemRect = element.getBoundingClientRect();
    glassTarget.set({
      deformation: 0,
      height: itemRect.height,
      id,
      left: itemRect.left - navigationRect.left - 4,
      mode: "item",
      top: itemRect.top - navigationRect.top,
      width: itemRect.width + 8,
    });
  };
  const hideGlass = () => {
    glassTarget.set(null);
  };
  return (
    <nav
      ref={setNavigationElement}
      data-liquid-glass-navigation="true"
      className="relative isolate hidden flex-none items-center justify-start gap-3 xl:flex 2xl:gap-4"
      aria-label={`${rolePortalLabel[role]} navigation`}
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={handleGlassPointerDown}
      onPointerLeave={handleGlassPointerLeave}
      onPointerMove={handleGlassPointerMove}
    >
      <TopbarLiquidGlass isDark={isDark} target={glassTarget} />
      {entries.map((entry) => {
        if (entry.type === "link") {
          const Icon = entry.item.icon;
          return (
            <NavLink
              key={entry.item.id}
              to={entry.item.path}
              data-topbar-navigation={entry.item.id}
              onClick={() => onMenuChange(null)}
              onBlur={hideGlass}
              {...routeIntentHandlers(queryClient, entry.item.path, (element) => showGlass(entry.item.id, element))}
              className={({ isActive }) => [base, isActive ? active : inactive].join(" ")}
            >
              {({ isActive }) => (
                <>
                  <span data-topbar-refractive-source="true" className="relative z-10 flex items-center gap-2">
                    <Icon size={16} className="shrink-0" />
                    {entry.item.label}
                  </span>
                  {isActive && <TopbarActiveUnderline isDark={isDark} />}
                </>
              )}
            </NavLink>
          );
        }
        const isActive = entry.children.some((child) => pathname.startsWith(child.path));
        const isOpen = openMenuId === entry.id;
        const Icon = entry.icon;
        return (
          <div key={entry.id} className="relative z-10">
            <button
              type="button"
              data-topbar-navigation={entry.id}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={() => onMenuChange(isOpen ? null : entry.id)}
              onBlur={hideGlass}
              onFocus={(event) => showGlass(entry.id, event.currentTarget)}
              onPointerEnter={(event) => showGlass(entry.id, event.currentTarget)}
              className={[base, isActive || isOpen ? active : inactive].join(" ")}
            >
              <span data-topbar-refractive-source="true" className="relative z-10 flex items-center gap-2">
                <Icon size={16} />
                {entry.label}
                <ChevronDown size={14} className={`ml-1 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </span>
              {isActive && <TopbarActiveUnderline isDark={isDark} />}
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
    `relative flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${isActive ? "text-white after:absolute after:bottom-1 after:left-4 after:h-0.5 after:w-4 after:rounded-full after:bg-emerald-300" : "text-white/80 hover:bg-white/10 hover:text-white"}`;
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

function routeIntentHandlers(queryClient: ReturnType<typeof useQueryClient>, path: string, onIntent?: (element: HTMLElement) => void) {
  const preload = (event: SyntheticEvent<HTMLElement>) => {
    onIntent?.(event.currentTarget);
    void preloadPortalRoute(path);
    void prefetchPortalRouteData(queryClient, path);
  };
  return {
    onFocus: preload,
    onPointerEnter: preload,
    onTouchStart: preload,
  };
}
