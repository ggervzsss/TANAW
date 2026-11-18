/*
 * GENERATED FILE. Do not edit; change design-system/src/components/Alert.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: b81c916bf97b2ef92db867a17bb3f96521ca26a73cab71cc67f437950d228e51
 */
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type AlertTone = "info" | "success" | "warning" | "danger";

export type AlertProps = {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  /** A button or link on the right. */
  action?: ReactNode;
  /** Replaces the tone's default icon; pass null for none. */
  icon?: ReactNode;
  className?: string;
};

const tones: Record<AlertTone, { box: string; icon: ReactNode; title: string }> = {
  info: { box: "border-(--tanaw-info-line) bg-(--tanaw-information-surface)", icon: <Info size={18} />, title: "text-(--tanaw-info-text)" },
  success: { box: "border-(--tanaw-success-line) bg-(--tanaw-success-surface)", icon: <CheckCircle2 size={18} />, title: "text-(--tanaw-success-text)" },
  warning: { box: "border-(--tanaw-warning-line) bg-(--tanaw-warning-surface)", icon: <AlertTriangle size={18} />, title: "text-(--tanaw-warning-text)" },
  danger: { box: "border-(--tanaw-danger-line) bg-(--tanaw-danger-surface)", icon: <XCircle size={18} />, title: "text-(--tanaw-danger-text)" },
};

/** A banner inside a page or card that explains a state: offline, delayed, needs attention, saved. */
export function Alert({ tone = "info", title, children, action, icon, className }: AlertProps) {
  const style = tones[tone];
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} data-tone={tone} className={cn("tanaw-alert flex items-start gap-3 rounded-tanaw-md border px-4 py-3", style.box, className)}>
      {icon !== null && (
        <span aria-hidden="true" className={cn("mt-0.5 shrink-0", style.title)}>
          {icon ?? style.icon}
        </span>
      )}
      <div className="min-w-0 flex-1 text-sm leading-relaxed text-(--tanaw-text-secondary)">
        {title && <p className={cn("font-bold", style.title)}>{title}</p>}
        {children && <div className={cn(title ? "mt-0.5" : undefined)}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
