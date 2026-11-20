import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  CodeXml,
  LifeBuoy,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Moon,
  Pencil,
  Settings,
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
import { Button } from "../components/Button";
import type { AccountIdentity } from "./TopbarAccount";
import "./GeneralSettings.css";

const settingsSections = {
  profile: { label: "Profile Information", icon: User },
  security: { label: "Password & Security", icon: Shield },
  appearance: { label: "Appearance", icon: Monitor },
  support: { label: "Support Tickets", icon: LifeBuoy },
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
  // Block bodies: scroll methods return a Promise in current Chromium, and React treats an
  // effect's return value as its clean-up, so returning one crashes on unmount.
  useEffect(() => {
    workspace.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [active]);
  const CategoryIcon = settingsSections[active].icon;

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
        <div className="tanaw-settings-title">
          <span className="tanaw-settings-emblem">
            <Settings size={21} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1
              id={pageTitle}
              className="font-display text-3xl leading-tight font-bold"
            >
              General Settings
            </h1>
            <p>Manage your account, security, and preferences.</p>
          </div>
        </div>
      </header>

      <div className="tanaw-settings-grid">
        <nav aria-label="Settings sections" className="tanaw-settings-rail">
          {sections.map((section) => {
            const { label, icon: Icon } = settingsSections[section];
            return (
              <button
                key={section}
                type="button"
                aria-current={active === section ? "page" : undefined}
                onClick={() => onSelect(section)}
                className="tanaw-settings-link"
              >
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            );
          })}
        </nav>

        <section
          ref={content}
          aria-labelledby={sectionTitle}
          className="tanaw-settings-panel"
          data-form-scroll-container
        >
          <header className="tanaw-settings-panel-header">
            <span className="tanaw-settings-category-icon">
              <CategoryIcon size={19} aria-hidden="true" />
            </span>
            <div>
              <h2
                id={sectionTitle}
                className="font-display text-xl leading-tight font-bold"
              >
                {settingsSections[active].label}
              </h2>
              <p>{description}</p>
            </div>
          </header>
          {children}
        </section>
      </div>
    </section>
  );
}

export function SettingsGroup({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="tanaw-settings-group">
      <header>
        <h3 className="flex items-center gap-2 text-sm font-bold">
          {icon}
          {title}
        </h3>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
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

export function SettingsActions({
  busy,
  saveDisabled,
  dirty,
  onCancel,
  detail,
  children,
}: {
  busy: boolean;
  saveDisabled?: boolean;
  dirty?: boolean;
  onCancel: () => void;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <div className="tanaw-settings-actions">
      <p role="status" className="tanaw-settings-action-status">
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
        ) : (
          detail
        )}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || saveDisabled}>
          {children}
        </Button>
      </div>
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
        {themeOptions.map(({ value: option, label, icon: Icon }) => (
          <label
            className="tanaw-theme-option"
            key={option}
            data-theme-option={option}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span className="tanaw-theme-preview" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="tanaw-theme-label">
              <Icon size={16} aria-hidden="true" />
              {label}
              {value === option && (
                <Check size={16} className="ml-auto" aria-hidden="true" />
              )}
            </span>
          </label>
        ))}
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
