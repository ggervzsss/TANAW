import {
  ArrowLeft,
  Check,
  CircleAlert,
  CodeXml,
  Info,
  LifeBuoy,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Moon,
  Shield,
  Sun,
  Upload,
  User,
} from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "../components/Button";
import { useScrollFade } from "../lib/scroll-fade";
import { getSettingsSaveBarState } from "../lib/settingsDraft";
import type { AccountIdentity } from "./TopbarAccount";
import "./GeneralSettings.css";

const settingsSections = {
  profile: { label: "Profile Information", icon: User },
  security: { label: "Password & Security", icon: Shield },
  appearance: { label: "Appearance", icon: Monitor },
  support: { label: "Requests", icon: LifeBuoy },
  developer: { label: "Developer Settings", icon: CodeXml },
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
const noMotion = { duration: 0 } as const;

const sectionEnterMs = 260;
const sectionEnterEasing = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * Fades the section body up a few pixels whenever the section changes. The first render is left
 * alone so a fresh load shows its content at once, and reduced motion turns it off. It uses the
 * Web Animations API, so nothing re-mounts and no form state is lost.
 */
function useSectionEnter(ref: RefObject<HTMLElement | null>, key: unknown, rise = 6) {
  const isFirstRender = useRef(true);
  useLayoutEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const element = ref.current;
    if (!element || typeof element.animate !== "function") return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.animate(
      [
        { opacity: 0, transform: `translateY(${rise}px)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: sectionEnterMs, easing: sectionEnterEasing },
    );
    return () => animation.cancel();
  }, [key, ref, rise]);
}

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
  const rail = useRef<HTMLElement>(null);
  // On phones the sections scroll sideways; keep the current one in view.
  useScrollFade(rail, active);
  // Block bodies: scroll methods return a Promise in current Chromium, and React treats an
  // effect's return value as its clean-up, so returning one crashes on unmount.
  useEffect(() => {
    workspace.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [active]);
  // The section heading stays put while the section below it fades up into place.
  useSectionEnter(body, active);
  const highlightMotion = useReducedMotion() ? noMotion : railSpring;

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
        <nav ref={rail} aria-label="Settings sections" className="tanaw-settings-rail tanaw-scroll-x">
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
                      transition={highlightMotion}
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
  /** Status and controls that belong to the whole group, shown at the end of the header row. */
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
        <div key={row} aria-hidden="true">
          <span className="tanaw-settings-skeleton tanaw-settings-skeleton--dot" />
          <span
            className="tanaw-settings-skeleton"
            style={{ width: `${46 - row * 12}%` }}
          />
          <span className="tanaw-settings-skeleton tanaw-settings-skeleton--end" />
        </div>
      ))}
    </div>
  );
}

/**
 * A note inside a settings section: a thin coloured mark at the start and a soft tint, no box
 * edge. Danger notes are announced as alerts; the others as status.
 */
export function SettingsNote({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "danger";
  children: ReactNode;
}) {
  const Icon = tone === "success" ? Check : tone === "danger" ? CircleAlert : Info;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      data-tone={tone}
      className="tanaw-settings-note"
    >
      <Icon size={16} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

type ImageUploadProps = {
  account: Pick<AccountIdentity, "name" | "email" | "role">;
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
        {account.email && (
          <p className="tanaw-settings-identity-email">{account.email}</p>
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

const firstEditableField =
  'input:not([type="file"]):not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)';

type SettingsSaveBarProps = {
  /** True while the form differs from what is saved. */
  dirty: boolean;
  busy: boolean;
  saveDisabled?: boolean;
  onDiscard: () => void;
  busyLabel?: string;
  /** The submit button's label. */
  children: ReactNode;
};

/**
 * The one save model for a settings form: a frosted bar pinned to the bottom of the settings
 * panel that appears while there are unsaved changes, with Discard and the submit action. It
 * sits in the form's flow, so the end of the form is never hidden behind it.
 */
export function SettingsSaveBar({
  dirty,
  busy,
  saveDisabled = false,
  onDiscard,
  busyLabel = "Saving changes...",
  children,
}: SettingsSaveBarProps) {
  const slot = useRef<HTMLDivElement>(null);
  const hadFocus = useRef(false);
  const { status, visible, showDiscard } = getSettingsSaveBarState({
    dirty,
    busy,
  });

  // When the bar leaves after a save or discard, keep keyboard users in the form rather than
  // dropping focus to the page.
  useEffect(() => {
    if (visible || !hadFocus.current) return;
    hadFocus.current = false;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    slot.current
      ?.closest("form")
      ?.querySelector<HTMLElement>(firstEditableField)
      ?.focus();
  }, [visible]);

  return (
    <div
      ref={slot}
      className="tanaw-settings-save-slot"
      onFocus={() => {
        hadFocus.current = true;
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next))
          hadFocus.current = false;
      }}
    >
      <div className="tanaw-settings-actions" data-visible={visible}>
        <p role="status" className="tanaw-settings-action-status">
          {status === "saving" ? (
            <>
              <LoaderCircle
                size={16}
                className="motion-safe:animate-spin"
                aria-hidden="true"
              />
              {busyLabel}
            </>
          ) : status === "dirty" ? (
            <>
              <CircleAlert size={16} aria-hidden="true" />
              Unsaved changes
            </>
          ) : null}
        </p>
        {visible && (
          <div className="tanaw-settings-action-buttons">
            {showDiscard && (
              <Button variant="secondary" disabled={busy} onClick={onDiscard}>
                Discard
              </Button>
            )}
            <Button type="submit" loading={busy} disabled={saveDisabled}>
              {children}
            </Button>
          </div>
        )}
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
  const ringMotion = useReducedMotion() ? noMotion : railSpring;
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
                      transition={ringMotion}
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
