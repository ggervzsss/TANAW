import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";

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
 * Arrow keys move between tabs. Render the matching panel with role="tabpanel".
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
              "relative -mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) disabled:cursor-not-allowed disabled:opacity-50",
              selected ? "border-(--tanaw-action) text-(--tanaw-accent-ink)" : "border-transparent text-(--tanaw-text-muted) hover:border-(--tanaw-border) hover:text-(--tanaw-text)",
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && (
              <span className={cn("rounded-full px-2 py-0.5 text-xs tabular-nums", selected ? "bg-(--tanaw-selected-bg)" : "bg-(--tanaw-surface-subtle)")}>{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
