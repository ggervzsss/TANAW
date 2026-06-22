import type { ComponentType, PropsWithChildren, ReactNode } from "react";
import type { LucideProps } from "lucide-react";

type PanelProps = PropsWithChildren<{
  className?: string;
}>;

export function Panel({ children, className = "" }: PanelProps) {
  return <section className={["shadow-panel rounded-2xl border border-white/80 bg-white/96 ring-1 ring-slate-900/4 backdrop-blur-sm", className].join(" ")}>{children}</section>;
}

type PanelHeaderProps = {
  title: string;
  icon?: ComponentType<LucideProps>;
  right?: ReactNode;
};

export function PanelHeader({ title, icon: Icon, right }: PanelHeaderProps) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-slate-200/80 bg-linear-to-r from-slate-50 to-white px-5 py-4">
      <span className="text-tanaw-navy flex items-center gap-2.5 text-xs font-black tracking-widest uppercase">
        {Icon && <Icon size={15} className="text-tanaw-green" />}
        {title}
      </span>
      {right}
    </div>
  );
}
