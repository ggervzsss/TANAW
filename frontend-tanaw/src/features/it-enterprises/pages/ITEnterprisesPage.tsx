import { Building2, ChevronRight, Plus } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Button, EmptyState, PortalPageHeader, SearchField, Skeleton, cn, openRowFromClick } from "@/shared/ui-kit";
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

/** The chosen chip's tint glides to the next choice instead of jumping. */
const GLIDE = { type: "tween", duration: 0.24, ease: [0.2, 0.8, 0.2, 1] } as const;

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
  const reduceMotion = useReducedMotion();

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
            <div className="min-w-0 flex-[1_1_20rem] max-sm:basis-full sm:max-w-104">
              <label htmlFor="it-enterprise-search" className="mb-1.5 block text-[13px] font-medium text-(--tanaw-text-secondary)">
                Search
              </label>
              <SearchField id="it-enterprise-search" value={query} onChange={(value) => setParam({ q: value || null })} placeholder="Enterprise, barangay or owner email" label="Search enterprises" />
            </div>
            <div className="min-w-0 max-sm:w-full">
              <span id="it-enterprise-show" className="mb-1.5 block text-[13px] font-medium text-(--tanaw-text-secondary)">
                Show
              </span>
              <LayoutGroup id="it-enterprise-show">
                <div role="group" aria-labelledby="it-enterprise-show" className="ite-chips flex min-h-11 flex-wrap items-center gap-1">
                  {CHIPS.map((item) => {
                    const on = chip === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => showChip(item.key)}
                        className={cn(
                          "rounded-tanaw-md ease-tanaw-out relative inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 px-3.5 whitespace-nowrap pointer-coarse:min-h-11 text-sm font-medium transition-[background-color,color,scale] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-[0.97] motion-reduce:transition-colors motion-reduce:active:scale-100",
                          on ? "text-(--tanaw-accent-ink)" : "text-(--tanaw-text) hover:bg-(--tanaw-control-hover)",
                        )}
                      >
                        {on && <motion.span layoutId="ite-chip-highlight" aria-hidden="true" className="ite-chip-highlight" transition={reduceMotion ? { duration: 0 } : GLIDE} />}
                        <span className="relative">{item.label}</span>{" "}
                        <span className={cn("relative font-semibold tabular-nums", on ? "text-(--tanaw-accent-ink)" : "text-(--tanaw-text-muted)")}>
                          {isLoading ? "–" : counts[item.key].toLocaleString("en-US")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </LayoutGroup>
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
  const cell = "ite-figure min-w-0";
  const note = "mt-2 block text-[13px] text-(--tanaw-text-muted)";
  // A note line holds its height while the figures load, so the strip does not grow when they arrive.
  const noteSkeleton = (
    <span className="flex h-5 items-center">
      <Skeleton className="h-3 w-40 max-w-full" />
    </span>
  );
  const value = (main: number, of?: number) =>
    isLoading ? (
      <Skeleton className="mt-2.5 h-9 w-20" />
    ) : (
      <span className="ite-value mt-2.5 block text-4xl leading-none font-semibold tracking-[-0.03em] text-(--tanaw-text) tabular-nums">
        {main.toLocaleString("en-US")}
        {of !== undefined && " "}
        {of !== undefined && <span className="text-xl font-medium tracking-normal text-(--tanaw-text-muted)">of {of.toLocaleString("en-US")}</span>}
      </span>
    );
  return (
    <dl className="ite-figures">
      <div className={cell}>
        <dt className="text-sm font-semibold text-(--tanaw-text-secondary)">Registered enterprises</dt>
        <dd>
          {value(figures.total)}
          <span className={note}>{isLoading ? noteSkeleton : registeredNote(figures)}</span>
        </dd>
      </div>
      <div className={cell}>
        <dt className="text-sm font-semibold text-(--tanaw-text-secondary)">Desktop apps sending data</dt>
        <dd>
          {value(figures.appsSending, figures.appsTotal)}
          <span className={note}>{isLoading ? noteSkeleton : appsNote(figures)}</span>
        </dd>
      </div>
      <div className={cell}>
        <dt className="text-sm font-semibold text-(--tanaw-text-secondary)">Cameras counting</dt>
        <dd>
          {value(figures.camerasCounting, figures.camerasTotal)}
          <span className={cn(note, "flex flex-wrap items-center gap-x-2.5 gap-y-1")}>
            {isLoading ? noteSkeleton : camerasNote(figures)}
            {!isLoading && figures.attention > 0 && (
              <button
                type="button"
                onClick={onShowAttention}
                className="ease-tanaw-out rounded-sm font-semibold text-(--tanaw-accent-ink) underline pointer-coarse:min-h-11 pointer-coarse:text-left decoration-(--tanaw-accent-ink)/40 underline-offset-4 transition-[text-decoration-color] duration-200 hover:decoration-(--tanaw-accent-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
              >
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
  const head = "px-4 py-2.5 text-xs font-semibold tracking-label text-(--tanaw-label) uppercase";
  return (
    <div className="relative mt-4 overflow-x-auto max-lg:overflow-visible">
      <table className="ite-table w-full min-w-245 border-separate border-spacing-0 text-left text-sm">
        <caption className="sr-only">Enterprises with their account, desktop app and cameras</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(head, "w-[28%] pl-3")}>
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
            <th scope="col" className={cn(head, "pr-3 text-right")}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 5 }, (_, index) => (
                <tr key={index} className="align-top">
                  {Array.from({ length: 4 }, (__, cellIndex) => (
                    <td key={cellIndex} className={cn("px-4 py-4", cellIndex === 0 && "pl-3")}>
                      <span className={cn("flex items-center", cellIndex === 0 ? "h-6" : "h-5")}>
                        <Skeleton className={cellIndex === 0 ? "h-4 w-3/4" : "h-3.5 w-2/3"} />
                      </span>
                      <span className="mt-0.5 flex h-5 items-center">
                        <Skeleton className="h-3 w-1/2" />
                      </span>
                    </td>
                  ))}
                  <td className="py-4 pr-3 pl-4">
                    <span className="block min-h-10" />
                  </td>
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
    <tr onClick={openRowFromClick} className="tanaw-row-link align-top">
      <th scope="row" className="py-4 pr-4 pl-3 font-normal">
        <Link data-row-primary to={manageEnterprisePath(row.enterpriseId)} className="block text-base font-semibold text-(--tanaw-text)">
          {row.name}
        </Link>
        <span className="mt-0.5 block text-[13px] text-(--tanaw-text-secondary)">{placeLine(row)}</span>
      </th>
      <td data-label="Account" className="px-4 py-4">
        <StateText tone={account.tone}>{account.label}</StateText>
        <span className={cn(sub, "break-all")}>{account.sub}</span>
      </td>
      <td data-label="Desktop app" className="px-4 py-4">
        <StateText tone={app.tone} dot>
          {app.label}
        </StateText>
        {app.sub && <span className={sub}>{app.sub}</span>}
      </td>
      <td data-label="Cameras" className="px-4 py-4">
        <span className={cn("block font-semibold", toneText[cameras.tone])}>{cameras.label}</span>
        {cameras.sub && <span className={sub}>{cameras.sub}</span>}
      </td>
      <td data-actions={resend ? "" : undefined} className="py-4 pr-3 pl-4 text-right">
        <div className="inline-flex min-h-10 items-center gap-4">
          {resend && <ResendInvitationButton row={row} label={resend} />}
          <ChevronRight size={16} aria-hidden="true" className="tanaw-row-chevron" />
        </div>
      </td>
    </tr>
  );
}

function ResendInvitationButton({ row, label }: { row: EnterpriseRow; label: string }) {
  const resend = useResendInvitation();
  return (
    <Button variant="secondary" className="pointer-coarse:min-h-11" loading={resend.isPending} onClick={() => resend.mutate(row.id)} aria-label={`${label} to ${row.name}`}>
      {label}
    </Button>
  );
}
