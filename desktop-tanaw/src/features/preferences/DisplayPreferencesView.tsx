import { SettingsGroup } from "../../ui-kit/patterns/GeneralSettings";
import { Check, CircleAlert, RotateCcw, Type } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "../../components/Card";
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
        <div className="grid content-start gap-3">
          <PreferenceRow title="Text size" description="Choose a readable size without changing system zoom.">
            <OptionGroup name="text-size" value={displayPreferences.textSize} options={textSizeOptions} onChange={(textSize) => updateDisplayPreferences({ textSize })} />
          </PreferenceRow>
          <PreferenceRow title="Interface scale" description="Adjust content spacing independently from text size.">
            <OptionGroup name="interface-scale" value={displayPreferences.interfaceScale} options={interfaceScaleOptions} onChange={(interfaceScale) => updateDisplayPreferences({ interfaceScale })} />
          </PreferenceRow>
        </div>
        <DisplayPreview preferences={displayPreferences} />
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={isDefault || saveStatus === "saving"}
          onClick={resetDisplayPreferences}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-emerald-400/10"
        >
          <RotateCcw size={16} /> Reset to default
        </button>
      </div>
    </SettingsGroup>
  );
}

function PreferenceRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-sm font-bold text-(--tanaw-text)">{title}</h4>
        <p className="mt-0.5 text-xs text-(--tanaw-text-secondary)">{description}</p>
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
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className={`rounded-tanaw-sm relative border p-2.5 transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--tanaw-focus-ring) ${selected ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600 dark:border-emerald-400 dark:bg-emerald-400/10 dark:ring-emerald-400" : "border-slate-200 bg-white hover:border-emerald-300 dark:border-white/12 dark:bg-white/4"}`}
            >
              <input type="radio" name={name} value={option.value} checked={selected} onChange={() => onChange(option.value)} className="sr-only" />
              <span className="flex items-center justify-between gap-2 text-sm font-bold text-slate-900 dark:text-white">
                {option.label} {selected && <Check size={15} className="text-emerald-700 dark:text-emerald-300" aria-hidden="true" />}
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-300">{option.description}</span>
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
    <Card className="overflow-hidden rounded-[28px] dark:border-white/10">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-white/10">
        <Type size={18} className="text-emerald-700 dark:text-emerald-300" />
        <h3 className="font-bold text-slate-950 dark:text-white">Live preview</h3>
      </div>
      <div className="p-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-950/30" style={{ fontSize: `${previewFontScale}em`, padding: previewPadding }}>
          <h3 className="text-xl font-bold text-slate-950 dark:text-white">Visitor overview</h3>
          <p className="mt-2 max-w-2xl leading-6 text-slate-600 dark:text-slate-300">Review the latest visitor count and open the detailed report when you need more context.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/5">
              <span className="block text-xs font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">Current visitors</span>
              <strong className="mt-1 block text-lg text-slate-950 dark:text-white">128 people</strong>
            </div>
            <span className="rounded-tanaw-sm bg-(--tanaw-action) px-3 py-2 font-bold text-(--tanaw-on-action)">View report</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function SaveStatus({ status, onRetry }: { status: "idle" | "saving" | "saved" | "error"; onRetry: () => void }) {
  if (status === "error") {
    return (
      <div role="alert" className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
        <CircleAlert size={16} /> Failed to save.
        <button type="button" onClick={onRetry} className="underline underline-offset-4">
          Retry
        </button>
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" className="flex min-h-6 items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-300">
      {status === "saving" ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" aria-hidden="true" />
      ) : (
        <Check size={16} className="text-emerald-600" aria-hidden="true" />
      )}
      {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Ready"}
    </div>
  );
}
