import { useId } from "react";

export function DesignSwitch({ label, description, checked, disabled, onChange }: { label: string; description?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="design-switch-row">
      <div>
        <label id={id}>{label}</label>
        {description && <p id={`${id}-description`}>{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-labelledby={id}
        aria-describedby={description ? `${id}-description` : undefined}
        aria-checked={checked}
        disabled={disabled}
        className="design-switch"
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}
