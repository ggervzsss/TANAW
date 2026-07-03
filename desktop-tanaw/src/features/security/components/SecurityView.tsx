import { type FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { validatePasswordPolicy } from "../../../utils/password-policy";
import { changePassword } from "../../login/api/login";
import { useAuthStore } from "../../login/stores/auth-store";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import { ActiveSessionsPanel } from "./ActiveSessionsPanel";
import { CredentialControl } from "./CredentialControl";

export function SecurityView() {
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);
  const [isPasswordSuccess, setIsPasswordSuccess] = useState(false);

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

  return (
    <div className="animate-in fade-in mx-auto w-full max-w-290 space-y-6 pt-2 font-['Inter'] duration-500">
      <div className="mx-auto w-full">
        <p className="mb-2 text-[11px] font-black tracking-[0.24em] text-[#b7952b] uppercase">Enterprise Controls</p>
        <h2 className="text-2xl font-bold tracking-tight text-[#111827]">Password Settings</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500">Update your enterprise account password.</p>
      </div>

      <div className="space-y-6">
        <CredentialControl isLoading={isPasswordLoading} isSuccess={isPasswordSuccess} onSubmit={handlePasswordUpdate} />
        <ActiveSessionsPanel />
      </div>
    </div>
  );
}
