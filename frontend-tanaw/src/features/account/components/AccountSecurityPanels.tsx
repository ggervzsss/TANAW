import type { FormEvent, RefObject } from "react";
import { PasswordMatchIndicator, PasswordRequirements } from "@/shared/components/PasswordRequirements";
import { Alert } from "@/design-system";
import { useSettingsDraft } from "@/design-system/lib/settingsDraft";
import { SettingsActions, SettingsGroup } from "@/design-system/patterns/GeneralSettings";
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
  onCancel: () => void;
  onConfirmationChange: (value: string) => void;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  passwordConfirmation: string;
  resetSignal: number;
  saveError: string;
};

export function PasswordChangePanel(props: PasswordChangePanelProps) {
  const {
    currentPassword,
    errors,
    formRef,
    isLoading,
    isSuccess,
    newPassword,
    onCancel,
    onConfirmationChange,
    onCurrentPasswordChange,
    onNewPasswordChange,
    onSubmit,
    passwordConfirmation,
    resetSignal,
    saveError,
  } = props;
  const dirty = Boolean(currentPassword || newPassword || passwordConfirmation);
  const draftMarker = useSettingsDraft(dirty);
  return (
    <form data-settings-draft={draftMarker} ref={formRef} autoComplete="off" noValidate onSubmit={onSubmit} aria-busy={isLoading}>
      <fieldset disabled={isLoading} className="tanaw-settings-body">
        <SettingsGroup title="Verify your identity">
          <div className="max-w-xl">
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
          </div>
        </SettingsGroup>
        <SettingsGroup title="New password" description="Check the requirements as you type, then enter the same password again.">
          <div className="tanaw-settings-fields items-start">
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
        </SettingsGroup>
        {saveError && <Alert tone="danger">{saveError}</Alert>}
      </fieldset>
      <SettingsActions busy={isLoading} dirty={dirty} saveDisabled={!dirty} detail={isSuccess ? "Password updated" : undefined} onCancel={onCancel}>
        Update Password
      </SettingsActions>
    </form>
  );
}
