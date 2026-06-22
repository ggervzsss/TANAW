import type { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: CardProps) {
  return <div className={`rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-[#1e293b] ${className}`}>{children}</div>;
}
