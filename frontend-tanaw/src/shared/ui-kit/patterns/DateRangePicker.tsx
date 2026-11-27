import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "../lib/cn";
import {
  DATE_RANGE_PRESETS,
  calendarDays,
  customRange,
  formatRangeLabel,
  formatRangeText,
  monthTitle,
  parseIsoDate,
  presetRange,
  rangeNote,
  toIsoDate,
  type DateRange,
  type DateRangePreset,
} from "../lib/dateRange";
import { useExclusivePopupDismissal } from "../lib/popup-dismissal";

export type DateRangePickerProps = {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** Accessible name of the popover, such as "Choose a date range for Most Visited". */
  ariaLabel: string;
  /** "pill" for compact headings, "field" for toolbars beside other 44px fields. */
  variant?: "pill" | "field";
  /** A visible label above a field trigger. */
  label?: string;
  /** Presets to offer; all five by default. */
  presets?: readonly DateRangePreset[];
  /** Today's date; days after it cannot be picked. */
  today?: Date;
  /** Override the trigger text, for example "October 2026" for a reporting month. */
  triggerLabel?: string;
  align?: "left" | "right";
  className?: string;
};

type Draft = { range: DateRange; picking: string | null };

/**
 * A date range popover: quick ranges on the left, a month calendar on the right, and Cancel / Apply.
 * Nothing changes until Apply. Escape or an outside click cancels.
 */
