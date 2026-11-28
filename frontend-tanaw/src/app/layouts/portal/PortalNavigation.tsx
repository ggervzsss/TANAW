import { BookOpen, ChevronDown, ChevronRight, LogOut, Monitor, Moon, Pencil, Settings, Sun } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { matchPath, NavLink } from "react-router-dom";
import { preloadPortalRoute } from "@/app/routers/routeModules";
import { prefetchPortalRouteData } from "@/app/routers/portalDataPrefetch";
import { TopbarNavigation } from "@/shared/ui-kit/patterns/TopbarNavigation";
import { AccountAvatar, type AccountIdentity } from "@/shared/ui-kit/patterns/TopbarAccount";
import { ConfirmDialog } from "@/shared/ui-kit/components/ConfirmDialog";
import { ModalPortal } from "@/shared/ui-kit/components/ModalPortal";
import { SegmentedControl } from "@/shared/ui-kit/components/SegmentedControl";
import { useDialogFocus } from "@/shared/ui-kit/lib/focus-trap";
import { hasSettingsDraft } from "@/shared/ui-kit/lib/settingsDraft";
import { easeOut } from "@/shared/ui-kit/lib/motion";
import type { ThemePreference } from "@/shared/utils/theme";
import { rolePortalLabel } from "@/shared/constants/roleLabels";
import type { UserRole } from "@/shared/types/role.types";
import type { NavigationBadge, NavigationItem } from "./navigation";
import type { TopbarEntry } from "./portalNavigationModel";
import "./portal-nav-sheet.css";

type DesktopProps = {
  entries: TopbarEntry[];
  isDark: boolean;
  openMenuId: string | null;
  pathname: string;
  role: UserRole;
  onMenuChange: (id: string | null) => void;
  /** Counts beside link labels, by navigation item id. */
  badges?: Partial<Record<string, NavigationBadge>>;
};

/** An amber count beside a navigation label; screen readers hear its own label instead of the digits. */
function NavBadge({ badge }: { badge?: NavigationBadge }) {
  if (!badge || badge.count < 1) return null;
  return (
    <>
      <span aria-hidden="true" data-topbar-badge className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 text-xs leading-none font-bold text-amber-950 tabular-nums">
        {badge.count > 99 ? "99+" : badge.count}
      </span>
      <span className="sr-only">, {badge.label}</span>
    </>
  );
}

function matchesRoute(path: string, pathname: string) {
  return !!matchPath({ path, end: false }, pathname);
}

function matchesItem(item: NavigationItem, pathname: string) {
  return [item.path, ...(item.alsoActiveOn ?? [])].some((path) => matchesRoute(path, pathname));
}

/** Highlight a link on its own page and on the sub-pages it owns, such as Requests under Dashboard. */
function navLinkActive(item: NavigationItem, pathname: string) {
  return ({ isActive }: { isActive: boolean }) => isActive || matchesItem(item, pathname);
}

