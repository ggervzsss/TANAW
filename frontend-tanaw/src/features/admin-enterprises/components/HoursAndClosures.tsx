import { useQuery } from "@tanstack/react-query";
import { closureMarkedBy, closureState, closureStateLabels, formatClosureDates, orderClosures, type ClosureState } from "@/features/enterprise-accounts/model/closures";
import { WEEKDAYS, dayBreakNote, dayHours, formatDayHours, openingStatus, philippineMoment, weekdayLabels, type OpeningStatusTone } from "@/features/enterprise-accounts/model/openingHours";
import { enterpriseClosuresQueryKey, listEnterpriseClosures } from "@/features/enterprise-accounts/services/enterpriseAccountService";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { Badge, Button, Skeleton, cn, type BadgeTone } from "@/shared/ui-kit";
import type { EnterpriseRow } from "../model/enterpriseDirectory";

/*
 * Opening Hours and Temporary Closures on Enterprise Details, read-only for the Admin. IT keeps both
 * on the enterprise account, and the enterprise changes them in the desktop app.
 */

const statusTone: Record<OpeningStatusTone, BadgeTone> = { open: "success", closed: "neutral", temporarilyClosed: "danger" };
const closureTone: Record<ClosureState, BadgeTone> = { upcoming: "warning", ongoing: "danger", ended: "neutral" };

/** Day name, hours and break note; on phones the hours drop under the day name. */
const hoursRowClass = "grid grid-cols-[8.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-2.5 max-sm:grid-cols-[minmax(0,1fr)_auto]";
const hoursCellClass = "max-sm:col-span-2 max-sm:row-start-2";
const noteCellClass = "max-sm:col-start-2 max-sm:row-start-1";

/** Two columns under the trend, split by hairlines; they stack at 1100px like the sections above. */
const gridClass = "mt-10 grid grid-cols-2 gap-x-10 gap-y-8 border-t border-(--tanaw-border-soft) pt-8 max-[1100px]:grid-cols-1";
const sectionRuleClass = "min-w-0 border-l border-(--tanaw-border-soft) pl-10 max-[1100px]:border-t max-[1100px]:border-l-0 max-[1100px]:pt-6 max-[1100px]:pl-0";
const quietLineClass = "mt-3 border-y border-(--tanaw-border-soft) py-3 text-sm text-(--tanaw-text-secondary)";

