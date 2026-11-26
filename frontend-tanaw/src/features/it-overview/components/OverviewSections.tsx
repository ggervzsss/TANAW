import { Check, ChevronRight, Clock3, TriangleAlert, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, cn } from "@/shared/ui-kit";
import type { ItOverview } from "../hooks/useItOverview";
import { firstRows, type ConnectionRow } from "../model/itOverview";
import { itOverviewPaths } from "../model/paths";

const linkButtonClass =
  "inline-flex h-10.5 shrink-0 items-center justify-center rounded-tanaw-md border border-(--tanaw-control-border) bg-(--tanaw-control-bg) px-4 text-sm font-bold whitespace-nowrap text-(--tanaw-text) no-underline shadow-tanaw-resting transition-colors hover:border-(--tanaw-control-border-hover) hover:bg-(--tanaw-control-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)";
const rowClass = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 border-b border-(--tanaw-border-soft) py-4 max-sm:grid-cols-1";
const metaClass = "flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.8125rem] text-(--tanaw-text-secondary)";
const titleClass = "mt-1 block text-[0.96875rem] font-bold text-(--tanaw-text)";
const placeClass = "mt-0.5 block text-sm text-(--tanaw-text-secondary)";
const stateClass = "mt-1.5 inline-flex items-center gap-1.5 text-[0.8125rem] font-bold";

function Section({
  id,
  title,
  description,
  link,
  hidden,
  isLoading,
  isError,
  errorText,
  onRetry,
  empty,
  children,
}: {
  id: string;
  title: string;
  description: string;
  link: { to: string; label: string };
  hidden: number;
  isLoading: boolean;
  isError: boolean;
  errorText: string;
  onRetry: () => void;
  empty: string | null;
  children: ReactNode;
}) {
  const titleId = `${id}-title`;
  let body: ReactNode = children;
  if (isLoading) body = <SectionMessage>Loading…</SectionMessage>;
  else if (isError)
    body = (
      <div className="flex flex-wrap items-center gap-3 pt-4">
        <p className="m-0 text-sm text-(--tanaw-text-secondary)">{errorText}</p>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  else if (empty) body = <SectionMessage>{empty}</SectionMessage>;
  return (
    <section aria-labelledby={titleId} className="min-w-0" data-testid={id}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-(--tanaw-border-soft) pb-3">
        <div className="min-w-0">
          <h2 id={titleId} className="font-display m-0 text-[1.3125rem] leading-tight font-bold text-(--tanaw-text)">
            {title}
          </h2>
          <p className="mt-1 mb-0 text-sm text-(--tanaw-text-secondary)">{description}</p>
        </div>
        <SectionLink to={link.to}>{link.label}</SectionLink>
      </div>
      {body}
      {!isLoading && !isError && hidden > 0 && (
        <p className="mt-3 mb-0 text-sm text-(--tanaw-text-secondary)">
          <SectionLink to={link.to}>{`${hidden.toLocaleString("en-US")} more on the full list`}</SectionLink>
        </p>
      )}
    </section>
  );
}

function SectionLink({ to, children }: { to: string; children: string }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-9 items-center gap-1 rounded-md text-sm font-semibold whitespace-nowrap text-(--tanaw-accent-ink) no-underline underline-offset-3 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
    >
      {children}
      <ChevronRight size={15} aria-hidden="true" />
    </Link>
  );
}

function SectionMessage({ children }: { children: ReactNode }) {
  return <p className="mt-4 mb-0 text-sm text-(--tanaw-text-secondary)">{children}</p>;
}

function Dot() {
  return <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-current" />;
}

/** Words only a screen reader hears, naming which row a button acts on. */
function Hidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

function Sep() {
  return <span aria-hidden="true">·</span>;
}

