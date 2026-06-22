import { type FormEvent, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ThemePreference } from "../../../types/enterprise";
import { getStartupSettings, updateStartupSettings } from "../../../lib/appLifecycle";
import { validatePasswordPolicy } from "../../../utils/password-policy";
import { changePassword, requestDataArchive } from "../../login/api/login";
import { useAuthStore } from "../../login/stores/auth-store";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import { ActiveSessionsPanel } from "./ActiveSessionsPanel";
import { BackgroundMonitoringPanel } from "./BackgroundMonitoringPanel";
import { CredentialControl } from "./CredentialControl";
import { DataArchivePanel } from "./DataArchivePanel";
import { EnhancedProtectionPanel } from "./EnhancedProtectionPanel";
import { ThemePreferencePanel } from "./ThemePreferencePanel";

type SecurityViewProps = {
  theme: ThemePreference;
  setTheme: React.Dispatch<React.SetStateAction<ThemePreference>>;
};

export function SecurityView({ theme, setTheme }: SecurityViewProps) {
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);
  const [isPasswordSuccess, setIsPasswordSuccess] = useState(false);
  const [isArchiveLoading, setIsArchiveLoading] = useState(false);
  const [isArchiveSuccess, setIsArchiveSuccess] = useState(false);
  const [isStartupLoading, setIsStartupLoading] = useState(false);
  const [openAtLogin, setOpenAtLogin] = useState(false);

  useEffect(() => {
    let isMounted = true;
    void getStartupSettings().then((settings) => {
      if (isMounted) {
        setOpenAtLogin(settings.openAtLogin);
      }
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
    try {
      const settings = await updateStartupSettings(enabled);
      setOpenAtLogin(settings.openAtLogin);
      notifySuccess(settings.openAtLogin ? "TANAW will start at sign-in." : "TANAW startup at sign-in disabled.");
    } catch {
      notifyError("Unable to update background startup setting.");
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
          <EnhancedProtectionPanel />
          <BackgroundMonitoringPanel isElectron={Boolean(window.tanawAppLifecycle)} isLoading={isStartupLoading} openAtLogin={openAtLogin} onToggleStartup={handleStartupToggle} />
          <ThemePreferencePanel theme={theme} setTheme={setTheme} />
          <DataArchivePanel isLoading={isArchiveLoading} isSuccess={isArchiveSuccess} onRequestArchive={handleDataArchive} />
        </div>
      </div>
    </div>
  );
}
