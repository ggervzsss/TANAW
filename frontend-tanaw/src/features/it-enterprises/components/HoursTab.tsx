import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarOff } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { OpeningHoursField } from "@/features/enterprise-accounts/components/OpeningHoursField";
import { defaultOpeningHours, sameOpeningHours, validateOpeningHours, type OpeningHours } from "@/features/enterprise-accounts/model/openingHours";
import {
  addEnterpriseClosure,
  enterpriseClosuresQueryKey,
  listEnterpriseClosures,
  removeEnterpriseClosure,
  updateEnterpriseAccount,
  type EnterpriseClosure,
} from "@/features/enterprise-accounts/services/enterpriseAccountService";
import { Button, EmptyState, Input, Skeleton } from "@/shared/ui-kit";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { formatPhilippineDate, type SystemDateFormat } from "@/shared/utils/dateTime";
import { hoursPayload } from "../model/accountPayload";
import type { DisplayFormats, EnterpriseAccount, EnterpriseRow } from "../model/enterprises";
import { notifyError, notifySuccess, refreshEnterprises } from "../hooks/useEnterpriseActions";
import { FieldError, FieldLabel, SectionHeading } from "./StateText";

/** Opening hours: the weekly hours, and the closed days. */
export function HoursTab({ row, formats, onAccountUpdated }: { row: EnterpriseRow; formats: DisplayFormats; onAccountUpdated: (account: EnterpriseAccount) => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start gap-x-14 gap-y-10 max-lg:grid-cols-1">
      <WeeklyHours account={row.account} onAccountUpdated={onAccountUpdated} />
      <ClosedDays accountId={row.id} dateFormat={formats.dateFormat} />
    </div>
  );
}

function WeeklyHours({ account, onAccountUpdated }: { account: EnterpriseAccount; onAccountUpdated: (account: EnterpriseAccount) => void }) {
  const queryClient = useQueryClient();
  const [hours, setHours] = useState<OpeningHours>(() => account.openingHours ?? defaultOpeningHours());
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (payload: NonNullable<ReturnType<typeof hoursPayload>>) => updateEnterpriseAccount(account.id, payload),
    onSuccess: async (updated) => {
      await refreshEnterprises(queryClient);
      onAccountUpdated(updated as EnterpriseAccount);
      notifySuccess("Hours saved", "TANAW uses the new hours to tell a closed place from an offline one.");
    },
    onError: (failure) => notifyError("Hours not saved", getApiErrorMessage(failure, "The hours could not be saved. Try again.")),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = validateOpeningHours(hours);
    setError(problem);
    if (problem) return;
    const payload = hoursPayload(account, hours);
    if (!payload) {
      setError("Add the attraction type, barangay and address on the Details tab first.");
      return;
    }
    save.mutate(payload);
  };

  const unchanged = sameOpeningHours(account.openingHours ?? null, hours);

  return (
    <section aria-labelledby="ite-hours">
      <SectionHeading id="ite-hours">Weekly hours</SectionHeading>
      <p className="mt-1 text-sm text-(--tanaw-text-secondary)">TANAW only expects counts while the place is open, so a closed camera is not flagged.</p>
      {!account.openingHours && <p className="mt-2 text-[13px] font-semibold text-(--tanaw-warn-ink)">No hours are saved yet. These are the usual 8:00 AM to 5:00 PM hours.</p>}
      <form noValidate onSubmit={submit} className="mt-3">
        <OpeningHoursField
          value={hours}
          onChange={(value) => {
            setHours(value);
            setError(null);
          }}
          error={error ?? undefined}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" loading={save.isPending} disabled={unchanged && Boolean(account.openingHours)}>
            Save hours
          </Button>
          {unchanged && account.openingHours && <span className="text-[13px] text-(--tanaw-text-muted)">No changes yet.</span>}
        </div>
      </form>
    </section>
  );
}

function closureDates(closure: EnterpriseClosure, dateFormat: SystemDateFormat) {
  const day = (value: string) => formatPhilippineDate(`${value}T12:00:00+08:00`, dateFormat);
  return closure.startDate === closure.endDate ? day(closure.startDate) : `${day(closure.startDate)} to ${day(closure.endDate)}`;
}

