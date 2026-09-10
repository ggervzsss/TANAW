import { Check, CircleAlert, Save, ShieldAlert } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Panel } from "@/shared/components/panel";
import { FilterSelect, ModalFrame, Switch } from "@/shared/components/ui";
import type { SettingField, SettingSection, SettingValue } from "../types";

type SettingsDetailPanelProps = {
  sections: SettingSection[];
  storedValues: Record<string, SettingValue>;
  metadataLabel: string;
  additionalContentBySectionId?: Partial<Record<string, ReactNode>>;
  onPersist: (values: Record<string, SettingValue>) => Promise<Record<string, SettingValue>>;
};

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function SettingsDetailPanel({ sections, storedValues, metadataLabel, additionalContentBySectionId, onPersist }: SettingsDetailPanelProps) {
  const defaults = useMemo<Record<string, SettingValue>>(
    () => Object.fromEntries(sections.flatMap((section) => section.fields.map((field) => [settingKey(section.id, field), field.value]))),
    [sections],
  );
  const initialValues = useMemo(() => ({ ...defaults, ...storedValues }), [defaults, storedValues]);
  const [values, setValues] = useState<Record<string, SettingValue>>(initialValues);
  const [saveStateByKey, setSaveStateByKey] = useState<Record<string, SaveState>>({});
  const [confirmSecurity, setConfirmSecurity] = useState(false);
  const confirmedRef = useRef(initialValues);
  const valuesRef = useRef(initialValues);
  const failedPatchByKeyRef = useRef<Record<string, Record<string, SettingValue>>>({});
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  const queuePatch = (patch: Record<string, SettingValue>) => {
    const keys = Object.keys(patch);
    const snapshot = { ...patch };
    setSaveStateByKey((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, "saving"])) }));
    saveChainRef.current = saveChainRef.current.then(async () => {
      try {
        const persisted = await onPersist(snapshot);
        confirmedRef.current = { ...confirmedRef.current, ...persisted };
        keys.forEach((key) => {
          delete failedPatchByKeyRef.current[key];
        });
        const settledKeys = keys.filter((key) => valuesRef.current[key] === snapshot[key]);
        if (settledKeys.length > 0) {
          const nextValues = { ...valuesRef.current };
          settledKeys.forEach((key) => {
            nextValues[key] = persisted[key] ?? snapshot[key];
          });
          valuesRef.current = nextValues;
          setValues(nextValues);
          setSaveStateByKey((current) => ({ ...current, ...Object.fromEntries(settledKeys.map((key) => [key, "saved"])) }));
        }
      } catch {
        const failedKeys = keys.filter((key) => valuesRef.current[key] === snapshot[key]);
        if (failedKeys.length === 0) return;
        failedKeys.forEach((key) => {
          failedPatchByKeyRef.current[key] = snapshot;
        });
        const rolledBack = { ...valuesRef.current };
        failedKeys.forEach((key) => {
          rolledBack[key] = confirmedRef.current[key];
        });
        valuesRef.current = rolledBack;
        setValues(rolledBack);
        setSaveStateByKey((current) => ({ ...current, ...Object.fromEntries(failedKeys.map((key) => [key, "error"])) }));
      }
    });
  };

  const updateValue = (key: string, value: SettingValue, immediate: boolean) => {
    const next = { ...valuesRef.current, [key]: value };
    valuesRef.current = next;
    setValues(next);
    if (immediate) {
      queuePatch({ [key]: value });
    } else {
      setSaveStateByKey((current) => ({ ...current, [key]: value === confirmedRef.current[key] ? "idle" : "dirty" }));
    }
  };

  const retryFailedPatch = (key: string) => {
    const patch = failedPatchByKeyRef.current[key];
    if (!patch) return;
    valuesRef.current = { ...valuesRef.current, ...patch };
    setValues(valuesRef.current);
    queuePatch(patch);
  };

  const saveSection = (section: SettingSection) => {
    const patch = Object.fromEntries(
      section.fields.map((field) => {
        const key = settingKey(section.id, field);
        return [key, valuesRef.current[key]];
      }),
    );
    queuePatch(patch);
  };

  return (
    <Panel className="mx-auto max-w-6xl overflow-hidden">
      <div className="border-b border-slate-200 px-6 py-5 dark:border-white/10">
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-300">{metadataLabel}</p>
      </div>
      <div className="divide-y divide-slate-200 dark:divide-white/10">
        {sections.map((section) => {
          const Icon = section.icon;
          const isImmediateSection = section.id === "display" || section.id === "notifications";
          const sectionKeys = section.fields.map((field) => settingKey(section.id, field));
          const isDirty = sectionKeys.some((key) => saveStateByKey[key] === "dirty");
          const isSaving = sectionKeys.some((key) => saveStateByKey[key] === "saving");
          return (
            <section key={section.id} className="p-6 sm:p-7">
              <div className="mb-5 flex items-start gap-3">
                <div className="bg-tgreen-dark/10 text-tgreen-dark rounded-xl p-3 dark:bg-emerald-300/10 dark:text-emerald-300"><Icon className="h-5 w-5" /></div>
                <div>
                  <h2 className="text-lg font-bold text-slate-950 dark:text-white">{section.title}</h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-300">{section.description}</p>
                </div>
              </div>
              <div className="divide-y divide-slate-100 border-y border-slate-100 dark:divide-white/8 dark:border-white/8">
                {section.fields.map((field) => {
                  const key = settingKey(section.id, field);
                  return <SettingRow key={key} field={field} value={values[key] ?? field.value} saveState={saveStateByKey[key] ?? "idle"} onChange={(value) => updateValue(key, value, isImmediateSection)} onRetry={() => retryFailedPatch(key)} />;
                })}
              </div>
              {!isImmediateSection && (
                <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                  {isDirty && <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">Unsaved section changes</span>}
                  <button type="button" disabled={!isDirty || isSaving} onClick={() => (section.id === "security" ? setConfirmSecurity(true) : saveSection(section))} className="bg-tgreen-dark hover:bg-tgreen-light inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50">
                    <Save size={15} /> {isSaving ? "Applying…" : "Apply section"}
                  </button>
                </div>
              )}
              {additionalContentBySectionId?.[section.id] && <div className="mt-5">{additionalContentBySectionId[section.id]}</div>}
            </section>
          );
        })}
      </div>
      {confirmSecurity && (
        <ModalFrame title="Apply Sign-in Protection" eyebrow="Security setting" onClose={() => setConfirmSecurity(false)} maxWidthClassName="max-w-xl">
          <div className="space-y-5">
            <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100"><ShieldAlert className="mt-0.5 shrink-0" size={20} /><p className="text-sm leading-6">These values change when accounts are temporarily locked after failed sign-in attempts. The change applies to all TANAW accounts and can be changed again later.</p></div>
            <div className="flex justify-end gap-3 border-t border-slate-100 pt-5 dark:border-white/10">
              <button type="button" onClick={() => setConfirmSecurity(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 dark:border-white/15 dark:text-slate-100">Cancel</button>
              <button type="button" onClick={() => { const section = sections.find((candidate) => candidate.id === "security"); if (section) saveSection(section); setConfirmSecurity(false); }} className="bg-tgreen-dark rounded-xl px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700">Apply to all accounts</button>
            </div>
          </div>
        </ModalFrame>
      )}
    </Panel>
  );
}

function SettingRow({ field, value, saveState, onChange, onRetry }: { field: SettingField; value: SettingValue; saveState: SaveState; onChange: (value: SettingValue) => void; onRetry: () => void }) {
  return (
    <div className="grid gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)] sm:items-center">
      <div><h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{field.label}</h3>{field.description && <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-300">{field.description}</p>}</div>
      <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
        {field.type === "toggle" ? <Switch checked={Boolean(value)} label={field.label} disabled={saveState === "saving"} onChange={onChange} /> : <FilterSelect value={String(value)} onChange={(nextValue) => onChange(typeof field.value === "number" ? Number(nextValue) : nextValue)} options={field.options.map((option) => [String(option), formatSelectOption(field, option)] as const)} ariaLabel={field.label} className="min-w-52" />}
        <SettingSaveStatus state={saveState} onRetry={onRetry} />
      </div>
    </div>
  );
}

function SettingSaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "idle" || state === "dirty") return null;
  if (state === "error") return <span role="alert" className="inline-flex items-center gap-1 text-xs font-bold text-red-700 dark:text-red-300"><CircleAlert size={14} /> Failed <button type="button" onClick={onRetry} className="underline underline-offset-2">Retry</button></span>;
  return <span role="status" aria-live="polite" className="inline-flex min-w-16 items-center gap-1 text-xs font-bold text-slate-500 dark:text-slate-300">{state === "saving" ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" /> : <Check size={14} className="text-emerald-600" />}{state === "saving" ? "Saving…" : "Saved"}</span>;
}

function formatSelectOption(field: SettingField, option: string | number) {
  if (field.type !== "select") return String(option);
  if (field.key === "loginAttemptLimit") return `${option} attempts`;
  if (field.key === "loginLockMinutes") return `${option} minutes`;
  if (field.key === "retentionDays") return `${option} days`;
  if (field.key === "timeFormat") return option === "24-hour" ? "24-hour" : "12-hour (AM/PM)";
  return String(option);
}

function settingKey(sectionId: string, field: SettingField) {
  return `${sectionId}.${field.key ?? field.label}`;
}
