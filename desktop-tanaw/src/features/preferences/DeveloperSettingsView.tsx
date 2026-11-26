import { Code2, Gauge, LayoutDashboard } from "lucide-react";
import { useState } from "react";
import { SettingsGroup } from "../../ui-kit/patterns/GeneralSettings";
import { DesignSwitch } from "../../components/DesignSwitch";
import { DEVICE_PERFORMANCE_OPTIONS, devicePerformanceLabel, readDevicePerformanceProfile, useDevicePerformanceProfile, type DevicePerformanceProfile } from "../camera/model/device-performance";
import { applyDevicePerformanceProfile, DEFAULT_ML_SERVICE_BASE_URL, getMlServiceStatus } from "../camera/services/ml-service";
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from "../toasts/services/toast-service";
import { SAMPLE_DASHBOARD_SHORTCUT, updateDeveloperSettings, useDeveloperSettings } from "./developer-settings";

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
    <div>
      <SettingsGroup icon={<Gauge size={17} aria-hidden="true" />} title="Performance profile" description="How hard this computer works on every camera. Changing it restarts running cameras.">
        <fieldset>
          <legend className="sr-only">Performance profile</legend>
          <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
            {DEVICE_PERFORMANCE_OPTIONS.map((option) => {
              return (
                <label
                  key={option.value}
                  className="tanaw-choice"
                >
                  <input
                    type="radio"
                    name="performance-profile"
                    value={option.value}
                    checked={profile === option.value}
                    disabled={applyState.kind === "applying"}
                    onChange={() => void chooseProfile(option.value)}
                    className="peer sr-only"
                  />
                  <span className="tanaw-choice-title">{option.label}</span>
                  <span className="tanaw-choice-description">{option.description}</span>
                </label>
              );
            })}
          </div>
          <p
            role={applyState.kind === "error" ? "alert" : "status"}
            aria-live="polite"
            className={`mt-3 min-h-5 text-[0.8125rem] ${applyState.kind === "error" ? "font-semibold text-(--tanaw-error)" : "text-(--tanaw-text-secondary)"}`}
          >
            {applyState.kind === "applying" ? "Applying…" : applyState.kind === "done" || applyState.kind === "error" ? applyState.message : null}
          </p>
        </fieldset>
      </SettingsGroup>

      <SettingsGroup icon={<Code2 size={17} aria-hidden="true" />} title="Camera preview" description="Normally each detected person shows only a plain box.">
        <div>
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
      </SettingsGroup>

      <SettingsGroup icon={<LayoutDashboard size={17} aria-hidden="true" />} title="Dashboard preview" description="For checking the Dashboard layout before real counts build up.">
        <DesignSwitch
          label="Sample dashboard data"
          description={`Fill the Dashboard with made-up counts, cameras and reports. Nothing is saved, sent to the LGU or added to reports. A note on the Dashboard shows while it is on. On the Dashboard, ${SAMPLE_DASHBOARD_SHORTCUT} switches it on or off.`}
          checked={settings.sampleDashboard}
          onChange={(sampleDashboard) => updateDeveloperSettings({ sampleDashboard })}
        />
      </SettingsGroup>
    </div>
  );
}
