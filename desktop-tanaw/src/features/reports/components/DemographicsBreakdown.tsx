import { Info, Keyboard, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";
import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { DemoBreakdown } from "../../../types/enterprise";
import { demographicCount, getDemographicAllocationStatus, getDemographicTotals } from "../utils/demographics";
import {
  buildAssistedDemo,
  clampPercentage,
  demographicGroups,
  fillRemainingDemographics,
  groupTotal,
  settingsFromDemo,
  updateDemographicValue,
  type AssistedSettings,
} from "../model/demographic-allocation";

type DemographicsBreakdownProps = {
  demo: DemoBreakdown;
  isReadOnly: boolean;
  previousDemo?: DemoBreakdown | null;
  setDemo: Dispatch<SetStateAction<DemoBreakdown>>;
  uniqueCap: number;
};

const groups = demographicGroups;

type DemographicGroup = (typeof groups)[number];
type AllocationMode = "assisted" | "manual";

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
          <div className="flex rounded-xl border border-gray-200 bg-gray-50 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
            <ModeButton active={mode === "manual"} icon={<Keyboard size={13} />} label="Manual" onClick={() => setMode("manual")} />
            <ModeButton active={mode === "assisted"} icon={<SlidersHorizontal size={13} />} label="Assisted" onClick={() => setMode("assisted")} />
          </div>
          <button
            type="button"
            onClick={applyRemainingAllocation}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[10px] font-bold tracking-wider text-[#065f46] uppercase shadow-sm transition-colors hover:border-[#065f46]/40 hover:bg-[#065f46]/5"
          >
            <Sparkles size={13} /> Fill Remaining
          </button>
        </div>
      )}

      {mode === "assisted" && !isReadOnly && (
        <div className="mb-3 space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold tracking-wider text-[#111827] uppercase">Assisted Allocation</p>
              <p className={`mt-1 text-[10px] font-semibold ${categoryShareTotal === 100 ? "text-gray-500" : "text-amber-700"}`}>Category share total: {categoryShareTotal}%</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={resetEvenly}
                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[10px] font-bold tracking-wider text-gray-600 uppercase transition-colors hover:border-[#065f46]/40 hover:text-[#065f46]"
              >
                <RotateCcw size={12} /> Even Split
              </button>
              <button
                type="button"
                disabled={!hasPreviousDemo}
                onClick={usePreviousMix}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[10px] font-bold tracking-wider text-gray-600 uppercase transition-colors hover:border-[#065f46]/40 hover:text-[#065f46] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
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
              className="flex items-center gap-2 rounded-xl bg-[#065f46] px-3.5 py-2.5 text-[10px] font-bold tracking-wider text-white uppercase shadow-sm transition-colors hover:bg-[#044a36]"
            >
              <Sparkles size={13} /> Apply Allocation
            </button>
          </div>
        </div>
      )}

      <div className="tanaw-demographic-grid grid grid-cols-3 gap-2.5 rounded-2xl border border-(--tanaw-border-subtle) bg-(--tanaw-surface-raised) p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)] max-[850px]:grid-cols-1">
        {groups.map((group) => (
          <div key={group.title} className="tanaw-demographic-card min-w-0 rounded-xl border border-(--tanaw-border-subtle) bg-(--tanaw-surface-inset) p-2.5">
            <div className="mb-2 flex min-w-0 items-center gap-1">
              <p className="min-w-0 truncate text-[9px] font-bold text-(--tanaw-text) uppercase">{group.title}</p>
              <InfoTooltip content={group.description} align="left">
                <Info size={12} className="shrink-0 text-(--tanaw-muted-text) transition-colors hover:text-(--tanaw-green)" aria-hidden="true" />
              </InfoTooltip>
            </div>
            <div className="space-y-2">
              <DemographicInput demo={demo} disabled={isReadOnly} field={group.maleKey} label="Male" setDemo={setDemo} setInputNote={setInputNote} uniqueCap={allocation.cap} />
              <DemographicInput demo={demo} disabled={isReadOnly} field={group.femaleKey} label="Female" setDemo={setDemo} setInputNote={setInputNote} uniqueCap={allocation.cap} />
              <div className="tanaw-demographic-total rounded-lg border border-(--tanaw-border-subtle) bg-(--tanaw-surface-raised) px-2 py-1.5 text-center shadow-sm">
                <p className="text-[8px] font-bold tracking-wider text-(--tanaw-muted-text) uppercase">Total</p>
                <p className="font-mono text-xs font-bold text-(--tanaw-text)">{totals[group.totalKey].toLocaleString()}</p>
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
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold tracking-wider uppercase transition-colors ${
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
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
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
  return <span className="w-24 shrink-0 rounded-lg border border-gray-300 bg-gray-50 px-1 text-center font-mono text-xs leading-8 font-bold text-[#111827]">{label}</span>;
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
      className="h-8 w-14 rounded-lg border border-gray-300 px-1 text-center text-xs font-bold text-[#111827] outline-none focus:border-[#065f46]"
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
        className="tanaw-demographic-input w-full rounded-lg border border-(--tanaw-border-strong) bg-(--tanaw-control-bg) p-2 text-center text-xs text-(--tanaw-text) outline-none focus:border-(--tanaw-green) disabled:bg-(--tanaw-surface-inset) disabled:text-(--tanaw-muted-text)"
      />
    </label>
  );
}
