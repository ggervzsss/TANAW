import { Info } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { TrafficPoint } from "../types/dashboard";
import { PLOT_TOP, SHADE_LEVELS, trafficGeometry } from "../utils/traffic";
import { TrafficChartLoading } from "./DashboardSkeleton";
import { useSkeletonReveal } from "../../../ui-kit/lib/skeleton";

type ChartProps = {
  points: TrafficPoint[];
  busiest: number;
  summary: string | null;
  /** Key of the period still in progress (today's current two hours), if any. */
  inProgressKey: string | null;
  /** Today: the chart follows the cameras live and the line is live occupancy, not peak occupancy. */
  isLive: boolean;
  loading: boolean;
  unavailable: boolean;
};

/** The plot fills the height the dashboard leaves it; this is the least it draws at. */
const MIN_PLOT_HEIGHT = 96;
const AXIS_GUTTER = 70;
/** Room on the left for the occupancy scale, when the line is drawn. */
const OCCUPANCY_GUTTER = 56;
const count = (value: number) => Math.round(value).toLocaleString("en-US");
/** Axis numbers stay short: 4,000, then 12K once they pass ten thousand. */
const axisCount = (value: number) => (value >= 10_000 ? `${Math.round(value / 1000)}K` : count(value));

/** A period can be compared with its usual when it has counts and a usual value. */
const comparable = (point: TrafficPoint) => point.entries !== null && point.usual !== null;
/** The shades bars take, lightest first. */
const SHADES = Array.from({ length: SHADE_LEVELS }, (_, level) => level + 1);

/** Where the arrow keys start when nothing is highlighted: the busiest period, else the latest with counts. */
function defaultIndex(points: TrafficPoint[], busiest: number) {
  if (busiest >= 0) return busiest;
  for (let i = points.length - 1; i >= 0; i--) if (points[i].entries !== null) return i;
  return 0;
}

/** How a period compares with its usual. Only the screen reader hears it; the label beside the bar leaves it out. */
function describe(point: TrafficPoint, inProgress: boolean) {
  if (point.entries === null) return "The cameras were not counting then";
  if (!point.usual) return "Usual counts appear after two weeks of counting";
  if (inProgress) return point.usual.typical < 1 ? "In progress. Usually quiet at this time" : `In progress. About ${count(point.usual.typical)} is usual for the whole period`;
  const diff = point.entries - point.usual.typical;
  // A percentage of a tiny usual count misleads; small periods show the difference in entries only.
  const percent = point.usual.typical >= 10 ? Math.round((diff / point.usual.typical) * 100) : null;
  if (Math.round(Math.abs(diff)) === 0 || (percent !== null && Math.abs(percent) < 3)) return "About the same as usual";
  return `${count(Math.abs(diff))} ${diff > 0 ? "more" : "fewer"} than usual${percent === null ? "" : ` (${diff > 0 ? "+" : ""}${percent}%)`}`;
}

/** What a screen reader hears for the period the arrow keys reach; the visible label beside it is hidden from it. */
function spoken(point: TrafficPoint, busiest: boolean, occupancyName: string, comparison: string) {
  const figures = point.entries === null ? "not counted" : `${count(point.entries)} entries${point.occupancy !== null ? `, ${count(point.occupancy)} ${occupancyName}` : ""}`;
  const usual = point.usual ? ` Usual range ${count(point.usual.low)} to ${count(point.usual.high)} entries.` : "";
  return `${point.period}${busiest ? ", busiest" : ""}: ${figures}. ${comparison}.${usual}`;
}

/** The label beside a period: its width, and the height of one of its lines, for keeping it inside the plot. */
const HOVER_WIDTH = 220;
const HOVER_LINE = 22;

