import { RotateCcw, Save } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Panel } from "@/shared/components/panel";
import type { SettingField, SettingSection, SettingValue } from "../types";

type SettingsDetailPanelProps = {
  sections: SettingSection[];
  storedValues: Record<string, SettingValue>;
  isSaving: boolean;
  metadataLabel: string;
  additionalContentBySectionId?: Partial<Record<string, ReactNode>>;
  onSave: (values: Record<string, SettingValue>) => void;
};

export function SettingsDetailPanel({ sections, storedValues, isSaving, metadataLabel, additionalContentBySectionId, onSave }: SettingsDetailPanelProps) {
  const defaults = useMemo<Record<string, SettingValue>>(
    () => Object.fromEntries(sections.flatMap((section) => section.fields.map((field) => [settingKey(section.id, field), field.value]))),
    [sections],
  );
  const [values, setValues] = useState<Record<string, SettingValue>>({
    ...defaults,
    ...storedValues,
  });

  return (
    <Panel className="mx-auto max-w-6xl overflow-hidden p-6">
      <div className="mb-6 border-b border-gray-200 pb-5">
        <p className="text-sm font-semibold text-gray-500">{metadataLabel}</p>
      </div>

      <div className="space-y-8">
        {sections.map((section) => {
          const Icon = section.icon;

          return (
            <section key={section.id}>
              <div className="mb-4 flex items-center gap-3">
                <div className="bg-tgreen-dark/10 text-tgreen-dark rounded-lg p-3">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">{section.title}</h3>
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
                {additionalContentBySectionId?.[section.id]}
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-5">
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setValues((current) => ({ ...current, ...defaults }));
              toast.success("System settings reset to defaults.");
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            <RotateCcw size={15} /> Reset Defaults
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => onSave(values)}
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
