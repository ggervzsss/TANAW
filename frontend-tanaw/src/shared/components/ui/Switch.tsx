import { Switch as DesignSwitch } from "../../../design-system";

/** The design-system Switch for rows that show their own label text. */
export function Switch({ checked, disabled = false, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <DesignSwitch hideLabel label={label} checked={checked} disabled={disabled} onChange={onChange} />;
}
