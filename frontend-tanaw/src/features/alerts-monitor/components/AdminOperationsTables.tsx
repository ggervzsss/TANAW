import { CheckCircle2, TicketCheck } from "lucide-react";
import { PriorityBadge, TicketStatusBadge } from "@/features/support-tickets";
import { EmptyState, ExpandableTableText } from "@/shared/components/ui";
import type { SupportTicket } from "@/shared/services/supportTickets";
import type { PriorityAlert, PriorityAlertStatus } from "@/shared/types";
import { adminAlertLabel, adminAlertStatusLabel } from "../model";
import { AlertStatusBadge, SeverityBadge } from "./PriorityAlertComponents";

export function SituationTable({ alerts, isLoading, onOpen }: { alerts: PriorityAlert[]; isLoading: boolean; onOpen: (alertId: string) => void }) {
  return (
    <>
      <div className="tanaw-data-table overflow-x-auto">
        <table className="w-full min-w-220 table-fixed text-left text-sm">
          <colgroup>
            {["w-[20%]", "w-[20%]", "w-[34%]", "w-[14%]", "w-[12%]"].map((className, index) => (
              <col key={index} className={className} />
            ))}
          </colgroup>
          <thead className="tanaw-data-table-head bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
            <tr>
              {["Situation", "Establishment", "What Happened", "Urgency", "Status"].map((heading) => (
                <th key={heading} className="px-4 py-4 whitespace-nowrap">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tanaw-data-table-body divide-y divide-gray-100 text-gray-800">
            {alerts.map((alert) => (
              <SituationRow key={alert.id} alert={alert} onOpen={() => onOpen(alert.id)} />
            ))}
            {alerts.length === 0 && (
              <TableEmptyState
                icon={CheckCircle2}
                isLoading={isLoading}
                loadingTitle="Loading current situations"
                loadingDescription="Checking current Admin situations."
                emptyTitle="No situations found"
                emptyDescription="There are no Admin situations matching this search."
              />
            )}
          </tbody>
        </table>
      </div>
      <div className="tanaw-data-footer border-t border-gray-100 bg-gray-50 px-4 py-3 text-[10px] font-bold tracking-wide text-gray-500 uppercase">Showing {alerts.length} Admin situations</div>
    </>
  );
}

export function SupportRequestTable({ tickets, isLoading, onOpen }: { tickets: SupportTicket[]; isLoading: boolean; onOpen: (ticketId: string) => void }) {
  return (
    <>
      <div className="tanaw-data-table overflow-x-auto">
        <table className="w-full min-w-210 table-fixed text-left text-sm">
          <colgroup>
            {["w-[17%]", "w-[22%]", "w-[35%]", "w-[13%]", "w-[13%]"].map((className, index) => (
              <col key={index} className={className} />
            ))}
          </colgroup>
          <thead className="tanaw-data-table-head bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
            <tr>
              {["Request", "Enterprise", "Concern", "Urgency", "Status"].map((heading) => (
                <th key={heading} className="px-4 py-4 whitespace-nowrap">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tanaw-data-table-body divide-y divide-gray-100 text-gray-800">
            {tickets.map((ticket) => (
              <tr key={ticket.id} onClick={() => onOpen(ticket.id)} className="tanaw-data-table-row tanaw-interactive-row group cursor-pointer">
                <td className="px-4 py-4 font-mono text-xs font-bold text-emerald-700">{ticket.code}</td>
                <td className="px-4 py-4 font-bold text-gray-950">{ticket.enterpriseName}</td>
                <td className="px-4 py-4">
                  <ExpandableTableText primary={ticket.subject} secondary={ticket.description} ariaLabel="support concern" twoLines />
                </td>
                <td className="px-4 py-4">
                  <PriorityBadge priority={ticket.priority} />
                </td>
                <td className="px-4 py-4">
                  <TicketStatusBadge status={ticket.status} />
                </td>
              </tr>
            ))}
            {tickets.length === 0 && (
              <TableEmptyState
                icon={TicketCheck}
                isLoading={isLoading}
                loadingTitle="Loading escalated support"
                loadingDescription="Checking important enterprise requests."
                emptyTitle="No escalated support requests"
                emptyDescription="High and urgent requests that need Admin awareness will appear here."
              />
            )}
          </tbody>
        </table>
      </div>
      <div className="tanaw-data-footer border-t border-gray-100 bg-gray-50 px-4 py-3 text-[10px] font-bold tracking-wide text-gray-500 uppercase">
        IT handles responses; Admin has supervisory visibility
      </div>
    </>
  );
}

function SituationRow({ alert, onOpen }: { alert: PriorityAlert; onOpen: () => void }) {
  return (
    <tr onClick={onOpen} className="tanaw-data-table-row tanaw-interactive-row group cursor-pointer">
      <td className="px-4 py-4 font-bold text-gray-950">{adminAlertLabel(alert)}</td>
      <td className="px-4 py-4">
        <ExpandableTableText primary={alert.enterprise ?? alert.requester} ariaLabel="affected establishment" className="font-semibold text-gray-900" />
      </td>
      <td className="px-4 py-4">
        <ExpandableTableText primary={alert.summary} secondary={alert.requiredAction} ariaLabel="situation and suggested response" twoLines />
      </td>
      <td className="px-4 py-4">
        <AdminUrgencyBadge alert={alert} />
      </td>
      <td className="px-4 py-4">
        <AdminAlertStatusBadge status={alert.status} />
      </td>
    </tr>
  );
}

function TableEmptyState({
  icon,
  isLoading,
  loadingTitle,
  loadingDescription,
  emptyTitle,
  emptyDescription,
}: {
  icon: typeof CheckCircle2;
  isLoading: boolean;
  loadingTitle: string;
  loadingDescription: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <tr>
      <td colSpan={5}>
        <EmptyState icon={icon} title={isLoading ? loadingTitle : emptyTitle} description={isLoading ? loadingDescription : emptyDescription} />
      </td>
    </tr>
  );
}

export function AdminAlertStatusBadge({ status }: { status: PriorityAlertStatus }) {
  return <AlertStatusBadge status={status} label={adminAlertStatusLabel(status)} />;
}

export function AdminUrgencyBadge({ alert }: { alert: PriorityAlert }) {
  const labels = { Critical: "Urgent", Warning: "Important", Info: "For Awareness" } as const;
  return <SeverityBadge severity={alert.severity} label={labels[alert.severity]} />;
}
