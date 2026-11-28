import type { FormEvent, ReactNode, RefObject } from "react";
import { PasswordMatchIndicator, PasswordRequirements } from "@/shared/components/PasswordRequirements";
import { useSettingsDraft } from "@/shared/ui-kit/lib/settingsDraft";
import { SettingsGroup, SettingsNote, SettingsSaveBar } from "@/shared/ui-kit/patterns/GeneralSettings";
import { PASSWORD_INPUT_MAX_CODE_UNITS, PASSWORD_MIN_LENGTH } from "@/shared/utils/passwordPolicy";
import type { PasswordErrors } from "../model";
import { AccountField } from "./AccountField";

type PasswordChangePanelProps = {
  /** The side panel beside the password groups: two-step verification and sessions. */
  aside?: ReactNode;
  currentPassword: string;
  errors: PasswordErrors;
  formRef: RefObject<HTMLFormElement | null>;
  isLoading: boolean;
  newPassword: string;
  onClear: () => void;
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
    aside,
    currentPassword,
    errors,
    formRef,
    isLoading,
    newPassword,
    onClear,
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
        <div className="tanaw-account-security-layout">
          <div className="tanaw-account-security-main">
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
            {saveError && <SettingsNote tone="danger">{saveError}</SettingsNote>}
          </div>
          {aside ? <div className="tanaw-account-aside">{aside}</div> : null}
        </div>
      </fieldset>
      <SettingsSaveBar busy={isLoading} dirty={dirty} onDiscard={onClear} busyLabel="Updating password...">
        Update password
      </SettingsSaveBar>
    </form>
  );
}
