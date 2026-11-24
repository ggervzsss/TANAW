import { CalendarOff, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsGroup } from "../../../ui-kit/patterns/GeneralSettings";
import { addClosure, listClosures, removeClosure, updateOpeningHours, type ClosureSummary } from "../../login/api/login";
import { useAuthStore } from "../../login/stores/auth-store";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import { listSupportTickets, type SupportTicket } from "../../tickets/services/tickets";
import { getRequestErrorMessage } from "../model/profile-edit";
import { WEEKDAYS, dayHours, defaultOpeningHours, setDayHours, validateOpeningHours, weekdayLabels, type DayMode, type OpeningHours, type Weekday } from "../model/opening-hours";

const control =
  "rounded-lg border border-(--tanaw-border) bg-(--tanaw-surface) px-2.5 py-1.5 text-sm text-(--tanaw-text) outline-none focus:border-tanaw-ledger focus:ring-2 focus:ring-tanaw-ledger/15";

/** Account changes waiting for IT: a new contact number or enterprise name. */
export function PendingAccountChanges({ refreshKey }: { refreshKey: number }) {
  const [changes, setChanges] = useState<SupportTicket[]>([]);
  useEffect(() => {
    let disposed = false;
    void listSupportTickets()
      .then((requests) => {
        if (disposed) return;
        setChanges(requests.filter((request) => request.group === "Account change" && request.accountChange?.field !== "businessEmail" && (request.status === "Sent" || request.status === "In Progress")));
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [refreshKey]);
  if (changes.length === 0) return null;
  return (
    <ul className="enterprise-profile-pending-changes m-0 list-none space-y-2 p-0" aria-label="Changes waiting for IT">
      {changes.map((change) => (
        <li key={change.id} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-300/30 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="font-bold">{change.title} is waiting for IT</p>
          <p className="mt-0.5">
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
      <div className="divide-y divide-(--tanaw-border)" data-testid="opening-hours">
        {WEEKDAYS.map((day) => {
          const entry = dayHours(hours, day);
          const periods = entry.periods ?? [];
          return (
            <div key={day} className="grid gap-2 py-2.5 sm:grid-cols-[6.5rem_9.5rem_minmax(0,1fr)] sm:items-center">
              <span className="text-sm font-bold text-(--tanaw-text)">{weekdayLabels[day]}</span>
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
                        <button type="button" aria-label={`Remove ${weekdayLabels[day]} opening time ${index + 1}`} onClick={() => update(day, "hours", periods.filter((_, at) => at !== index))} className="rounded-full p-1 text-(--tanaw-text-secondary)">
                          <X size={14} />
                        </button>
                      )}
                    </span>
                  ))}
                  {periods.length < 4 && (
                    <button type="button" onClick={() => update(day, "hours", [...periods, { open: "13:00", close: "17:00" }])} className="inline-flex items-center gap-1 text-xs font-bold text-tanaw-ledger dark:text-emerald-200">
                      <Plus size={13} />
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
      {error && <p className="mt-2 text-xs font-bold text-tanaw-red">{error}</p>}
      <button type="button" disabled={!dirty || isSaving} onClick={() => void save()} className="mt-3 rounded-full bg-tanaw-ledger px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
        {isSaving ? "Saving..." : "Save opening hours"}
      </button>
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

  useEffect(() => {
    void listClosures()
      .then(setClosures)
      .catch(() => undefined);
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
      {closures.length > 0 ? (
        <ul className="m-0 list-none divide-y divide-(--tanaw-border) p-0">
          {closures.map((closure) => (
            <li key={closure.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="inline-flex items-center gap-2">
                <CalendarOff size={15} className="text-tanaw-ledger dark:text-emerald-200" />
                <span className="font-bold text-(--tanaw-text)">{closure.startDate === closure.endDate ? formatDay(closure.startDate) : `${formatDay(closure.startDate)} to ${formatDay(closure.endDate)}`}</span>
                {closure.reason && <span className="text-(--tanaw-text-secondary)">{closure.reason}</span>}
              </span>
              <button type="button" aria-label="Remove this closure" onClick={() => void remove(closure.id)} className="rounded-full p-1 text-(--tanaw-text-secondary)">
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-(--tanaw-text-secondary)">No closures planned.</p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold text-(--tanaw-text-secondary)">
          From
          <input type="date" value={start} onChange={(event) => setStart(event.target.value)} className={`mt-1 block ${control}`} />
        </label>
        <label className="text-xs font-bold text-(--tanaw-text-secondary)">
          To
          <input type="date" value={end} min={start || undefined} onChange={(event) => setEnd(event.target.value)} className={`mt-1 block ${control}`} />
        </label>
        <label className="min-w-44 flex-1 text-xs font-bold text-(--tanaw-text-secondary)">
          Reason (optional)
          <input type="text" value={reason} maxLength={160} placeholder="Closed for renovation" onChange={(event) => setReason(event.target.value)} className={`mt-1 block w-full ${control}`} />
        </label>
        <button type="button" disabled={!start || isSaving} onClick={() => void add()} className="rounded-full bg-tanaw-ledger px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          Add closure
        </button>
      </div>
      {error && <p className="mt-2 text-xs font-bold text-tanaw-red">{error}</p>}
    </SettingsGroup>
  );
}
