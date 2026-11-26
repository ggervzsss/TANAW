import {
  ArrowLeft,
  Check,
  CircleAlert,
  CodeXml,
  LifeBuoy,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Moon,
  Pencil,
  Shield,
  SlidersHorizontal,
  Sun,
  Upload,
  User,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { LayoutGroup, motion } from "motion/react";
import { Button } from "../components/Button";
import { Skeleton } from "../components/Spinner";
import { usePageEnter } from "../lib/page-enter";
import type { AccountIdentity } from "./TopbarAccount";
import "./GeneralSettings.css";

const settingsSections = {
  profile: { label: "Profile Information", icon: User },
  security: { label: "Password & Security", icon: Shield },
  appearance: { label: "Appearance", icon: Monitor },
  support: { label: "Requests", icon: LifeBuoy },
  developer: { label: "Developer Settings", icon: CodeXml },
  system: { label: "System Settings", icon: SlidersHorizontal },
};

export type SettingsSection = keyof typeof settingsSections;
export type SettingsTheme = "light" | "dark" | "system";

type GeneralSettingsProps = {
  sections: readonly SettingsSection[];
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  onBack: () => void;
  description: string;
  children: ReactNode;
};

/** One spring for every selection highlight in Settings, so they all glide the same way. */
const railSpring = { type: "spring", stiffness: 520, damping: 44, mass: 0.9 } as const;

export function GeneralSettings({
  sections,
  active,
  onSelect,
  onBack,
  description,
  children,
}: GeneralSettingsProps) {
  const pageTitle = useId();
  const sectionTitle = useId();
  const workspace = useRef<HTMLElement>(null);
  const content = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // Block bodies: scroll methods return a Promise in current Chromium, and React treats an
  // effect's return value as its clean-up, so returning one crashes on unmount.
  useEffect(() => {
    workspace.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [active]);
  // The section heading stays put while the section below it fades up into place.
  usePageEnter(body, active, { rise: 6 });

  return (
    <section
      ref={workspace}
      aria-labelledby={pageTitle}
      tabIndex={-1}
      className="tanaw-settings-workspace outline-none"
    >
      <header className="tanaw-settings-header">
        <button
          type="button"
          className="tanaw-settings-return"
          onClick={onBack}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back<span className="sr-only"> from General Settings</span>
        </button>
        <h1 id={pageTitle} className="tanaw-settings-heading">
          General Settings
        </h1>
        <p className="tanaw-settings-lede">
          Manage your account, security, and preferences.
        </p>
      </header>

      <div className="tanaw-settings-grid">
        <nav aria-label="Settings sections" className="tanaw-settings-rail">
          <LayoutGroup id="settings-rail">
            {sections.map((section) => {
              const { label, icon: Icon } = settingsSections[section];
              const current = active === section;
              return (
                <button
                  key={section}
                  type="button"
                  aria-current={current ? "page" : undefined}
                  onClick={() => onSelect(section)}
                  className="tanaw-settings-link"
                >
                  {current && (
                    <motion.span
                      layoutId="settings-rail-highlight"
                      className="tanaw-settings-link-highlight"
                      transition={railSpring}
                      aria-hidden="true"
                    />
                  )}
                  <Icon size={17} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </LayoutGroup>
        </nav>

        <section
          ref={content}
          aria-labelledby={sectionTitle}
          className="tanaw-settings-panel"
          data-form-scroll-container
        >
          <header className="tanaw-settings-panel-header">
            <h2 id={sectionTitle}>{settingsSections[active].label}</h2>
            <p>{description}</p>
          </header>
          <div ref={body} className="tanaw-settings-panel-body">
            {children}
          </div>
        </section>
      </div>
    </section>
  );
}

export function SettingsGroup({
  title,
  description,
  icon,
  actions,
  children,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  /** Status and actions that belong to the whole group, such as a save state or Reset. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const heading = (
    <>
      <h3>
        {icon}
        {title}
      </h3>
      {description && <p>{description}</p>}
    </>
  );
  return (
    <section className="tanaw-settings-group">
      {actions ? (
        <header className="tanaw-settings-group-header">
          <div className="min-w-0">{heading}</div>
          <div className="tanaw-settings-group-actions">{actions}</div>
        </header>
      ) : (
        <header>{heading}</header>
      )}
      {children}
    </section>
  );
}

/** Placeholder rows in the shape of a settings list while its data loads. */
export function SettingsRowsSkeleton({
  rows = 2,
  label,
}: {
  rows?: number;
  label: string;
}) {
  return (
    <div role="status" className="tanaw-settings-rows-skeleton">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row}>
          <Skeleton className="h-4 w-4 shrink-0" shape="circle" />
          <Skeleton className="h-3.5" style={{ width: `${46 - row * 12}%` }} />
          <Skeleton className="ml-auto h-3.5 w-14" />
        </div>
      ))}
    </div>
  );
}

type ImageUploadProps = {
  account: Pick<AccountIdentity, "name" | "email" | "role">;
  onEditEmail?: () => void;
  title: string;
  initials: string;
  image?: string | null;
  fileName?: string;
  error?: string;
  loading?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  removeLabel: string;
};

export function SettingsImageUpload({
  account,
  onEditEmail,
  title,
  initials,
  image,
  fileName,
  error,
  loading,
  onChange,
  onRemove,
  removeLabel,
}: ImageUploadProps) {
  const requirements = useId();
  return (
    <div className="tanaw-settings-upload">
      <span aria-hidden="true" className="tanaw-settings-upload-avatar">
        {image ? (
          <img src={image} alt="" className="size-full object-cover" />
        ) : (
          initials
        )}
      </span>
      <div className="tanaw-settings-identity">
        <h3>{account.name}</h3>
        <p className="tanaw-settings-identity-role">{account.role}</p>
        {(account.email || onEditEmail) && (
          <div className="tanaw-settings-identity-email">
            <p>{account.email || "Email not provided"}</p>
            {onEditEmail && (
              <button
                type="button"
                className="tanaw-settings-edit-email"
                onClick={onEditEmail}
              >
                <Pencil size={13} aria-hidden="true" />
                Edit email
              </button>
            )}
          </div>
        )}
      </div>
      <div className="tanaw-settings-upload-tools">
        <div className="tanaw-settings-upload-actions">
          <label className="tanaw-settings-upload-control">
            <Upload size={15} aria-hidden="true" />
            <span>
              {loading ? "Reading image..." : `Upload ${title.toLowerCase()}`}
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-describedby={requirements}
              disabled={loading}
              onChange={onChange}
            />
          </label>
          {image && (
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={onRemove}
            >
              {removeLabel}
            </Button>
          )}
        </div>
        <p id={requirements}>PNG, JPG, or WebP. Maximum 2 MB.</p>
        {error && (
          <p role="alert" className="font-semibold text-(--tanaw-danger)!">
            {error}
          </p>
        )}
        {fileName && (
          <p
            role="status"
            className="wrap-break-word font-semibold text-(--tanaw-accent-ink)!"
          >
            {fileName} is ready to save.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The save bar of a settings form. It appears only while the form has unsaved changes (or is
 * saving them), sticks to the bottom of the settings panel, and offers Discard and the form's
 * one save action. A form with nothing to save shows no Cancel or Save buttons at all.
 */
export function SettingsActions({
  busy,
  saveDisabled,
  dirty,
  onDiscard,
  children,
}: {
  busy: boolean;
  saveDisabled?: boolean;
  dirty: boolean;
  onDiscard: () => void;
  children: ReactNode;
}) {
  const open = dirty || busy;
  // The status paragraph stays mounted while the form is clean (empty and visually hidden), so
  // screen readers announce "Unsaved changes" when the bar appears: a live region inserted with
  // its text already inside is often not announced.
  return (
    <div className={open ? "tanaw-settings-actions tanaw-enter" : "contents"}>
      <p role="status" className={open ? "tanaw-settings-action-status" : "sr-only"}>
        {busy ? (
          <>
            <LoaderCircle
              size={16}
              className="motion-safe:animate-spin"
              aria-hidden="true"
            />{" "}
            Saving changes...
          </>
        ) : dirty ? (
          <>
            <CircleAlert size={16} aria-hidden="true" /> Unsaved changes
          </>
        ) : null}
      </p>
      {open && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onDiscard}>
            Discard
          </Button>
          <Button type="submit" disabled={busy || saveDisabled}>
            {children}
          </Button>
        </div>
      )}
    </div>
  );
}

const themeOptions = [
  { value: "light", label: "Light Mode", icon: Sun },
  { value: "dark", label: "Dark Mode", icon: Moon },
  { value: "system", label: "System Default", icon: Monitor },
] as const;

export function ThemeSelector({
  value,
  onChange,
}: {
  value: SettingsTheme;
  onChange: (theme: SettingsTheme) => void;
}) {
  const name = useId();
  return (
    <SettingsGroup
      title="Theme"
      description="Changes apply immediately. System Default follows your device's appearance."
    >
      <fieldset className="tanaw-theme-grid">
        <legend className="sr-only">Theme</legend>
        <LayoutGroup id="settings-theme">
          {themeOptions.map(({ value: option, label, icon: Icon }) => {
            const selected = value === option;
            return (
              <label
                className="tanaw-theme-option"
                key={option}
                data-theme-option={option}
              >
                <input
                  type="radio"
                  name={name}
                  value={option}
                  checked={selected}
                  onChange={() => onChange(option)}
                />
                <span className="tanaw-theme-frame" aria-hidden="true">
                  {selected && (
                    <motion.span
                      layoutId="settings-theme-ring"
                      className="tanaw-theme-ring"
                      transition={railSpring}
                    />
                  )}
                  <span className="tanaw-theme-preview">
                    <span />
                    <span />
                    <span />
                  </span>
                </span>
                <span className="tanaw-theme-label">
                  <Icon size={15} aria-hidden="true" />
                  {label}
                  {selected && (
                    <Check size={15} className="ml-auto" aria-hidden="true" />
                  )}
                </span>
              </label>
            );
          })}
        </LayoutGroup>
      </fieldset>
    </SettingsGroup>
  );
}

export function SettingsReadOnly({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-(--tanaw-text-muted)">
      <LockKeyhole size={13} aria-hidden="true" />
      {children}
    </span>
  );
}
