import { Eye, Paperclip, TicketCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Panel } from "@/shared/components/panel";
import { EmptyState, ExpandableTableText } from "@/shared/components/ui";
import type { Request } from "@/shared/services/requests";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { formatTicketTime } from "../model";
import { GroupBadge, TicketStatusBadge, UrgentBadge } from "./TicketBadges";

type SupportTicketsTableProps = {
  isItResponder: boolean;
  isLoading: boolean;
  onOpenTicket: (ticketId: string) => void;
  timeFormat: SystemTimeFormat;
  tickets: Request[];
  toolbar: ReactNode;
};

export function SupportTicketsTable({ isItResponder, isLoading, onOpenTicket, tickets, timeFormat, toolbar }: SupportTicketsTableProps) {
  return (
    <Panel className="tanaw-data-panel mt-6 overflow-hidden">
      {toolbar}
      <div className="tanaw-data-table overflow-x-auto">
        <table className="w-full min-w-260 table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[18%]" />
            <col className="w-[24%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead className="tanaw-data-table-head bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
            <tr>
              {["Reference", "From", "Request", "Group", "Urgent", "Status", "Sent"].map((heading) => (
                <th key={heading} className="px-4 py-4 whitespace-nowrap">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tanaw-data-table-body divide-y divide-gray-100 text-gray-800">
            {tickets.map((ticket) => (
              <TicketRow key={ticket.id} ticket={ticket} timeFormat={timeFormat} onOpen={() => onOpenTicket(ticket.id)} />
            ))}
            {tickets.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    icon={TicketCheck}
                    title={isLoading ? "Loading requests" : "No requests"}
                    description={isLoading ? "Fetching requests." : "Requests from enterprises and from the sign-in page appear here."}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="tanaw-data-footer flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-3 text-[10px] font-bold tracking-wide text-gray-500 uppercase">
        <span>Showing {tickets.length} requests</span>
        <span>{isItResponder ? "IT request queue" : "Read only"}</span>
      </div>
    </Panel>
  );
}

function TicketRow({ ticket, onOpen, timeFormat }: { ticket: Request; onOpen: () => void; timeFormat: SystemTimeFormat }) {
  const attachments = ticket.attachments ?? [];
  return (
    <tr onClick={onOpen} className="tanaw-data-table-row tanaw-interactive-row group cursor-pointer">
      <td className="px-4 py-4 align-top font-mono text-xs font-bold text-emerald-700">{ticket.code}</td>
      <td className="px-4 py-4 align-top">
        <ExpandableTableText
          primary={ticket.enterpriseName ?? ticket.requesterName}
          secondary={ticket.enterpriseId ?? ticket.requesterEmail ?? ""}
          ariaLabel="ticket enterprise and ID"
          className="font-bold text-gray-950"
          secondaryClassName="font-mono text-[10px] font-semibold text-gray-500"
        />
      </td>
      <td className="px-4 py-4 align-top">
        <ExpandableTableText
          primary={ticket.title}
          secondary={ticket.description}
          ariaLabel="ticket subject and description"
          className="font-bold text-gray-950"
          secondaryClassName="text-xs leading-relaxed text-gray-500"
          twoLines
        />
        {attachments.length > 0 && (
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
            <Paperclip size={11} />
            {attachments.length} photo{attachments.length === 1 ? "" : "s"}
          </p>
        )}
      </td>
      <td className="px-4 py-4 align-top">
        <GroupBadge group={ticket.group} />
      </td>
      <td className="px-4 py-4 align-top">
        {ticket.urgent ? <UrgentBadge /> : <span className="text-xs text-gray-400">No</span>}
      </td>
      <td className="px-4 py-4 align-top">
        <TicketStatusBadge status={ticket.status} />
      </td>
      <td className="px-4 py-4 align-top">
        <p className="text-[11px] font-bold text-gray-500 uppercase">{formatTicketTime(ticket.createdAt, timeFormat)}</p>
        <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-tanaw-ledger">
          <Eye size={12} />
          Inspect
        </button>
      </td>
    </tr>
  );
}
