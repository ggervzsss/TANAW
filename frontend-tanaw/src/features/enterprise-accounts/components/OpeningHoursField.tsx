import { ChevronDown, Plus, X } from "lucide-react";
import { cn, controlClassName } from "@/shared/ui-kit";
import { MAX_PERIODS_PER_DAY, WEEKDAYS, dayHours, setDayHours, weekdayLabels, type DayMode, type OpeningHours, type Weekday } from "../model/openingHours";

/** The kit's soft tinted field, compact for a row of times. */
const control = cn(controlClassName, "rounded-tanaw-sm h-9 w-auto px-2.5 tabular-nums");

/**
 * Opening hours, day by day: closed, open 24 hours, or one or more opening periods. TANAW only
 * shows a place as offline during these hours.
 */
export function OpeningHoursField({ value, onChange, error }: { value: OpeningHours; onChange: (value: OpeningHours) => void; error?: string }) {
  const update = (day: Weekday, mode: DayMode, periods = dayHours(value, day).periods ?? []) =>
    onChange(setDayHours(value, { day, mode, periods: mode === "hours" ? (periods.length ? periods : [{ open: "08:00", close: "17:00" }]) : [] }));

  return (
    <fieldset data-field-name="openingHours" className="m-0 min-w-0 border-0 p-0 md:col-span-2">
      <legend className="mb-1 p-0 text-[13px] font-medium text-(--tanaw-text-secondary)">Opening hours</legend>
      <p className="text-[13px] text-(--tanaw-text-secondary)">TANAW shows a place as offline only while it is open. A midday break is two opening times on the same day.</p>
      <div className="mt-2 divide-y divide-(--tanaw-border-soft) border-y border-(--tanaw-border-soft)">
        {WEEKDAYS.map((day) => {
          const entry = dayHours(value, day);
          const periods = entry.periods ?? [];
          return (
            <div key={day} className="grid gap-2 py-2.5 sm:grid-cols-[7rem_10rem_minmax(0,1fr)] sm:items-center">
              <span className="text-sm font-semibold text-(--tanaw-text)">{weekdayLabels[day]}</span>
              <span className="group relative flex items-center">
                <select
                  aria-label={`${weekdayLabels[day]} hours`}
                  value={entry.mode}
                  onChange={(event) => update(day, event.target.value as DayMode)}
                  className={cn(control, "w-full cursor-pointer appearance-none pr-8 font-medium")}
                >
                  <option value="hours">Open</option>
                  <option value="open24h">Open 24 hours</option>
                  <option value="closed">Closed</option>
                </select>
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className="ease-tanaw-out pointer-events-none absolute right-2.5 text-(--tanaw-text-muted) transition-[translate,color] duration-200 group-focus-within:text-(--tanaw-accent-ink) group-hover:translate-y-px group-hover:text-(--tanaw-text) motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
                />
              </span>
              {entry.mode === "hours" ? (
                <div className="flex flex-wrap items-center gap-2">
                  {periods.map((period, index) => (
                    <span key={index} className="inline-flex items-center gap-1.5">
                      <input
                        type="time"
                        aria-label={`${weekdayLabels[day]} opening time ${index + 1}`}
                        value={period.open}
                        onChange={(event) =>
                          update(
                            day,
                            "hours",
                            periods.map((item, at) => (at === index ? { ...item, open: event.target.value } : item)),
                          )
                        }
                        className={control}
                      />
                      <span className="text-(--tanaw-text-muted)">to</span>
                      <input
                        type="time"
                        aria-label={`${weekdayLabels[day]} closing time ${index + 1}`}
                        value={period.close}
                        onChange={(event) =>
                          update(
                            day,
                            "hours",
                            periods.map((item, at) => (at === index ? { ...item, close: event.target.value } : item)),
                          )
                        }
                        className={control}
                      />
                      {periods.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remove ${weekdayLabels[day]} opening time ${index + 1}`}
                          onClick={() =>
                            update(
                              day,
                              "hours",
                              periods.filter((_, at) => at !== index),
                            )
                          }
                          className="ease-tanaw-out rounded-full p-1 text-(--tanaw-text-muted) transition-[background-color,color,scale] duration-200 hover:bg-(--tanaw-tonal-danger) hover:text-(--tanaw-danger) active:scale-90 motion-reduce:transition-none"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  ))}
                  {periods.length < MAX_PERIODS_PER_DAY && (
                    <button
                      type="button"
                      onClick={() => update(day, "hours", [...periods, { open: "13:00", close: "17:00" }])}
                      className="group/add rounded-tanaw-sm ease-tanaw-out -mx-1.5 inline-flex min-h-8 items-center gap-1 px-1.5 text-[13px] font-semibold text-(--tanaw-accent-ink) transition-colors duration-200 hover:bg-(--tanaw-control-bg) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
                    >
                      <Plus size={13} aria-hidden="true" className="ease-tanaw-out transition-transform duration-200 group-hover/add:rotate-90 motion-reduce:transition-none" />
                      Add a break
                    </button>
                  )}
                </div>
              ) : (
                <span className="text-sm text-(--tanaw-text-secondary)">{entry.mode === "closed" ? "Closed all day" : "Open all day"}</span>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 text-[13px] font-medium text-(--tanaw-error)">{error}</p>}
    </fieldset>
  );
}