export function HoursAndClosures({ row, now }: { row: EnterpriseRow; now: Date }) {
  const { timeFormat, dateFormat } = useSystemDisplayPreferences();
  const accountId = row.account?.id ?? "";
  const closures = useQuery({ queryKey: enterpriseClosuresQueryKey(accountId), queryFn: () => listEnterpriseClosures(accountId), enabled: Boolean(accountId) });
  const hours = row.account?.openingHours ?? null;
  const moment = philippineMoment(now);
  // The status waits for the closures, so a closed day is never shown as open for a moment.
  const status = closures.isSuccess ? openingStatus({ hours, closures: closures.data, now, timeFormat, dateFormat }) : null;
  const enterpriseNames = [row.account?.displayName, row.account?.enterpriseName, row.name];

  return (
    <div className={gridClass}>
      <section aria-labelledby="hours-title" className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 id="hours-title" className="ae-heading">
            Opening Hours
          </h2>
          {hours && closures.isPending ? (
            <Skeleton shape="pill" className="h-5.5 w-40" label="Loading opening status" />
          ) : (
            status && (
              <Badge size="sm" tone={statusTone[status.tone]} sentenceCase={false} className="ae-fade">
                {status.label}
              </Badge>
            )
          )}
        </div>
        <p className="mt-1 text-[13px] text-(--tanaw-text-secondary)">Entered by IT when the account was created. The enterprise can change it in the desktop app.</p>
        {!row.account ? (
          <p className={quietLineClass}>The enterprise account could not be loaded, so its opening hours are not shown.</p>
        ) : !hours ? (
          <p className={quietLineClass}>No opening hours are on record yet, so TANAW counts the place as open at all hours.</p>
        ) : (
          <>
            <ul className="ae-rows mt-3 text-sm">
              {WEEKDAYS.map((day) => {
                const entry = dayHours(hours, day);
                const today = day === moment.weekday;
                const note = dayBreakNote(entry);
                return (
                  <li key={day} data-today={today || undefined} aria-current={today ? "date" : undefined} className={hoursRowClass}>
                    <span className="font-semibold text-(--tanaw-text)">
                      {weekdayLabels[day]}
                      {today && <span className="font-normal text-(--tanaw-accent-ink)"> (today)</span>}
                    </span>
                    <span className={cn("tabular-nums", hoursCellClass, entry.mode === "closed" ? "text-(--tanaw-text-muted)" : "text-(--tanaw-text)")}>{formatDayHours(entry, timeFormat)}</span>
                    {note && <span className={cn("text-[13px] text-(--tanaw-text-muted)", noteCellClass)}>{note}</span>}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[13px] text-(--tanaw-text-muted)">The pin is faded on the map outside these hours. The desktop app is only shown as offline during them.</p>
          </>
        )}
      </section>

      <section aria-labelledby="closures-title" className={sectionRuleClass}>
        <h2 id="closures-title" className="ae-heading">
          Temporary Closures
        </h2>
        <p className="mt-1 text-[13px] text-(--tanaw-text-secondary)">Set by the enterprise in the desktop app, or by IT. On these days the place is never shown as offline.</p>
        {!row.account ? (
          <p className={quietLineClass}>The enterprise account could not be loaded, so its closures are not shown.</p>
        ) : closures.isPending ? (
          <ClosureRowsSkeleton label="Loading temporary closures" />
        ) : closures.isError ? (
          <div role="alert" className={cn(quietLineClass, "flex flex-wrap items-center justify-between gap-x-3 gap-y-2")}>
            Temporary closures could not be loaded.
            <Button size="sm" variant="secondary" loading={closures.isFetching} onClick={() => void closures.refetch()}>
              Try again
            </Button>
          </div>
        ) : closures.data.length === 0 ? (
          <p className={quietLineClass}>No temporary closures are on record. The place keeps its usual opening hours.</p>
        ) : (
          <ul className="ae-rows ae-fade mt-3 text-sm">
            {orderClosures(closures.data, moment.date).map((closure) => {
              const state = closureState(closure, moment.date);
              const marked = closureMarkedBy(closure, enterpriseNames);
              return (
                <li key={closure.id} className="py-3">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 font-semibold text-(--tanaw-text) tabular-nums">{formatClosureDates(closure, dateFormat)}</span>
                    <Badge size="sm" tone={closureTone[state]} sentenceCase={false} className="shrink-0">
                      {closureStateLabels[state]}
                    </Badge>
                  </span>
                  <span className="mt-0.5 block wrap-break-word text-(--tanaw-text-secondary)">{closure.reason || "No reason given"}</span>
                  {marked && <span className="mt-0.5 block text-[13px] text-(--tanaw-text-muted)">{marked}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** A section heading (18px at 1.3) and its 13px caption as bars, with room for the status pill. */
function HeadingSkeleton({ title, pill = false }: { title: string; pill?: boolean }) {
  return (
    <>
      <span className="flex h-[23.4px] items-center justify-between gap-3">
        <Skeleton className={cn("h-5", title)} />
        {pill && <Skeleton shape="pill" className="h-5.5 w-40" />}
      </span>
      <span className="mt-1 flex h-[19.5px] items-center">
        <Skeleton className="h-3.5 w-full max-w-md" />
      </span>
    </>
  );
}

/** Both sections while the enterprise loads, at their real line heights. */
export function HoursAndClosuresSkeleton() {
  return (
    <div aria-hidden="true" className={gridClass}>
      <div className="min-w-0">
        <HeadingSkeleton title="w-36" pill />
        <span className="ae-rows ae-rows-static mt-3 block text-sm">
          {WEEKDAYS.map((day, index) => (
            <span key={day} className={hoursRowClass}>
              <span className="flex h-5 items-center">
                <Skeleton className="h-3.5 w-20" />
              </span>
              <span className={cn("flex h-5 items-center", hoursCellClass)}>
                <Skeleton className={cn("h-3.5", index < 5 ? "w-52 max-w-full" : "w-28")} />
              </span>
              {index < 5 && (
                <span className={cn("flex h-5 items-center", noteCellClass)}>
                  <Skeleton className="h-3 w-20" />
                </span>
              )}
            </span>
          ))}
        </span>
        <span className="mt-3 flex h-[19.5px] items-center">
          <Skeleton className="h-3 w-full max-w-sm" />
        </span>
      </div>
      <div className={sectionRuleClass}>
        <HeadingSkeleton title="w-44" />
        <ClosureRowsSkeleton />
      </div>
    </div>
  );
}

/** Closure rows while they load: the dates and the status pill, the reason, and who marked it. */
function ClosureRowsSkeleton({ label }: { label?: string }) {
  return (
    <span role={label ? "status" : undefined} aria-label={label} className="mt-3 block">
      <span aria-hidden="true" className="ae-rows ae-rows-static block text-sm">
        {[0, 1].map((index) => (
          <span key={index} className="block py-3">
            <span className="flex h-5.5 items-center justify-between gap-3">
              <Skeleton className="h-3.5 w-44 max-w-full" />
              <Skeleton shape="pill" className="h-5.5 w-20 shrink-0" />
            </span>
            <span className="mt-0.5 flex h-5 items-center">
              <Skeleton className="h-3.5 w-32" />
            </span>
            <span className="mt-0.5 flex h-[19.5px] items-center">
              <Skeleton className="h-3 w-56 max-w-full" />
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}
