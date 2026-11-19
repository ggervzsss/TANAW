import { Check, Code2, Gauge } from "lucide-react";
import { useState } from "react";
import { Card } from "../../components/Card";
import { DesignSwitch } from "../../components/DesignSwitch";
import { DEVICE_PERFORMANCE_OPTIONS, devicePerformanceLabel, readDevicePerformanceProfile, useDevicePerformanceProfile, type DevicePerformanceProfile } from "../camera/model/device-performance";
import { applyDevicePerformanceProfile, DEFAULT_ML_SERVICE_BASE_URL, getMlServiceStatus } from "../camera/services/ml-service";
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from "../toasts/services/toast-service";
import { updateDeveloperSettings, useDeveloperSettings } from "./developer-settings";

type ApplyState = { kind: "idle" } | { kind: "applying" } | { kind: "done"; message: string } | { kind: "error"; message: string };

export function DeveloperSettingsView() {
  const settings = useDeveloperSettings();
  const profile = useDevicePerformanceProfile();
  const [applyState, setApplyState] = useState<ApplyState>({ kind: "idle" });

  const chooseProfile = async (next: DevicePerformanceProfile) => {
    if (next === profile || applyState.kind === "applying") return;
    setApplyState({ kind: "applying" });
    const label = devicePerformanceLabel(next);
    try {
      const status = await getMlServiceStatus();
      const restarted = await applyDevicePerformanceProfile(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL, next);
      setApplyState({
        kind: "done",
        message:
          restarted === 0
            ? `Using ${label}. Cameras use it when they start.`
            : `Using ${label}. Restarting ${restarted === 1 ? "1 running camera" : `${restarted} running cameras`} with it.`,
      });
      if (restarted > 0) notifyInfo(`${label} selected. The camera service is restarting running cameras.`, "performance-profile");
      else notifySuccess(`Performance profile applied. Using ${label}.`, "performance-profile");
    } catch {
      const selected = readDevicePerformanceProfile() === next;
      const message = selected
        ? `${label} selected. Running cameras could not restart. Restart them from Camera Setup to apply the change.`
        : "Performance profile could not be changed. Check the camera service and try again.";
      setApplyState({ kind: "error", message });
      if (selected) notifyWarning(message, "performance-profile");
      else notifyError(message, "performance-profile");
    }
  };

  return (
    <div className="animate-in fade-in mx-auto w-full max-w-260 space-y-6 pt-2 font-sans duration-500">
      <header>
        <p className="mb-2 text-[11px] font-black tracking-[0.24em] text-tanaw-gold-ink dark:text-(--tanaw-gold-ink) uppercase">This computer</p>
        <h2 className="text-2xl font-bold tracking-tight text-[#111827] dark:text-white">Developer Settings</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-slate-300">
          Detection models and diagnostic overlays for testing cameras. They are saved on this computer only and apply to every camera on it.
        </p>
      </header>

      <Card className="overflow-hidden rounded-[28px] border-emerald-100/80 shadow-[0_22px_60px_rgba(15,23,42,0.08)] dark:border-white/10">
        <div className="h-1.5 bg-linear-to-r from-tanaw-ledger via-tanaw-live to-[#d6ad33]" />
        <SectionHeading icon={<Gauge size={18} />} title="Performance profile" description="How hard this computer works on every camera. Changing it restarts running cameras." />
        <fieldset className="p-6">
          <legend className="sr-only">Performance profile</legend>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {DEVICE_PERFORMANCE_OPTIONS.map((option) => {
              const selected = profile === option.value;
              return (
                <label
                  key={option.value}
                  className={`relative rounded-xl border p-3 transition ${selected ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600 dark:border-emerald-400 dark:bg-emerald-400/10 dark:ring-emerald-400" : "border-slate-200 bg-white hover:border-emerald-300 dark:border-white/12 dark:bg-white/4"} ${applyState.kind === "applying" ? "cursor-wait opacity-70" : "cursor-pointer"}`}
                >
                  <input
                    type="radio"
                    name="performance-profile"
                    value={option.value}
                    checked={selected}
                    disabled={applyState.kind === "applying"}
                    onChange={() => void chooseProfile(option.value)}
                    className="peer sr-only"
                  />
                  <span className="flex items-center justify-between gap-2 text-sm font-bold text-slate-900 dark:text-white">
                    {option.label} {selected && <Check size={15} className="text-emerald-700 dark:text-emerald-300" aria-hidden="true" />}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-300">{option.description}</span>
                </label>
              );
            })}
          </div>
          <p
            role={applyState.kind === "error" ? "alert" : "status"}
            aria-live="polite"
            className={`mt-3 min-h-5 text-sm ${applyState.kind === "error" ? "font-semibold text-red-700 dark:text-red-300" : "text-slate-500 dark:text-slate-300"}`}
          >
            {applyState.kind === "applying" ? "Applying…" : applyState.kind === "done" || applyState.kind === "error" ? applyState.message : null}
          </p>
        </fieldset>
      </Card>

      <Card className="overflow-hidden rounded-[28px] border-emerald-100/80 shadow-[0_22px_60px_rgba(15,23,42,0.08)] dark:border-white/10">
        <SectionHeading icon={<Code2 size={18} />} title="Camera preview" description="Normally each detected person shows only a plain box." />
        <div className="space-y-4 p-6">
          <DesignSwitch
            label="Detection details"
            description="Show each person's tracker number, tracking state (for example In monitored area) and detection confidence."
            checked={settings.detectionLabels}
            onChange={(detectionLabels) => updateDeveloperSettings({ detectionLabels })}
          />
          <DesignSwitch
            label="Male/female estimate"
            description="Show each person's live estimate and how much evidence it rests on. It is not saved; Reports keep only daily totals. Estimates need a clear view of the body."
            checked={settings.demographics}
            onChange={(demographics) => updateDeveloperSettings({ demographics })}
          />
        </div>
      </Card>
    </div>
  );
}

function SectionHeading({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-200 p-6 dark:border-white/10">
      <span className="text-emerald-700 dark:text-emerald-300" aria-hidden="true">
        {icon}
      </span>
      <div>
        <h3 className="text-xl font-bold text-slate-950 dark:text-white">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-300">{description}</p>
      </div>
    </div>
  );
}
