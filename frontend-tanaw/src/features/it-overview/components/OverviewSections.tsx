import { Check, ChevronRight, Clock3, TriangleAlert, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Skeleton, cn, openRowFromClick } from "@/shared/ui-kit";
import type { ItOverview } from "../hooks/useItOverview";
import { useScrollEdges } from "../hooks/useScrollEdges";
import { firstRows, type ConnectionRow } from "../model/itOverview";
import { itOverviewPaths } from "../model/paths";

/** A row split from the next by a hairline; its hover band reaches past the text, which stays aligned with the heading. */
const rowClass = "it-overview__row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 py-4 max-sm:grid-cols-1";
const metaClass = "flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.8125rem] text-(--tanaw-text-secondary)";
/** A row that opens as a whole. */
const clickableRowClass = "tanaw-row-link";

const titleClass = "mt-1 block text-[0.96875rem] font-semibold text-(--tanaw-text)";
const placeClass = "mt-0.5 block text-sm text-(--tanaw-text-secondary)";
const stateClass = "mt-1.5 inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold";

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
  stateLine = false,
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
  /** Rows carry a fourth line (the request state), so the loading rows do too. */
  stateLine?: boolean;
  children: ReactNode;
}) {
  const titleId = `${id}-title`;
  let body: ReactNode = children;
  if (isLoading) body = <SectionSkeleton label={`Loading ${title.toLowerCase()}`} stateLine={stateLine} />;
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
    <section aria-labelledby={titleId} className="min-w-0" data-testid={id} data-overview-section={id}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-(--tanaw-border-soft) pb-3">
        <div className="min-w-0">
          <h2 id={titleId} className="m-0 text-lg leading-snug font-[650] tracking-[-0.01em] text-(--tanaw-text)">
            {title}
          </h2>
          <p className="mt-1 mb-0 text-[13px] text-(--tanaw-text-secondary)">{description}</p>
        </div>
        <SectionLink to={link.to}>{link.label}</SectionLink>
      </div>
      <div key={isLoading ? "loading" : isError ? "error" : "rows"} className="it-overview__body">
        {body}
      </div>
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
      className="group rounded-tanaw-sm ease-tanaw-out inline-flex min-h-9 items-center gap-1 text-sm font-semibold whitespace-nowrap text-(--tanaw-accent-ink) no-underline decoration-(--tanaw-accent-ink)/40 underline-offset-4 transition-colors duration-200 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
    >
      {children}
      <ChevronRight
        size={15}
        aria-hidden="true"
        className="ease-tanaw-out transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
      />
    </Link>
  );
}

function SectionMessage({ children }: { children: ReactNode }) {
  return <p className="mt-4 mb-0 text-sm text-(--tanaw-text-secondary)">{children}</p>;
}

/**
 * Three rows in the shape of the list while it loads: each bar sits in its text line's own height
 * (meta, title, place and, for requests, the state line), beside a button-sized block.
 */
