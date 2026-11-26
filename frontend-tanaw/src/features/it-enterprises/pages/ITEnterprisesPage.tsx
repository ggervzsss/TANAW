import { Building2, ChevronRight, Plus } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Button, EmptyState, PortalPageHeader, SearchField, Skeleton, cn } from "@/shared/ui-kit";
import { RegisterEnterpriseDialog } from "../components/RegisterEnterpriseDialog";
import { StateText } from "../components/StateText";
import { toneText } from "../components/tones";
import { useResendInvitation } from "../hooks/useEnterpriseActions";
import { useDisplayFormats, useEnterpriseRows } from "../hooks/useEnterpriseRows";
import {
  CHIPS,
  accountCell,
  appCell,
  appsNote,
  cameraCell,
  camerasNote,
  chipCounts,
  filterRows,
  parseChip,
  placeLine,
  registeredNote,
  resendLabel,
  summarizeEnterprises,
  type ChipKey,
  type DisplayFormats,
  type EnterpriseFigures,
  type EnterpriseRow,
} from "../model/enterprises";
import { manageEnterprisePath } from "../model/paths";
import "../itEnterprises.css";

/*
 * IT Enterprises (/it/enterprises): every enterprise account with its sign-in state, desktop app and
 * cameras. ?show=attention|pending|sending picks a chip, ?q= searches, and ?register=1 opens the
 * Register enterprise dialog.
 */
export function ITEnterprisesPage() {
  const [params, setParams] = useSearchParams();
  const chip = parseChip(params.get("show"));
  const query = params.get("q") ?? "";
  const registerOpen = params.get("register") === "1";
  const formats = useDisplayFormats();
  const { rows, isLoading, isError, healthFailed, refetch } = useEnterpriseRows();

  const counts = useMemo(() => chipCounts(rows), [rows]);
  const figures = useMemo(() => summarizeEnterprises(rows), [rows]);
  const visible = useMemo(() => filterRows(rows, chip, query), [rows, chip, query]);

  const setParam = (changes: Record<string, string | null>) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  };
  const showChip = (key: ChipKey) => setParam({ show: key === "all" ? null : key });

  return (
    <div className="it-enterprises w-full">
      <PortalPageHeader
        title="Enterprises"
        description="Register enterprises, send their sign-in invitations, and keep their desktop apps and cameras sending data."
        actions={
          <Button size="lg" leadingIcon={<Plus size={16} aria-hidden="true" />} onClick={() => setParam({ register: "1" })}>
            Register enterprise
          </Button>
        }
      />

      {isError && rows.length === 0 ? (
        <Alert
          tone="danger"
          title="Enterprises could not be loaded"
          action={
            <Button size="sm" variant="secondary" onClick={refetch}>
              Try again
            </Button>
          }
        >
          Check the connection to the TANAW server, then try again.
        </Alert>
      ) : (
        <>
          <Figures isLoading={isLoading} figures={figures} onShowAttention={() => setParam({ show: "attention", q: null })} />

          {healthFailed && (
            <p role="status" className="mt-4 text-[13px] text-(--tanaw-warn-ink)">
              Desktop app and camera status could not be loaded, so those columns may be empty.
            </p>
          )}

          <div className="mt-5.5 flex flex-wrap items-end gap-x-6 gap-y-4">
            <div className="min-w-0 flex-[1_1_20rem] sm:max-w-104">
              <label htmlFor="it-enterprise-search" className="mb-1.5 block text-xs font-semibold text-(--tanaw-text-secondary)">
                Search
              </label>
              <SearchField id="it-enterprise-search" value={query} onChange={(value) => setParam({ q: value || null })} placeholder="Enterprise, barangay or owner email" label="Search enterprises" />
            </div>
            <div>
              <span id="it-enterprise-show" className="mb-1.5 block text-xs font-semibold text-(--tanaw-text-secondary)">
                Show
              </span>
              <div role="group" aria-labelledby="it-enterprise-show" className="flex flex-wrap gap-1.5">
                {CHIPS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={chip === item.key}
                    onClick={() => showChip(item.key)}
                    className={cn(
                      "inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-[13.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)",
                      chip === item.key
                        ? "border-(--tanaw-action) bg-(--ite-chip-on) text-(--tanaw-accent-ink)"
                        : "border-(--tanaw-control-border) bg-(--tanaw-control-bg) text-(--tanaw-text) hover:border-(--tanaw-control-border-hover)",
                    )}
                  >
                    {item.label} <span className="font-bold text-(--tanaw-text-muted) tabular-nums">{isLoading ? "–" : counts[item.key].toLocaleString("en-US")}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p role="status" className="sr-only">
            {isLoading ? "Loading enterprises" : `Showing ${visible.length} of ${rows.length} enterprises`}
          </p>

          <EnterpriseTable
            rows={visible}
            isLoading={isLoading}
            formats={formats}
            empty={
              rows.length === 0 ? (
                <EmptyState
                  icon={<Building2 size={22} />}
                  title="No enterprises registered yet"
                  description="Register an enterprise to send its owner a sign-in invitation."
                  action={
                    <Button size="sm" onClick={() => setParam({ register: "1" })}>
                      Register enterprise
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Building2 size={22} />}
                  title="No enterprises match."
                  description="Check the spelling, or show all enterprises."
                  action={
                    <Button size="sm" variant="secondary" onClick={() => setParam({ show: null, q: null })}>
                      Show all enterprises
                    </Button>
                  }
                />
              )
            }
          />
        </>
      )}

      <AnimatePresence>{registerOpen && <RegisterEnterpriseDialog key="register-enterprise" onClose={() => setParam({ register: null })} />}</AnimatePresence>
    </div>
  );
}

