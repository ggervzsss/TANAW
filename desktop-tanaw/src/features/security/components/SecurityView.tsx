import { type FormEvent, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getStartupSettings, updateStartupSettings } from "../../../lib/appLifecycle";
import { validatePasswordPolicy } from "../../../utils/password-policy";
import { changePassword, getAccountPreferences, requestDataArchive, updateAccountPreferences } from "../../login/api/login";
import { useAuthStore } from "../../login/stores/auth-store";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import { readLocalStartupPreference, writeLocalStartupPreference } from "../utils/startupPreference";
import { ActiveSessionsPanel } from "./ActiveSessionsPanel";
import { BackgroundMonitoringPanel, type StartupFeedback } from "./BackgroundMonitoringPanel";
import { CredentialControl } from "./CredentialControl";
import { DataArchivePanel } from "./DataArchivePanel";

const STARTUP_UNAVAILABLE_MESSAGE = "Startup at sign-in is not available in this environment.";

export function SecurityView() {
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);
  const [isPasswordSuccess, setIsPasswordSuccess] = useState(false);
  const [isArchiveLoading, setIsArchiveLoading] = useState(false);
  const [isArchiveSuccess, setIsArchiveSuccess] = useState(false);
  const [isStartupLoading, setIsStartupLoading] = useState(false);
  const [isStartupAvailable, setIsStartupAvailable] = useState(() => Boolean(window.tanawAppLifecycle));
  const [openAtLogin, setOpenAtLogin] = useState(false);
  const [startupFeedback, setStartupFeedback] = useState<StartupFeedback | null>(null);

  useEffect(() => {
    let isMounted = true;
    void loadStartupPreference()
      .then(({ feedback, isAvailable, openAtLogin }) => {
        if (!isMounted) return;
        setOpenAtLogin(openAtLogin);
        setIsStartupAvailable(isAvailable);
        setStartupFeedback(feedback);
      })
      .catch(() => {
        if (!isMounted) return;
        setOpenAtLogin(false);
        setIsStartupAvailable(false);
        setStartupFeedback({ message: STARTUP_UNAVAILABLE_MESSAGE, tone: "warning" });
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handlePasswordUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (newPassword !== confirmPassword) {
      notifyError("New passwords do not match.");
      return;
    }
    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) {
      notifyError(policyError);
      return;
    }

    setIsPasswordLoading(true);
    try {
      const session = await changePassword(currentPassword, newPassword);
      queryClient.removeQueries({ queryKey: ["enterprise-current-user"] });
      setSession(session);
      setIsPasswordSuccess(true);
      notifySuccess("Password updated.");
      window.setTimeout(() => setIsPasswordSuccess(false), 3000);
      form.reset();
    } catch {
      notifyError("Unable to update password. Check your current password and try again.");
    } finally {
      setIsPasswordLoading(false);
    }
  };

  const handleDataArchive = async () => {
    setIsArchiveLoading(true);
    try {
      await requestDataArchive();
      setIsArchiveLoading(false);
      setIsArchiveSuccess(true);
      window.setTimeout(() => setIsArchiveSuccess(false), 3000);
      notifySuccess("Data archive request recorded.");
    } catch {
      setIsArchiveLoading(false);
      notifyError("Unable to request data archive.");
    }
  };

  const handleStartupToggle = async (enabled: boolean) => {
    setIsStartupLoading(true);
    const previousValue = openAtLogin;
    setOpenAtLogin(enabled);
    setStartupFeedback(null);
    try {
      const settings = await updateStartupSettings(enabled);
      const persistedValue = settings.isAvailable ? settings.openAtLogin : false;
      setOpenAtLogin(persistedValue);
      setIsStartupAvailable(settings.isAvailable);
      writeLocalStartupPreference(persistedValue);
      try {
        await updateAccountPreferences({ openAtLogin: persistedValue });
      } catch {
        writeLocalStartupPreference(persistedValue);
      }
      setStartupFeedback(
        settings.isAvailable
          ? {
              message: settings.openAtLogin ? "TANAW startup at sign-in enabled." : "TANAW startup at sign-in disabled.",
              tone: "success",
            }
          : { message: settings.message ?? STARTUP_UNAVAILABLE_MESSAGE, tone: "warning" },
      );
    } catch {
      setOpenAtLogin(previousValue);
      setStartupFeedback({ message: "Unable to update startup setting. Please try again.", tone: "error" });
    } finally {
      setIsStartupLoading(false);
    }
  };

  return (
    <div className="animate-in fade-in mx-auto w-full max-w-290 space-y-6 pt-2 font-['Inter'] duration-500">
      <div className="mx-auto w-full">
        <p className="mb-2 text-[11px] font-black tracking-[0.24em] text-[#b7952b] uppercase">Enterprise Controls</p>
        <h2 className="text-2xl font-bold tracking-tight text-[#111827]">Security & Data Control</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500">Manage credentials, active sessions, and system-wide preferences.</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(340px,0.88fr)]">
        <div className="space-y-6">
          <CredentialControl isLoading={isPasswordLoading} isSuccess={isPasswordSuccess} onSubmit={handlePasswordUpdate} />
          <ActiveSessionsPanel />
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-1">
          <BackgroundMonitoringPanel feedback={startupFeedback} isAvailable={isStartupAvailable} isLoading={isStartupLoading} openAtLogin={openAtLogin} onToggleStartup={handleStartupToggle} />
          <DataArchivePanel isLoading={isArchiveLoading} isSuccess={isArchiveSuccess} onRequestArchive={handleDataArchive} />
        </div>
      </div>
    </div>
  );
}

async function loadStartupPreference() {
  const startupSettings = await getStartupSettings();
  let preferredOpenAtLogin: boolean | null = null;

  try {
    const preferences = await getAccountPreferences();
    preferredOpenAtLogin = preferences.openAtLogin;
    writeLocalStartupPreference(preferences.openAtLogin);
  } catch {
    preferredOpenAtLogin = readLocalStartupPreference();
  }

  if (!startupSettings.isAvailable) {
    const feedback: StartupFeedback = { message: startupSettings.message ?? STARTUP_UNAVAILABLE_MESSAGE, tone: "warning" };
    return {
      feedback,
      isAvailable: false,
      openAtLogin: false,
    };
  }

  const desiredOpenAtLogin = preferredOpenAtLogin ?? startupSettings.openAtLogin;
  if (desiredOpenAtLogin !== startupSettings.openAtLogin) {
    try {
      const appliedSettings = await updateStartupSettings(desiredOpenAtLogin);
      return {
        feedback: null,
        isAvailable: appliedSettings.isAvailable,
        openAtLogin: appliedSettings.openAtLogin,
      };
    } catch {
      const feedback: StartupFeedback = { message: "Unable to update startup setting. Please try again.", tone: "error" };
      return {
        feedback,
        isAvailable: true,
        openAtLogin: startupSettings.openAtLogin,
      };
    }
  }

  return {
    feedback: null,
    isAvailable: true,
    openAtLogin: startupSettings.openAtLogin,
  };
}
