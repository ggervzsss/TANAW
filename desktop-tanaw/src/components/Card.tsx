import type { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`tanaw-enterprise-card rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-(--enterprise-border-soft) dark:bg-(--enterprise-card-bg) ${className}`}>{children}</div>
  );
}
