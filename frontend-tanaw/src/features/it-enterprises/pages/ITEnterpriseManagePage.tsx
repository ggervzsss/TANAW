import { AlertTriangle, CheckCircle2, Info, SearchX } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Alert, Button, EmptyState, PortalPageHeader, Skeleton, Tabs, cn } from "@/shared/ui-kit";
import { formatPhilippineDate } from "@/shared/utils/dateTime";
import { CameraRowsSkeleton, ConnectionTab } from "../components/ConnectionTab";
import { DetailsTab } from "../components/DetailsTab";
import { HoursTab } from "../components/HoursTab";
import { toneText } from "../components/tones";
import { useDisplayFormats } from "../hooks/useEnterpriseRows";
import { useManagedEnterprise } from "../hooks/useManagedEnterprise";
import { placeLine, statusLine, type DisplayFormats, type EnterpriseRow } from "../model/enterprises";
import { ENTERPRISES_PATH, parseManageTab, type ManageTab } from "../model/paths";
import "../itEnterprises.css";

const TABS: { value: ManageTab; label: string }[] = [
  { value: "connection", label: "Connection" },
  { value: "details", label: "Details and account" },
  { value: "hours", label: "Opening hours" },
];

const BACK = { to: ENTERPRISES_PATH, label: "Enterprises", ariaLabel: "Back to Enterprises" };

/*
 * Manage an enterprise (/it/enterprises/:enterpriseId), by enterprise ID or account ID.
 * ?tab=connection|details|hours keeps the open tab.
 */
export function ITEnterpriseManagePage() {
  const { enterpriseId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = parseManageTab(params.get("tab"));
  const formats = useDisplayFormats();
  const { row, isLoading, notFound, isError, refetch, setAccount } = useManagedEnterprise(enterpriseId);

  if (notFound) {
    return (
      <div className="it-enterprises w-full">
        <PortalPageHeader back={BACK} title="Enterprise not found" />
        <EmptyState
          icon={<SearchX size={22} />}
          title="This enterprise is not registered"
          description="The link may be old, or the enterprise ID may be mistyped."
          action={
            <Link
              to={ENTERPRISES_PATH}
              className="rounded-tanaw-md ease-tanaw-out inline-flex h-10.5 items-center bg-(--tanaw-control-bg) px-4.5 text-sm font-semibold text-(--tanaw-text) no-underline transition-[background-color,translate,scale] duration-200 hover:-translate-y-px hover:bg-(--tanaw-control-bg-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:translate-y-0 active:scale-[0.97] motion-reduce:transition-colors motion-reduce:hover:translate-y-0"
            >
              Go to Enterprises
            </Link>
          }
        />
      </div>
    );
  }

  if (isError && !row) {
    return (
      <div className="it-enterprises w-full">
        <PortalPageHeader back={BACK} title="Manage an enterprise" />
        <Alert
          tone="danger"
          title="This enterprise could not be loaded"
          action={
            <Button size="sm" variant="secondary" onClick={refetch}>
              Try again
            </Button>
          }
        >
          Check the connection to the TANAW server, then try again.
        </Alert>
      </div>
    );
  }

  if (isLoading || !row) {
    return (
      <div className="it-enterprises w-full">
        {/* The page in its own shape: the title and lede in their line heights, the tabs, then the Connection tab's facts and cameras. */}
        <PortalPageHeader
          back={BACK}
          className="mb-4"
          title={
            <>
              <span className="sr-only">Loading enterprise</span>
              <Skeleton className="inline-block h-[0.8em] w-md max-w-full align-middle" />
            </>
          }
          description={<Skeleton className="inline-block h-4 w-sm max-w-full align-middle" />}
          actions={<Skeleton className="h-4 w-48" />}
        />
        <div role="status" aria-label="Loading enterprise">
          <div aria-hidden="true" className="flex gap-1 border-b border-(--tanaw-border-soft)">
            {["w-24", "w-36", "w-28"].map((width) => (
              <span key={width} className="flex h-5 box-content items-center px-4 pt-2.5 pb-3.5">
                <Skeleton className={cn("h-3.5", width)} />
              </span>
            ))}
          </div>
          <div aria-hidden="true" className={cn("pt-6", tab !== "connection" && "hidden")}>
            <div className="grid grid-cols-4 border-y border-(--tanaw-border-soft) max-lg:grid-cols-2 max-sm:grid-cols-1 lg:[&>div+div]:border-l lg:[&>div+div]:border-(--tanaw-border-soft)">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="min-w-0 px-5 py-4 first:pl-0 max-lg:px-0 max-lg:py-3">
                  <span className="flex h-5 items-center">
                    <Skeleton className="h-3 w-28" />
                  </span>
                  <span className="mt-1 flex h-6 items-center">
                    <Skeleton className="h-4 w-32" />
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-8">
              <span className="flex h-6 items-center">
                <Skeleton className="h-4.5 w-40" />
              </span>
              <span className="mt-1 flex h-5 items-center">
                <Skeleton className="h-3 w-56" />
              </span>
              <div className="mt-2 border-t border-(--tanaw-border-soft)">
                <CameraRowsSkeleton />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const selectTab = (next: string) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next === "connection") updated.delete("tab");
        else updated.set("tab", next);
        return updated;
      },
      { replace: true },
    );

  return (
    <div className="it-enterprises w-full">
      <PortalPageHeader back={BACK} title={row.name} description={headerLine(row, formats)} actions={<StatusLine row={row} />} className="mb-4" />
      <Tabs items={TABS} value={tab} onChange={selectTab} ariaLabel="Enterprise sections" idPrefix="ite" />
      <div key={tab} role="tabpanel" id={`ite-panel-${tab}`} aria-labelledby={`ite-tab-${tab}`} className="ite-panel pt-6">
        {tab === "connection" && <ConnectionTab row={row} formats={formats} />}
        {tab === "details" && <DetailsTab key={row.id} row={row} formats={formats} onAccountUpdated={setAccount} />}
        {tab === "hours" && <HoursTab key={row.id} row={row} formats={formats} onAccountUpdated={setAccount} />}
      </div>
    </div>
  );
}

/** "Park or open area · Brgy. San Antonio · Registered Mar 3, 2026". */
function headerLine(row: EnterpriseRow, { dateFormat }: DisplayFormats) {
  return `${placeLine(row)} · Registered ${formatPhilippineDate(row.account.createdAt, dateFormat)}`;
}

function StatusLine({ row }: { row: EnterpriseRow }) {
  const status = statusLine(row);
  const Icon = status.tone === "ok" ? CheckCircle2 : status.tone === "muted" ? Info : AlertTriangle;
  return (
    <p role="status" className={cn("inline-flex items-center gap-2 text-sm font-semibold", toneText[status.tone])}>
      <Icon size={16} aria-hidden="true" />
      {status.text}
    </p>
  );
}
