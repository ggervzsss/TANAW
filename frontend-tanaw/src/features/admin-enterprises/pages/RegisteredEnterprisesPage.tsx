import { ChevronDown, ChevronRight, ChevronUp, CircleAlert, CircleCheck, CircleMinus, Building2, TriangleAlert, X } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { adminEnterpriseDetailsPath } from "@/app/routers/routes";
import { Alert, Button, EmptyState, Pagination, PortalPageHeader, SearchField, Select, Skeleton, cn } from "@/shared/ui-kit";
import { useEnterpriseDirectory, useNow } from "../hooks/useEnterpriseDirectory";
import { plural, type CameraState } from "../model/cameraStatus";
import {
  ALL,
  ATTRACTION_TYPES,
  CAMERA_FILTER_OPTIONS,
  DEFAULT_FILTERS,
  camerasSubline,
  distinctValues,
  filterEnterpriseRows,
  filtersFromParams,
  hasActiveFilters,
  paramsFromFilters,
  resultLine,
  sortEnterpriseRows,
  summarizeEnterprises,
  type CameraFilter,
  type EnterpriseFilters,
  type EnterpriseRow,
  type SortDirection,
} from "../model/enterpriseDirectory";
import "../adminEnterprises.css";

const PAGE_SIZE = 10;

/*
 * Registered Enterprises (/admin/enterprises). Filters, sort and page live in the URL
 * (?q=&barangay=&type=&category=&camera=&attention=1&sort=desc&page=2), so returning from
 * Enterprise Details restores the list and other screens can link to "needs attention".
 */
export function RegisteredEnterprisesPage() {
  const now = useNow();
  const directory = useEnterpriseDirectory(now);
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const sort: SortDirection = params.get("sort") === "desc" ? "descending" : "ascending";
  const requestedPage = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  const summary = useMemo(() => summarizeEnterprises(directory.rows), [directory.rows]);
  const filtered = useMemo(() => sortEnterpriseRows(filterEnterpriseRows(directory.rows, filters), sort), [directory.rows, filters, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const barangays = useMemo(() => distinctValues(directory.rows, (row) => row.barangay), [directory.rows]);
  const categories = useMemo(() => distinctValues(directory.rows, (row) => row.attractionCategory), [directory.rows]);

  const update = (next: Partial<EnterpriseFilters>, options: { sort?: SortDirection; page?: number } = {}) => {
    setParams(paramsFromFilters({ ...filters, ...next }, { sort: options.sort ?? sort, page: options.page }), { replace: true });
  };

  const showing =
    filtered.length === 0
      ? "Showing 0 enterprises"
      : pageCount === 1
        ? `Showing ${plural(filtered.length, "enterprise")}`
        : `Showing ${(page - 1) * PAGE_SIZE + 1} to ${Math.min(page * PAGE_SIZE, filtered.length)} of ${filtered.length.toLocaleString("en-US")}`;

  return (
    <div className="admin-enterprises w-full">
      <Header updatedAt={directory.updatedAt} now={now} isLoading={directory.isLoading} />

      {directory.isError && directory.rows.length === 0 ? (
        <Alert
          tone="danger"
          title="Enterprises could not be loaded"
          action={
            <Button size="sm" variant="secondary" onClick={directory.refetch}>
              Try again
            </Button>
          }
        >
          Check the connection to the TANAW server, then try again.
        </Alert>
      ) : (
        <>
          <FigureStrip
            isLoading={directory.isLoading}
            enterprises={summary.enterprises}
            cameras={summary.cameras}
            camerasNote={camerasSubline(summary)}
            attention={summary.attention}
            onShowAttention={() => update({ ...DEFAULT_FILTERS, attention: true }, { page: 1 })}
          />

          {directory.accountsFailed && (
            <p role="status" className="mt-4 text-[13px] text-(--tanaw-warn-ink)">
              Enterprise account details could not be loaded, so attraction codes and addresses may be missing.
            </p>
          )}

          <form role="search" aria-label="Filter enterprises" className="mt-5.5 grid grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))] gap-3 max-xl:grid-cols-3 max-md:grid-cols-1" onSubmit={(event) => event.preventDefault()}>
            <div className="min-w-0 max-xl:col-span-3 max-md:col-span-1">
              <label htmlFor="enterprise-search" className="mb-2 block text-xs font-bold tracking-label text-(--tanaw-label) uppercase">
                Search
              </label>
              <SearchField id="enterprise-search" value={filters.search} onChange={(search) => update({ search }, { page: 1 })} placeholder="Enterprise, category or barangay" label="Search enterprises" />
            </div>
            <Select label="Barangay" value={filters.barangay} onChange={(barangay) => update({ barangay }, { page: 1 })} options={[[ALL, "All barangays"], ...barangays.map((value) => [value, value] as const)]} searchable />
            <Select
              label="Attraction type"
              value={filters.attractionType}
              onChange={(attractionType) => update({ attractionType }, { page: 1 })}
              options={[[ALL, "All types"], ...ATTRACTION_TYPES.map((value) => [value, value] as const)]}
            />
            <Select
              label="Attraction category"
              value={filters.attractionCategory}
              onChange={(attractionCategory) => update({ attractionCategory }, { page: 1 })}
              options={[[ALL, "All categories"], ...categories.map((value) => [value, value] as const)]}
              searchable
            />
            <Select label="Camera status" value={filters.camera} onChange={(camera) => update({ camera: camera as CameraFilter }, { page: 1 })} options={CAMERA_FILTER_OPTIONS} />
          </form>

          <div className="mt-3 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
            <p role="status" className="text-sm font-semibold text-(--tanaw-text) tabular-nums">
              {directory.isLoading ? "Loading enterprises" : resultLine(filtered.length, directory.rows.length, filters)}
            </p>
            {filters.attention && (
              <button
                type="button"
                aria-label="Remove filter: Needs attention"
                onClick={() => update({ attention: false }, { page: 1 })}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-(--ae-chip) px-3 text-[13px] font-semibold text-(--tanaw-text) transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
              >
                Needs attention <X size={14} aria-hidden="true" />
              </button>
            )}
            {hasActiveFilters(filters) && (
              <button type="button" onClick={() => update(DEFAULT_FILTERS, { page: 1 })} className="text-sm font-semibold text-(--tanaw-accent-ink) underline-offset-4 hover:underline">
                Clear filters
              </button>
            )}
          </div>

          <EnterpriseTable
            rows={visible}
            listSearch={params.toString()}
            isLoading={directory.isLoading}
            sort={sort}
            onSort={() => update({}, { sort: sort === "ascending" ? "descending" : "ascending", page: 1 })}
            empty={
              directory.rows.length === 0 ? (
                <EmptyState icon={<Building2 size={22} />} title="No registered enterprises" description="Enterprises appear here once IT registers and activates their accounts." />
              ) : (
                <EmptyState
                  icon={<Building2 size={22} />}
                  title="No enterprises match these filters"
                  description="Change the search or filters to see more enterprises."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => update(DEFAULT_FILTERS, { page: 1 })}>
                      Clear filters
                    </Button>
                  }
                />
              )
            }
          />

          {!directory.isLoading && filtered.length > 0 && (
            <Pagination page={page} pageCount={pageCount} onChange={(next) => update({}, { page: next })} summary={showing} ariaLabel="Enterprise pages" className="mt-5" />
          )}
        </>
      )}
    </div>
  );
}

