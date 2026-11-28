import { motion } from "motion/react";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { easeOut } from "../lib/motion";
import { useScrollFade } from "../lib/scroll-fade";

function nextIndex(key: string, index: number, count: number): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export type SegmentedOption = { value: string; label: ReactNode; count?: number; disabled?: boolean };

export type SegmentedControlProps = {
  options: readonly SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
};

/**
 * A row of pill-shaped choices that filter one list ("Needs attention", "Escalated support"), each
 * with an optional count. Sentence case. The chosen pill takes the soft green tint, and the tint
 * glides from one choice to the next instead of jumping. On phones the row stays on one line and
 * scrolls sideways, its cut-off edge faded, keeping the chosen pill in view.
 */
export function SegmentedControl({ options, value, onChange, ariaLabel, size = "md", className }: SegmentedControlProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const groupRef = useRef<HTMLDivElement>(null);
  const indicatorId = useId();
  useScrollFade(groupRef, value);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const enabled = options.filter((option) => !option.disabled);
    const index = enabled.findIndex((option) => option.value === value);
    const next = event.key === "Home" || event.key === "End" ? null : nextIndex(event.key, index, enabled.length);
    if (next === null) return;
    event.preventDefault();
    const target = enabled[next];
    if (!target) return;
    onChange(target.value);
    refs.current[options.indexOf(target)]?.focus();
  };

  return (
    <div ref={groupRef} role="radiogroup" aria-label={ariaLabel} className={cn("tanaw-segmented tanaw-scroll-x inline-flex max-w-full flex-wrap items-center gap-1 max-sm:flex-nowrap max-sm:overflow-x-auto", className)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={onKeyDown}
            className={cn(
              "relative isolate inline-flex items-center gap-2 rounded-full font-semibold whitespace-nowrap transition-[color,background-color,scale] duration-200 ease-tanaw-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none",
              size === "sm" ? "px-3 py-1.5 text-[0.8125rem] pointer-coarse:min-h-11" : "px-4 py-2 text-sm pointer-coarse:min-h-11",
              "shrink-0",
              selected ? "text-(--tanaw-accent-ink)" : "text-(--tanaw-text-secondary) hover:bg-(--tanaw-control-bg) hover:text-(--tanaw-text)",
            )}
          >
            {selected && (
              <motion.span
                aria-hidden="true"
                layoutId={`${indicatorId}-segment`}
                data-segment-indicator
                className="absolute inset-0 -z-10 rounded-full bg-(--tanaw-selected-bg)"
                transition={{ duration: 0.24, ease: easeOut }}
              />
            )}
            {option.label}
            {option.count !== undefined && (
              <span className={cn("rounded-full px-1.5 text-xs tabular-nums", selected ? "bg-(--tanaw-accent-ink)/12 text-(--tanaw-accent-ink)" : "bg-(--tanaw-control-bg) text-(--tanaw-text-muted)")}>
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
