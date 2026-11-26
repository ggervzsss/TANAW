import { CalendarOff, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../ui-kit";
import { SettingsGroup, SettingsRowsSkeleton } from "../../../ui-kit/patterns/GeneralSettings";
import { addClosure, listClosures, removeClosure, updateOpeningHours, type ClosureSummary } from "../../login/api/login";
import { useAuthStore } from "../../login/stores/auth-store";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import { listSupportTickets, type SupportTicket } from "../../tickets/services/tickets";
import { getRequestErrorMessage } from "../model/profile-edit";
import { WEEKDAYS, dayHours, defaultOpeningHours, setDayHours, validateOpeningHours, weekdayLabels, type DayMode, type OpeningHours, type Weekday } from "../model/opening-hours";

const control = "tanaw-settings-control";

/** Account changes waiting for IT: a new contact number or enterprise name. */
export function PendingAccountChanges({ refreshKey }: { refreshKey: number }) {
  const [changes, setChanges] = useState<SupportTicket[]>([]);
  useEffect(() => {
    let disposed = false;
    void listSupportTickets()
      .then((requests) => {
        if (disposed) return;
        setChanges(requests.filter((request) => request.group === "Account change" && request.accountChange?.field !== "businessEmail" && request.status === "In Progress"));
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [refreshKey]);
  if (changes.length === 0) return null;
  return (
    <ul className="enterprise-profile-pending-changes m-0 grid list-none gap-2 p-0" aria-label="Changes waiting for IT">
      {changes.map((change) => (
        <li key={change.id} className="tanaw-settings-note tanaw-enter">
          <p className="font-semibold">{change.title} is waiting for IT</p>
          <p className="mt-0.5 text-(--tanaw-text-secondary)">
            {change.accountChange?.label}: {change.accountChange?.currentValue ?? "Not set"} → {change.accountChange?.requestedValue}. It changes once IT approves it.
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Opening hours, day by day, saved right away. */
export function OpeningHoursSettings() {
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const saved = user?.openingHours ?? null;
  const [hours, setHours] = useState<OpeningHours>(saved ?? defaultOpeningHours());
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const dirty = JSON.stringify(hours) !== JSON.stringify(saved ?? defaultOpeningHours());

  const update = (day: Weekday, mode: DayMode, periods = dayHours(hours, day).periods ?? []) => {
    setError("");
    setHours(setDayHours(hours, { day, mode, periods: mode === "hours" ? (periods.length ? periods : [{ open: "08:00", close: "17:00" }]) : [] }));
  };

  async function save() {
    const problem = validateOpeningHours(hours);
    if (problem) {
      setError(problem);
      return;
    }
    setIsSaving(true);
    try {
      updateUser(await updateOpeningHours(hours));
      notifySuccess("Opening hours saved.");
    } catch (failure) {
      const message = getRequestErrorMessage(failure, "Unable to save the opening hours.");
      setError(message);
      notifyError(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SettingsGroup title="Opening hours" description="TANAW shows your place as offline only while it is open. A midday break is two opening times on the same day.">
      <div className="divide-y divide-(--tanaw-border-soft)" data-testid="opening-hours">
        {WEEKDAYS.map((day) => {
          const entry = dayHours(hours, day);
          const periods = entry.periods ?? [];
          return (
            <div key={day} className="grid gap-2 py-2.5 first:pt-0 sm:grid-cols-[6.5rem_9.5rem_minmax(0,1fr)] sm:items-center">
              <span className="text-sm font-semibold text-(--tanaw-text)">{weekdayLabels[day]}</span>
              <select aria-label={`${weekdayLabels[day]} hours`} value={entry.mode} onChange={(event) => update(day, event.target.value as DayMode)} className={control}>
                <option value="hours">Open</option>
                <option value="open24h">Open 24 hours</option>
                <option value="closed">Closed</option>
              </select>
              {entry.mode === "hours" ? (
                <div className="flex flex-wrap items-center gap-2">
                  {periods.map((period, index) => (
                    <span key={index} className="inline-flex items-center gap-1.5">
                      <input type="time" aria-label={`${weekdayLabels[day]} opening time ${index + 1}`} value={period.open} onChange={(event) => update(day, "hours", periods.map((item, at) => (at === index ? { ...item, open: event.target.value } : item)))} className={control} />
                      <span className="text-(--tanaw-text-secondary)">to</span>
                      <input type="time" aria-label={`${weekdayLabels[day]} closing time ${index + 1}`} value={period.close} onChange={(event) => update(day, "hours", periods.map((item, at) => (at === index ? { ...item, close: event.target.value } : item)))} className={control} />
                      {periods.length > 1 && (
                        <button type="button" aria-label={`Remove ${weekdayLabels[day]} opening time ${index + 1}`} onClick={() => update(day, "hours", periods.filter((_, at) => at !== index))} className="tanaw-settings-icon-button">
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  ))}
                  {periods.length < 4 && (
                    <button type="button" onClick={() => update(day, "hours", [...periods, { open: "13:00", close: "17:00" }])} className="tanaw-settings-text-action">
                      <Plus size={14} aria-hidden="true" />
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
      {error && <p role="alert" className="mt-2 text-[0.8125rem] font-semibold text-(--tanaw-error)">{error}</p>}
      <div className="mt-4 flex justify-end">
        <Button size="sm" disabled={!dirty || isSaving} onClick={() => void save()}>
          {isSaving ? "Saving..." : "Save opening hours"}
        </Button>
      </div>
    </SettingsGroup>
  );
}

function formatDay(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

/** Temporary closures: while closed, TANAW never shows the place as offline. */
export function TemporaryClosuresSettings() {
  const [closures, setClosures] = useState<ClosureSummary[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let disposed = false;
    void listClosures()
      .then((items) => {
        if (!disposed) setClosures(items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) setIsLoaded(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

  async function add() {
    setIsSaving(true);
    try {
      const closure = await addClosure({ startDate: start, endDate: end || start, reason: reason.trim() || null });
      setClosures((current) => [...current, closure].sort((left, right) => left.startDate.localeCompare(right.startDate)));
      setStart("");
      setEnd("");
      setReason("");
      setError("");
      notifySuccess("Temporary closure saved.");
    } catch (failure) {
      setError(getRequestErrorMessage(failure, "Unable to save the closure."));
    } finally {
      setIsSaving(false);
    }
  }

  async function remove(closureId: string) {
    try {
      await removeClosure(closureId);
      setClosures((current) => current.filter((closure) => closure.id !== closureId));
    } catch (failure) {
      notifyError(getRequestErrorMessage(failure, "Unable to remove the closure."));
    }
  }

  return (
    <SettingsGroup title="Temporary closures" description="Mark the days you are closed for a holiday, a vacation or repairs, so TANAW never shows you as offline then.">
      {!isLoaded ? (
        <SettingsRowsSkeleton label="Loading closures" rows={2} />
      ) : closures.length > 0 ? (
        <ul className="tanaw-enter m-0 list-none divide-y divide-(--tanaw-border-soft) p-0">
          {closures.map((closure) => (
            <li key={closure.id} className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0">
              <span className="inline-flex min-w-0 items-center gap-2">
                <CalendarOff size={15} className="shrink-0 text-(--tanaw-accent-ink)" aria-hidden="true" />
                <span className="font-semibold text-(--tanaw-text)">{closure.startDate === closure.endDate ? formatDay(closure.startDate) : `${formatDay(closure.startDate)} to ${formatDay(closure.endDate)}`}</span>
                {closure.reason && <span className="text-(--tanaw-text-secondary)">{closure.reason}</span>}
              </span>
              <button type="button" aria-label="Remove this closure" onClick={() => void remove(closure.id)} className="tanaw-settings-icon-button">
                <X size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-(--tanaw-text-secondary)">No closures planned.</p>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-[0.8125rem] font-medium text-(--tanaw-text-secondary)">
          From
          <input type="date" value={start} onChange={(event) => setStart(event.target.value)} className={`mt-1 block ${control}`} />
        </label>
        <label className="text-[0.8125rem] font-medium text-(--tanaw-text-secondary)">
          To
          <input type="date" value={end} min={start || undefined} onChange={(event) => setEnd(event.target.value)} className={`mt-1 block ${control}`} />
        </label>
        <label className="min-w-44 flex-1 text-[0.8125rem] font-medium text-(--tanaw-text-secondary)">
          Reason (optional)
          <input type="text" value={reason} maxLength={160} placeholder="Closed for renovation" onChange={(event) => setReason(event.target.value)} className={`mt-1 block w-full ${control}`} />
        </label>
        <Button variant="secondary" size="sm" disabled={!start || isSaving} onClick={() => void add()}>
          Add closure
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-[0.8125rem] font-semibold text-(--tanaw-error)">{error}</p>}
    </SettingsGroup>
  );
}
