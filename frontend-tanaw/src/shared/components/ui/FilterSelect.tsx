import { SelectDropdown, type SelectDropdownOption } from "./SelectDropdown";

type FilterSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectDropdownOption[];
  ariaLabel?: string;
  className?: string;
  searchable?: boolean;
};

export function FilterSelect({ value, onChange, options, ariaLabel, className = "", searchable = false }: FilterSelectProps) {
  return <SelectDropdown value={value} onChange={onChange} options={options} ariaLabel={ariaLabel} className={className} searchable={searchable} />;
}
