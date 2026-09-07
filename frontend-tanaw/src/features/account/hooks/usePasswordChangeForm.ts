import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast/headless";
import { useAuthStore } from "@/app/store/authStore";
import { useFocusFirstInvalidField } from "@/shared/hooks/useFocusFirstInvalidField";
import { changePassword, currentUserQueryKey } from "@/shared/services/accountService";
import { getPasswordErrors, resetPasswordInputs, type PasswordErrors } from "../model";

export function usePasswordChangeForm() {
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);
  const focusFirstInvalidField = useFocusFirstInvalidField();
  const formRef = useRef<HTMLFormElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const [errors, setErrors] = useState<PasswordErrors>({});

  const clearValues = useCallback(() => {
    setCurrentPassword("");
    setNewPassword("");
    setPasswordConfirmation("");
    setResetSignal((current) => current + 1);
    resetPasswordInputs(formRef.current);
  }, []);

  useEffect(() => {
    const form = formRef.current;
    resetPasswordInputs(form);
    return () => resetPasswordInputs(form);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const nextErrors = getPasswordErrors(currentPassword, newPassword, passwordConfirmation);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      clearValues();
      window.requestAnimationFrame(() =>
        focusFirstInvalidField(
          form,
          ["currentPassword", "newPassword", "confirmPassword"].filter((name) => nextErrors[name as keyof PasswordErrors]),
        ),
      );
      return;
    }
    setIsLoading(true);
    try {
      const session = await changePassword(currentPassword, newPassword);
      queryClient.removeQueries({ queryKey: currentUserQueryKey });
      setSession(session);
      setIsSuccess(true);
      toast.success("Password updated.");
      window.setTimeout(() => setIsSuccess(false), 2600);
      clearValues();
      setErrors({});
    } catch {
      clearValues();
      toast.error("Unable to update password. Check your current password and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateField(field: "currentPassword" | "newPassword" | "confirmPassword", value: string) {
    if (field === "currentPassword") setCurrentPassword(value);
    else if (field === "newPassword") setNewPassword(value);
    else setPasswordConfirmation(value);
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  return { currentPassword, errors, formRef, isLoading, isSuccess, newPassword, passwordConfirmation, resetSignal, submit, updateField };
}
