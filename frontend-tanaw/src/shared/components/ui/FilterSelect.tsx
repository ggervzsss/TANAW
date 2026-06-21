type FilterSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string] | string)[];
  className?: string;
};

export function FilterSelect({ value, onChange, options, className = "" }: FilterSelectProps) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={`rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none ${className}`}>
      {options.map((option) => {
        const [optionValue, label] = typeof option === "string" ? [option, option] : option;
        return (
          <option key={optionValue} value={optionValue}>
            {label}
          </option>
        );
      })}
    </select>
  );
}
