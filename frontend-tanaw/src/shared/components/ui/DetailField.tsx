import type { ReactNode } from "react";

type DetailFieldProps = {
  label: string;
  value: ReactNode;
};

export function DetailField({ label, value }: DetailFieldProps) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-[#f8faf8] p-4 shadow-sm ring-1 ring-white dark:border-emerald-300/20 dark:bg-[#172033] dark:ring-white/8">
      <p className="mb-1.5 text-[10px] font-bold tracking-[0.16em] text-slate-500 uppercase dark:text-slate-300">{label}</p>
      <div className="text-sm leading-relaxed font-semibold wrap-break-word text-slate-950 dark:text-slate-100">{value}</div>
    </div>
  );
}