function Figures({ isLoading, figures, onShowAttention }: { isLoading: boolean; figures: EnterpriseFigures; onShowAttention: () => void }) {
  const cell = "min-w-0 px-6 py-4.5 first:pl-0 max-lg:px-0 max-lg:py-4";
  const note = "mt-2 block text-[13px] text-(--tanaw-text-muted)";
  const value = (main: number, of?: number) =>
    isLoading ? (
      <Skeleton className="mt-2.5 h-9 w-20" />
    ) : (
      <span className="font-display mt-2.5 block text-4xl leading-none font-bold text-(--tanaw-text) tabular-nums">
        {main.toLocaleString("en-US")}
        {of !== undefined && " "}
        {of !== undefined && <span className="text-xl text-(--tanaw-text-muted)">of {of.toLocaleString("en-US")}</span>}
      </span>
    );
  return (
    <dl className="grid grid-cols-3 border-y border-(--tanaw-border-soft) max-lg:grid-cols-1 [&>div+div]:border-l [&>div+div]:border-(--tanaw-border-soft) max-lg:[&>div+div]:border-t max-lg:[&>div+div]:border-l-0">
      <div className={cell}>
        <dt className="text-sm font-bold text-(--tanaw-text)">Registered enterprises</dt>
        <dd>
          {value(figures.total)}
          <span className={note}>{isLoading ? " " : registeredNote(figures)}</span>
        </dd>
      </div>
      <div className={cell}>
        <dt className="text-sm font-bold text-(--tanaw-text)">Desktop apps sending data</dt>
        <dd>
          {value(figures.appsSending, figures.appsTotal)}
          <span className={note}>{isLoading ? " " : appsNote(figures)}</span>
        </dd>
      </div>
      <div className={cell}>
        <dt className="text-sm font-bold text-(--tanaw-text)">Cameras counting</dt>
        <dd>
          {value(figures.camerasCounting, figures.camerasTotal)}
          <span className={cn(note, "flex flex-wrap items-center gap-x-2.5 gap-y-1")}>
            {isLoading ? " " : camerasNote(figures)}
            {!isLoading && figures.attention > 0 && (
              <button type="button" onClick={onShowAttention} className="font-semibold text-(--tanaw-accent-ink) underline underline-offset-4">
                Show places that need attention
              </button>
            )}
          </span>
        </dd>
      </div>
    </dl>
  );
}

