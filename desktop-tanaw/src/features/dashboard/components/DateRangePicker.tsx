import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { DashboardRange } from "../types/dashboard";
import {
  addDays,
  CALENDAR_HISTORY_DAYS,
  MAX_RANGE_DAYS,
  monthGrid,
  monthTitle,
  normalizeRange,
  presetRange,
  RANGE_PRESETS,
  rangeLabel,
  rangeLength,
  shortDate,
  weekdayName,
  longDate,
} from "../utils/dashboard-range";

type Draft = DashboardRange & { picking: boolean };

const WEEKDAY_HEADINGS = [
  ["Su", "Sunday"],
  ["Mo", "Monday"],
  ["Tu", "Tuesday"],
  ["We", "Wednesday"],
  ["Th", "Thursday"],
  ["Fr", "Friday"],
  ["Sa", "Saturday"],
];

function monthOf(date: string) {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) - 1 };
}

function draftSummary(draft: Draft) {
  if (draft.picking) return `${shortDate(draft.from)} chosen. Pick an end date.`;
  if (draft.from === draft.to) return `${weekdayName(draft.from)}, ${longDate(draft.from)}`;
  return `${shortDate(draft.from)} to ${shortDate(draft.to)}, ${draft.to.slice(0, 4)} (${rangeLength(draft)} days)`;
}

