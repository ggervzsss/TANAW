import type { ComponentType, PropsWithChildren, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { Card } from "../../ui-kit";

type PanelProps = PropsWithChildren<{
  className?: string;
}>;

/** The UI-kit Card as a page section. */
export function Panel({ children, className = "" }: PanelProps) {
  return (
    <Card as="section" className={className}>
      {children}
    </Card>
  );
}

type PanelHeaderProps = {
  title: string;
  icon?: ComponentType<LucideProps>;
  right?: ReactNode;
};

export function PanelHeader({ title, icon: Icon, right }: PanelHeaderProps) {
  return (
    <div className="flex shrink-0 items-center justify-between rounded-t-tanaw-lg border-b border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) px-5 py-4">
      <span className="flex items-center gap-2.5 text-xs font-bold tracking-label text-(--tanaw-label) uppercase">
        {Icon && <Icon size={15} className="text-(--tanaw-accent-ink)" />}
        {title}
      </span>
      {right}
    </div>
  );
}
