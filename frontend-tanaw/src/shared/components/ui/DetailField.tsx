import type { ReactNode } from "react";

type DetailFieldProps = {
  label: string;
  value: ReactNode;
};

export function DetailField({ label, value }: DetailFieldProps) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-[#f8faf8] p-4 shadow-sm ring-1 ring-white">
      <p className="mb-1.5 text-[10px] font-bold tracking-[0.16em] text-slate-500 uppercase">{label}</p>
      <p className="text-sm leading-relaxed font-semibold wrap-break-word text-slate-950">{value}</p>
    </div>
  );
}
