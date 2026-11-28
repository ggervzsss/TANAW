import { ShieldOff } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import toast from "react-hot-toast/headless";
import { useAuthStore } from "@/app/store/authStore";
import { Button, Dialog } from "@/shared/ui-kit";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { PASSWORD_INPUT_MAX_CODE_UNITS } from "@/shared/utils/passwordPolicy";
import { disableTwoFactor } from "../services";
import { AccountField } from "./AccountField";

/** Turns off two-step verification once the current password is confirmed. */
export function TwoFactorDisableDialog({ onClose }: { onClose: () => void }) {
  const updateUser = useAuthStore((state) => state.updateUser);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const formId = useId();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
    if (!password) {
      setError("Enter your current password.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      updateUser(await disableTwoFactor(password));
      toast.success("Two-step verification is off.");
      onClose();
    } catch (failure) {
      setPassword("");
      setError(getApiErrorMessage(failure, "Unable to turn off two-step verification. Try again."));
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      size="sm"
      title={
        <span className="flex items-center gap-3">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-(--tanaw-tonal-danger) text-(--tanaw-danger)">
            <ShieldOff size={19} />
          </span>
          Turn off 2FA?
        </span>
      }
      ariaLabel="Turn off two-step verification"
      accent="danger"
      description="Signing in will ask for your password only, and your recovery codes will stop working. Enter your current password to continue."
      onClose={() => {
        if (!isSaving) onClose();
      }}
      closeOnBackdrop={!isSaving}
      initialFocus="input[name='currentPassword']"
      footer={
        <>
          <Button variant="secondary" disabled={isSaving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="destructive" loading={isSaving}>
            Turn off 2FA
          </Button>
        </>
      }
    >
      <form id={formId} noValidate autoComplete="off" onSubmit={submit}>
        <AccountField
          label="Current Password"
          name="currentPassword"
          defaultValue=""
          value={password}
          placeholder="Current password"
          type="password"
          autoComplete="current-password"
          error={error}
          maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
          onValueChange={(value) => {
            setPassword(value);
            setError("");
          }}
        />
      </form>
    </Dialog>
  );
}
