import { ArrowUpRight, CheckCircle2, TicketCheck } from "lucide-react";
import { useState } from "react";
import { PriorityBadge, TicketStatusBadge } from "@/features/support-tickets";
import { EmptyState } from "@/shared/components/ui";
import type { SupportTicket } from "@/shared/services/supportTickets";
import type { PriorityAlert, PriorityAlertStatus } from "@/shared/types";
import { adminAlertLabel, adminAlertStatusLabel } from "../model";
import { AlertStatusBadge, SeverityBadge } from "./PriorityAlertComponents";

export function SituationTable({ alerts, isLoading, onOpen }: { alerts: PriorityAlert[]; isLoading: boolean; onOpen: (alertId: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(alerts[0]?.id ?? null);
  const selectedAlert = alerts.find((alert) => alert.id === selectedId) ?? alerts[0] ?? null;

  if (!selectedAlert) {
    return (
      <OperationsEmptyState
        icon={CheckCircle2}
        isLoading={isLoading}
        loadingTitle="Loading current situations"
        loadingDescription="Checking current Admin situations."
        emptyTitle="No situations found"
        emptyDescription="There are no Admin situations matching this search."
        footer={`Showing ${alerts.length} Admin situations`}
      />
    );
  }

  return (
    <>
      <div className="tanaw-operations-master-detail">
        <section className="tanaw-operations-queue" aria-label="Situation queue">
          <div className="tanaw-operations-queue__heading">
            <span>Situation</span>
            <span>{alerts.length}</span>
          </div>
          <div className="tanaw-operations-queue__items">
            {alerts.map((alert) => (
              <button
                key={alert.id}
                type="button"
                aria-pressed={selectedAlert.id === alert.id}
                aria-label={`Select ${adminAlertLabel(alert)}`}
                onClick={() => setSelectedId(alert.id)}
                className="tanaw-operations-queue__item"
              >
                <span className="tanaw-operations-queue__title">{adminAlertLabel(alert)}</span>
                <span className="tanaw-operations-queue__enterprise">{alert.enterprise ?? alert.requester}</span>
                <span className="tanaw-operations-queue__badges">
                  <AdminUrgencyBadge alert={alert} />
                  <AdminAlertStatusBadge status={alert.status} />
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="tanaw-operations-detail" aria-label="Selected situation details" aria-live="polite">
          <div className="tanaw-operations-detail__eyebrow">What Happened</div>
          <div className="tanaw-operations-detail__title-row">
            <div>
              <h3>{adminAlertLabel(selectedAlert)}</h3>
              <p>{selectedAlert.enterprise ?? selectedAlert.requester}</p>
            </div>
            <AdminUrgencyBadge alert={selectedAlert} />
          </div>
          <p className="tanaw-operations-detail__summary">{selectedAlert.summary}</p>
          <div className="tanaw-operations-detail__response">
            <span>Suggested response</span>
            <p>{selectedAlert.requiredAction}</p>
          </div>
          <dl className="tanaw-operations-detail__facts">
            <OperationFact label="Establishment" value={selectedAlert.enterprise ?? selectedAlert.requester} />
            <OperationFact label="Urgency" value={<AdminUrgencyBadge alert={selectedAlert} />} />
            <OperationFact label="Status" value={<AdminAlertStatusBadge status={selectedAlert.status} />} />
          </dl>
          <button type="button" onClick={() => onOpen(selectedAlert.id)} className="tanaw-operations-detail__action">
            View situation details
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </section>
      </div>
      <OperationsFooter>Showing {alerts.length} Admin situations</OperationsFooter>
    </>
  );
}

export function SupportRequestTable({ tickets, isLoading, onOpen }: { tickets: SupportTicket[]; isLoading: boolean; onOpen: (ticketId: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(tickets[0]?.id ?? null);
  const selectedTicket = tickets.find((ticket) => ticket.id === selectedId) ?? tickets[0] ?? null;

  if (!selectedTicket) {
    return (
      <OperationsEmptyState
        icon={TicketCheck}
        isLoading={isLoading}
        loadingTitle="Loading escalated support"
        loadingDescription="Checking important enterprise requests."
        emptyTitle="No escalated support requests"
        emptyDescription="High and urgent requests that need Admin awareness will appear here."
        footer="IT handles responses; Admin has supervisory visibility"
      />
    );
  }

  return (
    <>
      <div className="tanaw-operations-master-detail">
        <section className="tanaw-operations-queue" aria-label="Support request queue">
          <div className="tanaw-operations-queue__heading">
            <span>Request</span>
            <span>{tickets.length}</span>
          </div>
          <div className="tanaw-operations-queue__items">
            {tickets.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                aria-pressed={selectedTicket.id === ticket.id}
                aria-label={`Select support request ${ticket.code}`}
                onClick={() => setSelectedId(ticket.id)}
                className="tanaw-operations-queue__item"
              >
                <span className="tanaw-operations-queue__code">{ticket.code}</span>
                <span className="tanaw-operations-queue__title">{ticket.subject}</span>
                <span className="tanaw-operations-queue__enterprise">{ticket.enterpriseName}</span>
                <span className="tanaw-operations-queue__badges">
                  <PriorityBadge priority={ticket.priority} />
                  <TicketStatusBadge status={ticket.status} />
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="tanaw-operations-detail" aria-label="Selected support request details" aria-live="polite">
          <div className="tanaw-operations-detail__eyebrow">Concern</div>
          <div className="tanaw-operations-detail__title-row">
            <div>
              <h3>{selectedTicket.subject}</h3>
              <p>{selectedTicket.enterpriseName}</p>
            </div>
            <PriorityBadge priority={selectedTicket.priority} />
          </div>
          <p className="tanaw-operations-detail__summary">{selectedTicket.description}</p>
          <dl className="tanaw-operations-detail__facts">
            <OperationFact label="Request" value={selectedTicket.code} />
            <OperationFact label="Enterprise" value={selectedTicket.enterpriseName} />
            <OperationFact label="Urgency" value={<PriorityBadge priority={selectedTicket.priority} />} />
            <OperationFact label="Status" value={<TicketStatusBadge status={selectedTicket.status} />} />
          </dl>
          <button type="button" onClick={() => onOpen(selectedTicket.id)} className="tanaw-operations-detail__action">
            View request details
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </section>
      </div>
      <OperationsFooter>IT handles responses; Admin has supervisory visibility</OperationsFooter>
    </>
  );
}

function OperationFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function OperationsFooter({ children }: { children: React.ReactNode }) {
  return <div className="tanaw-data-footer border-t px-4 py-3 text-[10px] font-bold tracking-wide uppercase">{children}</div>;
}

function OperationsEmptyState({
  icon,
  isLoading,
  loadingTitle,
  loadingDescription,
  emptyTitle,
  emptyDescription,
  footer,
}: {
  icon: typeof CheckCircle2;
  isLoading: boolean;
  loadingTitle: string;
  loadingDescription: string;
  emptyTitle: string;
  emptyDescription: string;
  footer: string;
}) {
  return (
    <>
      <div className="tanaw-operations-empty">
        <EmptyState icon={icon} title={isLoading ? loadingTitle : emptyTitle} description={isLoading ? loadingDescription : emptyDescription} />
      </div>
      <OperationsFooter>{footer}</OperationsFooter>
    </>
  );
}

export function AdminAlertStatusBadge({ status }: { status: PriorityAlertStatus }) {
  return <AlertStatusBadge status={status} label={adminAlertStatusLabel(status)} />;
}

export function AdminUrgencyBadge({ alert }: { alert: PriorityAlert }) {
  const labels = { Critical: "Urgent", Warning: "Important", Info: "For Awareness" } as const;
  return <SeverityBadge severity={alert.severity} label={labels[alert.severity]} />;
}