export function RequestsSection({ overview }: { overview: ItOverview }) {
  const section = overview.requests;
  const { shown, hidden } = firstRows(section.rows);
  return (
    <Section
      id="it-overview-requests"
      title="Requests waiting for IT"
      description="Not picked up yet, then the ones you are working on."
      link={{ to: itOverviewPaths.requests, label: "All requests" }}
      hidden={hidden}
      isLoading={section.isLoading}
      isError={section.isError}
      errorText="Requests could not be loaded."
      onRetry={section.refetch}
      empty={shown.length === 0 ? "No requests are waiting for IT." : null}
    >
      <ul className="m-0 list-none p-0">
        {shown.map((row) => (
          <li key={row.id} className={rowClass}>
            <div className="min-w-0">
              <span className={metaClass}>
                <span>{row.group}</span>
                <Sep />
                <span>{row.when}</span>
                <span className="ml-auto text-(--tanaw-text-muted) tabular-nums">{row.code}</span>
              </span>
              <Link to={row.href} className={cn(titleClass, "no-underline hover:text-(--tanaw-accent-ink) hover:underline")}>
                {row.title}
              </Link>
              <span className={placeClass}>{row.place}</span>
              <span className={cn(stateClass, row.state === "waiting" ? "text-(--tanaw-warn-ink)" : "text-(--tanaw-accent-ink)")}>
                <Dot />
                {row.stateLabel}
              </span>
            </div>
            <div>
              {row.canStart ? (
                <Button onClick={() => section.start(row)} loading={section.startingId === row.id} disabled={section.startingId !== null}>
                  Start on it<Hidden> ({row.code})</Hidden>
                </Button>
              ) : (
                <Link to={row.href} className={linkButtonClass}>
                  Open<Hidden> {row.code}</Hidden>
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const connectionIcons: Record<ConnectionRow["kind"], ReactNode> = {
  offline: <WifiOff size={15} aria-hidden="true" />,
  delayed: <Clock3 size={15} aria-hidden="true" />,
  camera: <TriangleAlert size={15} aria-hidden="true" />,
};

export function ConnectionsSection({ overview }: { overview: ItOverview }) {
  const section = overview.connections;
  const { shown, hidden } = firstRows(section.rows);
  return (
    <Section
      id="it-overview-connections"
      title="Connection problems"
      description="Desktop apps and cameras that are not sending visitor counts."
      link={{ to: itOverviewPaths.enterprises, label: "All enterprises" }}
      hidden={hidden}
      isLoading={section.isLoading}
      isError={section.isError}
      errorText="Connection status could not be loaded."
      onRetry={section.refetch}
      empty={shown.length === 0 ? "Every open place is sending data and every camera is counting." : null}
    >
      <ul className="m-0 list-none p-0">
        {shown.map((row) => (
          <li key={`${row.enterpriseId}-${row.kind}`} className={rowClass}>
            <div className="min-w-0">
              <span className={cn(stateClass, "mt-0", row.kind === "offline" ? "text-(--tanaw-danger)" : "text-(--tanaw-warn-ink)")}>
                {connectionIcons[row.kind]}
                {row.label}
              </span>
              <Link to={row.href} className={cn(titleClass, "no-underline hover:text-(--tanaw-accent-ink) hover:underline")}>
                {row.place}
              </Link>
              <span className={placeClass}>{row.detail}</span>
              {row.requestCode && <span className={cn(metaClass, "mt-1.5")}>Request {row.requestCode} is open</span>}
            </div>
            <Link to={row.href} className={linkButtonClass}>
              Check<Hidden> {row.place}</Hidden>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function DoneNote({ children }: { children: string }) {
  return (
    <span className="inline-flex min-h-10.5 items-center gap-1.5 text-sm font-semibold text-(--tanaw-accent-ink)">
      <Check size={16} strokeWidth={2.6} aria-hidden="true" />
      {children}
    </span>
  );
}

export function AccountsSection({ overview }: { overview: ItOverview }) {
  const section = overview.accounts;
  const { shown, hidden } = firstRows(section.rows);
  return (
    <Section
      id="it-overview-accounts"
      title="Accounts waiting"
      description="People and enterprises who cannot sign in yet."
      link={{ to: itOverviewPaths.personnel, label: "LGU Personnel" }}
      hidden={hidden}
      isLoading={section.isLoading}
      isError={section.isError}
      errorText="Accounts could not be loaded."
      onRetry={section.refetch}
      empty={shown.length === 0 ? "Every account is activated, and no email change is waiting." : null}
    >
      <ul className="m-0 list-none p-0">
        {shown.map((row) => (
          <li key={row.id} className={rowClass}>
            <div className="min-w-0">
              <span className={metaClass}>{row.kind}</span>
              <span className={titleClass}>{row.name}</span>
              <span className={placeClass}>{row.detail}</span>
            </div>
            <div>
              {row.action.type === "review" ? (
                <Link to={row.action.href} className={linkButtonClass}>
                  {row.action.label}
                  <Hidden> the email change for {row.name}</Hidden>
                </Link>
              ) : section.resentIds.has(row.id) ? (
                <DoneNote>Sent again</DoneNote>
              ) : (
                <Button variant="secondary" onClick={() => section.resend(row)} loading={section.resendingId === row.id} disabled={section.resendingId !== null}>
                  {row.action.label}
                  <Hidden> to {row.name}</Hidden>
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function EmailsSection({ overview }: { overview: ItOverview }) {
  const section = overview.emails;
  const { shown, hidden } = firstRows(section.rows);
  return (
    <Section
      id="it-overview-emails"
      title="Emails that did not arrive"
      description="Invitations and sign-in emails TANAW could not deliver."
      link={{ to: itOverviewPaths.emailLog, label: "Email log" }}
      hidden={hidden}
      isLoading={section.isLoading}
      isError={section.isError}
      errorText="The email log could not be loaded."
      onRetry={section.refetch}
      empty={shown.length === 0 ? "Every email in the last 7 days was delivered." : null}
    >
      <ul className="m-0 list-none p-0">
        {shown.map((row) => (
          <li key={row.id} className={rowClass}>
            <div className="min-w-0">
              <span className={metaClass}>
                <span>{row.kind}</span>
                <Sep />
                <span>{row.when}</span>
              </span>
              <span className={cn(titleClass, "wrap-break-word")}>{row.to}</span>
              {row.recipient && <span className={cn(placeClass, "wrap-break-word")}>{row.recipient}</span>}
              <span className={cn(placeClass, row.tone === "problem" ? "text-(--tanaw-danger)" : "")}>{row.reason}</span>
            </div>
            <div>
              {row.canRetry && (
                <Button variant="secondary" onClick={() => section.retry(row)} loading={section.retryingId === row.id} disabled={section.retryingId !== null}>
                  Try again<Hidden> for {row.to}</Hidden>
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
