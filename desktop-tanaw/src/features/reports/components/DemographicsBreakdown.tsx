import { ShieldCheck } from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { DemoBreakdown, DemographicEvidence } from "../../../types/enterprise";
import { CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE, formatDemographicValue, getDemographicEvidenceStatus, getExplicitDemographicTotals, parseDemographicCount } from "../utils/demographics";

type DemographicsBreakdownProps = {
  demo: DemoBreakdown;
  demographicEvidence: DemographicEvidence | null;
  isReadOnly: boolean;
  setDemo: Dispatch<SetStateAction<DemoBreakdown>>;
  setDemographicEvidence: Dispatch<SetStateAction<DemographicEvidence | null>>;
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

export function DemographicsBreakdown({ demo, demographicEvidence, isReadOnly, setDemo, setDemographicEvidence }: DemographicsBreakdownProps) {
  const [inputNote, setInputNote] = useState("");
  const evidenceStatus = getDemographicEvidenceStatus(demo);
  const explicitTotals = getExplicitDemographicTotals(demo);
  const helperMessage =
    inputNote ||
    evidenceStatus.validationMessage ||
    (demographicEvidence
      ? "Confirmed operator-entered facts. Missing categories remain Not provided."
      : evidenceStatus.hasAnyValue
        ? "Confirm the source for the values entered, or clear them to submit without demographic facts."
        : "No demographic facts entered. The report may be submitted with every demographic category marked Not provided.");
  const helperTone = inputNote || evidenceStatus.validationMessage || (evidenceStatus.hasAnyValue && !demographicEvidence) ? "text-amber-700" : "text-gray-500";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="block text-xs font-semibold tracking-wider text-[#111827] uppercase">Demographics Breakdown</label>
        <span className="text-[10px] font-bold text-gray-500">Optional operator facts</span>
      </div>
      <p className="mb-3 text-[10px] leading-relaxed font-semibold text-gray-500">
        Enter only counts directly supplied by an operator. Leave unknown values blank; TANAW does not infer a split, reuse a previous mix, or fill a remainder.
      </p>

      <div className="grid grid-cols-3 gap-2 rounded-sm border border-gray-200 bg-white p-2">
        {groups.map((group) => (
          <div key={group.title} className="min-w-0 border-r border-gray-100 pr-2 last:border-r-0 last:pr-0">
            <InfoTooltip content={group.description} align="left">
              <p className="mb-2 truncate text-[9px] font-bold text-[#111827] uppercase">{group.title}</p>
            </InfoTooltip>
            <div className="space-y-2">
              <DemographicInput demo={demo} disabled={isReadOnly} field={group.maleKey} label="Male" setDemo={setDemo} setDemographicEvidence={setDemographicEvidence} setInputNote={setInputNote} />
              <DemographicInput
                demo={demo}
                disabled={isReadOnly}
                field={group.femaleKey}
                label="Female"
                setDemo={setDemo}
                setDemographicEvidence={setDemographicEvidence}
                setInputNote={setInputNote}
              />
              <div className="rounded-sm border border-gray-200 bg-gray-50 px-2 py-1.5 text-center">
                <p className="text-[8px] font-bold tracking-wider text-gray-400 uppercase">Explicit total</p>
                <p className="font-mono text-xs font-bold text-[#111827]">{formatDemographicValue(explicitTotals[group.totalKey])}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {!isReadOnly && (
        <label
          className={`mt-3 flex items-start gap-2 rounded-sm border p-3 ${evidenceStatus.hasAnyValue && !evidenceStatus.validationMessage ? "border-gray-200 bg-gray-50" : "border-gray-100 bg-gray-50/60"}`}
        >
          <input
            type="checkbox"
            checked={demographicEvidence?.quality === "confirmed"}
            disabled={!evidenceStatus.hasAnyValue || Boolean(evidenceStatus.validationMessage)}
            onChange={(event) => setDemographicEvidence(event.target.checked ? CONFIRMED_OPERATOR_DEMOGRAPHIC_EVIDENCE : null)}
            className="mt-0.5 accent-[#065f46] disabled:cursor-not-allowed"
          />
          <span>
            <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-[#111827] uppercase">
              <ShieldCheck size={12} /> Confirm operator evidence
            </span>
            <span className="mt-1 block text-[10px] leading-relaxed font-semibold text-gray-500">
              I confirm only the values entered above are operator-provided facts. Blank categories remain unknown and were not generated by TANAW.
            </span>
          </span>
        </label>
      )}

      {isReadOnly && (
        <p className="mt-3 text-[10px] font-semibold text-gray-500">
          Evidence: {demographicEvidence ? `${demographicEvidence.provenance.replace("_", " ")} / ${demographicEvidence.quality}` : "Not provided"}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-3 text-[10px] font-semibold">
        <span className={helperTone}>{helperMessage}</span>
        <span className="shrink-0 text-[#065f46]">Explicit grand total: {formatDemographicValue(explicitTotals.grandTotal)}</span>
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
  setDemographicEvidence: Dispatch<SetStateAction<DemographicEvidence | null>>;
  setInputNote: Dispatch<SetStateAction<string>>;
};

function DemographicInput({ demo, disabled, field, label, setDemo, setDemographicEvidence, setInputNote }: DemographicInputProps) {
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
        onChange={(event) => updateDemographicValue(event.target.value, field, setDemo, setDemographicEvidence, setInputNote)}
        className="w-full rounded-sm border border-gray-300 p-1.5 text-center text-xs outline-none focus:border-[#065f46] disabled:bg-gray-50"
      />
    </label>
  );
}

function updateDemographicValue(
  rawValue: string,
  field: keyof DemoBreakdown,
  setDemo: Dispatch<SetStateAction<DemoBreakdown>>,
  setDemographicEvidence: Dispatch<SetStateAction<DemographicEvidence | null>>,
  setInputNote: Dispatch<SetStateAction<string>>,
) {
  if (rawValue !== "" && parseDemographicCount(rawValue) === null) {
    setInputNote("Enter a whole number from 0 to 2,147,483,647.");
    return;
  }

  setInputNote("");
  setDemographicEvidence(null);
  setDemo((current) => ({ ...current, [field]: rawValue }));
}
