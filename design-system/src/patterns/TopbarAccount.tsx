import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  LogOut,
  Pencil,
  Settings,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { cn } from "../lib/cn";
import { initialsOf } from "../lib/initials";
import { Tooltip } from "../components/Tooltip";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { hasSettingsDraft } from "../lib/settingsDraft";
import "./TopbarAccount.css";

export type AccountIdentity = {
  name: string;
  email?: string;
  role: string;
  image?: string | null;
};

type TopbarAccountProps = {
  account: AccountIdentity;
  className?: string;
  activeAction?: "settings" | "help";
  onEditProfile: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onSignOut: () => void;
  onOpen?: () => void;
};

const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200";

export function AccountAvatar({
  account,
  className,
}: {
  account: AccountIdentity;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-(--tanaw-action) text-sm font-bold text-(--tanaw-on-action)",
        className,
      )}
    >
      {account.image ? (
        <img src={account.image} alt="" className="size-full object-cover" />
      ) : (
        initialsOf(account.name) || "?"
      )}
    </span>
  );
}

export function TopbarAccount({
  account,
  className,
  activeAction,
  onEditProfile,
  onSettings,
  onHelp,
  onSignOut,
  onOpen,
}: TopbarAccountProps) {
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const group = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const avatarLabel = account.image
    ? "Edit profile"
    : `Edit profile, ${initialsOf(account.name) || "?"}`;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!group.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  const activate = (action: () => void) => {
    trigger.current?.focus();
    setOpen(false);
    action();
  };

  const editProfile = (event: MouseEvent<HTMLButtonElement>) => {
    setOpen(false);
    onOpen?.();
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      event.currentTarget.animate?.([{ scale: "0.94" }, { scale: "1" }], {
        duration: 160,
        easing: "ease-out",
      });
    }
    onEditProfile();
  };

  const requestSignOut = () => {
    if (hasSettingsDraft()) setConfirmSignOut(true);
    else onSignOut();
  };

  return (
    <div
      ref={group}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <div className={cn("tanaw-account-control", className)} data-open={open}>
        <Tooltip content="Edit profile" focusable={false} align="left">
          <button
            type="button"
            aria-label={avatarLabel}
            data-account-navigation
            onClick={editProfile}
            className={cn(
              "tanaw-account-edit tanaw-topbar-compact-control",
              focus,
            )}
          >
            <AccountAvatar
              account={account}
              className="tanaw-account-trigger-avatar"
            />
            <span className="tanaw-account-edit-indicator" aria-hidden="true">
              <Pencil size={9} />
            </span>
          </button>
        </Tooltip>
        <button
          ref={trigger}
          type="button"
          aria-label={`Open account menu for ${account.name} ${account.role}`}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => {
            if (!open) onOpen?.();
            setOpen(!open);
          }}
          className={cn(
            "tanaw-account-trigger tanaw-topbar-compact-trigger",
            focus,
          )}
        >
          <span className="tanaw-account-trigger-copy hidden lg:block">
            <span className="block truncate text-sm leading-tight font-bold">
              {account.name}
            </span>{" "}
            <span className="tanaw-account-trigger-role mt-0.5 block truncate text-xs leading-tight">
              {account.role}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            size={16}
            className="tanaw-account-trigger-chevron"
          />
        </button>
      </div>

      <div id={menuId} aria-hidden={!open} className="tanaw-account-menu">
        <div className="tanaw-account-menu-identity">
          <AccountAvatar
            account={account}
            className="tanaw-account-menu-avatar"
          />
          <div className="min-w-0">
            <p title={account.name} className="truncate font-bold">
              {account.name}
            </p>
            {account.email && (
              <p
                title={account.email}
                className="truncate text-xs text-(--tanaw-text-secondary)"
              >
                {account.email}
              </p>
            )}
            <p className="tanaw-account-menu-role">{account.role}</p>
          </div>
        </div>
        <div className="tanaw-account-menu-list">
          <AccountMenuAction
            label="General Settings"
            icon={Settings}
            open={open}
            current={activeAction === "settings"}
            onClick={() => activate(onSettings)}
          />
          <AccountMenuAction
            label="Help Center"
            icon={BookOpen}
            open={open}
            current={activeAction === "help"}
            onClick={() => activate(onHelp)}
          />
        </div>
        <div className="tanaw-account-menu-list tanaw-account-menu-footer">
          <AccountMenuAction
            label="Sign Out"
            icon={LogOut}
            open={open}
            danger
            onClick={() => activate(requestSignOut)}
          />
        </div>
      </div>
      {confirmSignOut && (
        <ConfirmDialog
          title="Sign out and discard changes?"
          cancelLabel="Keep editing"
          confirmLabel="Sign Out"
          tone="danger"
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={() => {
            setConfirmSignOut(false);
            onSignOut();
          }}
        >
          Signing out will discard your unsaved settings.
        </ConfirmDialog>
      )}
    </div>
  );
}

function AccountMenuAction({
  label,
  icon: Icon,
  open,
  current,
  danger,
  onClick,
}: {
  label: string;
  icon: typeof Settings;
  open: boolean;
  current?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={open ? 0 : -1}
      aria-current={current ? "page" : undefined}
      data-account-navigation
      onClick={onClick}
      className={cn(
        "tanaw-account-menu-action",
        danger && "tanaw-account-menu-action--sign-out",
      )}
    >
      <span className="tanaw-account-menu-row">
        <Icon size={18} aria-hidden="true" />
        <span>{label}</span>
        {!danger && <ChevronRight size={16} aria-hidden="true" />}
      </span>
    </button>
  );
}
