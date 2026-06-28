import { useState, type Dispatch, type SetStateAction } from "react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { DemoBreakdown } from "../../../types/enterprise";
import { demographicCount, getDemographicAllocationStatus } from "../utils/demographics";

type DemographicsBreakdownProps = {
  demo: DemoBreakdown;
  isReadOnly: boolean;
  setDemo: Dispatch<SetStateAction<DemoBreakdown>>;
  uniqueCap: number;
};

const groups = [
  {
    description: "Visitors whose residence is within this province.",
    femaleKey: "thisProvFemale",
    maleKey: "thisProvMale",
    title: "This Province",
    totalKey: "thisProvince",
  },
  {
    description: "Visitors from another Philippine province.",
    femaleKey: "otherProvFemale",
    maleKey: "otherProvMale",
    title: "Other Province",
    totalKey: "otherProvince",
  },
  {
    description: "Visitors whose residence is outside the Philippines.",
    femaleKey: "foreignFemale",
    maleKey: "foreignMale",
    title: "Foreign",
    totalKey: "foreign",
  },
] as const;

export function DemographicsBreakdown({ demo, isReadOnly, setDemo, uniqueCap }: DemographicsBreakdownProps) {
  const [inputNote, setInputNote] = useState("");
  const allocation = getDemographicAllocationStatus(demo, uniqueCap);
  const totals = allocation.totals;
  const helperMessage = inputNote || allocation.validationMessage || "Whole numbers only. Total must match Unique Count before finalizing.";
  const helperTone = inputNote || allocation.remaining > 0 ? "text-amber-700" : allocation.isOverCap ? "text-red-700" : "text-gray-400";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="block text-xs font-semibold tracking-wider text-[#111827] uppercase">Demographics Breakdown</label>
        <span className="text-[10px] font-bold text-gray-500">Unique cap: {allocation.cap.toLocaleString()}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 rounded-sm border border-gray-200 bg-white p-2">
        {groups.map((group) => (
          <div key={group.title} className="min-w-0 border-r border-gray-100 pr-2 last:border-r-0 last:pr-0">
            <InfoTooltip content={group.description} align="left">
              <p className="mb-2 truncate text-[9px] font-bold text-[#111827] uppercase">{group.title}</p>
            </InfoTooltip>
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
