import { Switch } from "../design-system";

/** The design-system Switch with its label and description beside it. */
export function DesignSwitch({ label, description, checked, disabled, onChange }: { label: string; description?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <Switch label={label} description={description} checked={checked} disabled={disabled} onChange={onChange} className="design-switch-row" />;
}
