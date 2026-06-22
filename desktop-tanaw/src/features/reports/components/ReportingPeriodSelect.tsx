import { REPORTING_PERIODS } from "../../../lib/operationalDefaults";
import type { SystemLogPeriod } from "../../../types/enterprise";

type ReportingPeriodSelectProps = {
  isReadOnly: boolean;
  period: SystemLogPeriod;
  setPeriod: React.Dispatch<React.SetStateAction<SystemLogPeriod>>;
};

export function ReportingPeriodSelect({ isReadOnly, period, setPeriod }: ReportingPeriodSelectProps) {
  const options = REPORTING_PERIODS.includes(period as (typeof REPORTING_PERIODS)[number]) ? REPORTING_PERIODS : [period, ...REPORTING_PERIODS];

  return (
    <div>
      <label className="mb-2 block text-xs font-semibold tracking-wider text-[#111827] uppercase">Reporting Period</label>
      <select
        value={period}
        onChange={(event) => setPeriod(event.target.value as SystemLogPeriod)}
        disabled={isReadOnly}
        className="w-full rounded-sm border border-gray-300 bg-white p-2.5 text-sm font-medium text-[#111827] transition-all outline-none focus:border-[#065f46] disabled:bg-gray-50"
      >
        {options.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </div>
  );
}
