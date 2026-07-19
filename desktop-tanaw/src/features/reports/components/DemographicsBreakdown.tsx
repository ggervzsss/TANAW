import { Info, Keyboard, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";
import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { DemoBreakdown } from "../../../types/enterprise";
import { demographicCount, getDemographicAllocationStatus, getDemographicTotals } from "../utils/demographics";

type DemographicsBreakdownProps = {
  demo: DemoBreakdown;
  isReadOnly: boolean;
  previousDemo?: DemoBreakdown | null;
  setDemo: Dispatch<SetStateAction<DemoBreakdown>>;
  uniqueCap: number;
};

const groups = [
  {
    id: "thisProvince",
    description: "Visitors whose residence is within this province.",
    femaleKey: "thisProvFemale",
    maleKey: "thisProvMale",
    title: "This Province",
    totalKey: "thisProvince",
  },
  {
    id: "otherProvince",
    description: "Visitors from another Philippine province.",
    femaleKey: "otherProvFemale",
    maleKey: "otherProvMale",
    title: "Other Province",
    totalKey: "otherProvince",
  },
  {
    id: "foreign",
    description: "Visitors whose residence is outside the Philippines.",
    femaleKey: "foreignFemale",
    maleKey: "foreignMale",
    title: "Foreign",
    totalKey: "foreign",
  },
] as const;

type DemographicGroup = (typeof groups)[number];
type DemographicCategoryId = DemographicGroup["id"];
type AllocationMode = "assisted" | "manual";

type AssistedSettings = {
  categoryShares: Record<DemographicCategoryId, number>;
  maleShares: Record<DemographicCategoryId, number>;
};

const defaultAssistedSettings: AssistedSettings = {
  categoryShares: {
    foreign: 10,
    otherProvince: 30,
    thisProvince: 60,
  },
  maleShares: {
    foreign: 50,
    otherProvince: 50,
    thisProvince: 50,
  },
};

export function DemographicsBreakdown({ demo, isReadOnly, previousDemo = null, setDemo, uniqueCap }: DemographicsBreakdownProps) {
  const [inputNote, setInputNote] = useState("");
  const [mode, setMode] = useState<AllocationMode>("manual");
  const [assistedSettings, setAssistedSettings] = useState<AssistedSettings>(defaultAssistedSettings);
  const allocation = getDemographicAllocationStatus(demo, uniqueCap);
  const totals = allocation.totals;
  const assistedPreview = useMemo(() => buildAssistedDemo(assistedSettings, allocation.cap), [allocation.cap, assistedSettings]);
  const assistedPreviewTotals = useMemo(() => getDemographicTotals(assistedPreview), [assistedPreview]);
  const categoryShareTotal = groupTotal(groups.map((group) => assistedSettings.categoryShares[group.id]));
  const hasPreviousDemo = Boolean(previousDemo && getDemographicTotals(previousDemo).grandTotal > 0);
  const helperMessage = inputNote || allocation.validationMessage || "Whole numbers only. Total must match Unique Count before finalizing.";
  const helperTone = inputNote || allocation.remaining > 0 ? "text-amber-700" : allocation.isOverCap ? "text-red-700" : "text-gray-400";

  const applyAssistedAllocation = () => {
    if (isReadOnly) return;
    setDemo(buildAssistedDemo(assistedSettings, allocation.cap));
    setInputNote("Assisted allocation applied. Manual fields remain editable.");
  };

  const applyRemainingAllocation = () => {
    if (isReadOnly) return;
    const result = fillRemainingDemographics(demo, assistedSettings, allocation.cap);
    setDemo(result.demo);
    setInputNote(result.message);
  };

  const resetEvenly = () => {
    setAssistedSettings({
      categoryShares: {
        foreign: 34,
        otherProvince: 33,
        thisProvince: 33,
      },
      maleShares: {
        foreign: 50,
        otherProvince: 50,
        thisProvince: 50,
      },
    });
    setInputNote("Even allocation settings loaded.");
  };

  const usePreviousMix = () => {
    if (!previousDemo) return;
    setAssistedSettings(settingsFromDemo(previousDemo, assistedSettings));
    setInputNote("Previous report mix loaded into assisted allocation.");
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="block text-xs font-semibold tracking-wider text-[#111827] uppercase">Demographics Breakdown</label>
        <span className="text-[10px] font-bold text-gray-500">Unique visitors: {allocation.cap.toLocaleString()}</span>
      </div>
      {!isReadOnly && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex rounded-sm border border-gray-200 bg-gray-50 p-1">
            <ModeButton active={mode === "manual"} icon={<Keyboard size={13} />} label="Manual" onClick={() => setMode("manual")} />
            <ModeButton active={mode === "assisted"} icon={<SlidersHorizontal size={13} />} label="Assisted" onClick={() => setMode("assisted")} />
          </div>
          <button
            type="button"
            onClick={applyRemainingAllocation}
            className="flex items-center gap-1.5 rounded-sm border border-gray-200 bg-white px-2.5 py-1.5 text-[10px] font-bold tracking-wider text-[#065f46] uppercase transition-colors hover:border-[#065f46]/40 hover:bg-[#065f46]/5"
          >
            <Sparkles size={13} /> Fill Remaining
          </button>
        </div>
      )}

      {mode === "assisted" && !isReadOnly && (
        <div className="mb-3 space-y-3 rounded-sm border border-gray-200 bg-gray-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold tracking-wider text-[#111827] uppercase">Assisted Allocation</p>
              <p className={`mt-1 text-[10px] font-semibold ${categoryShareTotal === 100 ? "text-gray-500" : "text-amber-700"}`}>Category share total: {categoryShareTotal}%</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={resetEvenly}
                className="flex items-center gap-1 rounded-sm border border-gray-200 bg-white px-2 py-1.5 text-[10px] font-bold tracking-wider text-gray-600 uppercase transition-colors hover:border-[#065f46]/40 hover:text-[#065f46]"
              >
                <RotateCcw size={12} /> Even Split
              </button>
              <button
                type="button"
                disabled={!hasPreviousDemo}
                onClick={usePreviousMix}
                className="rounded-sm border border-gray-200 bg-white px-2 py-1.5 text-[10px] font-bold tracking-wider text-gray-600 uppercase transition-colors hover:border-[#065f46]/40 hover:text-[#065f46] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              >
                Previous Mix
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {groups.map((group) => (
              <AssistedGroupControls key={group.id} group={group} previewDemo={assistedPreview} settings={assistedSettings} setSettings={setAssistedSettings} />
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-3">
            <span className="text-[10px] font-semibold text-gray-500">Preview total: {assistedPreviewTotals.grandTotal.toLocaleString()}</span>
            <button
              type="button"
              onClick={applyAssistedAllocation}
              className="flex items-center gap-2 rounded-sm bg-[#065f46] px-3 py-2 text-[10px] font-bold tracking-wider text-white uppercase shadow-sm transition-colors hover:bg-[#044a36]"
            >
              <Sparkles size={13} /> Apply Allocation
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 rounded-sm border border-gray-200 bg-white p-2">
        {groups.map((group) => (
          <div key={group.title} className="min-w-0 border-r border-gray-100 pr-2 last:border-r-0 last:pr-0">
            <div className="mb-2 flex min-w-0 items-center gap-1">
              <p className="min-w-0 truncate text-[9px] font-bold text-[#111827] uppercase">{group.title}</p>
              <InfoTooltip content={group.description} align="left">
                <Info size={12} className="shrink-0 text-gray-400 transition-colors hover:text-[#065f46]" aria-hidden="true" />
              </InfoTooltip>
            </div>
            <div className="space-y-2">
              <DemographicInput demo={demo} disabled={isReadOnly} field={group.maleKey} label="Male" setDemo={setDemo} setInputNote={setInputNote} uniqueCap={allocation.cap} />
              <DemographicInput demo={demo} disabled={isReadOnly} field={group.femaleKey} label="Female" setDemo={setDemo} setInputNote={setInputNote} uniqueCap={allocation.cap} />
              <div className="rounded-sm border border-gray-200 bg-gray-50 px-2 py-1.5 text-center">
                <p className="text-[8px] font-bold tracking-wider text-gray-400 uppercase">Total</p>
                <p className="font-mono text-xs font-bold text-[#111827]">{totals[group.totalKey].toLocaleString()}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[10px] font-semibold">
        <span className={helperTone}>{helperMessage}</span>
        <span className="shrink-0 text-[#065f46]">Grand total: {totals.grandTotal.toLocaleString()}</span>
      </div>
    </div>
  );
}

type ModeButtonProps = {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
};

function ModeButton({ active, icon, label, onClick }: ModeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[10px] font-bold tracking-wider uppercase transition-colors ${
        active ? "bg-white text-[#065f46] shadow-sm" : "text-gray-500 hover:text-[#111827]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

type AssistedGroupControlsProps = {
  group: DemographicGroup;
  previewDemo: DemoBreakdown;
  settings: AssistedSettings;
  setSettings: Dispatch<SetStateAction<AssistedSettings>>;
};

function AssistedGroupControls({ group, previewDemo, settings, setSettings }: AssistedGroupControlsProps) {
  const maleShare = settings.maleShares[group.id];
  const malePreview = demographicCount(previewDemo[group.maleKey]);
  const femalePreview = demographicCount(previewDemo[group.femaleKey]);
  const categoryPreview = malePreview + femalePreview;

  return (
    <div className="rounded-sm border border-gray-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold tracking-wider text-[#111827] uppercase">{group.title}</p>
        <p className="font-mono text-[10px] font-bold text-[#065f46]">
          {malePreview.toLocaleString()} M / {femalePreview.toLocaleString()} F
        </p>
      </div>
      <div className="space-y-3">
        <PercentageControl
          countLabel={`${categoryPreview.toLocaleString()} pax`}
          label="Category Share"
          value={settings.categoryShares[group.id]}
          onChange={(value) =>
            setSettings((current) => ({
              ...current,
              categoryShares: { ...current.categoryShares, [group.id]: value },
            }))
          }
        />
        <PercentageControl
          balancedLabels={{ left: "Female", right: "Male" }}
          label="Gender Balance"
          value={maleShare}
          onChange={(value) =>
            setSettings((current) => ({
              ...current,
              maleShares: { ...current.maleShares, [group.id]: value },
            }))
          }
        />
      </div>
    </div>
  );
}

type PercentageControlProps = {
  balancedLabels?: {
    left: string;
    right: string;
  };
  countLabel?: string;
  label: string;
  onChange: (value: number) => void;
  value: number;
};

function PercentageControl({ balancedLabels, countLabel, label, onChange, value }: PercentageControlProps) {
  const leftValue = 100 - value;

  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[10px] font-semibold text-gray-500">
        <span>{label}</span>
        {balancedLabels && (
          <span>
            {balancedLabels.left} {leftValue}% / {balancedLabels.right} {value}%
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {countLabel && <CountPreview label={countLabel} />}
        {balancedLabels && <PercentageInput ariaLabel={`${balancedLabels.left} percentage`} value={leftValue} onChange={(nextValue) => onChange(100 - nextValue)} />}
        <input type="range" min={0} max={100} value={value} onChange={(event) => onChange(clampPercentage(event.target.value))} className="min-w-0 flex-1 accent-[#065f46]" />
        <PercentageInput ariaLabel={`${balancedLabels?.right ?? label} percentage`} value={value} onChange={onChange} />
      </div>
    </label>
  );
}

function CountPreview({ label }: { label: string }) {
  return <span className="w-24 shrink-0 rounded-sm border border-gray-300 bg-gray-50 px-1 text-center font-mono text-xs leading-8 font-bold text-[#111827]">{label}</span>;
}

type PercentageInputProps = {
  ariaLabel: string;
  onChange: (value: number) => void;
  value: number;
};

function PercentageInput({ ariaLabel, onChange, value }: PercentageInputProps) {
  return (
    <input
      type="number"
      aria-label={ariaLabel}
      min={0}
      max={100}
      value={value}
      onChange={(event) => onChange(clampPercentage(event.target.value))}
      className="h-8 w-14 rounded-sm border border-gray-300 px-1 text-center text-xs font-bold text-[#111827] outline-none focus:border-[#065f46]"
    />
  );
}

type DemographicInputProps = {
  demo: DemoBreakdown;
  disabled: boolean;
  field: keyof DemoBreakdown;
  label: "Female" | "Male";
  setDemo: Dispatch<SetStateAction<DemoBreakdown>>;
  setInputNote: Dispatch<SetStateAction<string>>;
  uniqueCap: number;
};

function DemographicInput({ demo, disabled, field, label, setDemo, setInputNote, uniqueCap }: DemographicInputProps) {
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
        onChange={(event) => updateDemographicValue(event.target.value, field, setDemo, setInputNote, uniqueCap)}
        className="w-full rounded-sm border border-gray-300 p-1.5 text-center text-xs outline-none focus:border-[#065f46] disabled:bg-gray-50"
      />
    </label>
  );
}

function updateDemographicValue(rawValue: string, field: keyof DemoBreakdown, setDemo: Dispatch<SetStateAction<DemoBreakdown>>, setInputNote: Dispatch<SetStateAction<string>>, uniqueCap: number) {
  const leadingDigits = rawValue.match(/^\d*/)?.[0] ?? "";
  const hasInvalidCharacters = rawValue !== leadingDigits;
  const hasNegativeSign = rawValue.includes("-");
  const requestedValue = leadingDigits ? Number.parseInt(leadingDigits, 10) : 0;

  setDemo((current) => {
    const currentFieldValue = demographicCount(current[field]);
    const currentTotalWithoutField = getDemographicAllocationStatus(current, uniqueCap).totals.grandTotal - currentFieldValue;
    const remaining = Math.max(0, uniqueCap - currentTotalWithoutField);
    const nextValue = Math.min(requestedValue, remaining);
    const nextDisplayValue = leadingDigits === "" ? "" : String(nextValue);

    if (leadingDigits !== "" && nextValue < requestedValue) {
      setInputNote("Adjusted to stay within the unique visitor count.");
    } else if (hasNegativeSign) {
      setInputNote("Negative values are not allowed.");
    } else if (hasInvalidCharacters) {
      setInputNote("Only whole numbers are allowed.");
    } else {
      setInputNote("");
    }

    return { ...current, [field]: nextDisplayValue };
  });
}

function buildAssistedDemo(settings: AssistedSettings, uniqueCap: number): DemoBreakdown {
  const categoryTotals = distributeIntegerTotal(
    uniqueCap,
    groups.map((group) => settings.categoryShares[group.id]),
  );
  const nextDemo = emptyDemo();

  groups.forEach((group, index) => {
    const maleShare = settings.maleShares[group.id];
    const [male, female] = distributeIntegerTotal(categoryTotals[index], [maleShare, 100 - maleShare]);
    nextDemo[group.maleKey] = String(male);
    nextDemo[group.femaleKey] = String(female);
  });

  return nextDemo;
}

function fillRemainingDemographics(demo: DemoBreakdown, settings: AssistedSettings, uniqueCap: number) {
  const lockedFields = new Set<keyof DemoBreakdown>();
  const weights: number[] = [];
  const fields: (keyof DemoBreakdown)[] = [];

  for (const group of groups) {
    const categoryShare = settings.categoryShares[group.id];
    const maleShare = settings.maleShares[group.id];
    fields.push(group.maleKey, group.femaleKey);
    weights.push(categoryShare * maleShare, categoryShare * (100 - maleShare));

    if (demo[group.maleKey].trim() !== "") lockedFields.add(group.maleKey);
    if (demo[group.femaleKey].trim() !== "") lockedFields.add(group.femaleKey);
  }

  const lockedTotal = fields.reduce((total, field) => total + (lockedFields.has(field) ? demographicCount(demo[field]) : 0), 0);
  const remaining = Math.max(0, uniqueCap - lockedTotal);

  if (lockedTotal >= uniqueCap) {
    return {
      demo,
      message: lockedTotal === uniqueCap ? "No remaining visitors to allocate." : "Manual values already exceed the unique visitor count.",
    };
  }

  const unlockedFields = fields.filter((field) => !lockedFields.has(field));
  if (unlockedFields.length === 0) {
    return { demo, message: "Clear a field before filling the remaining visitors." };
  }

  const unlockedWeights = fields.map((field, index) => (lockedFields.has(field) ? 0 : weights[index]));
  const allocatedValues = distributeIntegerTotal(remaining, unlockedWeights);
  const nextDemo = { ...demo };

  fields.forEach((field, index) => {
    if (!lockedFields.has(field)) {
      nextDemo[field] = String(allocatedValues[index]);
    }
  });

  return { demo: nextDemo, message: "Remaining visitors filled from the assisted mix." };
}

function settingsFromDemo(demo: DemoBreakdown, fallback: AssistedSettings): AssistedSettings {
  const totals = getDemographicTotals(demo);
  if (totals.grandTotal === 0) return fallback;

  return {
    categoryShares: {
      foreign: percentOf(totals.foreign, totals.grandTotal),
      otherProvince: percentOf(totals.otherProvince, totals.grandTotal),
      thisProvince: percentOf(totals.thisProvince, totals.grandTotal),
    },
    maleShares: {
      foreign: percentOf(demographicCount(demo.foreignMale), totals.foreign),
      otherProvince: percentOf(demographicCount(demo.otherProvMale), totals.otherProvince),
      thisProvince: percentOf(demographicCount(demo.thisProvMale), totals.thisProvince),
    },
  };
}

function distributeIntegerTotal(total: number, weights: number[]) {
  const normalizedTotal = Math.max(0, Math.floor(total));
  const positiveWeights = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const weightTotal = groupTotal(positiveWeights);
  const effectiveWeights = weightTotal > 0 ? positiveWeights : weights.map(() => 1);
  const effectiveTotal = groupTotal(effectiveWeights);
  const allocations = effectiveWeights.map((weight, index) => {
    const exact = effectiveTotal > 0 ? (normalizedTotal * weight) / effectiveTotal : 0;
    return {
      floor: Math.floor(exact),
      index,
      remainder: exact - Math.floor(exact),
    };
  });
  let remaining = normalizedTotal - groupTotal(allocations.map((allocation) => allocation.floor));
  const result = allocations.map((allocation) => allocation.floor);
  const byRemainder = [...allocations].sort((first, second) => second.remainder - first.remainder || first.index - second.index);

  for (const allocation of byRemainder) {
    if (remaining <= 0) break;
    result[allocation.index] += 1;
    remaining -= 1;
  }

  return result;
}

function percentOf(value: number, total: number) {
  if (total <= 0) return 50;
  return clampPercentage(Math.round((value / total) * 100));
}

function groupTotal(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function clampPercentage(value: string | number) {
  const numericValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.min(100, numericValue));
}

function emptyDemo(): DemoBreakdown {
  return {
    foreignFemale: "",
    foreignMale: "",
    otherProvFemale: "",
    otherProvMale: "",
    thisProvFemale: "",
    thisProvMale: "",
  };
}
