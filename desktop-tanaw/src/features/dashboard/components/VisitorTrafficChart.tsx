import { ArrowDown, ArrowUp, Info } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { TrafficPoint } from "../types/dashboard";
import { PLOT_TOP, trafficGeometry } from "../utils/traffic";

type ChartProps = {
  points: TrafficPoint[];
  busiest: number;
  summary: string | null;
  /** Key of the period still in progress (today's current two hours), if any. */
  inProgressKey: string | null;
  /** A short note for periods that leave out a camera, e.g. "Leaves out the Parking Area". */
  partialNote: (point: TrafficPoint) => string | null;
  footnote: string | null;
  loading: boolean;
  unavailable: boolean;
};

/** The plot fills the height the dashboard leaves it; this is the least it draws at. */
const MIN_PLOT_HEIGHT = 96;
const AXIS_GUTTER = 70;
const count = (value: number) => Math.round(value).toLocaleString("en-US");
/** Axis numbers stay short: 4,000, then 12K once they pass ten thousand. */
const axisCount = (value: number) => (value >= 10_000 ? `${Math.round(value / 1000)}K` : count(value));

/** A period can be compared with its usual when it has counts and a usual value. */
const comparable = (point: TrafficPoint) => point.entries !== null && point.usual !== null;

/** The period shown when nothing is picked: the busiest, else the latest with counts. */
function defaultIndex(points: TrafficPoint[], busiest: number) {
  if (busiest >= 0) return busiest;
  for (let i = points.length - 1; i >= 0; i--) if (points[i].entries !== null) return i;
  return 0;
}

function describe(point: TrafficPoint, inProgress: boolean) {
  if (point.later) return { text: point.usual && point.usual.typical >= 1 ? `Later today. About ${count(point.usual.typical)} is usual` : "Later today", tone: "" };
  if (point.entries === null) return { text: "The cameras were not counting then", tone: "" };
  if (!point.usual) return { text: "Usual counts appear after two weeks of counting", tone: "" };
  if (inProgress) return { text: point.usual.typical < 1 ? "In progress. Usually quiet at this time" : `In progress. About ${count(point.usual.typical)} is usual for the whole period`, tone: "" };
  const diff = point.entries - point.usual.typical;
  // A percentage of a tiny usual count misleads; small periods show the difference in entries only.
  const percent = point.usual.typical >= 10 ? Math.round((diff / point.usual.typical) * 100) : null;
  if (Math.round(Math.abs(diff)) === 0 || (percent !== null && Math.abs(percent) < 3)) return { text: "About the same as usual", tone: "" };
  return {
    text: `${count(Math.abs(diff))} ${diff > 0 ? "more" : "fewer"} than usual${percent === null ? "" : ` (${diff > 0 ? "+" : ""}${percent}%)`}`,
    tone: diff > 0 ? " dash-cmp-up" : " dash-cmp-down",
  };
}

