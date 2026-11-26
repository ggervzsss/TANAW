import { ChevronRight, SearchX, TriangleAlert } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useOperationalReports, useVisitorInsights, useVisitorRanking } from "@/app/hooks/useOperationalSync";
import { routes } from "@/app/routers/routes";
import { Alert, Button, DateRangePicker, EmptyState, PortalPageHeader, SegmentedControl, Skeleton, cn, initialsOf, parseIsoDate, toIsoDate, type DateRange } from "@/shared/ui-kit";
import { useEnterpriseDirectory, useNow } from "../hooks/useEnterpriseDirectory";
import { cameraWarning, formatSince, isSameDayAs, monitoredLocations, plural, type LocationState, type MonitoredLocation } from "../model/cameraStatus";
import type { EnterpriseRow } from "../model/enterpriseDirectory";
import {
  CAMERA_HISTORY_NOTE,
  cameraWindow,
  defaultTrendPeriod,
  emptyTrendMessage,
  isLiveRange,
  paramsWithRange,
  rangeFromParams,
  rangePhrase,
  rangeVisitors,
  trendPeriodFor,
  trendPeriodsFor,
  trendSource,
  trendTitle,
  windowText,
} from "../model/enterpriseRange";
import { busiestDay, busiestHour, dailyTrend, formatCount, hourlyTrend, monthlyTrend, trendNote, type Trend, type TrendPeriod } from "../model/enterpriseTrend";
import { TrendChart } from "../components/TrendChart";
import "../adminEnterprises.css";

const PERIOD_LABELS: Record<TrendPeriod, string> = { hourly: "Hourly", daily: "Daily", monthly: "Monthly" };

/** Where the back link returns: the list with the filters it had (passed as link state), or the plain list. */
function backTarget(state: unknown) {
  const search = state && typeof state === "object" && "listSearch" in state && typeof state.listSearch === "string" ? state.listSearch : "";
  return search ? `${routes.admin.enterprises}?${search}` : routes.admin.enterprises;
}

/*
 * Enterprise Details (/admin/enterprises/:enterpriseId), by the enterprise ID used on the map and
 * in reports. ?range=<preset>&from=&to= keeps a date range other than today (see
 * model/enterpriseRange.ts), and ?trend=daily|monthly keeps a trend period other than the range's
 * default.
 */
