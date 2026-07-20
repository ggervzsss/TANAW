import { SelectDropdown } from "./SelectDropdown";

export type DropdownOption = readonly [string, string];

type SearchableDropdownFieldProps = {
  name: string;
  label: string;
  options: readonly DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string;
};

export function SearchableDropdownField({ name, label, options, value, onChange, required = false, error }: SearchableDropdownFieldProps) {
  return (
    <SelectDropdown
      name={name}
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      required={required}
      error={error}
      searchable
      searchPlaceholder={`Search ${label.toLowerCase()}...`}
    />
  );
}
