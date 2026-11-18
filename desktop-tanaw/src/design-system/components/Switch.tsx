/*
 * GENERATED FILE. Do not edit; change design-system/src/components/Switch.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: b79fbaf3f977de6dfc94312df7c64daa34919229132ccf3c56b4c509cd5c9bbf
 */
import { useId, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Always required. Shown beside the switch unless hideLabel is set. */
  label: string;
  description?: ReactNode;
  /** Keeps the label for screen readers only, for switches inside tables or rows with their own text. */
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
};

function Track({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200",
        checked ? "border-(--tanaw-action) bg-(--tanaw-action)" : "border-slate-300 bg-slate-200 dark:border-slate-500 dark:bg-slate-600",
      )}
    >
      <span className={cn("h-4.5 w-4.5 rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none", checked ? "translate-x-5.5" : "translate-x-0.5")} />
    </span>
  );
}

/** An on/off switch: Civic Green track when on, slate when off. */
export function Switch({ checked, onChange, label, description, hideLabel = false, disabled = false, className }: SwitchProps) {
  const id = useId();
  const button = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={hideLabel ? label : undefined}
      aria-labelledby={hideLabel ? undefined : `${id}-label`}
      aria-describedby={description && !hideLabel ? `${id}-description` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="tanaw-switch inline-flex shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Track checked={checked} />
    </button>
  );
  if (hideLabel) return <span className={className}>{button}</span>;
  return (
    <div className={cn("tanaw-switch-row flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-sm font-semibold text-(--tanaw-text)">
          {label}
        </p>
        {description && (
          <p id={`${id}-description`} className="mt-0.5 text-sm leading-relaxed text-(--tanaw-text-muted)">
            {description}
          </p>
        )}
      </div>
      {button}
    </div>
  );
}
