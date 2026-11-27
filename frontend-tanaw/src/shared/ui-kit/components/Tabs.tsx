import { motion } from "motion/react";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { easeOut } from "../lib/motion";

function nextIndex(key: string, index: number, count: number): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export type TabItem = { value: string; label: ReactNode; icon?: ReactNode; count?: number; disabled?: boolean };

export type TabsProps = {
  items: readonly TabItem[];
  value: string;
  onChange: (value: string) => void;
  /** Names the tab list for screen readers. */
  ariaLabel: string;
  /** Prefix for tab and panel ids, so a panel can use aria-labelledby={`${idPrefix}-tab-${value}`}. */
  idPrefix?: string;
  className?: string;
};

/**
 * Underlined tabs that switch between views of one page ("Create reports", "Reports history").
 * The green underline glides to the chosen tab. Arrow keys move between tabs. Render the matching
 * panel with role="tabpanel".
 */
export function Tabs({ items, value, onChange, ariaLabel, idPrefix, className }: TabsProps) {
  const generated = useId();
  const prefix = idPrefix ?? generated;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = items.filter((item) => !item.disabled);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = enabled.findIndex((item) => item.value === value);
    const next = event.key === "ArrowDown" || event.key === "ArrowUp" ? null : nextIndex(event.key, index, enabled.length);
    if (next === null) return;
    event.preventDefault();
    const target = enabled[next];
    if (!target) return;
    onChange(target.value);
    refs.current[items.indexOf(target)]?.focus();
  };

  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("tanaw-tabs flex gap-1 overflow-x-auto border-b border-(--tanaw-border-soft)", className)}>
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            id={`${prefix}-tab-${item.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${prefix}-panel-${item.value}`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            onKeyDown={onKeyDown}
            className={cn(
              "group relative inline-flex shrink-0 items-center gap-2 px-4 pt-2.5 pb-3.5 text-sm font-semibold whitespace-nowrap transition-colors duration-150 ease-tanaw-out focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) disabled:cursor-not-allowed disabled:opacity-50",
              selected ? "text-(--tanaw-accent-ink)" : "text-(--tanaw-text-muted) hover:text-(--tanaw-text)",
            )}
          >
            {/* A quiet tint behind the label on hover, inside the tab padding. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-1 top-1 bottom-2 rounded-tanaw-md bg-(--tanaw-control-bg) opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-disabled:opacity-0"
            />
            <span className="relative inline-flex items-center gap-2">
              {item.icon}
              {item.label}
              {item.count !== undefined && (
                <span className={cn("rounded-full px-2 py-0.5 text-xs tabular-nums", selected ? "bg-(--tanaw-selected-bg)" : "bg-(--tanaw-control-bg)")}>{item.count}</span>
              )}
            </span>
            {selected && (
              <motion.span
                aria-hidden="true"
                layoutId={`${generated}-tab-indicator`}
                data-tab-indicator
                className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-(--tanaw-action)"
                transition={{ duration: 0.24, ease: easeOut }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
