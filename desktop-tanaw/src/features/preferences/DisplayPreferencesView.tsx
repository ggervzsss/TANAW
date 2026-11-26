import { SettingsGroup } from "../../ui-kit/patterns/GeneralSettings";
import { Check, CircleAlert, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../ui-kit";
import { useSystemDisplayPreferences, type DisplayPreferences, type InterfaceScalePreference, type TextSizePreference } from "./system-display-preferences";

const textSizeOptions: Array<{ value: TextSizePreference; label: string; description: string }> = [
  { value: "small", label: "Small", description: "Fits more text on screen." },
  { value: "default", label: "Default", description: "TANAW's standard text size." },
  { value: "large", label: "Large", description: "Makes text easier to read." },
  { value: "extra-large", label: "Extra Large", description: "Maximizes text legibility." },
];

const interfaceScaleOptions: Array<{ value: InterfaceScalePreference; label: string; description: string }> = [
  { value: "compact", label: "Compact", description: "Reduces workspace spacing." },
  { value: "default", label: "Default", description: "Uses balanced spacing." },
  { value: "comfortable", label: "Comfortable", description: "Adds room around content." },
];

export function DisplayPreferencesView() {
  const { displayPreferences, resetDisplayPreferences, retryDisplayPreferencesSave, saveStatus, updateDisplayPreferences } = useSystemDisplayPreferences();
  const isDefault = displayPreferences.textSize === "default" && displayPreferences.interfaceScale === "default";

  return (
    <SettingsGroup title="Display Preferences" description="Adjust text and spacing independently. Changes save automatically.">
      <div className="mb-3">
        <SaveStatus status={saveStatus} onRetry={retryDisplayPreferencesSave} />
      </div>
      <div className="tanaw-display-layout">
        <div className="grid content-start gap-6">
          <PreferenceRow title="Text size" description="Choose a readable size without changing system zoom.">
            <OptionGroup name="text-size" value={displayPreferences.textSize} options={textSizeOptions} onChange={(textSize) => updateDisplayPreferences({ textSize })} />
          </PreferenceRow>
          <PreferenceRow title="Interface scale" description="Adjust content spacing independently from text size.">
            <OptionGroup name="interface-scale" value={displayPreferences.interfaceScale} options={interfaceScaleOptions} onChange={(interfaceScale) => updateDisplayPreferences({ interfaceScale })} />
          </PreferenceRow>
        </div>
        <DisplayPreview preferences={displayPreferences} />
      </div>

      <div className="mt-5 flex justify-end">
        <Button variant="secondary" size="sm" leadingIcon={<RotateCcw size={15} aria-hidden="true" />} disabled={isDefault || saveStatus === "saving"} onClick={resetDisplayPreferences}>
          Reset to default
        </Button>
      </div>
    </SettingsGroup>
  );
}

function PreferenceRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h4 className="text-sm font-semibold text-(--tanaw-text)">{title}</h4>
        <p className="mt-0.5 text-[0.8125rem] text-(--tanaw-text-secondary)">{description}</p>
      </div>
      {children}
    </section>
  );
}

function OptionGroup<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: Array<{ value: T; label: string; description: string }>; onChange: (value: T) => void }) {
  return (
    <fieldset>
      <legend className="sr-only">{name === "text-size" ? "Text size" : "Interface scale"}</legend>
      <div className="tanaw-display-options">
        {options.map((option) => {
          return (
            <label
              key={option.value}
              className="tanaw-choice"
            >
              <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="sr-only" />
              <span className="tanaw-choice-title">{option.label}</span>
              <span className="tanaw-choice-description">{option.description}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function DisplayPreview({ preferences }: { preferences: DisplayPreferences }) {
  const previewFontScale = { small: 0.88, default: 1, large: 1.12, "extra-large": 1.25 }[preferences.textSize];
  const previewPadding = { compact: "1rem", default: "1.35rem", comfortable: "1.75rem" }[preferences.interfaceScale];
  return (
    <div className="min-w-0">
      <h4 className="tanaw-display-preview-title">Live preview</h4>
      <div className="tanaw-display-preview" style={{ fontSize: `${previewFontScale}em`, padding: previewPadding }}>
        <h3 className="font-display text-xl font-bold text-(--tanaw-text)">Visitor overview</h3>
        <p className="mt-2 max-w-2xl leading-6 text-(--tanaw-text-secondary)">Review the latest visitor count and open the detailed report when you need more context.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="rounded-tanaw-md bg-(--tanaw-surface) px-4 py-3 shadow-tanaw-resting">
            <span className="block text-xs font-medium text-(--tanaw-text-secondary)">Current visitors</span>
            <strong className="mt-1 block text-lg text-(--tanaw-text) tabular-nums">128 people</strong>
          </div>
          <span className="rounded-tanaw-md bg-(--tanaw-action) px-3.5 py-2 font-semibold text-(--tanaw-on-action)">View report</span>
        </div>
      </div>
    </div>
  );
}

function SaveStatus({ status, onRetry }: { status: "idle" | "saving" | "saved" | "error"; onRetry: () => void }) {
  if (status === "error") {
    return (
      <div role="alert" className="tanaw-enter flex items-center gap-2 text-sm font-semibold text-(--tanaw-error)">
        <CircleAlert size={16} aria-hidden="true" /> Failed to save.
        <button type="button" onClick={onRetry} className="rounded-tanaw-sm px-1 underline underline-offset-4 hover:text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)">
          Retry
        </button>
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" className="flex min-h-6 items-center gap-2 text-[0.8125rem] font-medium text-(--tanaw-text-secondary)">
      {status === "saving" ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-(--tanaw-accent-ink) border-t-transparent motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        <Check size={16} className="text-(--tanaw-accent-ink)" aria-hidden="true" />
      )}
      {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Ready"}
    </div>
  );
}
