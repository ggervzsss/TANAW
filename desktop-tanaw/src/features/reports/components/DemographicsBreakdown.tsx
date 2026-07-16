import { Keyboard, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { DemoBreakdown, DemographicEvidence } from "../../../types/enterprise";
import {
  CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE,
  ESTIMATED_OPERATOR_DEMOGRAPHIC_EVIDENCE,
  formatDemographicValue,
  getDemographicEvidenceStatus,
  getExplicitDemographicTotals,
  parseDemographicCount,
} from "../utils/demographics";

type DemographicsBreakdownProps = {
  demo: DemoBreakdown;
  demographicEvidence: DemographicEvidence | null;
  isReadOnly: boolean;
  setDemo: Dispatch<SetStateAction<DemoBreakdown>>;
  setDemographicEvidence: Dispatch<SetStateAction<DemographicEvidence | null>>;
  uniqueCount: number;
};

const groups = [
  { id: "thisProvince", femaleKey: "thisProvFemale", maleKey: "thisProvMale", title: "This Province", totalKey: "thisProvince" },
  { id: "otherProvince", femaleKey: "otherProvFemale", maleKey: "otherProvMale", title: "Other Province", totalKey: "otherProvince" },
  { id: "foreign", femaleKey: "foreignFemale", maleKey: "foreignMale", title: "Foreign", totalKey: "foreign" },
] as const;

type GroupId = (typeof groups)[number]["id"];
type AllocationMode = "manual" | "assisted";
type CategoryShares = Record<GroupId, number>;

const DEFAULT_CATEGORY_SHARES: CategoryShares = {
  thisProvince: 60,
  otherProvince: 30,
  foreign: 10,
};

export function DemographicsBreakdown({ demo, demographicEvidence, isReadOnly, setDemo, setDemographicEvidence, uniqueCount }: DemographicsBreakdownProps) {
  const [mode, setMode] = useState<AllocationMode>(demographicEvidence?.quality === "estimated" ? "assisted" : "manual");
  const [categoryShares, setCategoryShares] = useState<CategoryShares>(DEFAULT_CATEGORY_SHARES);
  const [maleShare, setMaleShare] = useState(50);
  const [assistedDraft, setAssistedDraft] = useState(demographicEvidence?.quality === "estimated");
  const [inputNote, setInputNote] = useState("");
  const evidenceStatus = getDemographicEvidenceStatus(demo);
  const totals = getExplicitDemographicTotals(demo);
  const categoryShareTotal = Object.values(categoryShares).reduce((total, value) => total + value, 0);
  const preview = useMemo(() => buildAssistedDemo(Math.max(0, uniqueCount), categoryShares, maleShare), [categoryShares, maleShare, uniqueCount]);
  const helperMessage =
    inputNote ||
    evidenceStatus.validationMessage ||
    (evidenceStatus.hasAnyValue
      ? demographicEvidence
        ? demographicEvidence.quality === "estimated"
          ? "Confirmed as an operator estimate."
          : "Confirmed as operator-provided counts."
        : "Confirm the values before submitting."
      : "Demographics are optional.");

  const applyAssistedAllocation = () => {
    if (categoryShareTotal !== 100 || uniqueCount <= 0) return;
    setDemo(preview);
    setDemographicEvidence(null);
    setAssistedDraft(true);
    setInputNote("Allocation applied. Confirm it as an estimate before submitting.");
  };

  const confirmEvidence = (checked: boolean) => {
    if (!checked) {
      setDemographicEvidence(null);
      return;
    }
    setDemographicEvidence(assistedDraft ? ESTIMATED_OPERATOR_DEMOGRAPHIC_EVIDENCE : CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE);
    setInputNote(assistedDraft ? "Confirmed as an operator estimate." : "Confirmed as operator-provided counts.");
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="block text-xs font-semibold tracking-wider text-[#111827] uppercase">Demographics</label>
        <span className="text-[10px] font-bold text-gray-500">Optional</span>
      </div>

      {!isReadOnly && (
        <div className="mb-3 flex rounded-sm border border-gray-200 bg-gray-50 p-1">
          <ModeButton active={mode === "manual"} label="Manual" onClick={() => setMode("manual")} icon={<Keyboard size={13} />} />
          <ModeButton active={mode === "assisted"} label="Assisted" onClick={() => setMode("assisted")} icon={<SlidersHorizontal size={13} />} />
        </div>
      )}

      {mode === "assisted" && !isReadOnly && (
        <div className="mb-3 space-y-3 rounded-sm border border-emerald-200 bg-emerald-50/50 p-3">
          <div className="grid grid-cols-3 gap-2">
            {groups.map((group) => (
              <PercentageInput key={group.id} label={group.title} value={categoryShares[group.id]} onChange={(value) => setCategoryShares((current) => ({ ...current, [group.id]: value }))} />
            ))}
          </div>
          <label className="block">
            <span className="flex justify-between text-[10px] font-semibold text-gray-600">
              <span>Male / Female</span>
              <span>
                {maleShare}% / {100 - maleShare}%
              </span>
            </span>
            <input type="range" min={0} max={100} value={maleShare} onChange={(event) => setMaleShare(clampPercentage(event.target.value))} className="mt-1 w-full accent-[#065f46]" />
          </label>
          <div className="flex items-center justify-between gap-3">
            <span className={`text-[10px] font-semibold ${categoryShareTotal === 100 ? "text-gray-500" : "text-amber-700"}`}>
              Residence total: {categoryShareTotal}% · Visitor count: {Math.max(0, uniqueCount).toLocaleString()}
            </span>
            <button
              type="button"
              disabled={categoryShareTotal !== 100 || uniqueCount <= 0}
              onClick={applyAssistedAllocation}
              className="flex items-center gap-1.5 rounded-sm bg-[#065f46] px-3 py-2 text-[10px] font-bold text-white uppercase disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles size={13} /> Apply estimate
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 rounded-sm border border-gray-200 bg-white p-2">
        {groups.map((group) => (
          <div key={group.title} className="min-w-0 border-r border-gray-100 pr-2 last:border-r-0 last:pr-0">
            <InfoTooltip content={`Male and female visitors from ${group.title.toLowerCase()}.`} align="left">
              <p className="mb-2 truncate text-[9px] font-bold text-[#111827] uppercase">{group.title}</p>
            </InfoTooltip>
            <div className="space-y-2">
              <DemographicInput
                demo={demo}
                disabled={isReadOnly}
                field={group.maleKey}
                label="Male"
                onManualEdit={() => setAssistedDraft(false)}
                setDemo={setDemo}
                setDemographicEvidence={setDemographicEvidence}
                setInputNote={setInputNote}
              />
              <DemographicInput
                demo={demo}
                disabled={isReadOnly}
                field={group.femaleKey}
                label="Female"
                onManualEdit={() => setAssistedDraft(false)}
                setDemo={setDemo}
                setDemographicEvidence={setDemographicEvidence}
                setInputNote={setInputNote}
              />
              <div className="rounded-sm border border-gray-200 bg-gray-50 px-2 py-1.5 text-center">
                <p className="text-[8px] font-bold tracking-wider text-gray-400 uppercase">Total</p>
                <p className="font-mono text-xs font-bold text-[#111827]">{formatDemographicValue(totals[group.totalKey])}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {!isReadOnly && evidenceStatus.hasAnyValue && (
        <label className="mt-3 flex items-center gap-2 rounded-sm border border-gray-200 bg-gray-50 p-3">
          <input
            type="checkbox"
            checked={demographicEvidence !== null}
            disabled={Boolean(evidenceStatus.validationMessage)}
            onChange={(event) => confirmEvidence(event.target.checked)}
            className="accent-[#065f46]"
          />
          <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-[#111827] uppercase">
            <ShieldCheck size={12} /> {assistedDraft ? "Confirm operator estimate" : "Confirm operator counts"}
          </span>
        </label>
      )}

      {isReadOnly && (
        <p className="mt-3 text-[10px] font-semibold text-gray-500">
          {demographicEvidence ? (demographicEvidence.quality === "estimated" ? "Source: Operator estimate" : "Source: Operator-provided counts") : "Demographics not provided"}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-3 text-[10px] font-semibold">
        <span className={evidenceStatus.hasAnyValue && !demographicEvidence ? "text-amber-700" : "text-gray-500"}>{helperMessage}</span>
        <span className="shrink-0 text-[#065f46]">Grand total: {formatDemographicValue(totals.grandTotal)}</span>
      </div>
    </div>
  );
}

function ModeButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[10px] font-bold uppercase ${active ? "bg-white text-[#065f46] shadow-sm" : "text-gray-500"}`}
    >
      {icon} {label}
    </button>
  );
}

function PercentageInput({ label, onChange, value }: { label: string; onChange: (value: number) => void; value: number }) {
  return (
    <label className="text-[9px] font-semibold text-gray-600">
      <span className="block truncate">{label}</span>
      <div className="mt-1 flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={(event) => onChange(clampPercentage(event.target.value))}
          className="w-full rounded-sm border border-gray-300 bg-white px-1 py-1.5 text-center text-xs font-bold"
        />
        <span>%</span>
      </div>
    </label>
  );
}

function DemographicInput({
  demo,
  disabled,
  field,
  label,
  onManualEdit,
  setDemo,
  setDemographicEvidence,
  setInputNote,
}: {
  demo: DemoBreakdown;
  disabled: boolean;
  field: keyof DemoBreakdown;
  label: "Female" | "Male";
  onManualEdit: () => void;
  setDemo: Dispatch<SetStateAction<DemoBreakdown>>;
  setDemographicEvidence: Dispatch<SetStateAction<DemographicEvidence | null>>;
  setInputNote: Dispatch<SetStateAction<string>>;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder={label === "Male" ? "M" : "F"}
        disabled={disabled}
        value={demo[field]}
        onChange={(event) => {
          const rawValue = event.target.value;
          if (rawValue !== "" && parseDemographicCount(rawValue) === null) {
            setInputNote("Enter a whole number from 0 to 2,147,483,647.");
            return;
          }
          setInputNote("");
          setDemographicEvidence(null);
          onManualEdit();
          setDemo((current) => ({ ...current, [field]: rawValue }));
        }}
        className="w-full rounded-sm border border-gray-300 p-1.5 text-center text-xs outline-none focus:border-[#065f46] disabled:bg-gray-50"
      />
    </label>
  );
}

function buildAssistedDemo(uniqueCount: number, categoryShares: CategoryShares, maleShare: number): DemoBreakdown {
  const categoryTotals = distributeIntegerTotal(
    uniqueCount,
    groups.map((group) => categoryShares[group.id]),
  );
  const demo: DemoBreakdown = { thisProvMale: "", thisProvFemale: "", otherProvMale: "", otherProvFemale: "", foreignMale: "", foreignFemale: "" };
  groups.forEach((group, index) => {
    const [male, female] = distributeIntegerTotal(categoryTotals[index], [maleShare, 100 - maleShare]);
    demo[group.maleKey] = String(male);
    demo[group.femaleKey] = String(female);
  });
  return demo;
}

function distributeIntegerTotal(total: number, weights: number[]) {
  const normalizedTotal = Math.max(0, Math.floor(total));
  const weightTotal = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  const exact = weights.map((weight) => (weightTotal > 0 ? (normalizedTotal * Math.max(0, weight)) / weightTotal : 0));
  const result = exact.map(Math.floor);
  let remaining = normalizedTotal - result.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, remainder: value - Math.floor(value) })).sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const item of order) {
    if (remaining === 0) break;
    result[item.index] += 1;
    remaining -= 1;
  }
  return result;
}

function clampPercentage(value: string | number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}
