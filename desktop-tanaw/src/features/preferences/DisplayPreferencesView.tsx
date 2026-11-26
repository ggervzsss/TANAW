import { SettingsGroup } from "../../ui-kit/patterns/GeneralSettings";
import { Check, CircleAlert, RotateCcw } from "lucide-react";
import { useId } from "react";
import { Button } from "../../ui-kit";
import { textSizeOptions, textSizeRootValue, useSystemDisplayPreferences, type PreferenceSaveStatus, type TextSizePreference } from "./system-display-preferences";

export function DisplayPreferencesView() {
  const { displayPreferences, resetDisplayPreferences, retryDisplayPreferencesSave, saveStatus, updateDisplayPreferences } = useSystemDisplayPreferences();
  const isDefault = displayPreferences.textSize === "default";

  return (
    <SettingsGroup
      title="Display Preferences"
      description="Choose a readable text size without changing system zoom. Changes save automatically."
      actions={
        <>
          <SaveStatus status={saveStatus} onRetry={retryDisplayPreferencesSave} />
          <Button variant="secondary" size="sm" leadingIcon={<RotateCcw size={15} aria-hidden="true" />} disabled={isDefault || saveStatus === "saving"} onClick={resetDisplayPreferences}>
            Reset to default
          </Button>
        </>
      }
    >
      <div className="tanaw-display-layout">
        <TextSizeChoices value={displayPreferences.textSize} onChange={(textSize) => updateDisplayPreferences({ textSize })} />
        <DisplayPreview textSize={displayPreferences.textSize} />
      </div>
    </SettingsGroup>
  );
}

function TextSizeChoices({ value, onChange }: { value: TextSizePreference; onChange: (value: TextSizePreference) => void }) {
  const name = useId();
  const titleId = useId();
  return (
    <div className="tanaw-display-column">
      <h4 id={titleId} className="tanaw-display-column-title">
        Text size
      </h4>
      <div role="radiogroup" aria-labelledby={titleId} className="tanaw-display-options">
        {textSizeOptions.map((option) => (
          <label key={option.value} className="tanaw-choice">
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="sr-only" />
            <span className="tanaw-choice-title">{option.label}</span>
            <span className="tanaw-choice-description">{option.description}</span>
            <span className="tanaw-display-sample" style={{ fontSize: textSizeRootValue(option.value) }} aria-hidden="true">
              Aa
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function DisplayPreview({ textSize }: { textSize: TextSizePreference }) {
  const size = textSizeRootValue(textSize);
  const label = textSizeOptions.find((option) => option.value === textSize)?.label ?? "Default";
  return (
    <div className="tanaw-display-column">
      <h4 className="tanaw-display-column-title">Live preview</h4>
      <figure className="tanaw-display-preview" data-testid="display-preview" data-text-size={textSize}>
        <div className="tanaw-display-preview-card" style={{ fontSize: size }} aria-hidden="true">
          <p className="tanaw-display-preview-eyebrow">Visitors today</p>
          <p className="tanaw-display-preview-figure font-display">
            128 <span>people</span>
          </p>
          <p className="tanaw-display-preview-body">Review the latest visitor count and open the detailed report when you need more context.</p>
          <div className="tanaw-display-preview-actions">
            <span>View report</span>
            <span>Export</span>
          </div>
        </div>
        <figcaption>
          {label} text, {size} base size
        </figcaption>
      </figure>
    </div>
  );
}

function SaveStatus({ status, onRetry }: { status: PreferenceSaveStatus; onRetry: () => void }) {
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
  if (status === "idle") return null;
  return (
    <div role="status" aria-live="polite" className="flex min-h-6 items-center gap-2 text-[0.8125rem] font-medium text-(--tanaw-text-secondary)">
      {status === "saving" ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-(--tanaw-accent-ink) border-t-transparent motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        <Check size={16} className="text-(--tanaw-accent-ink)" aria-hidden="true" />
      )}
      {status === "saving" ? "Saving…" : "Saved"}
    </div>
  );
}