function ClosedDays({ accountId, dateFormat }: { accountId: string; dateFormat: SystemDateFormat }) {
  const queryClient = useQueryClient();
  const startId = useId();
  const endId = useId();
  const reasonId = useId();
  const queryKey = enterpriseClosuresQueryKey(accountId);
  const closures = useQuery({ queryKey, queryFn: () => listEnterpriseClosures(accountId) });
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey }), queryClient.invalidateQueries({ queryKey: ["operational", "map-enterprises"] }), refreshEnterprises(queryClient)]);

  const add = useMutation({
    mutationFn: () => addEnterpriseClosure(accountId, { startDate: start, endDate: end || start, reason: reason.trim() || null }),
    onSuccess: async (closure) => {
      setStart("");
      setEnd("");
      setReason("");
      setError(null);
      await refresh();
      notifySuccess("Closed day added", `${closureDates(closure, dateFormat)} is marked closed.`);
    },
    onError: (failure) => setError(getApiErrorMessage(failure, "The closed day could not be saved. Try again.")),
  });
  const remove = useMutation({
    mutationFn: (closure: EnterpriseClosure) => removeEnterpriseClosure(accountId, closure.id),
    onSuccess: async (_, closure) => {
      await refresh();
      notifySuccess("Closed day removed", `${closureDates(closure, dateFormat)} is a normal day again.`);
    },
    onError: (failure) => notifyError("Closed day not removed", getApiErrorMessage(failure, "The closed day could not be removed. Try again.")),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!start) {
      setError("Choose the date the place is closed.");
      document.getElementById(startId)?.focus();
      return;
    }
    if (end && end < start) {
      setError("The last closed day cannot be before the first.");
      document.getElementById(endId)?.focus();
      return;
    }
    add.mutate();
  };

  const items = [...(closures.data ?? [])].sort((left, right) => left.startDate.localeCompare(right.startDate));

  return (
    <section aria-labelledby="ite-closures">
      <SectionHeading id="ite-closures">Closed days</SectionHeading>
      <p className="mt-1 text-sm text-(--tanaw-text-secondary)">Holidays and one-off closures. Reports show these days as closed, not as zero visitors.</p>
      {closures.isLoading ? (
        <div role="status" aria-label="Loading closed days" className="mt-3 space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : closures.isError ? (
        <p className="mt-3 text-sm text-(--tanaw-warn-ink)">Closed days could not be loaded.</p>
      ) : items.length === 0 ? (
        <EmptyState icon={<CalendarOff size={22} />} title="No closed days" description="Add a holiday or closure below." minHeightClassName="min-h-36" />
      ) : (
        <ul className="mt-3 border-t border-(--tanaw-border-soft)">
          {items.map((closure) => {
            const dates = closureDates(closure, dateFormat);
            return (
              <li key={closure.id} className="flex items-center justify-between gap-3 border-b border-(--tanaw-border-soft) py-2.5">
                <span className="min-w-0">
                  <span className="block font-bold text-(--tanaw-text)">{dates}</span>
                  <span className="block text-[13px] text-(--tanaw-text-secondary)">{closure.reason || "Closed"}</span>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={remove.isPending && remove.variables?.id === closure.id}
                  onClick={() => remove.mutate(closure)}
                  aria-label={`Remove closed day ${dates}`}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <form noValidate onSubmit={submit} className="mt-4">
        <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
          <div>
            <FieldLabel htmlFor={startId}>Date</FieldLabel>
            <Input
              id={startId}
              type="date"
              value={start}
              invalid={Boolean(error) && !start}
              onChange={(event) => {
                setStart(event.target.value);
                setError(null);
              }}
            />
          </div>
          <div>
            <FieldLabel htmlFor={endId} optional>
              Last day
            </FieldLabel>
            <Input
              id={endId}
              type="date"
              value={end}
              min={start || undefined}
              onChange={(event) => {
                setEnd(event.target.value);
                setError(null);
              }}
            />
          </div>
          <div className="col-span-2 max-sm:col-span-1">
            <FieldLabel htmlFor={reasonId} optional>
              Reason
            </FieldLabel>
            <Input id={reasonId} value={reason} maxLength={160} placeholder="For example: Pond cleaning" onChange={(event) => setReason(event.target.value)} />
          </div>
        </div>
        <FieldError id={`${startId}-error`}>{error}</FieldError>
        <div className="mt-3">
          <Button type="submit" variant="secondary" loading={add.isPending}>
            Add closed day
          </Button>
        </div>
      </form>
    </section>
  );
}
