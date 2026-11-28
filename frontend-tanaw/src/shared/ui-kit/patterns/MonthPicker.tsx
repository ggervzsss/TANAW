import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import { MONTHS_LONG, MONTHS_SHORT, isMonthInRange, pickerMonthLabel, type PickerMonth } from "../lib/pickerMonth";
import { useExclusivePopupDismissal } from "../lib/popup-dismissal";

export type MonthPickerProps = {
  value: PickerMonth;
  onChange: (month: PickerMonth) => void;
  /** The control's name, such as "Reporting month", shown above it unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  /** Which edge of the control the dropdown lines up with. */
  align?: "left" | "right";
  /** The first and last months that can be chosen. */
  min?: PickerMonth | null;
  max?: PickerMonth | null;
  /** A month to mark in the grid, such as the month now due. */
  highlight?: PickerMonth | null;
  highlightLabel?: string;
  className?: string;
};

/**
 * Chooses one whole month from a dropdown showing a year of months, with arrows to change the year.
 * A choice applies at once; there is no day calendar or Apply. On phones the dropdown rises from the
 * bottom edge as a sheet (Controls.css, .tanaw-picker-panel).
 */
export function MonthPicker({ value, onChange, label, hideLabel = false, min, max, highlight, highlightLabel, align = "right", className }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(value.year);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const valueId = useId();

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  useExclusivePopupDismissal(open, close, triggerRef, panelRef);

  const canYearBack = !min || year > min.year;
  const canYearForward = !max || year < max.year;

  const openPanel = () => {
    setYear(value.year);
    setOpen(true);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>('[aria-current="true"], button:not(:disabled)')?.focus());
  };

  const choose = (month: PickerMonth) => {
    onChange(month);
    close();
  };

  // Arrow keys move between months in the grid (four to a row).
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
    const step = steps[event.key];
    if (step === undefined) return;
    const buttons = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    for (let position = index + step; position >= 0 && position < buttons.length; position += step) {
      if (!buttons[position].disabled) {
        buttons[position].focus();
        return;
      }
    }
  };

  return (
    <div className={cn("relative", className)}>
      <span id={labelId} className={hideLabel ? "sr-only" : "mb-1.5 block text-xs font-semibold text-(--tanaw-text-secondary)"}>
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        data-exclusive-popup-trigger
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => (open ? close() : openPanel())}
        className={cn(
          "tanaw-picker-trigger inline-flex h-11 w-full items-center gap-2 rounded-tanaw-md border border-(--tanaw-control-border) bg-(--tanaw-control-bg) px-3.5 text-sm font-medium text-(--tanaw-text) outline-none transition-[border-color,background-color,box-shadow,scale] duration-200 ease-tanaw-out hover:border-(--tanaw-control-border-hover) hover:bg-(--tanaw-control-bg-hover) focus-visible:border-(--tanaw-accent-ink) focus-visible:shadow-(--tanaw-field-ring) active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100",
          open && "border-(--tanaw-accent-ink) bg-(--tanaw-control-bg-focus) shadow-(--tanaw-field-ring)",
        )}
      >
        <CalendarDays size={16} className="shrink-0 text-(--tanaw-accent-ink)" aria-hidden="true" />
        <span id={valueId} className="min-w-0 flex-1 truncate text-left tabular-nums">
          {pickerMonthLabel(value)}
        </span>
        <ChevronDown size={15} className={cn("tanaw-select-chevron shrink-0 text-(--tanaw-text-muted)", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`Choose the ${label.toLowerCase()}`}
          className={cn("shadow-tanaw-dialog absolute top-full z-1100", align === "right" ? "right-0" : "left-0", "tanaw-picker-panel tanaw-enter mt-2 w-72 rounded-tanaw-lg border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) p-3.5 text-(--tanaw-text)")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <button type="button" aria-label="Previous year" disabled={!canYearBack} onClick={() => setYear(year - 1)} className={navButtonClass}>
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <p className="font-display text-[1.0625rem] font-bold tabular-nums" aria-live="polite">
              {year}
            </p>
            <button type="button" aria-label="Next year" disabled={!canYearForward} onClick={() => setYear(year + 1)} className={navButtonClass}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <div ref={gridRef} role="group" aria-label={`Months of ${year}`} className="grid grid-cols-4 gap-1.5" onKeyDown={moveFocus}>
            {MONTHS_SHORT.map((short, monthIndex) => {
              const month = { year, monthIndex };
              const selected = value.year === year && value.monthIndex === monthIndex;
              const marked = Boolean(highlight && highlight.year === year && highlight.monthIndex === monthIndex);
              return (
                <button
                  key={short}
                  type="button"
                  disabled={!isMonthInRange(month, min, max)}
                  aria-current={selected ? "true" : undefined}
                  aria-label={`${MONTHS_LONG[monthIndex]} ${year}${marked && highlightLabel ? `, ${highlightLabel}` : ""}`}
                  title={marked ? highlightLabel : undefined}
                  onClick={() => choose(month)}
                  className={cn(
                    "relative h-10 rounded-lg text-sm font-semibold transition-colors pointer-coarse:h-12 disabled:cursor-not-allowed disabled:text-(--tanaw-interactive-disabled-text) disabled:opacity-60",
                    selected ? "bg-(--tanaw-action) text-(--tanaw-on-action)" : "hover:bg-(--tanaw-control-hover) disabled:hover:bg-transparent",
                  )}
                >
                  {short}
                  {marked && <span aria-hidden="true" className={cn("absolute bottom-1 left-1/2 size-1.25 -translate-x-1/2 rounded-full", selected ? "bg-(--tanaw-on-action)" : "bg-(--tanaw-accent-ink)")} />}
                </button>
              );
            })}
          </div>
          {highlight && highlightLabel && (
            <p className="mt-3 flex items-center gap-2 border-t border-(--tanaw-border-soft) pt-2.5 text-xs text-(--tanaw-text-muted)">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-(--tanaw-accent-ink)" />
              {highlightLabel}: {pickerMonthLabel(highlight)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const navButtonClass =
  "grid size-8.5 place-items-center rounded-[9px] pointer-coarse:size-11 border border-(--tanaw-border) text-(--tanaw-text-secondary) hover:bg-(--tanaw-control-hover) disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
