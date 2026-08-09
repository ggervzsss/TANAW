import { Check, Key, RefreshCw } from "lucide-react";
import type { FormEvent, RefObject } from "react";
import { PasswordMatchIndicator, PasswordRequirements } from "@/shared/components/PasswordRequirements";
import { Panel, PanelHeader } from "@/shared/components/panel";
import { PASSWORD_INPUT_MAX_CODE_UNITS, PASSWORD_MIN_LENGTH } from "@/shared/utils/passwordPolicy";
import type { PasswordErrors } from "../model";
import { AccountField } from "./AccountField";

type PasswordChangePanelProps = {
  currentPassword: string;
  errors: PasswordErrors;
  formRef: RefObject<HTMLFormElement | null>;
  isLoading: boolean;
  isSuccess: boolean;
  newPassword: string;
  onConfirmationChange: (value: string) => void;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  passwordConfirmation: string;
  resetSignal: number;
};

export function PasswordChangePanel(props: PasswordChangePanelProps) {
  const { currentPassword, errors, formRef, isLoading, isSuccess, newPassword, onConfirmationChange, onCurrentPasswordChange, onNewPasswordChange, onSubmit, passwordConfirmation, resetSignal } =
    props;
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="Change Password" icon={Key} />
      <form ref={formRef} autoComplete="off" noValidate onSubmit={onSubmit} className="space-y-4 p-6">
        <AccountField
          key={`current-password-${resetSignal}`}
          label="Current Password"
          name="currentPassword"
          defaultValue=""
          value={currentPassword}
          placeholder="Current password"
          type="password"
          autoComplete="new-password"
          preventPasswordAutofill
          error={errors.currentPassword}
          maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
          onValueChange={onCurrentPasswordChange}
        />
        <div className="grid items-start gap-4 md:grid-cols-2">
          <div>
            <AccountField
              key={`new-password-${resetSignal}`}
              label="New Password"
              name="newPassword"
              defaultValue=""
              value={newPassword}
              placeholder="Use a long password"
              type="password"
              autoComplete="new-password"
              error={errors.newPassword}
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
              onValueChange={onNewPasswordChange}
            />
            <PasswordRequirements password={newPassword} />
          </div>
          <div>
            <AccountField
              key={`confirm-password-${resetSignal}`}
              label="Confirm New Password"
              name="confirmPassword"
              defaultValue=""
              value={passwordConfirmation}
              placeholder="Repeat the password"
              type="password"
              autoComplete="new-password"
              error={errors.confirmPassword}
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
              onValueChange={onConfirmationChange}
            />
            <PasswordMatchIndicator password={newPassword} confirmation={passwordConfirmation} />
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isLoading}
            className="bg-tanaw-green disabled:bg-tanaw-green/70 inline-flex min-w-48 items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#044a1e]"
          >
            {isLoading ? <RefreshCw size={16} className="animate-spin" /> : isSuccess ? <Check size={16} /> : <Key size={16} />}
            {isLoading ? "Updating..." : isSuccess ? "Password Updated" : "Update Password"}
          </button>
        </div>
      </form>
    </Panel>
  );
}
