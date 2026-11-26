import { Eye, EyeOff } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useSettingsDraft } from "../../../ui-kit/lib/settingsDraft";
import { SettingsActions, SettingsGroup } from "../../../ui-kit/patterns/GeneralSettings";
import { PasswordMatchIndicator, PasswordRequirements } from "../../../components/PasswordRequirements";
import { PASSWORD_INPUT_MAX_CODE_UNITS, PASSWORD_MIN_LENGTH } from "../../../utils/password-policy";

export type PasswordChangeValues = {
  confirmPassword: string;
  currentPassword: string;
  newPassword: string;
};

type CredentialControlProps = {
  isLoading: boolean;
  isSuccess: boolean;
  onSubmit: (values: PasswordChangeValues) => Promise<boolean>;
};

export function CredentialControl({ isLoading, isSuccess, onSubmit }: CredentialControlProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordResetSignal, setPasswordResetSignal] = useState(0);
  const [visiblePasswords, setVisiblePasswords] = useState({
    confirm: false,
    current: false,
    next: false,
  });
  const inputClassName =
    "tanaw-settings-control min-h-10.5! w-full pr-12!";

  const dirty = Boolean(currentPassword || newPassword || passwordConfirmation);
  const draftMarker = useSettingsDraft(dirty);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading || !dirty) return;
    await onSubmit({
      confirmPassword: passwordConfirmation,
      currentPassword,
      newPassword,
    });
    reset();
  };

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setPasswordConfirmation("");
    setVisiblePasswords({ confirm: false, current: false, next: false });
    setPasswordResetSignal((current) => current + 1);
    formRef.current?.reset();
  };

  return (
    <form data-settings-draft={draftMarker} ref={formRef} onSubmit={handleSubmit} autoComplete="off" aria-busy={isLoading}>
      <fieldset disabled={isLoading} className="tanaw-settings-body">
        <SettingsGroup title="Verify your identity">
          <div className="max-w-xl">
            <label htmlFor="currentPassword" className="mb-1.5 block text-[0.8125rem] font-medium text-(--tanaw-text-secondary)">
              Current Password
            </label>
            <PasswordInput
              key={`current-password-${passwordResetSignal}`}
              ariaLabel={visiblePasswords.current ? "Hide current password" : "Show current password"}
              autoComplete="new-password"
              className={inputClassName}
              isVisible={visiblePasswords.current}
              name="currentPassword"
              maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
              placeholder="Enter your current password"
              preventPasswordAutofill
              value={currentPassword}
              onChange={setCurrentPassword}
              onToggle={() => setVisiblePasswords((current) => ({ ...current, current: !current.current }))}
            />
          </div>
        </SettingsGroup>
        <SettingsGroup title="New password" description="Check the requirements as you type, then enter the same password again.">
          <div className="tanaw-settings-fields">
            <div>
              <label htmlFor="newPassword" className="mb-1.5 block text-[0.8125rem] font-medium text-(--tanaw-text-secondary)">
                New Password
              </label>
              <PasswordInput
                key={`new-password-${passwordResetSignal}`}
                ariaLabel={visiblePasswords.next ? "Hide new password" : "Show new password"}
                autoComplete="new-password"
                className={inputClassName}
                isVisible={visiblePasswords.next}
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
                name="newPassword"
                placeholder="Use a long password"
                value={newPassword}
                onChange={setNewPassword}
                onToggle={() => setVisiblePasswords((current) => ({ ...current, next: !current.next }))}
              />
              <PasswordRequirements password={newPassword} />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="mb-1.5 block text-[0.8125rem] font-medium text-(--tanaw-text-secondary)">
                Confirm New Password
              </label>
              <PasswordInput
                key={`confirm-password-${passwordResetSignal}`}
                ariaLabel={visiblePasswords.confirm ? "Hide confirm new password" : "Show confirm new password"}
                autoComplete="new-password"
                className={inputClassName}
                isVisible={visiblePasswords.confirm}
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
                name="confirmPassword"
                placeholder="Repeat the password"
                value={passwordConfirmation}
                onChange={setPasswordConfirmation}
                onToggle={() => setVisiblePasswords((current) => ({ ...current, confirm: !current.confirm }))}
              />
              <PasswordMatchIndicator password={newPassword} confirmation={passwordConfirmation} />
            </div>
          </div>
        </SettingsGroup>
      </fieldset>
      <SettingsActions busy={isLoading} dirty={dirty} saveDisabled={!dirty} detail={isSuccess ? "Password updated" : undefined} onCancel={reset}>
        Update Password
      </SettingsActions>
    </form>
  );
}

type PasswordInputProps = {
  ariaLabel: string;
  autoComplete: string;
  className: string;
  isVisible: boolean;
  minLength?: number;
  maxLength?: number;
  name: string;
  onChange?: (value: string) => void;
  onToggle: () => void;
  placeholder: string;
  preventPasswordAutofill?: boolean;
  value: string;
};

function PasswordInput({ ariaLabel, autoComplete, className, isVisible, maxLength, minLength, name, onChange, onToggle, placeholder, preventPasswordAutofill = false, value }: PasswordInputProps) {
  const Icon = isVisible ? EyeOff : Eye;
  const [isUserActivated, setIsUserActivated] = useState(!preventPasswordAutofill);
  const isAutofillLocked = preventPasswordAutofill && !isUserActivated;

  return (
    <div className="relative">
      <input
        id={name}
        name={name}
        type={isVisible ? "text" : "password"}
        minLength={minLength}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={className}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onFocus={() => {
          if (isAutofillLocked) setIsUserActivated(true);
        }}
        onPointerDown={() => {
          if (isAutofillLocked) setIsUserActivated(true);
        }}
        onBlur={() => {
          if (preventPasswordAutofill && !value) setIsUserActivated(false);
        }}
        data-sensitive-password
        data-1p-ignore={preventPasswordAutofill ? true : undefined}
        data-lpignore={preventPasswordAutofill ? "true" : undefined}
        data-bwignore={preventPasswordAutofill ? true : undefined}
        readOnly={isAutofillLocked}
        aria-readonly={isAutofillLocked}
        required
      />
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={!value}
        onClick={() => {
          if (value) onToggle();
        }}
        className="tanaw-settings-icon-button absolute top-1/2 right-1.5 -translate-y-1/2"
      >
        <Icon size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