export function DateRangePicker({ range, today, onChange }: { range: DashboardRange; today: string; onChange: (range: DashboardRange) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ ...range, picking: false });
  const [view, setView] = useState(() => monthOf(range.to));
  const [focusDate, setFocusDate] = useState(range.to);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const moveFocusToGrid = useRef(false);
  const dialogId = useId();
  const titleId = useId();
  const earliest = addDays(today, -CALENDAR_HISTORY_DAYS);

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };

  const openPicker = () => {
    setDraft({ ...range, picking: false });
    setView(monthOf(range.to));
    setFocusDate(range.to);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    // The checked range takes focus; with a custom range, the group's tab stop does.
    const root = rootRef.current;
    (root?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? root?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]'))?.focus({ preventScroll: true });
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || !moveFocusToGrid.current) return;
    moveFocusToGrid.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${focusDate}"]`)?.focus({ preventScroll: true });
  }, [focusDate, open, view]);

  const disabledReason = (date: string) => {
    if (date > today) return "future";
    if (date < earliest) return "history";
    if (draft.picking && Math.abs(rangeLength({ from: date < draft.from ? date : draft.from, to: date < draft.from ? draft.from : date })) > MAX_RANGE_DAYS) return "length";
    return null;
  };

  const pickDate = (date: string) => {
    if (disabledReason(date)) return;
    setFocusDate(date);
    setDraft((current) => (current.picking ? { ...normalizeRange(current.from, date), preset: "custom", picking: false } : { from: date, to: date, preset: "custom", picking: true }));
  };

  const shiftMonth = (delta: number) => {
    setView((current) => {
      const next = new Date(Date.UTC(current.year, current.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  };

  const firstOfView = `${view.year}-${String(view.month + 1).padStart(2, "0")}-01`;
  const lastOfView = addDays(`${new Date(Date.UTC(view.year, view.month + 1, 1)).toISOString().slice(0, 10)}`, -1);
  const canPrev = firstOfView > earliest;
  const canNext = lastOfView < today;
  const low = draft.from <= draft.to ? draft.from : draft.to;
  const high = draft.from <= draft.to ? draft.to : draft.from;
  // The grid's one tab stop is always a day that can be chosen: the focused day if it can, else the
  // enabled day nearest today (or the month's end), so a keyboard user can always reach the grid.
  const enabledDays = monthGrid(view.year, view.month)
    .flat()
    .filter((date): date is string => Boolean(date) && !disabledReason(date!));
  const anchor = Date.parse(today < lastOfView ? today : lastOfView);
  const gridTabStop = enabledDays.includes(focusDate)
    ? focusDate
    : enabledDays.reduce<string | null>((best, date) => (best === null || Math.abs(Date.parse(date) - anchor) < Math.abs(Date.parse(best) - anchor) ? date : best), null);

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(event.key in steps)) return;
    event.preventDefault();
    let next = addDays(focusDate, steps[event.key]);
    if (next > today) next = today;
    if (next < earliest) next = earliest;
    moveFocusToGrid.current = true;
    setFocusDate(next);
    setView(monthOf(next));
  };

  const choosePreset = (id: (typeof RANGE_PRESETS)[number]["id"]) => {
    const next = presetRange(id, today);
    setDraft({ ...next, picking: false });
    setView(monthOf(next.to));
    setFocusDate(next.to);
  };

  const onPresetKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const current = radios.indexOf(document.activeElement as HTMLButtonElement);
    const last = radios.length - 1;
    const targets: Record<string, number> = {
      ArrowDown: current >= last ? 0 : current + 1,
      ArrowRight: current >= last ? 0 : current + 1,
      ArrowUp: current <= 0 ? last : current - 1,
      ArrowLeft: current <= 0 ? last : current - 1,
      Home: 0,
      End: last,
    };
    if (!(event.key in targets) || current < 0) return;
    event.preventDefault();
    const target = targets[event.key];
    choosePreset(RANGE_PRESETS[target].id);
    radios[target].focus();
  };

  const onDialogKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"])'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dash-date" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="dash-date-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={`Dashboard date range: ${rangeLabel(range, today)}`}
        onClick={() => (open ? close() : openPicker())}
      >
        <CalendarDays size={20} aria-hidden="true" />
        <span>{rangeLabel(range, today)}</span>
        <ChevronDown size={18} aria-hidden="true" className="dash-date-chevron" />
      </button>
      {open && (
        <div id={dialogId} className="dash-date-popover" role="dialog" aria-modal="false" aria-labelledby={titleId} onKeyDown={onDialogKey}>
          <h2 id={titleId} className="sr-only">
            Choose the dates to show
          </h2>
          <div className="dash-date-body">
            {/* A radio group: one tab stop (the chosen range), arrow keys and Home/End move the choice. */}
            <div className="dash-date-presets" role="radiogroup" aria-label="Quick ranges" onKeyDown={onPresetKey}>
              {RANGE_PRESETS.map((preset, position) => {
                const selected = draft.preset === preset.id;
                const tabStop = selected || (position === 0 && !RANGE_PRESETS.some((item) => item.id === draft.preset));
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={tabStop ? 0 : -1}
                    className="dash-date-preset"
                    onClick={() => choosePreset(preset.id)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <div className="dash-calendar">
              <div className="dash-calendar-head">
                <button type="button" className="dash-calendar-nav" aria-label="Previous month" disabled={!canPrev} onClick={() => shiftMonth(-1)}>
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <span className="dash-calendar-title" aria-live="polite">
                  {monthTitle(view.year, view.month)}
                </span>
                <button type="button" className="dash-calendar-nav" aria-label="Next month" disabled={!canNext} onClick={() => shiftMonth(1)}>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="dash-calendar-weekdays" aria-hidden="true">
                {WEEKDAY_HEADINGS.map(([short, long]) => (
                  <abbr key={long} title={long}>
                    {short}
                  </abbr>
                ))}
              </div>
              <div ref={gridRef} className="dash-calendar-grid" role="group" aria-label={`Days of ${monthTitle(view.year, view.month)}`} onKeyDown={onGridKey}>
                {monthGrid(view.year, view.month).flatMap((week, row) =>
                  week.map((date, column) => {
                    if (!date) return <span key={`blank-${row}-${column}`} className="dash-day dash-day-blank" aria-hidden="true" />;
                    const reason = disabledReason(date);
                    const inRange = date >= low && date <= high;
                    const classes = ["dash-day"];
                    if (inRange) classes.push("dash-day-in");
                    if (date === low) classes.push("dash-day-start");
                    if (date === high) classes.push("dash-day-end");
                    if (date === today) classes.push("dash-day-today");
                    const tabStop = date === gridTabStop;
                    return (
                      <button
                        key={date}
                        type="button"
                        data-date={date}
                        className={classes.join(" ")}
                        disabled={Boolean(reason)}
                        tabIndex={tabStop ? 0 : -1}
                        aria-pressed={date === low || date === high}
                        aria-current={date === today ? "date" : undefined}
                        aria-label={`${weekdayName(date)}, ${longDate(date)}${reason === "future" ? ", not yet counted" : ""}`}
                        onClick={() => pickDate(date)}
                        onFocus={() => setFocusDate(date)}
                      >
                        <span>{Number(date.slice(8, 10))}</span>
                      </button>
                    );
                  }),
                )}
              </div>
            </div>
          </div>
          <div className="dash-date-foot">
            <p className="dash-date-draft" aria-live="polite">
              {draftSummary(draft)}
            </p>
            <div className="dash-date-actions">
              <button type="button" className="dash-button dash-button-quiet" onClick={() => close()}>
                Cancel
              </button>
              <button
                type="button"
                className="dash-button dash-button-primary"
                disabled={draft.picking}
                onClick={() => {
                  onChange({ from: low, to: high, preset: draft.preset });
                  close();
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
