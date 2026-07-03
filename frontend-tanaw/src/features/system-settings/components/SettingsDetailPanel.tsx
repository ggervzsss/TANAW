import { RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Panel } from "@/shared/components/panel";
import type { SettingField, SettingSection, SettingValue } from "../types";

type SettingsDetailPanelProps = {
  section: SettingSection;
  storedValues: Record<string, SettingValue>;
  isSaving: boolean;
  metadataLabel: string;
  additionalContent?: ReactNode;
  onSave: (values: Record<string, SettingValue>) => void;
};

export function SettingsDetailPanel({ section, storedValues, isSaving, metadataLabel, additionalContent, onSave }: SettingsDetailPanelProps) {
  const Icon = section.icon;
  const defaults = useMemo<Record<string, SettingValue>>(() => Object.fromEntries(section.fields.map((field) => [settingKey(section.id, field), field.value])), [section.fields, section.id]);
  const [values, setValues] = useState<Record<string, SettingValue>>({
    ...defaults,
    ...storedValues,
  });

  return (
    <Panel className="overflow-hidden p-6">
      <div className="mb-6 flex items-start justify-between gap-4 border-b border-gray-200 pb-5 max-sm:flex-col">
        <div className="flex items-start gap-4">
          <div className="bg-tgreen-dark/10 text-tgreen-dark rounded-lg p-3">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">{section.title}</h3>
            <p className="mt-1 text-sm text-gray-500">{metadataLabel}</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold text-emerald-700 uppercase">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Editable
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {section.fields.map((field) => (
          <div key={field.label} className="rounded-xl border border-gray-200 bg-white p-5">
            <label className="block">
              <span className="mb-2 block text-[10px] font-bold tracking-wide text-gray-500 uppercase">{field.label}</span>
              {field.description && <span className="mb-4 block text-sm leading-6 text-gray-500">{field.description}</span>}
              <SettingControl
                field={field}
                value={values[settingKey(section.id, field)] ?? field.value}
                onChange={(value) =>
                  setValues((current) => ({
                    ...current,
                    [settingKey(section.id, field)]: value,
                  }))
                }
              />
            </label>
          </div>
        ))}
        {additionalContent}
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-5">
        <div className="flex flex-wrap justify-end gap-3">
          <button
            onClick={() => {
              setValues((current) => ({ ...current, ...defaults }));
              toast.success("Selected settings reset to defaults.");
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            <RotateCcw size={15} /> Reset Defaults
          </button>
          <button
            disabled={isSaving}
            onClick={() => {
              const sectionValues = Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith(`${section.id}.`)));
              onSave(sectionValues);
            }}
            className="bg-tgreen-dark hover:bg-tgreen-light inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-md transition"
          >
            <Save size={15} /> {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </Panel>
  );
}

function SettingControl({ field, value, onChange }: { field: SettingField; value: SettingValue; onChange: (value: SettingValue) => void }) {
  if (field.type === "toggle") {
    return (
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-semibold text-gray-700">{value ? "Enabled" : "Disabled"}</span>
        <input className="accent-tgreen-dark h-5 w-5" type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
      </div>
    );
  }

  return (
    <select
      value={String(value)}
      onChange={(event) => onChange(typeof field.value === "number" ? Number(event.target.value) : event.target.value)}
      className="focus:ring-tgreen-dark w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 outline-none focus:ring-1"
    >
      {field.options.map((option) => (
        <option key={String(option)} value={String(option)}>
          {formatSelectOption(field, option)}
        </option>
      ))}
    </select>
  );
}

function formatSelectOption(field: SettingField, option: string | number) {
  if (field.type !== "select") return String(option);
  if (field.key === "loginAttemptLimit") return `${option} attempts`;
  if (field.key === "loginLockMinutes") return `${option} minutes`;
  if (field.key === "retentionDays") return `${option} days`;
  return String(option);
}

function settingKey(sectionId: string, field: SettingField) {
  return `${sectionId}.${field.key ?? field.label}`;
}
