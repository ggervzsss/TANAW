import { Check, Key, Monitor, MonitorSmartphone, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast/headless";
import { useAuthStore } from "@/app/store/authStore";
import { PasswordMatchIndicator, PasswordRequirements } from "@/shared/components/PasswordRequirements";
import { PageHeader } from "@/shared/components/layout";
import { Panel, PanelHeader } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { useFocusFirstInvalidField } from "@/shared/hooks/useFocusFirstInvalidField";
import { changePassword } from "@/shared/services/accountManagement";
import { PASSWORD_INPUT_MAX_CODE_UNITS, PASSWORD_MIN_LENGTH, normalizePassword, validatePasswordPolicy } from "@/shared/utils/passwordPolicy";
import { AccountField } from "../components";

type PasswordErrors = Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", string>>;

export function AccountSecurityPage() {
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);
  const focusFirstInvalidField = useFocusFirstInvalidField();
  const passwordFormRef = useRef<HTMLFormElement>(null);
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);
  const [isPasswordSuccess, setIsPasswordSuccess] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordResetSignal, setPasswordResetSignal] = useState(0);
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});

  const clearPasswordValues = useCallback(() => {
    setCurrentPassword("");
    setNewPassword("");
    setPasswordConfirmation("");
    setPasswordResetSignal((current) => current + 1);
    resetPasswordInputs(passwordFormRef.current);
  }, []);

  useEffect(() => {
    const form = passwordFormRef.current;
    resetPasswordInputs(form);
    return () => resetPasswordInputs(form);
  }, []);

  const handlePasswordUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const nextErrors = getPasswordErrors(currentPassword, newPassword, passwordConfirmation);
    setPasswordErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      clearPasswordValues();
      window.requestAnimationFrame(() => {
        focusFirstInvalidField(
          form,
          ["currentPassword", "newPassword", "confirmPassword"].filter((fieldName) => nextErrors[fieldName as keyof PasswordErrors]),
        );
      });
      return;
    }

    setIsPasswordLoading(true);
    try {
      const session = await changePassword(currentPassword, newPassword);
      queryClient.removeQueries({ queryKey: ["current-user"] });
      setSession(session);
      setIsPasswordSuccess(true);
      toast.success("Password updated.");
      window.setTimeout(() => setIsPasswordSuccess(false), 2600);
      clearPasswordValues();
      setPasswordErrors({});
    } catch {
      clearPasswordValues();
      toast.error("Unable to update password. Check your current password and try again.");
    } finally {
      setIsPasswordLoading(false);
    }
  };

  return (
    <PageMotion>
      <PageHeader title="Password Settings" description="Update your account password." />
      <div className="mx-auto max-w-5xl space-y-6">
        <PasswordChangePanel
          currentPassword={currentPassword}
          errors={passwordErrors}
          formRef={passwordFormRef}
          isLoading={isPasswordLoading}
          isSuccess={isPasswordSuccess}
          newPassword={newPassword}
          passwordConfirmation={passwordConfirmation}
          resetSignal={passwordResetSignal}
          onCurrentPasswordChange={(value) => {
            setCurrentPassword(value);
            setPasswordErrors((current) => ({ ...current, currentPassword: undefined }));
          }}
          onNewPasswordChange={(value) => {
            setNewPassword(value);
            setPasswordErrors((current) => ({ ...current, newPassword: undefined }));
          }}
          onConfirmationChange={(value) => {
            setPasswordConfirmation(value);
            setPasswordErrors((current) => ({ ...current, confirmPassword: undefined }));
          }}
          onSubmit={handlePasswordUpdate}
        />
        <ActiveSessionsPanel />
      </div>
    </PageMotion>
  );
}

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

function PasswordChangePanel(props: PasswordChangePanelProps) {
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

function ActiveSessionsPanel() {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="Active Sessions" icon={MonitorSmartphone} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-160 text-left text-sm">
          <thead className="bg-slate-50 text-[10px] font-black tracking-widest text-slate-500 uppercase">
            <tr>
              {["Device", "Location", "Last Active", "IP Address"].map((label) => (
                <th key={label} className="border-b border-slate-200 p-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            <tr>
              <td className="flex items-center gap-2 p-3 font-semibold text-slate-900">
                <Monitor size={15} className="text-tanaw-green" /> Workstation Browser (Current)
              </td>
              <td className="p-3 font-medium text-slate-600">Current device</td>
              <td className="p-3 text-xs font-bold text-emerald-600">Active Now</td>
              <td className="p-3 font-mono text-xs text-slate-500">Unavailable</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function getPasswordErrors(currentPassword: string, newPassword: string, confirmation: string) {
  const errors: PasswordErrors = {};
  if (!currentPassword) errors.currentPassword = "Enter your current password.";
  const policyError = validatePasswordPolicy(newPassword);
  if (policyError) errors.newPassword = policyError;
  if (!confirmation) errors.confirmPassword = "Please confirm your new password.";
  else if (normalizePassword(newPassword) !== normalizePassword(confirmation)) errors.confirmPassword = "New passwords do not match.";
  return errors;
}

function resetPasswordInputs(form: HTMLFormElement | null) {
  form?.reset();
  form?.querySelectorAll<HTMLInputElement>('input[type="password"], input[data-sensitive-password]').forEach((input) => {
    input.value = "";
  });
}
