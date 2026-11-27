import { AlertTriangle, CheckCircle2, Info, SearchX } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Alert, Button, EmptyState, PortalPageHeader, Skeleton, Tabs, cn } from "@/shared/ui-kit";
import { formatPhilippineDate } from "@/shared/utils/dateTime";
import { ConnectionTab } from "../components/ConnectionTab";
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
        <PortalPageHeader back={BACK} title={<span className="sr-only">Loading enterprise</span>} />
        <div role="status" aria-label="Loading enterprise">
          <Skeleton className="h-8 w-full max-w-md" />
          <Skeleton className="mt-3 h-4 w-full max-w-sm" />
          <div className="mt-6 flex gap-6 border-b border-(--tanaw-border-soft) pb-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="mt-6 grid grid-cols-4 border-y border-(--tanaw-border-soft) max-lg:grid-cols-2 max-sm:grid-cols-1">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="px-5 py-4 first:pl-0 max-lg:px-0">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="mt-2.5 h-4 w-32" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-8 h-5 w-40" />
          <Skeleton className="mt-4 h-14 w-full" />
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
