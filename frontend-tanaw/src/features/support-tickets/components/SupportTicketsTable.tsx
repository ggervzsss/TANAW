import { Eye, Paperclip, TicketCheck } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState, ExpandableTableText } from "@/shared/components/ui";
import type { Request } from "@/shared/services/requests";
import { Skeleton } from "@/shared/ui-kit";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { formatTicketTime } from "../model";
import { GroupBadge, TicketStatusBadge } from "./TicketBadges";
import "../supportTickets.css";

type SupportTicketsTableProps = {
  isItResponder: boolean;
  isLoading: boolean;
  onOpenTicket: (ticketId: string) => void;
  timeFormat: SystemTimeFormat;
  tickets: Request[];
  toolbar: ReactNode;
};

const HEADINGS = ["Reference", "From", "Request", "Group", "Status", "Sent"];

/** The requests as an open table: filters above, column names on a soft band, rows split by hairlines. */
export function SupportTicketsTable({ isItResponder, isLoading, onOpenTicket, tickets, timeFormat, toolbar }: SupportTicketsTableProps) {
  const loading = isLoading && tickets.length === 0;
  return (
    <section aria-label="Requests" className="mt-6">
      {toolbar}
      {loading && (
        <p role="status" className="sr-only">
          Loading requests
        </p>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="support-tickets__table w-full min-w-260 table-fixed border-separate border-spacing-0 text-left text-sm">
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[20%]" />
            <col className="w-[28%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead className="text-xs font-semibold tracking-label text-(--tanaw-label) uppercase">
            <tr>
              {HEADINGS.map((heading) => (
                <th key={heading} className="px-4 py-2.5 whitespace-nowrap">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-(--tanaw-text)" aria-busy={loading || undefined}>
            {loading && <SkeletonRows />}
            {tickets.map((ticket) => (
              <TicketRow key={ticket.id} ticket={ticket} timeFormat={timeFormat} onOpen={() => onOpenTicket(ticket.id)} />
            ))}
            {!loading && tickets.length === 0 && (
              <tr data-empty="">
                <td colSpan={6}>
                  <EmptyState icon={TicketCheck} title="No requests" description="Requests from enterprises and from the sign-in page appear here." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-[13px] text-(--tanaw-text-secondary)">
        <span className="tabular-nums">Showing {tickets.length} requests</span>
        <span>{isItResponder ? "IT request queue" : "Read only"}</span>
      </div>
    </section>
  );
}

/**
 * Request rows in the table's shape while the requests load: the same cells, hairlines and badges
 * as TicketRow, with each bar in a box of its line's height.
 */
function SkeletonRows() {
  const line = (height: string, bar: string) => (
    <span className={`flex ${height} items-center`}>
      <Skeleton className={bar} />
    </span>
  );
  return (
    <>
      {[0, 1, 2, 3].map((row) => (
        <tr key={row} data-empty="" data-skeleton="" aria-hidden="true">
          <td className="px-4 py-4 align-top">{line("h-[19.5px]", "h-3.5 w-20")}</td>
          <td className="px-4 py-4 align-top">
            {line("h-5", "h-4 w-3/4")}
            <span className="mt-1 block">{line("h-4", "h-3 w-1/2")}</span>
          </td>
          <td className="px-4 py-4 align-top">
            {line("h-5", "h-4 w-4/5")}
            <span className="mt-1 block">{line("h-[1.32rem]", "h-3 w-3/5")}</span>
          </td>
          <td className="px-4 py-4 align-top">
            <Skeleton shape="pill" className="h-6.5 w-24" />
          </td>
          <td className="px-4 py-4 align-top">
            <Skeleton shape="pill" className="h-6.5 w-20" />
          </td>
          <td className="px-4 py-4 align-top">
            {line("h-[19.5px]", "h-3.5 w-20")}
            <span className="mt-2 block">{line("h-[19.5px]", "h-3 w-14")}</span>
          </td>
        </tr>
      ))}
    </>
  );
}

function TicketRow({ ticket, onOpen, timeFormat }: { ticket: Request; onOpen: () => void; timeFormat: SystemTimeFormat }) {
  const attachments = ticket.attachments ?? [];
  return (
    <tr onClick={onOpen} className="group cursor-pointer">
      <td className="px-4 py-4 align-top font-mono text-[13px] font-semibold text-(--tanaw-accent-ink)">{ticket.code}</td>
      <td className="px-4 py-4 align-top">
        <ExpandableTableText
          primary={ticket.enterpriseName ?? ticket.requesterName}
          secondary={ticket.enterpriseId ?? ticket.requesterEmail ?? ""}
          ariaLabel="ticket enterprise and ID"
          className="font-semibold text-(--tanaw-text)"
          secondaryClassName="font-mono text-xs text-(--tanaw-text-muted)"
        />
      </td>
      <td className="px-4 py-4 align-top">
        <ExpandableTableText
          primary={ticket.title}
          secondary={ticket.description}
          ariaLabel="ticket subject and description"
          className="font-semibold text-(--tanaw-text)"
          secondaryClassName="text-[13px] leading-relaxed text-(--tanaw-text-secondary)"
          twoLines
        />
        {attachments.length > 0 && (
          <p className="rounded-tanaw-sm mt-2 inline-flex items-center gap-1 bg-(--tanaw-selected-bg) px-2 py-1 text-xs font-semibold text-(--tanaw-accent-ink)">
            <Paperclip size={12} aria-hidden="true" />
            {attachments.length} photo{attachments.length === 1 ? "" : "s"}
          </p>
        )}
      </td>
      <td className="px-4 py-4 align-top">
        <GroupBadge group={ticket.group} />
      </td>
      <td className="px-4 py-4 align-top">
        <TicketStatusBadge status={ticket.status} />
      </td>
      <td className="px-4 py-4 align-top">
        <p className="text-[13px] text-(--tanaw-text-secondary) tabular-nums">{formatTicketTime(ticket.createdAt, timeFormat)}</p>
        <button type="button" className="rounded-tanaw-sm mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-(--tanaw-accent-ink) group-hover:underline">
          <Eye size={13} aria-hidden="true" />
          Inspect
        </button>
      </td>
    </tr>
  );
}
