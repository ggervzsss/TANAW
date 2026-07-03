type ReportingPeriodFieldProps = {
  description: string;
  isLoading?: boolean;
  label: string;
  onPeriodChange?: (period: string) => void;
  options?: string[];
  period: string;
};

export function ReportingPeriodField({
  description,
  isLoading = false,
  label,
  onPeriodChange,
  options = [],
  period,
}: ReportingPeriodFieldProps) {
  const canSelectPeriod = Boolean(onPeriodChange && options.length > 1);

  return (
    <div>
      <label className="mb-2 block text-xs font-semibold tracking-wider text-[#111827] uppercase">{label}</label>
      <div className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2.5">
        {canSelectPeriod ? (
          <select
            value={period}
            disabled={isLoading}
            onChange={(event) => onPeriodChange?.(event.target.value)}
            className="h-10 w-full rounded-sm border border-gray-200 bg-white px-3 text-sm font-bold text-[#111827] outline-none transition-colors focus:border-[#065f46] disabled:cursor-wait disabled:bg-gray-100 disabled:text-gray-500"
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm font-bold text-[#111827]">{period}</p>
        )}
        <p className="mt-1 text-xs leading-5 text-gray-500">{description}</p>
      </div>
    </div>
  );
}
