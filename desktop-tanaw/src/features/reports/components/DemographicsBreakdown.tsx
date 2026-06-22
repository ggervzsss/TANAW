import type { DemoBreakdown } from "../../../types/enterprise";

type DemographicsBreakdownProps = {
  demo: DemoBreakdown;
  isReadOnly: boolean;
  setDemo: React.Dispatch<React.SetStateAction<DemoBreakdown>>;
};

const groups = [
  { title: "This Prov.", titleText: "This Province", maleKey: "thisProvMale", femaleKey: "thisProvFemale", className: "border-r border-gray-100 pr-2" },
  { title: "Other Prov.", titleText: "Other Province", maleKey: "otherProvMale", femaleKey: "otherProvFemale", className: "border-r border-gray-100 pr-2 pl-1" },
  { title: "Foreign", titleText: "Foreign Country", maleKey: "foreignMale", femaleKey: "foreignFemale", className: "pl-1" },
] as const;

export function DemographicsBreakdown({ demo, isReadOnly, setDemo }: DemographicsBreakdownProps) {
  return (
    <div>
      <label className="mb-2 block text-xs font-semibold tracking-wider text-[#111827] uppercase">Demographics Breakdown</label>
      <div className="grid grid-cols-3 gap-2 rounded-sm border border-gray-200 bg-white p-2">
        {groups.map((group) => (
          <div key={group.title} className={group.className}>
            <p className="mb-2 truncate text-[9px] font-bold text-[#111827] uppercase" title={group.titleText}>
              {group.title}
            </p>
            <div className="space-y-2">
              <DemographicInput placeholder="M" field={group.maleKey} demo={demo} disabled={isReadOnly} setDemo={setDemo} />
              <DemographicInput placeholder="F" field={group.femaleKey} demo={demo} disabled={isReadOnly} setDemo={setDemo} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemographicInput({
  demo,
  disabled,
  field,
  placeholder,
  setDemo,
}: {
  demo: DemoBreakdown;
  disabled: boolean;
  field: keyof DemoBreakdown;
  placeholder: string;
  setDemo: React.Dispatch<React.SetStateAction<DemoBreakdown>>;
}) {
  return (
    <input
      type="number"
      placeholder={placeholder}
      disabled={disabled}
      value={demo[field]}
      onChange={(event) => setDemo({ ...demo, [field]: event.target.value })}
      className="w-full rounded-sm border border-gray-300 p-1.5 text-center text-xs outline-none focus:border-[#065f46] disabled:bg-gray-50"
    />
  );
}
