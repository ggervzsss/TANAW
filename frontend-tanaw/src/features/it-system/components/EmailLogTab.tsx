import { Mail } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, Button, cn, EmptyState, SegmentedControl, Skeleton } from "@/shared/ui-kit";
import { formatPhilippineTime, type SystemDateFormat, type SystemTimeFormat } from "@/shared/utils/dateTime";
import {
  activityDayLabel,
  EMAIL_RESULT_LABELS,
  emailKindLabel,
  emailLogFilterOptions,
  emailRecipientLine,
  emailResult,
  emailResultDetail,
  filterEmailLog,
  isEmailProblem,
  parseEmailLogFilter,
  type EmailLogEntry,
  type EmailLogFilter,
  type EmailResult,
} from "../model";

const RESULT_TONE: Record<EmailResult, { text: string; dot: string }> = {
  delivered: { text: "text-(--tanaw-accent-ink)", dot: "bg-(--tanaw-accent-ink)" },
  sending: { text: "text-(--tanaw-text-secondary)", dot: "bg-(--tanaw-text-muted)" },
  failed: { text: "text-(--tanaw-danger-text)", dot: "bg-(--tanaw-danger-text)" },
};

const linkButton = "font-semibold text-(--tanaw-accent-ink) underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)";
const headCell = "px-4 py-3 text-[0.6875rem] font-bold tracking-label text-(--tanaw-text-secondary) uppercase";

type EmailLogTabProps = {
  deliveries: readonly EmailLogEntry[];
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => void;
  retryingId: string | null;
  onRetry: (delivery: EmailLogEntry) => void;
  now: Date;
  dateFormat: SystemDateFormat;
  timeFormat: SystemTimeFormat;
};

/** Every email TANAW sent in the last seven days, with what happened to it. */
export function EmailLogTab({ deliveries, isLoading, isError, onRefresh, retryingId, onRetry, now, dateFormat, timeFormat }: EmailLogTabProps) {
  const [filter, setFilter] = useState<EmailLogFilter>("all");
  const rows = useMemo(() => filterEmailLog(deliveries, filter), [deliveries, filter]);
  const problemCount = useMemo(() => deliveries.filter(isEmailProblem).length, [deliveries]);
  const options = emailLogFilterOptions.map((option) => (option.value === "problems" && problemCount > 0 ? { ...option, count: problemCount } : option));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <SegmentedControl ariaLabel="Email result" options={options} value={filter} onChange={(value) => setFilter(parseEmailLogFilter(value))} />
        <p className="text-[0.84375rem] text-(--tanaw-text-secondary)">Every email TANAW sent in the last 7 days.</p>
      </div>

      {isError && (
        <Alert
          tone="danger"
          className="mt-4"
          title="The email log could not be loaded."
          action={
            <button type="button" onClick={onRefresh} className={linkButton}>
              Try again
            </button>
          }
        />
      )}

      {isLoading ? (
        <div className="mt-4 grid gap-3" aria-busy="true">
          <Skeleton className="h-12 w-full" label="Loading the email log" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : rows.length === 0 ? (
        !isError && (
          <EmptyState
            icon={<Mail size={22} />}
            title={filter === "problems" ? "No email problems" : "No emails in the last 7 days"}
            description={filter === "problems" ? "Every email in the last 7 days was delivered or is still sending." : "Invitations, codes and replies TANAW sends will show here."}
            minHeightClassName="min-h-48"
            className="mt-3.5 border-t border-(--tanaw-border-soft)"
          />
        )
      ) : (
        <div className="mt-3.5 overflow-x-auto">
          <table className="w-full min-w-200 border-collapse text-left text-sm">
            <caption className="sr-only">{filter === "problems" ? "Emails that were not delivered in the last 7 days" : "Emails sent in the last 7 days"}</caption>
            <thead>
              <tr className="border-y border-(--tanaw-border-soft)">
                <th scope="col" className={cn(headCell, "w-[16%] pl-0")}>
                  Sent
                </th>
                <th scope="col" className={cn(headCell, "w-[30%]")}>
                  To
                </th>
                <th scope="col" className={cn(headCell, "w-[20%]")}>
                  Email
                </th>
                <th scope="col" className={headCell}>
                  Result
                </th>
                <th scope="col" className={cn(headCell, "pr-0 text-right")}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((delivery) => {
                const result = emailResult(delivery);
                const tone = RESULT_TONE[result];
                const detail = emailResultDetail(delivery);
                const who = emailRecipientLine(delivery);
                return (
                  <tr key={delivery.id} data-email-row={delivery.id} className="border-b border-(--tanaw-border-soft) hover:bg-(--tanaw-control-hover)">
                    <td className="py-3.5 pr-4 align-top text-(--tanaw-text-secondary) tabular-nums">
                      {activityDayLabel(delivery.createdAt, now, dateFormat)}, {formatPhilippineTime(delivery.createdAt, timeFormat)}
                    </td>
                    <th scope="row" className="px-4 py-3.5 align-top font-normal">
                      <span className="block font-bold wrap-anywhere text-(--tanaw-text)">{delivery.recipient}</span>
                      {who && <span className="mt-0.5 block text-[0.8125rem] text-(--tanaw-text-secondary)">{who}</span>}
                    </th>
                    <td className="px-4 py-3.5 align-top text-(--tanaw-text)">{emailKindLabel(delivery.purpose)}</td>
                    <td className="px-4 py-3.5 align-top">
                      <span className={cn("inline-flex items-center gap-1.5 font-semibold", tone.text)}>
                        <span aria-hidden="true" className={cn("size-2 rounded-full", tone.dot)} />
                        {EMAIL_RESULT_LABELS[result]}
                      </span>
                      {detail && <span className="mt-0.5 block text-[0.8125rem] text-(--tanaw-text-muted)">{detail}</span>}
                    </td>
                    <td className="py-3.5 pl-4 text-right align-top">
                      {delivery.canRetry && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={retryingId === delivery.id}
                          disabled={Boolean(retryingId) && retryingId !== delivery.id}
                          onClick={() => onRetry(delivery)}
                          aria-label={`Try again: ${emailKindLabel(delivery.purpose)} to ${delivery.recipient}`}
                        >
                          Try again
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
