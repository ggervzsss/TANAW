import type { FormEvent } from "react";
import { useState } from "react";
import { requestPasswordRecovery, resetRecoveredPassword, verifyPasswordRecovery } from "../services";
import { getApiErrorMessage, validateNewPassword, validateRecoveryEmail, validateVerificationCode } from "../utils/authDialog";

export type RecoveryStep = "email" | "code" | "password" | "success";

export function usePasswordRecoveryFlow() {
  const [step, setStep] = useState<RecoveryStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [expiresIn, setExpiresIn] = useState(10);
  const [notice, setNotice] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const clearError = () => {
    if (error) setError("");
  };

  const updateEmail = (value: string) => {
    setEmail(value);
    clearError();
  };

  const updateCode = (value: string) => {
    setCode(value.replace(/\D/g, "").slice(0, 6));
    clearError();
  };

  const updatePassword = (value: string) => {
    setPassword(value);
    clearError();
  };

  const updateConfirmation = (value: string) => {
    setConfirmation(value);
    clearError();
  };

  const requestCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextError = validateRecoveryEmail(email);
    setError(nextError);
    if (nextError) return;

    setIsSubmitting(true);
    try {
      const response = await requestPasswordRecovery({ email });
      setChallengeId(response.challengeId);
      setExpiresIn(response.expiresInMinutes);
      setNotice(response.message);
      setStep("code");
      setError("");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to start account recovery. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextError = validateVerificationCode(code);
    setError(nextError);
    if (nextError) return;

    setIsSubmitting(true);
    try {
      const response = await verifyPasswordRecovery({ challengeId, code });
      setResetToken(response.resetToken);
      setStep("password");
      setError("");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Invalid or expired verification code."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextError = validateNewPassword(password, confirmation);
    setError(nextError);
    if (nextError) return;

    setIsSubmitting(true);
    try {
      await resetRecoveredPassword({ challengeId, resetToken, newPassword: password });
      setStep("success");
      setError("");
      setPassword("");
      setConfirmation("");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to reset password. Please restart account recovery."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    code,
    confirmation,
    email,
    error,
    expiresIn,
    isSubmitting,
    notice,
    password,
    requestCode,
    resetPassword,
    step,
    updateCode,
    updateConfirmation,
    updateEmail,
    updatePassword,
    verifyCode,
  };
}
