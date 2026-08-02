import { Check, Key, Monitor, MonitorSmartphone, RefreshCw } from "lucide-react";
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

export function ActiveSessionsPanel() {
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