function SectionSkeleton({ label, stateLine }: { label: string; stateLine: boolean }) {
  return (
    <div role="status" aria-label={label} className="it-overview__skeleton">
      {[0, 1, 2].map((index) => (
        <div key={index} className={rowClass}>
          <div className="min-w-0">
            <span className="flex h-5 items-center">
              <Skeleton className="h-3 w-40" />
            </span>
            <span className="mt-1 flex h-6 items-center">
              <Skeleton className="h-4 w-3/4" />
            </span>
            <span className="mt-0.5 flex h-5 items-center">
              <Skeleton className="h-3.5 w-1/2" />
            </span>
            {stateLine && (
              <span className="mt-1.5 flex h-5 items-center">
                <Skeleton className="h-3 w-24" />
              </span>
            )}
          </div>
          <Skeleton className="rounded-tanaw-md h-10.5 w-28 max-sm:hidden" />
        </div>
      ))}
    </div>
  );
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
      stateLine
    >
      <ul className="m-0 list-none p-0">
        {shown.map((row) => (
          <li key={row.id} onClick={openRowFromClick} className={cn(rowClass, clickableRowClass)}>
            <div className="min-w-0">
              <span className={metaClass}>
                <span>{row.group}</span>
                <Sep />
                <span>{row.when}</span>
                <span className="ml-auto text-(--tanaw-text-muted) tabular-nums">{row.code}</span>
              </span>
              <Link data-row-primary to={row.href} className={titleClass}>
                {row.title}
              </Link>
              <span className={placeClass}>{row.place}</span>
              <span className={cn(stateClass, row.state === "waiting" ? "text-(--tanaw-warn-ink)" : "text-(--tanaw-accent-ink)")}>
                <Dot />
                {row.stateLabel}
              </span>
            </div>
            <div className={cn("flex items-center gap-4", !row.canStart && "max-sm:hidden")}>
              {row.canStart && (
                <Button onClick={() => section.start(row)} loading={section.startingId === row.id} disabled={section.startingId !== null}>
                  Start on it<Hidden> ({row.code})</Hidden>
                </Button>
              )}
              <ChevronRight size={16} aria-hidden="true" className="tanaw-row-chevron" />
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

/**
 * Every connection problem, in a list that scrolls inside itself once it outgrows its space. Its
 * edges fade while rows sit past them, and it takes keyboard focus while it scrolls.
 */
function ConnectionList({ rows, labelledBy }: { rows: readonly ConnectionRow[]; labelledBy: string }) {
  const { ref, scrollProps } = useScrollEdges<HTMLUListElement>();
  return (
    <div className="it-overview__scroll-frame">
      <ul ref={ref} data-fit-list="" aria-labelledby={labelledBy} className="it-overview__scroll m-0 list-none" {...scrollProps}>
        {rows.map((row) => (
          <li key={`${row.enterpriseId}-${row.kind}`} onClick={openRowFromClick} className={cn(rowClass, clickableRowClass)}>
            <div className="min-w-0">
              <span className={cn(stateClass, "mt-0", row.kind === "offline" ? "text-(--tanaw-danger)" : "text-(--tanaw-warn-ink)")}>
                {connectionIcons[row.kind]}
                {row.label}
              </span>
              <Link data-row-primary to={row.href} className={titleClass}>
                {row.place}
              </Link>
              <span className={placeClass}>{row.detail}</span>
              {row.requestCode && <span className={cn(metaClass, "mt-1.5")}>Request {row.requestCode} is open</span>}
            </div>
            <ChevronRight size={16} aria-hidden="true" className="tanaw-row-chevron max-sm:hidden" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Shows every problem: the list scrolls rather than stopping at the first few. */
export function ConnectionsSection({ overview }: { overview: ItOverview }) {
  const section = overview.connections;
  const rows = section.rows;
  return (
    <Section
      id="it-overview-connections"
      title="Connection problems"
      description="Desktop apps and cameras that are not sending visitor counts."
      link={{ to: itOverviewPaths.enterprises, label: "All enterprises" }}
      hidden={0}
      isLoading={section.isLoading}
      isError={section.isError}
      errorText="Connection status could not be loaded."
      onRetry={section.refetch}
      empty={rows.length === 0 ? "Every open place is sending data and every camera is counting." : null}
    >
      <ConnectionList rows={rows} labelledBy="it-overview-connections-title" />
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
          <li key={row.id} onClick={row.action.type === "review" ? openRowFromClick : undefined} className={cn(rowClass, row.action.type === "review" && clickableRowClass)}>
            <div className="min-w-0">
              <span className={metaClass}>{row.kind}</span>
              {row.action.type === "review" ? (
                <Link data-row-primary to={row.action.href} aria-label={`${row.action.label} the email change for ${row.name}`} className={titleClass}>
                  {row.name}
                </Link>
              ) : (
                <span className={titleClass}>{row.name}</span>
              )}
              <span className={placeClass}>{row.detail}</span>
            </div>
            <div className={cn(row.action.type === "review" && "max-sm:hidden")}>
              {row.action.type === "review" ? (
                <ChevronRight size={16} aria-hidden="true" className="tanaw-row-chevron" />
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
            <div className={cn(!row.canRetry && "max-sm:hidden")}>
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
