import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { normalizePassword, validatePasswordPolicy } from "../../../utils/password-policy";
import { changePassword } from "../../login/api/login";
import { useAuthStore } from "../../login/stores/auth-store";
import { notifyError, notifySuccess, notifyWarning } from "../../toasts/services/toast-service";
import { CredentialControl, type PasswordChangeValues } from "./CredentialControl";

export function SecurityView() {
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);

  const handlePasswordUpdate = async ({ confirmPassword, currentPassword, newPassword }: PasswordChangeValues) => {
    if (!currentPassword) {
      notifyWarning("Enter your current password.");
      return false;
    }
    if (normalizePassword(newPassword) !== normalizePassword(confirmPassword)) {
      notifyWarning("New passwords do not match.");
      return false;
    }
    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) {
      notifyWarning(policyError);
      return false;
    }

    setIsPasswordLoading(true);
    try {
      const session = await changePassword(currentPassword, newPassword);
      queryClient.removeQueries({ queryKey: ["enterprise-current-user"] });
      setSession(session);
      notifySuccess("Password updated.");
      return true;
    } catch {
      notifyError("Unable to update password. Check your current password and try again.");
      return false;
    } finally {
      setIsPasswordLoading(false);
    }
  };

  return <CredentialControl isLoading={isPasswordLoading} onSubmit={handlePasswordUpdate} />;
}