function Header({ updatedAt, now, isLoading }: { updatedAt: number; now: Date; isLoading: boolean }) {
  const status = isLoading || !updatedAt ? "Loading camera status" : `Camera status is live. Last update ${minutesAgo(updatedAt, now.getTime())}.`;
  return (
    <PortalPageHeader
      title="Registered Enterprises"
      description="View and manage the enterprises monitored by TANAW."
      actions={
        <p role="status" className="text-[13px] text-(--tanaw-text-secondary)">
          {status}
        </p>
      }
    />
  );
}

function minutesAgo(updatedAt: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60_000);
  return minutes < 1 ? "less than a minute ago" : `${minutes.toLocaleString("en-US")} min ago`;
}

function FigureStrip({
  isLoading,
  enterprises,
  cameras,
  camerasNote,
  attention,
  onShowAttention,
}: {
  isLoading: boolean;
  enterprises: number;
  cameras: number;
  camerasNote: string;
  attention: number;
  onShowAttention: () => void;
}) {
  const cell = "min-w-0 px-6 py-4.5 first:pl-0 max-md:px-0 max-md:py-4";
  const value = (content: ReactNode, className?: string) =>
    isLoading ? (
      <Skeleton className="mt-2.5 h-9 w-16" />
    ) : (
      <div className={cn("mt-2.5 font-display text-4xl leading-none font-bold text-(--tanaw-text) tabular-nums", className)}>{content}</div>
    );
  const note = "mt-2 block text-[13px] text-(--tanaw-text-muted)";
  return (
    <dl className="grid grid-cols-3 border-y border-(--tanaw-border-soft) max-md:grid-cols-1 [&>div+div]:border-l [&>div+div]:border-(--tanaw-border-soft) max-md:[&>div+div]:border-t max-md:[&>div+div]:border-l-0">
      <div className={cell}>
        <dt className="text-sm font-bold text-(--tanaw-text)">Registered enterprises</dt>
        <dd>
          {value(enterprises.toLocaleString("en-US"))}
          <span className={note}>Active enterprise accounts monitored by TANAW</span>
        </dd>
      </div>
      <div className={cell}>
        <dt className="text-sm font-bold text-(--tanaw-text)">Listed cameras</dt>
        <dd>
          {value(cameras.toLocaleString("en-US"))}
          <span className={note}>{isLoading ? " " : camerasNote}</span>
        </dd>
      </div>
      <div className={cell}>
        <dt className="text-sm font-bold text-(--tanaw-text)">Needs attention</dt>
        <dd>
          {value(attention.toLocaleString("en-US"), attention > 0 ? "text-(--tanaw-danger)" : undefined)}
          <span className={note}>
            Enterprises with a camera issue or no connection
            {!isLoading && attention > 0 && (
              <>
                {" "}
                <button type="button" onClick={onShowAttention} className="font-semibold text-(--tanaw-accent-ink) underline underline-offset-4">
                  Show these {attention.toLocaleString("en-US")}
                </button>
              </>
            )}
          </span>
        </dd>
      </div>
    </dl>
  );
}

