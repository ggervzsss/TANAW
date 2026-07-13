import { FileCheck2, Search } from "lucide-react";
import type { FinalReportScopeType, ReportingPeriodResource } from "@/shared/types";

type BatchReportsToolbarProps = {
  query: string;
  periods: ReportingPeriodResource[];
  selectedPeriodId: string;
  scopeType: FinalReportScopeType;
  barangay: string;
  availableBarangays: string[];
  selectedCount: number;
  canFinalize: boolean;
  onQueryChange: (value: string) => void;
  onPeriodChange: (value: string) => void;
  onScopeChange: (value: FinalReportScopeType) => void;
  onBarangayChange: (value: string) => void;
  onGenerate: () => void;
};

export function BatchReportsToolbar({ query, periods, selectedPeriodId, scopeType, barangay, availableBarangays, selectedCount, canFinalize, onQueryChange, onPeriodChange, onScopeChange, onBarangayChange, onGenerate }: BatchReportsToolbarProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-gray-200 bg-gray-50 p-4">
      <label className="min-w-64 grow">
        <span className="mb-1 block text-[10px] font-bold tracking-wide text-slate-500 uppercase">Search frozen obligations</span>
        <span className="relative block"><Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Enterprise, site, barangay, or authoritative ID" className="focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm outline-none focus:ring-1" /></span>
      </label>
      <SelectField label="Reporting period" value={selectedPeriodId} onChange={onPeriodChange} disabled={periods.length === 0}>
        {periods.length === 0 && <option value="">No server period available</option>}
        {periods.map((period) => <option key={period.reportingPeriodId} value={period.reportingPeriodId}>{period.label} · {period.status}</option>)}
      </SelectField>
      <SelectField label="Final scope" value={scopeType} onChange={(value) => onScopeChange(value as FinalReportScopeType)} disabled={!selectedPeriodId}>
        <option value="citywide">Citywide</option><option value="barangay">Barangay</option><option value="enterprise_selection">Enterprise selection</option>
      </SelectField>
      {scopeType === "barangay" && <SelectField label="Frozen barangay" value={barangay} onChange={onBarangayChange} disabled={availableBarangays.length === 0}><option value="">Select barangay</option>{availableBarangays.map((value) => <option key={value} value={value}>{value}</option>)}</SelectField>}
      <button type="button" disabled={!canFinalize} onClick={onGenerate} className="bg-tanaw-green inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"><FileCheck2 size={16} /> Finalize {selectedCount} exact revision{selectedCount === 1 ? "" : "s"}</button>
    </div>
  );
}

function SelectField({ label, value, onChange, disabled, children }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; children: React.ReactNode }) {
  return <label><span className="mb-1 block text-[10px] font-bold tracking-wide text-slate-500 uppercase">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none disabled:bg-slate-100">{children}</select></label>;
}