export function VisitorTrafficChart({ points, busiest, summary, inProgressKey, partialNote, footnote, loading, unavailable }: ChartProps) {
  const headingId = useId();
  const readoutId = useId();
  const clipId = useId().replace(/:/g, "");
  const areaRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const width = size.width;
  const [selected, setSelected] = useState<{ signature: string; index: number } | null>(null);
  const [intro, setIntro] = useState(true);
  const signature = points.map((point) => point.key).join("|");
  const index = selected?.signature === signature && selected.index < points.length ? selected.index : defaultIndex(points, busiest);
  const empty = !loading && (unavailable || points.every((item) => item.entries === null));
  const showPlot = !loading && !empty;
  const hasUsual = points.some(comparable);
  const showsRange = points.some((point) => point.usual !== null);
  // History can exist while none of the periods shown were counted (a camera added late today).
  const usualNote = hasUsual ? "" : points.some((point) => point.usual) ? "Usual counts show for the periods the cameras counted. " : "Usual counts appear after two weeks of counting. ";

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
    () => trafficGeometry(points, width, Math.max(MIN_PLOT_HEIGHT, size.height - PLOT_TOP - 2), AXIS_GUTTER, single),
    [points, width, size.height, single],
  );
  // The bubble and the Busiest tag sit over the taller of the bar and its usual tick.
  const markTop = (item: TrafficPoint) => Math.min(geometry.y(item.entries ?? 0), item.usual ? geometry.y(item.usual.typical) : Infinity);
  // The Busiest tag (about 72px wide, 30 to 8px above its bar) steps aside while the value bubble
  // (about 60px wide, 34 to 10px above the bar being read) would cover it.
  const tagMeetsBubble = (() => {
    const selectedPoint = points[index];
    if (busiest < 0 || !selectedPoint || selectedPoint.entries === null || points[busiest]?.entries === null) return false;
    // The bubble's span follows the same rule that shifts it at the chart's two ends.
    const at = geometry.x(index);
    const [bubbleLeft, bubbleRight] = at < 60 ? [at - 14, at + 46] : at > geometry.plotWidth - 60 ? [at - 46, at + 14] : [at - 30, at + 30];
    const tagLeft = geometry.x(busiest) - 40;
    const tagRight = geometry.x(busiest) + 40;
    const tagTop = markTop(points[busiest]) - 30;
    const bubbleTop = markTop(selectedPoint) - 34;
    return bubbleLeft < tagRight && tagLeft < bubbleRight && Math.abs(tagTop - bubbleTop) < 24;
  })();

  const point = points[index] ?? null;
  const inProgress = point?.key === inProgressKey;
  const readout = point ? describe(point, inProgress) : null;
  const note = point && point.entries !== null ? partialNote(point) : null;

  const step = points.length > 16 ? Math.ceil(points.length / 8) : 1;
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: points.length - 1 };
    if (!(event.key in moves) || !points.length) return;
    event.preventDefault();
    setSelected({ signature, index: Math.max(0, Math.min(points.length - 1, moves[event.key])) });
  };

  return (
    <section className={`dash-traffic${intro ? " dash-intro" : ""}`} aria-labelledby={headingId}>
      {/* The selected period reads beside the title, so the plot keeps the height below. */}
      <div className="dash-traffic-head">
        <div className="dash-section-head">
          <h2 id={headingId} className="dash-section-title">
            Visitor Traffic
          </h2>
          {loading ? <span className="design-skeleton dash-line-skeleton" aria-hidden="true" /> : summary && <p className="dash-section-sub">{summary}</p>}
        </div>
        {loading && <span className="design-skeleton dash-readout-skeleton" aria-hidden="true" />}
        {showPlot && point && readout && (
          <div id={readoutId} className="dash-readout" aria-live="polite" aria-atomic="true">
            <p className="dash-readout-when">
              {point.period}
              {index === busiest && <span className="dash-tag">Busiest</span>}
            </p>
            {point.entries === null ? (
              <p className="dash-readout-value dash-readout-none">{point.later ? "Not yet" : "No count"}</p>
            ) : (
              <p className="dash-readout-value">
                {count(point.entries)}
                <span>entries</span>
              </p>
            )}
            <p className={`dash-cmp${readout.tone}`}>
              {readout.tone === " dash-cmp-up" && <ArrowUp size={16} aria-hidden="true" />}
              {readout.tone === " dash-cmp-down" && <ArrowDown size={16} aria-hidden="true" />}
              {readout.text}
              {note && <span className="dash-read-note">{note}</span>}
            </p>
            {/* The lane shows this visually; screen readers hear it with the period. */}
            {point.occupancy !== null && <span className="sr-only">{`, up to ${count(point.occupancy)} visitors inside`}</span>}
          </div>
        )}
      </div>

      {loading ? (
        <div className="dash-chart-loading" aria-busy="true" aria-label="Loading visitor traffic">
          <div className="dash-chart-skeleton">
            {[38, 52, 64, 72, 86, 100, 80].map((height, i) => (
              <span key={height} className="design-skeleton" style={{ height: `${height}%`, animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
        </div>
      ) : empty ? (
        <div className="dash-chart-empty" role="status">
          {unavailable ? "History unavailable. Check the local camera service." : "No observations available for this period."}
        </div>
      ) : (
        <div className="dash-chart-body">
          <div
            className="dash-plot"
            tabIndex={0}
            role="group"
            aria-label="Visitor traffic chart. Use the left and right arrow keys to move between periods."
            aria-describedby={readoutId}
            onKeyDown={onKey}
          >
            <div ref={areaRef} className="dash-plot-area">
              {width > 0 && (
                <svg width={geometry.plotWidth} height={PLOT_TOP + geometry.plotHeight + 2} aria-hidden="true" className="dash-plot-svg">
                  <defs>
                    <clipPath id={clipId}>
                      <rect x={-20} y={0} width={geometry.plotWidth + 40} height={geometry.base} />
                    </clipPath>
                    {/* Each state's green is full at the tip and softens toward the baseline. */}
                    {(["above", "within", "below"] as const).map((state) => (
                      <linearGradient key={state} id={`${clipId}-${state}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" className={`dash-stop dash-stop-${state}`} />
                        <stop offset="1" className={`dash-stop dash-stop-${state} dash-stop-base`} />
                      </linearGradient>
                    ))}
                  </defs>
                  {geometry.ticks.map((tick) => (
                    <line key={tick} x1={0} x2={geometry.plotWidth} y1={geometry.y(tick)} y2={geometry.y(tick)} className={tick === 0 ? "dash-axis-base" : "dash-grid"} />
                  ))}
                  {point && <rect className="dash-guide" x={geometry.x(index) - 0.5} y={PLOT_TOP} width={1} height={geometry.plotHeight} style={{ x: geometry.x(index) - 0.5 }} />}
                  {/* Redesign 3: the usual range as a soft band behind the bars. */}
                  {geometry.band && <path d={geometry.band} className="dash-band" />}
                  <g clipPath={`url(#${clipId})`}>
                    {points.map((item, i) => {
                      if (item.entries === null) return null;
                      const top = geometry.y(item.entries);
                      // A rounded top; the overhang below the baseline is clipped, so the base stays square.
                      const radius = geometry.radius;
                      // A period still in progress cannot be below usual yet.
                      const live = item.key === inProgressKey;
                      const state = !item.usual ? "within" : item.entries > item.usual.high ? "above" : item.entries < item.usual.low && !live ? "below" : "within";
                      const left = geometry.x(i) - geometry.barWidth / 2;
                      const height = Math.max(2, geometry.base - top) + radius;
                      const y = geometry.base - height + radius;
                      return (
                        <rect
                          key={item.key}
                          className={`dash-bar dash-bar-${state}${live ? " dash-bar-live" : ""}${i === index ? " dash-bar-selected" : ""}`}
                          x={left}
                          y={y}
                          width={geometry.barWidth}
                          height={height}
                          rx={radius}
                          style={{ x: left, y, width: geometry.barWidth, height, fill: `url(#${clipId}-${state})`, animationDelay: `${Math.min(i * (points.length > 10 ? 12 : 45), 360)}ms` }}
                        />
                      );
                    })}
                  </g>
                  {/* The usual count for each period: a line over the bars with a halo in the page color. */}
                  {geometry.usualLine && (
                    <>
                      <path d={geometry.usualLine} pathLength={1} className="dash-uline-halo" />
                      <path d={geometry.usualLine} pathLength={1} className="dash-uline" />
                    </>
                  )}
                  {points.map((item, i) =>
                    item.usual ? (
                      <circle
                        key={`usual-${item.key}`}
                        className={`dash-udot${i === index ? " dash-udot-on" : ""}`}
                        cx={geometry.x(i)}
                        cy={geometry.y(item.usual.typical)}
                        r={i === index ? 6 : geometry.dense ? 2.5 : 4.5}
                        style={{ cx: geometry.x(i), cy: geometry.y(item.usual.typical) }}
                      />
                    ) : null,
                  )}
                </svg>
              )}
              {width > 0 && busiest >= 0 && busiest !== index && points[busiest].entries !== null && !tagMeetsBubble && (
                <span className="dash-peak-tag" style={{ left: geometry.x(busiest), top: markTop(points[busiest]) - 30 }}>
                  Busiest
                </span>
              )}
              {width > 0 && point && point.entries !== null && (
                <span
                  className={`dash-bubble${geometry.x(index) < 60 ? " dash-bubble-start" : geometry.x(index) > geometry.plotWidth - 60 ? " dash-bubble-end" : ""}`}
                  style={{ left: geometry.x(index), top: markTop(point) - 10 }}
                  aria-hidden="true"
                >
                  {count(point.entries)}
                </span>
              )}
              {width > 0 &&
                points.map((item, i) => (
                  <button
                    key={item.key}
                    type="button"
                    tabIndex={-1}
                    className="dash-hit"
                    style={{ left: geometry.slot * i, width: geometry.slot }}
                    aria-label={`${item.period}: ${item.later ? "later today" : item.entries === null ? "not counted" : `${count(item.entries)} entries`}${item.occupancy !== null ? `, up to ${count(item.occupancy)} visitors inside` : ""}${item.usual ? `, usual about ${count(item.usual.typical)} entries (${count(item.usual.low)} to ${count(item.usual.high)})` : ""}`}
                    aria-pressed={i === index}
                    onPointerEnter={() => setSelected({ signature, index: i })}
                    onClick={() => setSelected({ signature, index: i })}
                  />
                ))}
              <div className="dash-y-labels" aria-hidden="true">
                {geometry.ticks.map((tick) => (
                  <span key={tick} style={{ top: geometry.y(tick) - 10 }}>
                    {axisCount(tick)}
                  </span>
                ))}
              </div>
            </div>
            <div className="dash-x-labels" aria-hidden="true" style={{ width: geometry.plotWidth }}>
              {points.map((item, i) => (
                <span
                  key={item.key}
                  className={i === index ? "dash-x-selected" : i % step === 0 && Math.abs(i - index) >= Math.min(step, 2) ? (item.later ? "dash-x-later" : "") : "dash-x-hidden"}
                  style={{ left: geometry.x(i) }}
                >
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          <div className="dash-chart-foot">
            <ul className="dash-legend" aria-label="Chart key">
              {hasUsual ? (
                <>
                  <li>
                    <span className="dash-key dash-key-above" aria-hidden="true" />
                    Above usual
                  </li>
                  <li>
                    <span className="dash-key dash-key-within" aria-hidden="true" />
                    Within usual
                  </li>
                  <li>
                    <span className="dash-key dash-key-below" aria-hidden="true" />
                    Below usual
                  </li>
                </>
              ) : (
                <li>
                  <span className="dash-key dash-key-within" aria-hidden="true" />
                  Entries
                </li>
              )}
              {showsRange && (
                <>
                  <li>
                    <span className="dash-key dash-key-uline" aria-hidden="true">
                      <i />
                    </span>
                    Usual for this day
                  </li>
                  <li>
                    <span className="dash-key dash-key-band" aria-hidden="true" />
                    Usual range
                  </li>
                </>
              )}
            </ul>
            <p className="dash-footnote">
              <Info size={15} aria-hidden="true" />
              {/* A note about the counts takes the place of the pointing hint; the chart's own label
                  still tells keyboard users about the arrow keys. */}
              <span>{[footnote, usualNote.trim(), footnote ? null : "Point to a period or use the arrow keys."].filter(Boolean).join(" ")}</span>
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
