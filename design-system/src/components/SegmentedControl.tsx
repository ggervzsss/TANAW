import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";

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
 * with an optional count. Sentence case. The selected choice fills with Civic Green.
 */
export function SegmentedControl({ options, value, onChange, ariaLabel, size = "md", className }: SegmentedControlProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

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
    <div role="radiogroup" aria-label={ariaLabel} className={cn("tanaw-segmented inline-flex max-w-full flex-wrap items-center gap-1", className)}>
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
              "inline-flex items-center gap-2 rounded-full font-bold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
              selected ? "bg-(--tanaw-action) text-(--tanaw-on-action) shadow-tanaw-resting" : "text-(--tanaw-text-secondary) hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text)",
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={cn("rounded-full px-1.5 text-xs tabular-nums", selected ? "bg-white/20 text-(--tanaw-on-action)" : "bg-(--tanaw-surface-subtle) text-(--tanaw-text-muted)")}>{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
