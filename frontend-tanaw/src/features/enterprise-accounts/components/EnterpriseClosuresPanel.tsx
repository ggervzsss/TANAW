import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, X } from "lucide-react";
import { useState } from "react";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { addEnterpriseClosure, enterpriseClosuresQueryKey, listEnterpriseClosures, removeEnterpriseClosure, type EnterpriseClosure } from "../services/enterpriseAccountService";

const control =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:border-slate-600 dark:bg-[#172033] dark:text-slate-100";

function formatDay(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function closureDates(closure: EnterpriseClosure) {
  return closure.startDate === closure.endDate ? formatDay(closure.startDate) : `${formatDay(closure.startDate)} to ${formatDay(closure.endDate)}`;
}

/** Temporary closures: a holiday, vacation or repairs. The place is never shown as offline then. */
export function EnterpriseClosuresPanel({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const queryKey = enterpriseClosuresQueryKey(accountId);
  const closuresQuery = useQuery({ queryKey, queryFn: () => listEnterpriseClosures(accountId) });
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ["operational", "map-enterprises"] });
  };
  const add = useMutation({
    mutationFn: () => addEnterpriseClosure(accountId, { startDate: start, endDate: end || start, reason: reason.trim() || null }),
    onSuccess: () => {
      setStart("");
      setEnd("");
      setReason("");
      setError("");
      refresh();
    },
    onError: (failure) => setError(getApiErrorMessage(failure, "The closure could not be saved.")),
  });
  const remove = useMutation({ mutationFn: (closureId: string) => removeEnterpriseClosure(accountId, closureId), onSuccess: refresh });
  const closures = closuresQuery.data ?? [];

  return (
    <section aria-labelledby={`closures-${accountId}`} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 id={`closures-${accountId}`} className="flex items-center gap-2 text-sm font-black tracking-wide text-slate-950 uppercase">
        <CalendarOff size={16} className="text-emerald-700" />
        Temporary closures
      </h3>
      <p className="mt-1 text-sm text-slate-500">While a place is closed, TANAW never shows it as offline.</p>
      {closures.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-700/70">
          {closures.map((closure) => (
            <li key={closure.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="font-bold text-slate-900 dark:text-slate-100">{closureDates(closure)}</span>
                {closure.reason && <span className="text-slate-500">: {closure.reason}</span>}
              </span>
              <button type="button" aria-label={`Remove the closure on ${closureDates(closure)}`} onClick={() => remove.mutate(closure.id)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">{closuresQuery.isLoading ? "Loading closures." : "No closures planned."}</p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold text-slate-500">
          From
          <input type="date" value={start} onChange={(event) => setStart(event.target.value)} className={`mt-1 block ${control}`} />
        </label>
        <label className="text-xs font-bold text-slate-500">
          To
          <input type="date" value={end} min={start || undefined} onChange={(event) => setEnd(event.target.value)} className={`mt-1 block ${control}`} />
        </label>
        <label className="min-w-48 flex-1 text-xs font-bold text-slate-500">
          Reason (optional)
          <input type="text" value={reason} maxLength={160} placeholder="Closed for renovation" onChange={(event) => setReason(event.target.value)} className={`mt-1 block w-full ${control}`} />
        </label>
        <button type="button" disabled={!start || add.isPending} onClick={() => add.mutate()} className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:bg-emerald-700/50">
          Add closure
        </button>
      </div>
      {error && <p className="mt-2 text-xs font-bold text-red-700">{error}</p>}
    </section>
  );
}