export function DesktopPortalNavigation({ entries, isDark, openMenuId, pathname, role, onMenuChange, badges = {} }: DesktopProps) {
  const queryClient = useQueryClient();
  const selected = entries.find((entry) => (entry.type === "link" ? matchesItem(entry.item, pathname) : entry.children.some((child) => matchesItem(child, pathname))));
  const activeId = selected?.type === "link" ? selected.item.id : selected?.id ?? null;
  const base =
    "relative z-10 isolate flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors duration-200 max-2xl:px-3.5";
  const tabClass = role === "admin" ? `${base} whitespace-nowrap max-[1440px]:px-2 max-[1440px]:text-xs` : base;
  const active = "text-white";
  const inactive = isDark ? "text-white/72" : "text-white/84";
  return (
    <TopbarNavigation
      activeId={activeId}
      className={`relative isolate hidden flex-none items-center justify-start gap-3 xl:flex 2xl:gap-4 ${role === "admin" ? "max-[1440px]:gap-1" : ""}`}
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
              className={(state) => [tabClass, navLinkActive(entry.item, pathname)(state) ? active : inactive].join(" ")}
            >
              <span className="relative z-10 flex items-center gap-2">
                <Icon size={16} className="shrink-0" />
                <span data-topbar-label>{entry.item.label}</span>
                <NavBadge badge={badges[entry.item.id]} />
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
                <span data-topbar-label>{entry.label}</span>
                <ChevronDown size={14} className={`ml-1 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </span>
            </button>
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: easeOut }}
                  className="absolute top-full left-0 z-1001 mt-4 w-64 origin-top-left overflow-hidden rounded-tanaw-lg border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) p-2 text-(--tanaw-text) shadow-tanaw-dialog"
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
                          `flex min-h-10 items-center gap-3 rounded-tanaw-md px-3.5 py-2 text-sm font-semibold transition-colors duration-150 ${isActive ? "bg-(--tanaw-selected-bg) text-(--tanaw-accent-ink)" : "text-(--tanaw-text-secondary) hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text)"}`
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
    </TopbarNavigation>
  );
}

export type PortalSheetAccount = {
  identity: AccountIdentity;
  activeAction?: "settings" | "help";
  theme: ThemePreference;
  onTheme: (theme: ThemePreference) => void;
  onEditProfile: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onSignOut: () => void;
};

type SheetProps = Pick<DesktopProps, "entries" | "pathname" | "role" | "badges"> & {
  id: string;
  account: PortalSheetAccount;
  onClose: () => void;
};

const themeChoices = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/**
 * The portal menu below the desktop breakpoint: a sheet hanging from the topbar with the role's
 * pages (each with its icon, the current one marked) and, on phones, the account at its foot.
 * Focus stays inside while it is open; Escape, the scrim and the menu button close it.
 */
export function PortalNavigationSheet({ id, entries, pathname, role, badges = {}, account, onClose }: SheetProps) {
  const queryClient = useQueryClient();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  useDialogFocus(sheetRef, onClose, !confirmSignOut);
  const items = entries.flatMap((entry) => (entry.type === "link" ? [entry.item] : entry.children));
  const current = items.find((item) => matchesItem(item, pathname));
  const run = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <ModalPortal lockScroll>
      <motion.div
        aria-hidden="true"
        className="tanaw-nav-sheet-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: easeOut }}
        onPointerDown={onClose}
      />
      <motion.div
        ref={sheetRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={`${rolePortalLabel[role]} menu`}
        tabIndex={-1}
        data-portal-nav-sheet
        className="tanaw-nav-sheet"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6, transition: { duration: 0.14, ease: easeOut } }}
        transition={{ duration: 0.24, ease: easeOut }}
      >
        <nav aria-label={`${rolePortalLabel[role]} pages`}>
          <p className="tanaw-nav-sheet__caption">{rolePortalLabel[role]}</p>
          <ul className="tanaw-nav-sheet__list tanaw-stagger">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <NavLink
                    to={item.path}
                    data-portal-sheet-navigation={item.id}
                    aria-current={item.id === current?.id ? "page" : undefined}
                    onClick={onClose}
                    {...routeIntentHandlers(queryClient, item.path)}
                    className="tanaw-nav-sheet__link"
                  >
                    <span className="tanaw-nav-sheet__seal" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <span className="tanaw-nav-sheet__label">{item.label}</span>
                    <NavBadge badge={badges[item.id]} />
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="tanaw-nav-sheet__account" aria-label="Your account">
          <div className="tanaw-nav-sheet__identity">
            <AccountAvatar account={account.identity} className="size-11 text-base" />
            <div className="min-w-0">
              <p className="tanaw-nav-sheet__identity-name">{account.identity.name}</p>
              {account.identity.email && <p className="tanaw-nav-sheet__identity-detail">{account.identity.email}</p>}
              <p className="tanaw-nav-sheet__identity-role">{account.identity.role}</p>
            </div>
          </div>
          <SheetAction icon={Pencil} label="Edit profile" onClick={() => run(account.onEditProfile)} />
          <SheetAction icon={Settings} label="General Settings" current={account.activeAction === "settings"} onClick={() => run(account.onSettings)} />
          <SheetAction icon={BookOpen} label="Help Center" current={account.activeAction === "help"} onClick={() => run(account.onHelp)} />
          <div className="tanaw-nav-sheet__theme">
            <span className="tanaw-nav-sheet__theme-label" aria-hidden="true">
              Theme
            </span>
            <SegmentedControl
              ariaLabel="Theme"
              value={account.theme}
              onChange={(value) => account.onTheme(value as ThemePreference)}
              options={themeChoices.map(({ value, label, icon: ChoiceIcon }) => ({
                value,
                label: (
                  <>
                    <ChoiceIcon size={15} aria-hidden="true" />
                    {label}
                  </>
                ),
              }))}
            />
          </div>
          <SheetAction
            icon={LogOut}
            label="Sign Out"
            danger
            onClick={() => {
              if (hasSettingsDraft()) setConfirmSignOut(true);
              else run(account.onSignOut);
            }}
          />
        </section>
      </motion.div>
      {confirmSignOut && (
        <ConfirmDialog
          title="Sign out and discard changes?"
          cancelLabel="Keep editing"
          confirmLabel="Sign Out"
          tone="danger"
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={() => {
            setConfirmSignOut(false);
            run(account.onSignOut);
          }}
        >
          Signing out will discard your unsaved settings.
        </ConfirmDialog>
      )}
    </ModalPortal>
  );
}

function SheetAction({ icon: Icon, label, current, danger, onClick }: { icon: typeof Settings; label: string; current?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-current={current ? "page" : undefined} onClick={onClick} className={danger ? "tanaw-nav-sheet__link tanaw-nav-sheet__link--danger" : "tanaw-nav-sheet__link"}>
      <span className="tanaw-nav-sheet__seal" aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="tanaw-nav-sheet__label">{label}</span>
      {!danger && <ChevronRight size={18} aria-hidden="true" />}
    </button>
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