export function EnterpriseDetailsPage() {
  const { enterpriseId = "" } = useParams();
  const location = useLocation();
  const back = { to: backTarget(location.state), label: "Registered Enterprises", ariaLabel: "Back to Registered Enterprises" };
  const now = useNow();
  const directory = useEnterpriseDirectory(now);
  const row = directory.rows.find((item) => item.id === enterpriseId);

  if (directory.isLoading) {
    return (
      <div className="admin-enterprises w-full">
        <PortalPageHeader back={back} title={<span className="sr-only">Loading enterprise</span>} />
        <div role="status" aria-label="Loading enterprise" className="space-y-4">
          <Skeleton className="h-28 w-full max-w-2xl" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (directory.isError && directory.rows.length === 0) {
    return (
      <div className="admin-enterprises w-full">
        <PortalPageHeader back={back} title="Enterprise Details" />
        <Alert
          tone="danger"
          title="This enterprise could not be loaded"
          action={
            <Button size="sm" variant="secondary" onClick={directory.refetch}>
              Try again
            </Button>
          }
        >
          Check the connection to the TANAW server, then try again.
        </Alert>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="admin-enterprises w-full">
        <PortalPageHeader back={back} title="Enterprise not found" />
        <EmptyState
          icon={<SearchX size={22} />}
          title="No registered enterprise has this ID"
          description="The enterprise may have been deactivated, or the link is out of date."
          action={
            <Link to={routes.admin.enterprises} className="font-semibold text-(--tanaw-accent-ink) underline underline-offset-4">
              Go to Registered Enterprises
            </Link>
          }
          className="border-y border-(--tanaw-border-soft)"
        />
      </div>
    );
  }

  return <EnterpriseDetails row={row} now={now} back={back} />;
}

function EnterpriseDetails({ row, now, back }: { row: EnterpriseRow; now: Date; back: { to: string; label: string; ariaLabel: string } }) {
  const [params, setParams] = useSearchParams();
  // Keep the link state (the list's filters) when the range or trend period changes the address.
  const { state: linkState } = useLocation();
  const todayIso = toIsoDate(now);
  const today = useMemo(() => parseIsoDate(todayIso), [todayIso]);
  const range = useMemo(() => rangeFromParams(params, today), [params, today]);
  const live = isLiveRange(range, today);
  const oneDay = range.start === range.end;
  const history = useMemo(() => cameraWindow(range, today), [range, today]);
  const period = trendPeriodFor(params.get("trend"), range, today);
  const periodOptions = trendPeriodsFor(range).map((value) => ({ value, label: PERIOD_LABELS[value] }));

  // Camera counts for the range (by hour for one day, by day otherwise), clipped to camera history.
  const insights = useVisitorInsights({ start: range.start, end: range.end, enterpriseId: row.id }, history !== null);
  // Visitor totals for a past range; today's total is the live count from the map.
  const ranking = useVisitorRanking({ start: range.start, end: range.end }, !live);
  const reports = useOperationalReports();

  const hourly = useMemo(() => (history && oneDay ? hourlyTrend(insights.data, trendTitle("hourly", range, today)) : null), [history, oneDay, insights.data, range, today]);
  const daily = useMemo(() => (history && !oneDay ? dailyTrend(insights.data, history) : null), [history, oneDay, insights.data]);
  const trend = useMemo(() => (period === "monthly" ? monthlyTrend(reports.data ?? [], row.id, range) : period === "daily" ? daily : hourly), [period, reports.data, row.id, range, daily, hourly]);
  const trendQuery = period === "monthly" ? reports : insights;
  const trendLoading = trendQuery.isPending && (period === "monthly" || history !== null);

  const locations = monitoredLocations(row.map, now);
  const phrase = rangePhrase(range, today);

  const changeRange = (next: DateRange) => setParams(paramsWithRange(params, next, today), { replace: true, state: linkState });
  const changePeriod = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === defaultTrendPeriod(range, today)) next.delete("trend");
    else next.set("trend", value);
    setParams(next, { replace: true, state: linkState });
  };

  return (
    <div className="admin-enterprises w-full">
      <PortalPageHeader
        back={back}
        title={row.name}
        description={row.address ?? `Barangay ${row.barangay}, San Pedro, Laguna`}
        leading={<EnterprisePhoto name={row.name} />}
        actions={<DateRangePicker value={range} onChange={changeRange} today={today} variant="pill" ariaLabel={`Choose a date range for ${row.name}`} />}
      >
        <Tags row={row} now={now} />
      </PortalPageHeader>

      <Figures
        row={row}
        now={now}
        locations={locations}
        live={live}
        phrase={phrase}
        total={live ? null : ranking.isPending ? "loading" : ranking.isError ? "error" : rangeVisitors(ranking.data, row.id)}
        busiest={<Busiest oneDay={oneDay} history={history} phrase={phrase} trend={oneDay ? hourly : daily} loading={history !== null && insights.isPending} failed={insights.isError} />}
      />

      <div className="mt-6.5 grid grid-cols-[minmax(0,1fr)_20rem] gap-x-10 gap-y-8 max-[1100px]:grid-cols-1">
        <section aria-labelledby="trend-title" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div>
              <h2 id="trend-title" className="font-display text-[1.375rem] font-bold text-(--tanaw-text)">
                {trend?.title ?? trendTitle(period, range, today)}
              </h2>
              <p className="mt-0.5 text-[13px] text-(--tanaw-text-muted)">{trendCaption(trend, trendSource(period, range, today))}</p>
            </div>
            {periodOptions.length > 1 && <SegmentedControl ariaLabel="Trend period" className="ae-trend-period" options={periodOptions} value={period} onChange={changePeriod} />}
          </div>
          {trendLoading ? (
            <Skeleton className="mt-4.5 h-62.5 w-full" label="Loading trend" />
          ) : trendQuery.isError ? (
            <p role="alert" className="mt-4.5 flex min-h-40 items-center border-b border-(--tanaw-border-soft) text-sm text-(--tanaw-text-secondary)">
              The trend could not be loaded. It will try again shortly.
            </p>
          ) : (
            <TrendChart trend={trend} empty={emptyTrendMessage(period, range, today)} />
          )}
        </section>

        <MonitoredLocations row={row} locations={locations} live={live} />
      </div>
    </div>
  );
}

