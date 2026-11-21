import { Switch } from "../ui-kit";

/** The UI-kit Switch with its label and description beside it. */
export function DesignSwitch({ label, description, checked, disabled, onChange }: { label: string; description?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <Switch label={label} description={description} checked={checked} disabled={disabled} onChange={onChange} className="design-switch-row" />;
}
