import { ChevronDown, ChevronRight, ChevronUp, CircleAlert, CircleCheck, CircleMinus, Building2, TriangleAlert, X } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { adminEnterpriseDetailsPath } from "@/app/routers/routes";
import { Alert, Button, EmptyState, Pagination, PortalPageHeader, SearchField, Select, Skeleton, cn, openRowFromClick } from "@/shared/ui-kit";
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
import { PhoneFilterSheet } from "../components/PhoneFilterSheet";
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

          <form
            role="search"
            aria-label="Filter enterprises"
            className="mt-6 grid grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))] gap-3 max-xl:grid-cols-3 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:items-end"
            onSubmit={(event) => event.preventDefault()}
          >
            <div className="min-w-0 max-xl:col-span-3 max-md:col-span-1">
              <label htmlFor="enterprise-search" className="mb-2 block text-[13px] font-semibold text-(--tanaw-text-secondary)">
                Search
              </label>
              <SearchField id="enterprise-search" value={filters.search} onChange={(search) => update({ search }, { page: 1 })} placeholder="Enterprise, category or barangay" label="Search enterprises" />
            </div>
            <PhoneFilterSheet
              noun="enterprises"
              activeCount={activeSelectCount(filters)}
              onClear={() => update({ ...DEFAULT_FILTERS, search: filters.search }, { page: 1 })}
              resultLabel={directory.isLoading ? undefined : resultLine(filtered.length, directory.rows.length, filters)}
            >
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
            </PhoneFilterSheet>
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
                className="ae-chip inline-flex min-h-8 items-center gap-1.5 rounded-full bg-(--ae-chip) px-3 text-[13px] font-semibold text-(--tanaw-accent-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
              >
                Needs attention <X size={14} aria-hidden="true" />
              </button>
            )}
            {hasActiveFilters(filters) && (
              <button type="button" onClick={() => update(DEFAULT_FILTERS, { page: 1 })} className="ae-text-action rounded-sm text-sm font-semibold text-(--tanaw-accent-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)">
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

/** The dropdown filters that differ from their defaults; the search and the attention chip show on the page. */
function activeSelectCount(filters: EnterpriseFilters) {
  return [filters.barangay !== ALL, filters.attractionType !== ALL, filters.attractionCategory !== ALL, filters.camera !== DEFAULT_FILTERS.camera].filter(Boolean).length;
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
  // Phones: the two counts side by side, Needs attention on a full row under them.
  const cell = "min-w-0 border-(--tanaw-border-soft) px-6 py-4 first:pl-0 max-md:py-3.5";
  const value = (content: ReactNode, className?: string) =>
    isLoading ? (
      <Skeleton className="mt-3 h-9 w-16 max-md:mt-2 max-md:h-7.5" />
    ) : (
      <div className={cn("ae-fade mt-3 font-display text-4xl leading-none font-bold text-(--tanaw-text) tabular-nums max-md:mt-2 max-md:text-[1.875rem]", className)}>{content}</div>
    );
  const note = "mt-2 block text-[13px] text-(--tanaw-text-muted) max-md:mt-1.5";
  return (
    <dl className="grid grid-cols-3 border-y border-(--tanaw-border-soft) max-md:grid-cols-2">
      <div className={cn(cell, "max-md:pr-4")}>
        <dt className="text-sm font-semibold text-(--tanaw-text)">Registered enterprises</dt>
        <dd>
          {value(enterprises.toLocaleString("en-US"))}
          <span className={note}>Active enterprise accounts monitored by TANAW</span>
        </dd>
      </div>
      <div className={cn(cell, "border-l max-md:pr-0 max-md:pl-4")}>
        <dt className="text-sm font-semibold text-(--tanaw-text)">Listed cameras</dt>
        <dd>
          {value(cameras.toLocaleString("en-US"))}
          <span className={note}>{isLoading ? " " : camerasNote}</span>
        </dd>
      </div>
      <div className={cn(cell, "border-l max-md:col-span-2 max-md:border-t max-md:border-l-0 max-md:px-0")}>
        <dt className="text-sm font-semibold text-(--tanaw-text)">Needs attention</dt>
        <dd>
          {value(attention.toLocaleString("en-US"), attention > 0 ? "text-(--tanaw-danger)" : undefined)}
          <span className={note}>
            Enterprises with a camera issue or no connection
            {!isLoading && attention > 0 && (
              <>
                {" "}
                <button type="button" onClick={onShowAttention} className="rounded-sm font-semibold text-(--tanaw-accent-ink) underline underline-offset-4 transition-colors duration-150 ease-tanaw-out hover:text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)">
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
  const header = "px-4 py-3 text-left text-xs font-semibold tracking-label whitespace-nowrap text-(--tanaw-label) uppercase first:pl-3 last:pr-3";
  const cell = "px-4 py-4 align-top first:pl-3 last:pr-3";
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="ae-table ae-table--stack w-full text-sm text-(--tanaw-text) min-[60rem]:min-w-240">
        <caption className="sr-only">Registered enterprises with their attraction classification and camera status</caption>
        <thead>
          <tr>
            <th scope="col" aria-sort={sort} className={cn(header, "w-[26%]")}>
              <button type="button" onClick={onSort} className="ae-sort inline-flex items-center gap-1 rounded-md uppercase hover:text-(--tanaw-accent-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)">
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
            <th scope="col" className={cn(header, "w-10")}>
              <span className="sr-only">Opens details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? // One page of rows, each bar in the box of the line it stands for (16px name line 24px tall, 14px text 20px, 13px notes 19.5px).
              Array.from({ length: PAGE_SIZE }, (_, index) => (
                <tr key={index}>
                  <td className={cell}>
                    <span className="flex h-6 items-center">
                      <Skeleton className="h-4 w-44" label={index === 0 ? "Loading enterprises" : undefined} />
                    </span>
                    <span className="mt-0.5 flex h-[19.5px] items-center">
                      <Skeleton className="h-3 w-60 max-w-full" />
                    </span>
                  </td>
                  <td className={cell}>
                    <span className="flex h-5 items-center">
                      <Skeleton className="h-3.5 w-20" />
                    </span>
                  </td>
                  <td className={cell}>
                    <span className="flex h-5 items-center">
                      <Skeleton className="h-3.5 w-14" />
                    </span>
                  </td>
                  <td className={cell}>
                    <span className="flex h-5 items-center">
                      <Skeleton className="h-3.5 w-32" />
                    </span>
                    <span className="mt-0.5 flex h-[19.5px] items-center">
                      <Skeleton className="h-3 w-20" />
                    </span>
                  </td>
                  <td className={cell}>
                    <span className="flex h-5 items-center">
                      <Skeleton className="h-3.5 w-20" />
                    </span>
                    <span className="mt-1 flex h-[19.5px] items-center">
                      <Skeleton className="h-3 w-28" />
                    </span>
                  </td>
                  <td className={cell} />
                </tr>
              ))
            : rows.map((row) => (
                <tr key={row.id} onClick={openRowFromClick} className="tanaw-row-link">
                  <th scope="row" className={cn(cell, "text-left font-normal")}>
                    <Link data-row-primary to={adminEnterpriseDetailsPath(row.id)} state={{ listSearch }} className="block text-base font-semibold">
                      {row.name}
                    </Link>
                    <span className="mt-0.5 line-clamp-2 block text-[13px] text-(--tanaw-text-secondary)">{[row.portfolio, row.address].filter(Boolean).join(". ") || "No address on record"}</span>
                  </th>
                  <td className={cell} data-cell="barangay" data-label="Barangay">
                    {row.barangay}
                  </td>
                  <td className={cn(cell, "tabular-nums")} data-cell="code" data-label="Attraction code">
                    {row.attractionCode ?? "—"}
                  </td>
                  <td className={cell} data-cell="category" data-label="Category">
                    <span className="block">{row.attractionCategory}</span>
                    {row.attractionType && <span className="mt-0.5 block text-[13px] text-(--tanaw-text-muted)">{row.attractionType}</span>}
                  </td>
                  <td className={cell} data-cell="cameras">
                    <span className="block font-semibold tabular-nums">{row.camera.cameraCount === null ? "Cameras unknown" : plural(row.camera.cameraCount, "camera")}</span>
                    <span className={cn("mt-1 flex items-start gap-1.5 text-[13px] font-semibold", statusColor[row.camera.state])}>
                      <span className="mt-0.5 shrink-0">{statusIcon[row.camera.state]}</span>
                      {row.camera.label}
                    </span>
                  </td>
                  <td className={cn(cell, "w-10 text-right align-middle")} data-cell="chevron">
                    <ChevronRight size={16} aria-hidden="true" className="tanaw-row-chevron ml-auto" />
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
      {!isLoading && rows.length === 0 && <div className="ae-fade border-b border-(--tanaw-border-soft)">{empty}</div>}
    </div>
  );
}
