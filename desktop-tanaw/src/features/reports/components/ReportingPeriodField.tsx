type ReportingPeriodFieldProps = {
  description: string;
  label: string;
  period: string;
};

export function ReportingPeriodField({ description, label, period }: ReportingPeriodFieldProps) {
  return (
    <div>
      <label className="mb-2 block text-xs font-semibold tracking-wider text-[#111827] uppercase">{label}</label>
      <div className="rounded-sm border border-gray-200 bg-gray-50 px-3 py-2.5">
        <p className="text-sm font-bold text-[#111827]">{period}</p>
        <p className="mt-1 text-xs leading-5 text-gray-500">{description}</p>
      </div>
    </div>
  );
}