export function DateRangePicker({ value, onChange, ariaLabel, variant = "pill", label, presets, today: todayProp, triggerLabel, align = "right", className }: DateRangePickerProps) {
  const [now] = useState(() => new Date());
  const today = todayProp ?? now;
  const todayIso = toIsoDate(today);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ range: value, picking: null });
  const [view, setView] = useState(() => monthOf(value.end));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const labelId = useId();
  const presetOptions = DATE_RANGE_PRESETS.filter((preset) => !presets || presets.includes(preset.value));

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  useExclusivePopupDismissal(open, close, triggerRef, panelRef);

  const openPicker = () => {
    setDraft({ range: value, picking: null });
    setView(monthOf(value.end));
    setOpen(true);
  };

  const choosePreset = (preset: DateRangePreset) => {
    const range = preset === "custom" ? { ...draft.range, preset } : presetRange(preset, today, preset === "month" ? view : undefined);
    setDraft({ range, picking: null });
    if (preset !== "month" && preset !== "custom") setView(monthOf(range.end));
  };

  const moveMonth = (step: number) => {
    const next = new Date(view.year, view.monthIndex + step, 1);
    const nextView = { year: next.getFullYear(), monthIndex: next.getMonth() };
    setView(nextView);
    if (draft.range.preset === "month") setDraft({ range: presetRange("month", today, nextView), picking: null });
  };

  const pickDay = (iso: string) => {
    if (draft.picking) setDraft({ range: customRange(draft.picking, iso), picking: null });
    else setDraft({ range: { preset: "custom", start: iso, end: iso }, picking: iso });
  };

  const apply = () => {
    onChange(draft.range);
    close();
  };

  const canGoNext = new Date(view.year, view.monthIndex + 1, 1) <= today;
  const range = draft.range;
  const days = calendarDays(view.year, view.monthIndex);

  return (
    <div className={cn("relative", className)}>
      {label && (
        <span id={labelId} className="mb-1.5 block text-xs font-semibold text-(--tanaw-text-secondary)">
          {label}
        </span>
      )}
      <button
        ref={triggerRef}
        type="button"
        data-exclusive-popup-trigger
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={label ? `${labelId} ${titleId}-value` : undefined}
        onClick={() => (open ? close() : openPicker())}
        className={cn(
          "tanaw-picker-trigger inline-flex max-w-full items-center gap-2 border font-medium text-(--tanaw-text) outline-none transition-[border-color,background-color,box-shadow,scale] duration-200 ease-tanaw-out focus-visible:border-(--tanaw-accent-ink) focus-visible:shadow-(--tanaw-field-ring) active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100",
          variant === "pill"
            ? "h-9 max-w-60 rounded-full border-transparent bg-(--tanaw-control-bg) px-3.5 text-[0.8125rem] hover:bg-(--tanaw-control-bg-hover)"
            : "h-11 w-full min-w-56 rounded-tanaw-md border-(--tanaw-control-border) bg-(--tanaw-control-bg) px-3.5 text-sm hover:border-(--tanaw-control-border-hover) hover:bg-(--tanaw-control-bg-hover)",
          open && "border-(--tanaw-accent-ink) bg-(--tanaw-control-bg-focus) shadow-(--tanaw-field-ring)",
        )}
      >
        <CalendarDays size={16} className="shrink-0 text-(--tanaw-accent-ink)" aria-hidden="true" />
        <span id={`${titleId}-value`} className="min-w-0 flex-1 truncate text-left">
          {triggerLabel ?? formatRangeLabel(value)}
        </span>
        <ChevronDown size={15} className={cn("tanaw-select-chevron shrink-0 text-(--tanaw-text-muted)", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={ariaLabel}
          className={cn(
            "tanaw-enter absolute top-full z-1100 mt-2 w-[min(29.5rem,calc(100vw-2rem))] rounded-tanaw-lg border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) p-3.5 text-(--tanaw-text) shadow-tanaw-dialog",
            align === "right" ? "right-0" : "left-0",
          )}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <div className="grid grid-cols-[7.75rem_minmax(0,1fr)] gap-3.5 max-sm:grid-cols-1">
            <div className="flex flex-col gap-1 border-r border-(--tanaw-border-soft) pr-3 max-sm:flex-row max-sm:flex-wrap max-sm:border-r-0 max-sm:pr-0" role="group" aria-label="Quick ranges">
              {presetOptions.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  aria-pressed={range.preset === preset.value}
                  onClick={() => choosePreset(preset.value)}
                  className={cn(
                    "h-9 rounded-lg px-2.5 text-left text-[0.84375rem] font-semibold transition-colors",
                    range.preset === preset.value ? "bg-(--tanaw-action) text-(--tanaw-on-action)" : "text-(--tanaw-text-secondary) hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text)",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)} className={navButtonClass}>
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <p className="font-display text-[1.0625rem] font-bold" aria-live="polite">
                  {monthTitle(view.year, view.monthIndex)}
                </p>
                <button type="button" aria-label="Next month" disabled={!canGoNext} onClick={() => moveMonth(1)} className={navButtonClass}>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="grid grid-cols-7 text-center text-xs font-semibold text-(--tanaw-text-muted)" aria-hidden="true">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                  <span key={day} className="py-1">
                    {day}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-0.5" role="group" aria-label={monthTitle(view.year, view.monthIndex)}>
                {days.map((cell) => {
                  const disabled = !cell.inMonth || cell.iso > todayIso;
                  const isEdge = cell.iso === range.start || cell.iso === range.end;
                  const inBand = cell.iso > range.start && cell.iso < range.end && cell.inMonth;
                  const roundStart = inBand && (cell.weekday === 0 || cell.day === 1);
                  const roundEnd = inBand && (cell.weekday === 6 || cell.iso === toIsoDate(new Date(view.year, view.monthIndex + 1, 0)));
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      disabled={disabled}
                      aria-pressed={!disabled && (isEdge || inBand)}
                      aria-label={parseIsoDate(cell.iso).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                      onClick={() => pickDay(cell.iso)}
                      className={cn(
                        "h-9 text-[0.84375rem] font-semibold tabular-nums transition-shadow",
                        disabled && "cursor-default text-(--tanaw-interactive-disabled-text) opacity-70",
                        !disabled && !isEdge && "rounded-lg hover:shadow-[inset_0_0_0_1.5px_var(--tanaw-action)]",
                        inBand && "rounded-none bg-(--tanaw-range-band)",
                        roundStart && "rounded-l-lg",
                        roundEnd && "rounded-r-lg",
                        isEdge && cell.inMonth && "rounded-lg bg-(--tanaw-action) text-(--tanaw-on-action)",
                        cell.iso === todayIso && !isEdge && "rounded-lg shadow-[inset_0_0_0_1.5px_var(--tanaw-action)]",
                      )}
                    >
                      {cell.inMonth ? cell.day : ""}
                    </button>
                  );
                })}
              </div>
              {draft.picking && (
                <p className="mt-1.5 text-xs font-semibold text-(--tanaw-accent-ink)" role="status">
                  Now select an end date
                </p>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-(--tanaw-border-soft) pt-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Showing {formatRangeText(range)}</p>
              <p className="mt-0.5 text-xs text-(--tanaw-text-muted)">{rangeNote(range, today)}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => close()} className="h-9 rounded-full border border-(--tanaw-border) px-4 text-sm font-semibold hover:bg-(--tanaw-control-hover)">
                Cancel
              </button>
              <button type="button" onClick={apply} className="h-9 rounded-full bg-(--tanaw-action) px-4 text-sm font-semibold text-(--tanaw-on-action) hover:bg-(--tanaw-action-hover)">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const navButtonClass =
  "grid size-8.5 place-items-center rounded-[9px] border border-(--tanaw-border) text-(--tanaw-text-secondary) hover:bg-(--tanaw-control-hover) disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

function monthOf(iso: string) {
  const date = parseIsoDate(iso);
  return { year: date.getFullYear(), monthIndex: date.getMonth() };
}