function EnterpriseTable({ rows, isLoading, formats, empty }: { rows: EnterpriseRow[]; isLoading: boolean; formats: DisplayFormats; empty: ReactNode }) {
  const head = "px-4 py-3 text-[11px] font-bold tracking-label text-(--tanaw-text-secondary) uppercase";
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="ite-table w-full min-w-245 border-collapse text-left text-sm">
        <caption className="sr-only">Enterprises with their account, desktop app and cameras</caption>
        <thead>
          <tr className="border-b border-(--tanaw-border-soft)">
            <th scope="col" className={cn(head, "w-[28%] pl-0")}>
              Enterprise
            </th>
            <th scope="col" className={cn(head, "w-[21%]")}>
              Account
            </th>
            <th scope="col" className={cn(head, "w-[22%]")}>
              Desktop app
            </th>
            <th scope="col" className={cn(head, "w-[16%]")}>
              Cameras
            </th>
            <th scope="col" className={cn(head, "pr-0 text-right")}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 5 }, (_, index) => (
                <tr key={index} className="border-b border-(--tanaw-border-soft)">
                  {Array.from({ length: 5 }, (__, cellIndex) => (
                    <td key={cellIndex} className={cn("px-4 py-4", cellIndex === 0 && "pl-0")}>
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="mt-2 h-3 w-1/2" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => <EnterpriseTableRow key={row.id} row={row} formats={formats} />)}
        </tbody>
      </table>
      {!isLoading && rows.length === 0 && empty}
    </div>
  );
}

function EnterpriseTableRow({ row, formats }: { row: EnterpriseRow; formats: DisplayFormats }) {
  const account = accountCell(row, formats);
  const app = appCell(row, formats);
  const cameras = cameraCell(row);
  const resend = resendLabel(row);
  const sub = "mt-0.5 block text-[13px] text-(--tanaw-text-muted)";
  return (
    <tr className="border-b border-(--tanaw-border-soft) align-top">
      <th scope="row" className="py-4 pr-4 font-normal">
        <span className="block text-base font-bold text-(--tanaw-text)">{row.name}</span>
        <span className="mt-0.5 block text-[13px] text-(--tanaw-text-secondary)">{placeLine(row)}</span>
      </th>
      <td className="px-4 py-4">
        <StateText tone={account.tone}>{account.label}</StateText>
        <span className={cn(sub, "break-all")}>{account.sub}</span>
      </td>
      <td className="px-4 py-4">
        <StateText tone={app.tone} dot>
          {app.label}
        </StateText>
        {app.sub && <span className={sub}>{app.sub}</span>}
      </td>
      <td className="px-4 py-4">
        <span className={cn("block font-semibold", toneText[cameras.tone])}>{cameras.label}</span>
        {cameras.sub && <span className={sub}>{cameras.sub}</span>}
      </td>
      <td className="py-4 pl-4 text-right">
        <div className="inline-flex items-center gap-4">
          {resend && <ResendInvitationButton row={row} label={resend} />}
          <Link
            to={manageEnterprisePath(row.enterpriseId)}
            aria-label={`Manage ${row.name}`}
            className="inline-flex min-h-10 items-center gap-1 rounded-md font-semibold whitespace-nowrap text-(--tanaw-accent-ink) no-underline underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
          >
            Manage
            <ChevronRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </td>
    </tr>
  );
}

function ResendInvitationButton({ row, label }: { row: EnterpriseRow; label: string }) {
  const resend = useResendInvitation();
  return (
    <Button variant="secondary" loading={resend.isPending} onClick={() => resend.mutate(row.id)} aria-label={`${label} to ${row.name}`}>
      {label}
    </Button>
  );
}