const statusIcon: Record<CameraState, ReactNode> = {
  ok: <CircleCheck size={15} aria-hidden="true" />,
  issue: <TriangleAlert size={15} aria-hidden="true" />,
  offline: <TriangleAlert size={15} aria-hidden="true" />,
  unconfigured: <CircleMinus size={15} aria-hidden="true" />,
  unknown: <CircleAlert size={15} aria-hidden="true" />,
};

const statusColor: Record<CameraState, string> = {
  ok: "text-(--tanaw-accent-ink)",
  issue: "text-(--tanaw-warn-ink)",
  offline: "text-(--tanaw-danger)",
  unconfigured: "text-(--tanaw-text-secondary)",
  unknown: "text-(--tanaw-text-secondary)",
};

function EnterpriseTable({ rows, isLoading, sort, onSort, empty, listSearch }: { rows: EnterpriseRow[]; isLoading: boolean; sort: SortDirection; onSort: () => void; empty: ReactNode; listSearch: string }) {
  const header = "px-4 py-3 text-left text-[11px] font-bold tracking-[0.12em] text-(--tanaw-text-secondary) uppercase first:pl-0";
  const cell = "px-4 py-4 align-top first:pl-0";
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="ae-table w-full min-w-240 border-collapse text-sm text-(--tanaw-text)">
        <caption className="sr-only">Registered enterprises with their attraction classification and camera status</caption>
        <thead>
          <tr className="border-b border-(--tanaw-border-soft)">
            <th scope="col" aria-sort={sort} className={cn(header, "w-[26%]")}>
              <button type="button" onClick={onSort} className="inline-flex items-center gap-1 rounded-md uppercase hover:text-(--tanaw-text)">
                Enterprise
                {sort === "ascending" ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              </button>
            </th>
            <th scope="col" className={cn(header, "w-[12%]")}>
              Barangay
            </th>
            <th scope="col" className={cn(header, "w-[11%]")}>
              Attraction code
            </th>
            <th scope="col" className={cn(header, "w-[21%]")}>
              Attraction category
            </th>
            <th scope="col" className={cn(header, "w-[16%]")}>
              Cameras
            </th>
            <th scope="col" className={header}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 5 }, (_, index) => (
                <tr key={index} className="border-b border-(--tanaw-border-soft)">
                  <td colSpan={6} className="py-4">
                    <Skeleton className="h-10 w-full" label={index === 0 ? "Loading enterprises" : undefined} />
                  </td>
                </tr>
              ))
            : rows.map((row) => (
                <tr key={row.id} className="border-b border-(--tanaw-border-soft)">
                  <th scope="row" className={cn(cell, "text-left font-normal")}>
                    <span className="block text-base font-bold">{row.name}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[13px] text-(--tanaw-text-secondary)">{[row.portfolio, row.address].filter(Boolean).join(". ") || "No address on record"}</span>
                  </th>
                  <td className={cell}>{row.barangay}</td>
                  <td className={cn(cell, "tabular-nums")}>{row.attractionCode ?? "—"}</td>
                  <td className={cell}>
                    <span className="block">{row.attractionCategory}</span>
                    {row.attractionType && <span className="mt-0.5 block text-[13px] text-(--tanaw-text-muted)">{row.attractionType}</span>}
                  </td>
                  <td className={cell}>
                    <span className="block font-semibold tabular-nums">{row.camera.cameraCount === null ? "Cameras unknown" : plural(row.camera.cameraCount, "camera")}</span>
                    <span className={cn("mt-1 flex items-start gap-1.5 text-[13px] font-semibold", statusColor[row.camera.state])}>
                      <span className="mt-0.5 shrink-0">{statusIcon[row.camera.state]}</span>
                      {row.camera.label}
                    </span>
                  </td>
                  <td className={cn(cell, "text-right whitespace-nowrap")}>
                    <Link to={adminEnterpriseDetailsPath(row.id)} state={{ listSearch }} aria-label={`View details for ${row.name}`} className="inline-flex items-center gap-0.5 font-semibold text-(--tanaw-accent-ink) no-underline hover:underline">
                      View details <ChevronRight size={15} aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
      {!isLoading && rows.length === 0 && <div className="border-b border-(--tanaw-border-soft)">{empty}</div>}
    </div>
  );
}
