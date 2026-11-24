import { Plus, X } from "lucide-react";
import { MAX_PERIODS_PER_DAY, WEEKDAYS, dayHours, setDayHours, weekdayLabels, type DayMode, type OpeningHours, type Weekday } from "../model/openingHours";

const control =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:border-slate-600 dark:bg-[#172033] dark:text-slate-100";

/**
 * Opening hours, day by day: closed, open 24 hours, or one or more opening periods. TANAW only
 * shows a place as offline during these hours.
 */
export function OpeningHoursField({ value, onChange, error }: { value: OpeningHours; onChange: (value: OpeningHours) => void; error?: string }) {
  const update = (day: Weekday, mode: DayMode, periods = dayHours(value, day).periods ?? []) =>
    onChange(setDayHours(value, { day, mode, periods: mode === "hours" ? (periods.length ? periods : [{ open: "08:00", close: "17:00" }]) : [] }));

  return (
    <fieldset data-field-name="openingHours" className="rounded-2xl border border-slate-200 p-4 md:col-span-2 dark:border-slate-700">
      <legend className="px-1 text-[11px] font-bold tracking-wide text-slate-500 uppercase">Opening hours</legend>
      <p className="text-sm text-slate-500">TANAW shows a place as offline only while it is open. A midday break is two opening times on the same day.</p>
      <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-700/70">
        {WEEKDAYS.map((day) => {
          const entry = dayHours(value, day);
          const periods = entry.periods ?? [];
          return (
            <div key={day} className="grid gap-2 py-2.5 sm:grid-cols-[7rem_10rem_minmax(0,1fr)] sm:items-center">
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{weekdayLabels[day]}</span>
              <select aria-label={`${weekdayLabels[day]} hours`} value={entry.mode} onChange={(event) => update(day, event.target.value as DayMode)} className={control}>
                <option value="hours">Open</option>
                <option value="open24h">Open 24 hours</option>
                <option value="closed">Closed</option>
              </select>
              {entry.mode === "hours" ? (
                <div className="flex flex-wrap items-center gap-2">
                  {periods.map((period, index) => (
                    <span key={index} className="inline-flex items-center gap-1.5">
                      <input
                        type="time"
                        aria-label={`${weekdayLabels[day]} opening time ${index + 1}`}
                        value={period.open}
                        onChange={(event) => update(day, "hours", periods.map((item, at) => (at === index ? { ...item, open: event.target.value } : item)))}
                        className={control}
                      />
                      <span className="text-slate-400">to</span>
                      <input
                        type="time"
                        aria-label={`${weekdayLabels[day]} closing time ${index + 1}`}
                        value={period.close}
                        onChange={(event) => update(day, "hours", periods.map((item, at) => (at === index ? { ...item, close: event.target.value } : item)))}
                        className={control}
                      />
                      {periods.length > 1 && (
                        <button type="button" aria-label={`Remove ${weekdayLabels[day]} opening time ${index + 1}`} onClick={() => update(day, "hours", periods.filter((_, at) => at !== index))} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                          <X size={14} />
                        </button>
                      )}
                    </span>
                  ))}
                  {periods.length < MAX_PERIODS_PER_DAY && (
                    <button type="button" onClick={() => update(day, "hours", [...periods, { open: "13:00", close: "17:00" }])} className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                      <Plus size={13} />
                      Add a break
                    </button>
                  )}
                </div>
              ) : (
                <span className="text-sm text-slate-500">{entry.mode === "closed" ? "Closed all day" : "Open all day"}</span>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 text-xs font-bold text-red-700">{error}</p>}
    </fieldset>
  );
}
