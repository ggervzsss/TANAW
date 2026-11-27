import { Check, CircleAlert, LoaderCircle, RotateCcw } from "lucide-react";
import { useId, useRef } from "react";
import { Button } from "@/shared/ui-kit";
import { SettingsGroup } from "@/shared/ui-kit/patterns/GeneralSettings";
import {
  defaultDisplayPreferences,
  isDefaultDisplayPreferences,
  textSizeRootValue,
  useSystemDisplayPreferences,
  type PreferenceSaveStatus,
  type TextSizePreference,
} from "@/shared/providers/systemDisplayPreferences";

const textSizeOptions: ReadonlyArray<{ value: TextSizePreference; label: string; description: string }> = [
  { value: "small", label: "Small", description: "Fits more text on screen." },
  { value: "default", label: "Default", description: "TANAW's standard text size." },
  { value: "large", label: "Large", description: "Makes text easier to read." },
  { value: "extra-large", label: "Extra Large", description: "Maximizes text legibility." },
];

export function DisplayPreferencesPage() {
  const { displayPreferences, resetDisplayPreferences, retryDisplayPreferencesSave, saveStatus, updateDisplayPreferences } = useSystemDisplayPreferences();
  const isDefault = isDefaultDisplayPreferences(displayPreferences);
  const layoutRef = useRef<HTMLDivElement>(null);

  // Reset disables its own button, so move focus to the option it selects instead of losing it.
  const reset = () => {
    resetDisplayPreferences();
    layoutRef.current?.querySelector<HTMLInputElement>(`input[type="radio"][value="${defaultDisplayPreferences.textSize}"]`)?.focus();
  };

  return (
    <SettingsGroup
      title="Display Preferences"
      description="Text size changes apply right away and save automatically."
      actions={
        <>
          <SaveStatus status={saveStatus} onRetry={retryDisplayPreferencesSave} />
          <Button variant="secondary" leadingIcon={<RotateCcw size={16} aria-hidden="true" />} disabled={isDefault || saveStatus === "saving"} onClick={reset}>
            Reset to default
          </Button>
        </>
      }
    >
      <div ref={layoutRef} className="tanaw-display-layout">
        <TextSizeOptions value={displayPreferences.textSize} onChange={(textSize) => updateDisplayPreferences({ textSize })} />
        <DisplayPreview textSize={displayPreferences.textSize} />
      </div>
    </SettingsGroup>
  );
}

/** Text sizes as radio rows with a dot; each row shows an "Aa" at its own size. */
function TextSizeOptions({ value, onChange }: { value: TextSizePreference; onChange: (value: TextSizePreference) => void }) {
  const name = useId();
  const descriptionId = `${name}-description`;
  return (
    <fieldset className="tanaw-display-column" aria-describedby={descriptionId}>
      <legend className="tanaw-display-column-title">Text size</legend>
      <p id={descriptionId} className="tanaw-display-help">
        Choose a readable size without changing browser zoom.
      </p>
      <div className="tanaw-display-options">
        {textSizeOptions.map((option) => (
          <label key={option.value} className="tanaw-choice">
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span className="tanaw-choice-title">{option.label}</span>{" "}
            <span className="tanaw-choice-description">{option.description}</span>
            <span className="tanaw-display-sample" aria-hidden="true" style={{ fontSize: textSizeRootValue(option.value) }}>
              Aa
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The preview is ordinary TANAW content. Text size scales the whole page from the root, so the
 * sample shows exactly what the rest of the portal looks like at the selected size and theme.
 */
function DisplayPreview({ textSize }: { textSize: TextSizePreference }) {
  const headingId = useId();
  const label = textSizeOptions.find((option) => option.value === textSize)?.label ?? "Default";
  return (
    <section className="tanaw-display-preview" aria-labelledby={headingId}>
      <header className="tanaw-display-preview-header">
        <h4 id={headingId}>Live preview</h4>
        <span>
          {label} · {textSizeRootValue(textSize)} text
        </span>
      </header>
      <div className="tanaw-display-preview-card">
        <p className="tanaw-display-preview-eyebrow">Today</p>
        <p className="tanaw-display-preview-title">Visitor overview</p>
        <p className="tanaw-display-preview-body">Review the latest visitor count and open the full report when you need more detail.</p>
        <div className="tanaw-display-preview-metric">
          <span>Current visitors</span>
          <strong>128</strong>
        </div>
        <span className="tanaw-display-preview-action" aria-hidden="true">
          View report
        </span>
      </div>
    </section>
  );
}

function SaveStatus({ status, onRetry }: { status: PreferenceSaveStatus; onRetry: () => void }) {
  if (status === "error") {
    return (
      <p role="alert" className="tanaw-display-status" data-tone="error">
        <CircleAlert size={16} aria-hidden="true" />
        Failed to save.
        <button type="button" onClick={onRetry} className="tanaw-display-retry">
          Retry
        </button>
      </p>
    );
  }
  return (
    <p role="status" className="tanaw-display-status">
      {status === "saving" && (
        <>
          <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" />
          Saving…
        </>
      )}
      {status === "saved" && (
        <>
          <Check size={16} aria-hidden="true" />
          Saved
        </>
      )}
    </p>
  );
}
