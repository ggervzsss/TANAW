import { Check, CircleAlert, RotateCcw, Type } from "lucide-react";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import {
  useSystemDisplayPreferences,
  type DisplayPreferences,
  type InterfaceScalePreference,
  type TextSizePreference,
} from "@/shared/providers/systemDisplayPreferences";

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

export function DisplayPreferencesPage() {
  const { displayPreferences, resetDisplayPreferences, retryDisplayPreferencesSave, saveStatus, updateDisplayPreferences } = useSystemDisplayPreferences();
  const isDefault = displayPreferences.textSize === "default" && displayPreferences.interfaceScale === "default";

  return (
    <PageMotion>
      <PageHeader title="Display Preferences" description="Make TANAW comfortable to read and navigate. Changes apply immediately to this account." />
      <div className="mx-auto max-w-5xl space-y-6">
        <Panel className="overflow-hidden">
          <div className="border-b border-slate-200 p-6 dark:border-white/10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-tanaw-green text-xs font-black tracking-[0.18em] uppercase dark:text-emerald-300">Your display</p>
                <h2 className="mt-2 text-xl font-bold text-slate-950 dark:text-white">Reading and workspace size</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-300">Text size changes typography. Interface scale changes the breathing room around workspace content.</p>
              </div>
              <SaveStatus status={saveStatus} onRetry={retryDisplayPreferencesSave} />
            </div>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-white/10">
            <PreferenceRow title="Text size" description="Choose a readable size without changing browser zoom.">
              <OptionGroup
                name="text-size"
                value={displayPreferences.textSize}
                options={textSizeOptions}
                onChange={(textSize) => updateDisplayPreferences({ textSize })}
              />
            </PreferenceRow>
            <PreferenceRow title="Interface scale" description="Adjust content spacing independently from text size.">
              <OptionGroup
                name="interface-scale"
                value={displayPreferences.interfaceScale}
                options={interfaceScaleOptions}
                onChange={(interfaceScale) => updateDisplayPreferences({ interfaceScale })}
              />
            </PreferenceRow>
          </div>
        </Panel>

        <DisplayPreview preferences={displayPreferences} />

        <div className="flex justify-end">
          <button
            type="button"
            disabled={isDefault || saveStatus === "saving"}
            onClick={resetDisplayPreferences}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-emerald-400/10"
          >
            <RotateCcw size={16} /> Reset to default
          </button>
        </div>
      </div>
    </PageMotion>
  );
}

function PreferenceRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-5 p-6 lg:grid-cols-[minmax(13rem,0.7fr)_minmax(0,1.3fr)] lg:items-start">
      <div>
        <h3 className="font-bold text-slate-900 dark:text-slate-100">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-300">{description}</p>
      </div>
      {children}
    </section>
  );
}

function OptionGroup<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: Array<{ value: T; label: string; description: string }>; onChange: (value: T) => void }) {
  return (
    <fieldset>
      <legend className="sr-only">{name === "text-size" ? "Text size" : "Interface scale"}</legend>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className={`relative rounded-xl border p-3 transition ${selected ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600 dark:border-emerald-400 dark:bg-emerald-400/10 dark:ring-emerald-400" : "border-slate-200 bg-white hover:border-emerald-300 dark:border-white/12 dark:bg-white/4"}`}
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
    <Panel className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4 dark:border-white/10">
        <Type size={18} className="text-emerald-700 dark:text-emerald-300" />
        <h2 className="font-bold text-slate-950 dark:text-white">Live preview</h2>
      </div>
      <div className="p-6">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-950/30" style={{ fontSize: `${previewFontScale}em`, padding: previewPadding }}>
          <h3 className="text-xl font-bold text-slate-950 dark:text-white">Visitor overview</h3>
          <p className="mt-2 max-w-2xl leading-6 text-slate-600 dark:text-slate-300">Review the latest visitor count and open the detailed report when you need more context.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/5">
              <span className="block text-xs font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">Current visitors</span>
              <strong className="mt-1 block text-lg text-slate-950 dark:text-white">128 people</strong>
            </div>
            <button type="button" className="bg-tanaw-green hover:bg-tanaw-green-dark rounded-xl px-4 py-2.5 font-bold text-white">View report</button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function SaveStatus({ status, onRetry }: { status: "idle" | "saving" | "saved" | "error"; onRetry: () => void }) {
  if (status === "error") {
    return (
      <div role="alert" className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
        <CircleAlert size={16} /> Failed to save.
        <button type="button" onClick={onRetry} className="underline underline-offset-4">Retry</button>
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" className="flex min-h-6 items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-300">
      {status === "saving" ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" aria-hidden="true" /> : <Check size={16} className="text-emerald-600" aria-hidden="true" />}
      {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Ready"}
    </div>
  );
}
