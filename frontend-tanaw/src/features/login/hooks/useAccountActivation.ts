import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { useAuthStore } from "@/app/store/authStore";
import { useFocusFirstInvalidField } from "@/shared/hooks/useFocusFirstInvalidField";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { emptyActivationPasswordValues, readActivationToken, type ActivationPasswordErrors, type ActivationPasswordValues, type ActivationView, validateActivationPasswordValues } from "../model";
import { completeAccountActivation, type AccountActivationDetails, validateAccountActivation } from "../services";

export function useAccountActivation() {
  const clearLocalSession = useAuthStore((state) => state.logout);
  const focusFirstInvalidField = useFocusFirstInvalidField();
  const [activationToken] = useState(readActivationToken);
  const [view, setView] = useState<ActivationView>(activationToken ? "validating" : "invalid");
  const [details, setDetails] = useState<AccountActivationDetails | null>(null);
  const [pageMessage, setPageMessage] = useState(activationToken ? "" : "This activation link is missing its security token.");
  const [values, setValues] = useState<ActivationPasswordValues>(emptyActivationPasswordValues);
  const [errors, setErrors] = useState<ActivationPasswordErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!window.location.hash) return;
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  useEffect(() => {
    if (!activationToken) return undefined;
    let isCurrent = true;
    void validateAccountActivation(activationToken)
      .then((activationDetails) => {
        if (!isCurrent) return;
        setDetails(activationDetails);
        setPageMessage("");
        setView("ready");
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        setPageMessage(getApiErrorMessage(error, "This activation link is invalid, expired, or has already been used."));
        setView("invalid");
      });
    return () => {
      isCurrent = false;
    };
  }, [activationToken]);

  const updateField = (field: keyof ActivationPasswordValues) => (event: ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (pageMessage) setPageMessage("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateActivationPasswordValues(values);
    setErrors(nextErrors);
    setPageMessage("");
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalidField(
        event.currentTarget,
        ["newPassword", "confirmPassword"].filter((fieldName) => nextErrors[fieldName as keyof ActivationPasswordErrors]),
      );
      return;
    }
    if (!activationToken) return;
    setIsSubmitting(true);
    try {
      await completeAccountActivation(activationToken, values.newPassword);
      clearLocalSession();
      setValues(emptyActivationPasswordValues);
      setView("success");
    } catch (error) {
      setPageMessage(getApiErrorMessage(error, "Unable to activate this account. Request a new activation email and try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return { details, errors, isSubmitting, pageMessage, submit, updateField, values, view };
}