function trendCaption(trend: Trend | null, source: string) {
  const note = trend ? trendNote(trend) : null;
  return note ? `${note}. ${source}` : source;
}

function EnterprisePhoto({ name }: { name: string }) {
  return (
    <span
      role="img"
      aria-label={`${name}: no photo on record`}
      className="grid h-28 w-42 shrink-0 place-items-center rounded-xl border border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) text-center text-(--tanaw-accent-ink) max-sm:hidden"
    >
      <span>
        <span className="block font-display text-[1.625rem] font-bold">{initialsOf(name)}</span>
        <span className="mt-0.5 block text-[11.5px] text-(--tanaw-text-muted)">Enterprise photo</span>
      </span>
    </span>
  );
}

const tagClass = "inline-flex min-h-6 items-center gap-1.5 rounded-full border border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) px-2.5 text-[12.5px] font-semibold text-(--tanaw-text-secondary)";

function Tags({ row, now }: { row: EnterpriseRow; now: Date }) {
  const warning = cameraWarning(row.map, now);
  const registered = row.registeredAt ? new Date(row.registeredAt) : null;
  const connection = connectionTag(row);
  return (
    <p className="mt-2.5 flex flex-wrap gap-1.5">
      <span className={cn(tagClass, connection.text)}>
        <span aria-hidden="true" className={cn("h-1.75 w-1.75 rounded-full", connection.dot)} />
        {connection.label}
      </span>
      {warning && (
        <span className={cn(tagClass, "border-transparent bg-(--tanaw-st-missing-bg) text-(--tanaw-st-missing)")}>
          <TriangleAlert size={13} aria-hidden="true" />
          {warning}
        </span>
      )}
      <span className={tagClass}>{row.attractionCategory}</span>
      {row.attractionType && <span className={tagClass}>{row.attractionType}</span>}
      {registered && !Number.isNaN(registered.getTime()) && (
        <span className={tagClass}>Registered {registered.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
      )}
    </p>
  );
}

function connectionTag(row: EnterpriseRow) {
  if (!row.map) return { label: "Camera status unavailable", text: "", dot: "bg-(--tanaw-text-muted)" };
  if (row.map.gatewayStatus === "Connected") return { label: "Online", text: "text-(--tanaw-accent-ink)", dot: "bg-(--tanaw-live)" };
  if (row.map.gatewayStatus === "Sync Delayed") return { label: "Updates delayed", text: "text-(--tanaw-warn-ink)", dot: "bg-(--tanaw-warn-ink)" };
  return { label: "Offline", text: "text-(--tanaw-danger)", dot: "bg-(--tanaw-danger)" };
}

type RangeTotal = ReturnType<typeof rangeVisitors> | "loading" | "error" | null;

function Figures({
  row,
  now,
  locations,
  live,
  phrase,
  total,
  busiest,
}: {
  row: EnterpriseRow;
  now: Date;
  locations: MonitoredLocation[];
  /** True for today; otherwise the live figures are marked "Now" beside the range's figures. */
  live: boolean;
  phrase: string;
  /** The range's visitor total, or null for today (read live from the map instead). */
  total: RangeTotal;
  busiest: ReactNode;
}) {
  const { camera, map } = row;
  const notCounting = locations.filter((location) => location.needsIt);
  const connected = map?.gatewayStatus === "Connected";
  const since = formatSince(map?.lastSync, now);

  const camerasValue = camera.cameraCount === null ? "—" : `${camera.runningCount}/${camera.cameraCount}`;
  const camerasShort = camera.cameraCount !== null && camera.cameraCount > 0 && camera.runningCount < camera.cameraCount;
  const camerasNote =
    camera.state === "offline"
      ? camera.label
      : camera.state === "unconfigured"
        ? "No cameras set up"
        : camera.state === "unknown"
          ? "Not on the monitoring list"
          : notCounting.length === 1
            ? `${notCounting[0]?.name} not counting`
            : notCounting.length > 1
              ? `${plural(notCounting.length, "camera")} not counting`
              : camera.state === "issue"
                ? camera.label
                : "Every camera is counting";

  // The count is today's only when the last update arrived today; an older one is not shown as today's.
  const visitors = map?.estimatedUniqueCount;
  const visitorsValue = visitors !== null && visitors !== undefined && isSameDayAs(map?.lastSync, now) ? formatCount(visitors) : "—";
  const visitorsNote =
    visitorsValue === "—"
      ? "No camera updates today"
      : !connected
        ? `Last updated ${since}`
        : notCounting.length > 0
          ? `${notCounting.length === 1 ? notCounting[0]?.name : plural(notCounting.length, "camera")} not counted right now`
          : null;

  const occupancy = map?.totalLiveOccupancy;

  return (
    <dl className="mt-6 grid grid-cols-4 border-y border-(--tanaw-border-soft) max-[1100px]:grid-cols-2 max-sm:grid-cols-1">
      <Figure index={0} title="Cameras" sub="online right now" now={!live} value={camerasValue} valueClass={camerasShort ? "text-(--tanaw-st-missing)" : undefined} note={camerasNote} noteClass={camerasShort || camera.state === "offline" ? "font-semibold text-(--tanaw-st-missing)" : undefined} />
      {total === null ? (
        <Figure index={1} title="Visitors today" sub="estimated unique visitors" value={visitorsValue} note={visitorsNote} />
      ) : (
        <Figure
          index={1}
          title="Visitors"
          sub={`estimated unique visitors ${phrase}`}
          value={total === "loading" ? <Skeleton className="h-8.5 w-28" label="Loading visitors" /> : total === "error" || total.value === null ? "—" : formatCount(total.value)}
          note={total === "loading" ? null : total === "error" ? "Visitor totals could not be loaded" : total.note}
        />
      )}
      <Figure index={2} title="Live occupancy" sub="visitors inside now" now={!live} value={occupancy === null || occupancy === undefined ? "—" : formatCount(occupancy)} note={occupancy === null || occupancy === undefined ? "Shown while the enterprise is online" : null} />
      {busiest}
    </dl>
  );
}

/** The busiest hour of one day, or the busiest day of a longer range, from camera counts. */
function Busiest({ oneDay, history, phrase, trend, loading, failed }: { oneDay: boolean; history: ReturnType<typeof cameraWindow>; phrase: string; trend: Trend | null; loading: boolean; failed: boolean }) {
  const best = trend ? (oneDay ? busiestHour(trend) : busiestDay(trend)) : null;
  const value = best ? ("hour" in best ? best.hour : best.weekday) : "—";
  const sub = oneDay ? `most visitors inside at once ${phrase}` : history?.clipped ? `most visitors, ${windowText(history)}` : `most visitors ${phrase}`;
  const note = !history ? CAMERA_HISTORY_NOTE : failed ? "Camera counts could not be loaded" : (best?.note ?? (oneDay ? `No camera counts ${phrase}` : "Not enough daily counts yet"));
  return (
    <Figure
      index={3}
      title={oneDay ? "Busiest hour" : "Busiest day"}
      sub={sub}
      value={loading ? <Skeleton className="h-8.5 w-28" label={oneDay ? "Loading busiest hour" : "Loading busiest day"} /> : value}
      note={loading ? null : note}
    />
  );
}

/** Rules between the four figures: one row of four, two rows of two at 1100px, one column on phones. */
function figureRuleClass(index: number) {
  return cn(
    "border-(--tanaw-border-soft) px-6 py-4.5 max-sm:border-l-0 max-sm:px-0",
    index === 0 ? "pl-0" : "border-l max-sm:border-t",
    index === 2 && "max-[1100px]:border-l-0 max-[1100px]:pl-0",
    index >= 2 && "max-[1100px]:border-t",
  );
}

function Figure({
  index,
  title,
  sub,
  now,
  value,
  valueClass,
  note,
  noteClass,
}: {
  index: number;
  title: string;
  sub: string;
  /** Mark a live figure "Now" while a past range is shown. */
  now?: boolean;
  value: ReactNode;
  valueClass?: string;
  note?: ReactNode;
  noteClass?: string;
}) {
  return (
    <div className={cn("min-w-0", figureRuleClass(index))}>
      <dt>
        <span className="flex items-center gap-2 text-sm font-bold text-(--tanaw-text)">
          {title}
          {now && <span className="inline-flex min-h-5 items-center rounded-full border border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) px-2 text-[11.5px] font-semibold text-(--tanaw-accent-ink)">Now</span>}
        </span>
        <span className="block text-xs text-(--tanaw-text-muted)">{sub}</span>
      </dt>
      <dd>
        <div className={cn("mt-2.5 font-display text-[2.125rem] leading-none font-bold text-(--tanaw-text) tabular-nums", valueClass)}>{value}</div>
        {note && <p className={cn("mt-1.5 text-xs text-(--tanaw-text-muted)", noteClass)}>{note}</p>}
      </dd>
    </div>
  );
}

const locationColor: Record<LocationState, { text: string; dot: string }> = {
  monitoring: { text: "text-(--tanaw-accent-ink)", dot: "bg-(--tanaw-live)" },
  starting: { text: "text-(--tanaw-warn-ink)", dot: "bg-(--tanaw-warn-ink)" },
  stopped: { text: "text-(--tanaw-st-missing)", dot: "bg-(--tanaw-st-missing)" },
  failing: { text: "text-(--tanaw-st-missing)", dot: "bg-(--tanaw-st-missing)" },
  offline: { text: "text-(--tanaw-st-missing)", dot: "bg-(--tanaw-st-missing)" },
};

function MonitoredLocations({ row, locations, live }: { row: EnterpriseRow; locations: MonitoredLocation[]; live: boolean }) {
  const empty =
    row.camera.state === "unknown"
      ? "Camera details appear once this enterprise is on the monitoring list."
      : row.camera.state === "unconfigured"
        ? "No cameras are set up at this enterprise."
        : row.camera.cameraCount
          ? `${plural(row.camera.cameraCount, "camera")} reported. The enterprise desktop has not sent camera names yet.`
          : "No camera details received yet.";
  return (
    <section aria-labelledby="locations-title" className="min-w-0 border-l border-(--tanaw-border-soft) pl-10 max-[1100px]:border-t max-[1100px]:border-l-0 max-[1100px]:pt-6 max-[1100px]:pl-0">
      <h2 id="locations-title" className="font-display text-[1.375rem] font-bold text-(--tanaw-text)">
        Monitored Locations
      </h2>
      <p className="mt-0.5 text-[13px] text-(--tanaw-text-muted)">{live ? "Cameras at this enterprise." : "Cameras at this enterprise, as they are now."}</p>
      {locations.length === 0 ? (
        <p className="mt-3 border-y border-(--tanaw-border-soft) py-3 text-sm text-(--tanaw-text-secondary)">{empty}</p>
      ) : (
        <ul className="mt-3 text-sm">
          {locations.map((location) => (
            <li key={location.id} className="border-b border-(--tanaw-border-soft) py-3">
              <span className="flex justify-between gap-3">
                <span className="min-w-0 font-semibold wrap-break-word text-(--tanaw-text)">{location.name}</span>
                <span className={cn("inline-flex shrink-0 items-center gap-1.5 font-semibold", locationColor[location.state].text)}>
                  <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", locationColor[location.state].dot)} />
                  {location.label}
                </span>
              </span>
              {location.note && location.state !== "monitoring" && <span className="mt-1 block text-[12.5px] text-(--tanaw-text-secondary)">{location.note}</span>}
              {location.needsIt && (
                <Link
                  to={routes.admin.requests}
                  aria-label={`Message IT about ${location.name}`}
                  className="mt-1.5 inline-flex items-center gap-0.5 text-[13px] font-semibold text-(--tanaw-accent-ink) no-underline hover:underline"
                >
                  Message IT about this camera <ChevronRight size={14} aria-hidden="true" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
