import type { ComponentType, PropsWithChildren, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { Card } from "../../ui-kit";

type PanelProps = PropsWithChildren<{
  className?: string;
}>;

/** A page section: the UI-kit Card, open on the page surface with a hairline above it. */
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

/** The heading row of a section: an Inter 650 title in sentence case, with controls on the right. */
export function PanelHeader({ title, icon: Icon, right }: PanelHeaderProps) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-(--tanaw-border-soft) px-5 py-4">
      <span className="flex items-center gap-2.5 text-[0.9375rem] font-[650] text-(--tanaw-text)">
        {Icon && <Icon size={16} className="text-(--tanaw-accent-ink)" aria-hidden="true" />}
        {title}
      </span>
      {right}
    </div>
  );
}