export function VisitorTrafficChart({ points, busiest, summary, inProgressKey, isLive, loading, unavailable }: ChartProps) {
  /** The line's name for one period: live now for the period in progress today, else its peak. */
  const occupancyName = (item: TrafficPoint) => (isLive && item.key === inProgressKey ? "live occupancy" : "peak occupancy");
  const headingId = useId();
  const announceId = useId();
  const clipId = useId().replace(/:/g, "");
  const areaRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const width = size.width;
  // A period is read only while the pointer rests on it, or while the arrow keys hold it and the
  // chart has focus. Nothing stays picked. Both are kept by key, so a new period starting today
  // leaves the highlight where it was.
  const [pointedKey, setPointedKey] = useState<string | null>(null);
  const [keyedKey, setKeyedKey] = useState<string | null>(null);
  const [intro, setIntro] = useState(true);
  // The summary and the plot fade in where their placeholders stood.
  const reveal = useSkeletonReveal(loading);
  const pointedIndex = pointedKey === null ? -1 : points.findIndex((item) => item.key === pointedKey);
  const keyedIndex = keyedKey === null ? -1 : points.findIndex((item) => item.key === keyedKey);
  const index = pointedIndex >= 0 ? pointedIndex : keyedIndex;
  const active = index >= 0;
  const empty = !loading && (unavailable || points.every((item) => item.entries === null));
  const showPlot = !loading && !empty;
  const hasUsual = points.some(comparable);
  const showsRange = points.some((point) => point.usual !== null);
  const hasOccupancy = points.some((point) => point.occupancy !== null);
  // History can exist while none of the periods shown were counted (a camera added late today).
  const usualNote = hasUsual ? "" : points.some((point) => point.usual) ? "Usual counts show for the periods the cameras counted." : "Usual counts appear after two weeks of counting.";

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return undefined;
    const measure = () =>
      setSize((current) => (current.width === area.clientWidth && current.height === area.clientHeight ? current : { width: area.clientWidth, height: area.clientHeight }));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [showPlot]);

  useEffect(() => {
    if (!showPlot || !intro) return undefined;
    const timer = window.setTimeout(() => setIntro(false), 1600);
    return () => window.clearTimeout(timer);
  }, [intro, showPlot]);

  // A day shows two-hour periods (keys like "h8"); any other range shows one point a day.
  const single = points.length > 0 && points.every((item) => item.key.startsWith("h"));
  const geometry = useMemo(
    () => trafficGeometry(points, width, Math.max(MIN_PLOT_HEIGHT, size.height - PLOT_TOP - 2), AXIS_GUTTER, single, hasOccupancy ? OCCUPANCY_GUTTER : 0),
    [points, width, size.height, single, hasOccupancy],
  );
  // The Busiest tag sits over the taller of the bar and its occupancy dot.
  const markTop = (item: TrafficPoint) => Math.min(geometry.y(item.entries ?? 0), item.occupancy !== null ? geometry.yOccupancy(item.occupancy) : Infinity);

  const point = active ? (points[index] ?? null) : null;
  // The label beside a period names it and gives its two figures. It reads to the right of its bar,
  // or to the left near the chart's right edge, level with the top of the bar or the line,
  // whichever is higher.
  const hover = (() => {
    if (!point || point.entries === null) return null;
    const height = HOVER_LINE * (2 + (point.occupancy !== null ? 1 : 0));
    const at = geometry.x(index);
    const side = geometry.barWidth / 2 + 12;
    const right = at + side + HOVER_WIDTH <= geometry.left + geometry.plotWidth;
    const left = right ? at + side : Math.max(0, at - side - HOVER_WIDTH);
    const top = Math.max(0, Math.min(geometry.base - height, markTop(point) - 6));
    return { left, top, right, height };
  })();
  // The Busiest tag (about 80px wide, 30 to 8px above its bar) steps aside while the label covers it.
  const tagMeetsHover = (() => {
    if (!hover || busiest < 0 || points[busiest]?.entries === null) return false;
    const tagLeft = geometry.x(busiest) - 40;
    const tagTop = markTop(points[busiest]) - 30;
    return hover.left < tagLeft + 80 && tagLeft < hover.left + HOVER_WIDTH && hover.top < tagTop + 22 && tagTop < hover.top + hover.height;
  })();

  // Only the arrow keys speak: pointing shows the label, which a screen reader does not follow.
  const keyed = keyedIndex >= 0 ? points[keyedIndex] : null;
  const announcement = keyed ? spoken(keyed, keyedIndex === busiest, occupancyName(keyed), describe(keyed, keyed.key === inProgressKey)) : "";

  const step = points.length > 16 ? Math.ceil(points.length / 8) : 1;
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!points.length) return;
    if (event.key === "Escape") {
      if (!active) return;
      event.preventDefault();
      event.stopPropagation();
      setKeyedKey(null);
      setPointedKey(null);
      return;
    }
    // The first arrow press lands on the busiest period; after that the arrows step from the one shown.
    const from = active ? index : defaultIndex(points, busiest);
    const moves: Record<string, number> = { ArrowLeft: active ? from - 1 : from, ArrowRight: active ? from + 1 : from, Home: 0, End: points.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    // The keys take over from the pointer until it moves onto another period.
    setPointedKey(null);
    setKeyedKey(points[Math.max(0, Math.min(points.length - 1, moves[event.key]))]?.key ?? null);
  };

  return (
    <section className={`dash-traffic${intro ? " dash-intro" : ""}`} aria-labelledby={headingId}>
      <div className="dash-traffic-head">
        <div className="dash-section-head">
          <div className="dash-traffic-title">
            <h2 id={headingId} className="dash-section-title">
              Visitor Traffic
            </h2>
            {/* Today follows the cameras: the bars and the line move as new readings arrive. */}
            {isLive && !loading && !unavailable && (
              <span className="dash-live-tag">
                <span className="dash-live-pulse" aria-hidden="true" />
                Live
              </span>
            )}
          </div>
          {loading ? <span className="design-skeleton dash-line-skeleton" aria-hidden="true" /> : summary && <p className={reveal ? `dash-section-sub ${reveal}` : "dash-section-sub"}>{summary}</p>}
        </div>
        {showPlot && (
          <p id={announceId} className="sr-only" aria-live="polite" aria-atomic="true">
            {announcement}
          </p>
        )}
      </div>

      {loading ? (
        <TrafficChartLoading label="Loading visitor traffic" />
      ) : empty ? (
        <div className="dash-chart-empty" role="status">
          {unavailable ? "History unavailable. Check the local camera service." : "No observations available for this period."}
        </div>
      ) : (
        <div className={reveal ? `dash-chart-body ${reveal}` : "dash-chart-body"}>
          <div
            className={`dash-plot${active ? " dash-plot-active" : ""}`}
            tabIndex={0}
            role="group"
            aria-label="Visitor traffic chart. Use the left and right arrow keys, Home and End to read each period, and Escape to stop."
            aria-describedby={announceId}
            onKeyDown={onKey}
            onBlur={() => setKeyedKey(null)}
          >
            <div ref={areaRef} className="dash-plot-area" onPointerLeave={() => setPointedKey(null)}>
              {width > 0 && (
                <svg width={geometry.left + geometry.plotWidth} height={PLOT_TOP + geometry.plotHeight + 2} aria-hidden="true" className="dash-plot-svg">
                  <defs>
                    <clipPath id={clipId}>
                      <rect x={geometry.left - 20} y={0} width={geometry.plotWidth + 40} height={geometry.base} />
                    </clipPath>
                    {/* Each shade is full at the tip and softens toward the baseline. */}
                    {SHADES.map((level) => (
                      <linearGradient key={level} id={`${clipId}-${level}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" className={`dash-stop dash-stop-${level}`} />
                        <stop offset="1" className={`dash-stop dash-stop-${level} dash-stop-base`} />
                      </linearGradient>
                    ))}
                  </defs>
                  {geometry.ticks.map((tick) => (
                    <line key={tick} x1={geometry.left} x2={geometry.left + geometry.plotWidth} y1={geometry.y(tick)} y2={geometry.y(tick)} className={tick === 0 ? "dash-axis-base" : "dash-grid"} />
                  ))}
                  {point && <rect className="dash-guide" x={geometry.x(index) - 0.5} y={PLOT_TOP} width={1} height={geometry.plotHeight} style={{ x: geometry.x(index) - 0.5 }} />}
                  {/* Redesign 3: the usual range as a soft band behind the bars. */}
                  {geometry.band && <path d={geometry.band} className="dash-band" />}
                  <g clipPath={`url(#${clipId})`}>
                    {points.map((item, i) => {
                      // No entries, no bar: an empty period shows nothing that looks like data.
                      const level = item.entries === null ? 0 : geometry.shade(item.entries);
                      if (item.entries === null || level === 0) return null;
                      const top = geometry.y(item.entries);
                      // A rounded top; the overhang below the baseline is clipped, so the base stays square.
                      const radius = geometry.radius;
                      const live = item.key === inProgressKey;
                      const left = geometry.x(i) - geometry.barWidth / 2;
                      const height = Math.max(2, geometry.base - top) + radius;
                      const y = geometry.base - height + radius;
                      return (
                        <rect
                          key={item.key}
                          className={`dash-bar dash-bar-shade-${level}${live ? " dash-bar-live" : ""}${i === index ? " dash-bar-selected" : ""}`}
                          x={left}
                          y={y}
                          width={geometry.barWidth}
                          height={height}
                          rx={radius}
                          style={{ x: left, y, width: geometry.barWidth, height, fill: `url(#${clipId}-${level})`, animationDelay: intro ? `${Math.min(i * (points.length > 10 ? 12 : 45), 360)}ms` : undefined }}
                        />
                      );
                    })}
                  </g>
                  {/* Occupancy (visitors inside): a line over the bars with a halo in the page color.
                      Its shape is set through CSS so a new reading glides instead of jumping. */}
                  {geometry.occupancyLine && (
                    <>
                      <path d={geometry.occupancyLine} pathLength={1} className="dash-uline-halo" style={{ d: `path("${geometry.occupancyLine}")` }} />
                      <path d={geometry.occupancyLine} pathLength={1} className="dash-uline" style={{ d: `path("${geometry.occupancyLine}")` }} />
                    </>
                  )}
                  {points.map((item, i) => {
                    if (item.occupancy === null) return null;
                    const cx = geometry.x(i);
                    const cy = geometry.yOccupancy(item.occupancy);
                    const now = isLive && item.key === inProgressKey;
                    return (
                      <g key={`occupancy-${item.key}`}>
                        {now && <circle className="dash-udot-pulse" cx={cx} cy={cy} r={6} style={{ cx, cy }} />}
                        <circle
                          className={`dash-udot${i === index ? " dash-udot-on" : ""}${now ? " dash-udot-now" : ""}`}
                          cx={cx}
                          cy={cy}
                          r={i === index || now ? 6 : geometry.dense ? 2.5 : 4.5}
                          style={{ cx, cy }}
                        />
                      </g>
                    );
                  })}
                </svg>
              )}
              {width > 0 && busiest >= 0 && busiest !== index && points[busiest].entries !== null && !tagMeetsHover && (
                <span className="dash-peak-tag" style={{ left: geometry.x(busiest), top: markTop(points[busiest]) - 30 }}>
                  Busiest
                </span>
              )}
              {/* The period being read, beside it: its name and two figures, as keyed text with no box.
                  It shows only while a period is pointed at or keyed. */}
              {width > 0 && point && hover && (
                <span className={`dash-hover${hover.right ? "" : " dash-hover-left"}`} style={{ left: hover.left, top: hover.top, width: HOVER_WIDTH }} aria-hidden="true">
                  <span className="dash-hover-when">
                    {point.period}
                    {index === busiest && <em>Busiest</em>}
                  </span>
                  <span>
                    <i className="dash-key dash-key-shade" />
                    <b>{count(point.entries ?? 0)}</b> entries
                  </span>
                  {point.occupancy !== null && (
                    <span>
                      <i className="dash-key dash-key-uline">
                        <i />
                      </i>
                      <b>{count(point.occupancy)}</b> {occupancyName(point)}
                    </span>
                  )}
                </span>
              )}
              {/* One strip per period, for pointing; the arrow keys reach the same periods. */}
              {width > 0 &&
                points.map((item, i) => (
                  <span
                    key={item.key}
                    className="dash-hit"
                    style={{ left: geometry.left + geometry.slot * i, width: geometry.slot }}
                    aria-hidden="true"
                    onPointerEnter={() => setPointedKey(item.key)}
                  />
                ))}
              {/* Entries read on the right, visitors inside on the left; both scales share the gridlines. */}
              <div className="dash-y-labels" aria-hidden="true">
                <span className="dash-y-title" style={{ top: PLOT_TOP - 30 }}>
                  Entries
                </span>
                {geometry.ticks.map((tick) => (
                  <span key={tick} style={{ top: geometry.y(tick) - 10 }}>
                    {axisCount(tick)}
                  </span>
                ))}
              </div>
              {hasOccupancy && (
                <div className="dash-y-labels dash-y-labels-occupancy" aria-hidden="true" style={{ width: OCCUPANCY_GUTTER - 12 }}>
                  <span className="dash-y-title" style={{ top: PLOT_TOP - 30 }}>
                    Inside
                  </span>
                  {geometry.ticks.map((tick) => (
                    <span key={tick} style={{ top: geometry.y(tick) - 10 }}>
                      {axisCount(geometry.occupancyAt(tick))}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="dash-x-labels" aria-hidden="true" style={{ width: geometry.left + geometry.plotWidth }}>
              {points.map((item, i) => (
                <span
                  key={item.key}
                  className={i === index ? "dash-x-selected" : i % step === 0 && (!active || Math.abs(i - index) >= Math.min(step, 2)) ? "" : "dash-x-hidden"}
                  style={{ left: geometry.x(i) }}
                >
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          <div className="dash-chart-foot">
            <ul className="dash-legend" aria-label="Chart key">
              {/* Bars are entries; the deeper the green, the more people came in. */}
              <li className="dash-legend-group">
                <strong>Entries</strong>
                <span className="dash-key-ramp" aria-hidden="true">
                  {SHADES.map((level) => (
                    <i key={level} className={`dash-key-step-${level}`} />
                  ))}
                </span>
                <span className="dash-legend-ends">fewer to more</span>
              </li>
              <li>
                <span className="dash-key dash-key-uline" aria-hidden="true">
                  <i />
                </span>
                {isLive ? "Live occupancy" : "Peak occupancy"}
              </li>
              {showsRange && (
                <li>
                  <span className="dash-key dash-key-band" aria-hidden="true" />
                  Usual range
                </li>
              )}
            </ul>
            {/* Why the usual range is missing, while it is. The chart's own label tells keyboard users about the arrow keys. */}
            {usualNote && (
              <p className="dash-footnote">
                <Info size={15} aria-hidden="true" />
                <span>{usualNote}</span>
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
