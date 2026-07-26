import { Check, Eye, EyeOff, Key, Monitor, MonitorSmartphone, Pencil, RefreshCw, Save, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useId, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast/headless";
import { useAuthStore } from "@/app/store/authStore";
import { PasswordMatchIndicator, PasswordRequirements } from "@/shared/components/PasswordRequirements";
import { PageHeader } from "@/shared/components/layout";
import { Panel, PanelHeader } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { changePassword, updateCurrentProfile } from "@/shared/services/accountManagement";
import type { UserRole } from "@/shared/types/role.types";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import {
  PERSON_NAME_MAX_LENGTH,
  composeApiPersonName,
  normalizeMiddleInitial,
  normalizePhilippineContactNumber,
  parsePersonName,
  validateMiddleInitial,
  validatePersonName,
  validatePhilippineContactNumber,
} from "@/shared/utils/accountValidation";
import { readProfileImageFile } from "@/shared/utils/imageUpload";
import { PASSWORD_INPUT_MAX_CODE_UNITS, PASSWORD_MIN_LENGTH, normalizePassword, validatePasswordPolicy } from "@/shared/utils/passwordPolicy";
import { roleAccessLabel, rolePortalLabel } from "@/shared/components/layout/navigation";
import { useFocusFirstInvalidField } from "@/shared/hooks/useFocusFirstInvalidField";

type AccountPageProps = {
  role: UserRole;
};

type ProfileUser = {
  name: string;
  email: string;
  department: string;
  phone: string;
};

function useAccountProfile(): ProfileUser {
  const authUser = useAuthStore((state) => state.user);

  return {
    name: authUser?.managerName ?? authUser?.displayName ?? "TANAW User",
    email: authUser?.email ?? "",
    department: authUser?.title ?? "City Tourism Operations",
    phone: authUser?.phone ?? "",
  };
}

export function AccountProfilePage({ role }: AccountPageProps) {
  const authUser = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const user = useAccountProfile();
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [fieldResetSignal, setFieldResetSignal] = useState(0);
  const authDisplayImageDataUrl = authUser?.displayImageDataUrl ?? null;
  const [displayImageDraft, setDisplayImageDraft] = useState(() => ({
    dataUrl: authDisplayImageDataUrl,
    fileName: "",
    sourceDataUrl: authDisplayImageDataUrl,
  }));
  const isImageDraftCurrent = displayImageDraft.sourceDataUrl === authDisplayImageDataUrl;
  const displayImageDataUrl = isImageDraftCurrent ? displayImageDraft.dataUrl : authDisplayImageDataUrl;
  const displayImageFileName = isImageDraftCurrent ? displayImageDraft.fileName : "";
  const profileName = useMemo(() => parsePersonName([authUser?.firstName, authUser?.lastName].filter(Boolean).join(" ") || user.name), [authUser?.firstName, authUser?.lastName, user.name]);
  const initials = useMemo(
    () =>
      user.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase(),
    [user.name],
  );

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const firstName = String(formData.get("firstName") ?? "");
    const middleInitial = normalizeMiddleInitial(String(formData.get("middleInitial") ?? ""));
    const lastName = String(formData.get("lastName") ?? "");
    const firstNameError = validatePersonName(firstName, "First name");
    const middleInitialError = validateMiddleInitial(middleInitial);
    const lastNameError = validatePersonName(lastName, "Last name");
    if (firstNameError || middleInitialError || lastNameError) {
      toast.error(firstNameError || middleInitialError || lastNameError);
      return;
    }
    const phoneInput = String(formData.get("phone") ?? "");
    const phoneError = validatePhilippineContactNumber(phoneInput, false);
    if (phoneError) {
      toast.error(phoneError);
      return;
    }
    const apiName = composeApiPersonName({ firstName, middleInitial, lastName });
    const normalizedPhone = normalizePhilippineContactNumber(phoneInput);
    setIsLoading(true);
    try {
      const updated = await updateCurrentProfile({
        firstName: apiName.firstName,
        lastName: apiName.lastName,
        email: user.email,
        phone: normalizedPhone || undefined,
        displayImageDataUrl,
      });
      updateUser(updated);
      setIsLoading(false);
      setIsSuccess(true);
      setFieldResetSignal((current) => current + 1);
      window.setTimeout(() => setIsSuccess(false), 2600);
      toast.success("Profile updated.");
    } catch (error) {
      setIsLoading(false);
      toast.error(getApiErrorMessage(error, "Unable to update profile."));
    }
  };

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const upload = await readProfileImageFile(file);
      setDisplayImageDraft({
        dataUrl: upload.dataUrl,
        fileName: upload.fileName,
        sourceDataUrl: authDisplayImageDataUrl,
      });
      toast.success("Profile photo ready to save.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load image.");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <PageMotion>
      <PageHeader title="Profile Settings" description="Manage your profile photo and primary contact details." />

      <form onSubmit={handleSave} className="mx-auto max-w-5xl space-y-6">
        <Panel className="overflow-hidden">
          <PanelHeader title="Account Display" icon={Upload} />
          <div className="p-6">
            <div className="mb-8 flex flex-col gap-6 border-b border-slate-100 pb-8 sm:flex-row sm:items-center">
              <label
                htmlFor={`profile-image-${role}`}
                className="group hover:border-tanaw-green relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-slate-300 bg-slate-50 shadow-sm transition"
              >
                {displayImageDataUrl ? (
                  <img src={displayImageDataUrl} alt="Profile preview" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-display text-tanaw-navy text-2xl font-bold transition-opacity group-hover:opacity-0">{initials || "TU"}</span>
                )}
                <span className="bg-tanaw-green/85 absolute inset-0 flex items-center justify-center text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <Upload size={20} />
                </span>
                <input id={`profile-image-${role}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageChange} className="sr-only" />
              </label>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-950">Profile Photo</h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">This profile is shown in the {rolePortalLabel[role]} header, reports, and other account-related records.</p>
                <span className="mt-3 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black tracking-wide text-emerald-700 uppercase">{roleAccessLabel[role]}</span>
                {displayImageFileName && <p className="mt-2 text-xs font-semibold text-emerald-700">{displayImageFileName}</p>}
                {displayImageDataUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setDisplayImageDraft({
                        dataUrl: null,
                        fileName: "",
                        sourceDataUrl: authDisplayImageDataUrl,
                      });
                    }}
                    className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                  >
                    Remove photo
                  </button>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field
                key={`firstName-${profileName.firstName}-${fieldResetSignal}`}
                name="firstName"
                label="First Name"
                defaultValue={profileName.firstName}
                maxLength={PERSON_NAME_MAX_LENGTH}
                editable
              />
              <Field
                key={`middleInitial-${profileName.middleInitial}-${fieldResetSignal}`}
                name="middleInitial"
                label="Middle Initial"
                defaultValue={profileName.middleInitial}
                maxLength={1}
                editable
              />
              <Field key={`lastName-${profileName.lastName}-${fieldResetSignal}`} name="lastName" label="Last Name" defaultValue={profileName.lastName} maxLength={PERSON_NAME_MAX_LENGTH} editable />
              <Field label="Professional Email" defaultValue={user.email} type="email" />
              <Field label="Department" defaultValue={user.department} />
              <Field key={`phone-${user.phone}-${fieldResetSignal}`} name="phone" label="Phone" defaultValue={user.phone} type="tel" maxLength={18} editable />
            </div>
          </div>
        </Panel>

        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="submit"
            disabled={isLoading}
            className="bg-tanaw-green disabled:bg-tanaw-green/70 inline-flex min-w-44 items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#044a1e]"
          >
            {isLoading ? <RefreshCw size={16} className="animate-spin" /> : isSuccess ? <Check size={16} /> : <Save size={16} />}
            {isLoading ? "Saving..." : isSuccess ? "Saved" : "Save Changes"}
          </button>
        </div>
      </form>
    </PageMotion>
  );
}

export function AccountSecurityPage() {
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);
  const focusFirstInvalidField = useFocusFirstInvalidField();
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);
  const [isPasswordSuccess, setIsPasswordSuccess] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", string>>>({});

  const handlePasswordUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const nextErrors: typeof passwordErrors = {};
    if (!currentPassword) nextErrors.currentPassword = "Enter your current password.";
    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) nextErrors.newPassword = policyError;
    if (!passwordConfirmation) nextErrors.confirmPassword = "Please confirm your new password.";
    else if (normalizePassword(newPassword) !== normalizePassword(passwordConfirmation)) nextErrors.confirmPassword = "New passwords do not match.";
    setPasswordErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalidField(form, ["currentPassword", "newPassword", "confirmPassword"].filter((fieldName) => nextErrors[fieldName as keyof typeof nextErrors]));
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
      form.reset();
      setCurrentPassword("");
      setNewPassword("");
      setPasswordConfirmation("");
      setPasswordErrors({});
    } catch {
      toast.error("Unable to update password. Check your current password and try again.");
    } finally {
      setIsPasswordLoading(false);
    }
  };

  return (
    <PageMotion>
      <PageHeader title="Password Settings" description="Update your account password." />

      <div className="mx-auto max-w-5xl space-y-6">
        <Panel className="overflow-hidden">
          <PanelHeader title="Change Password" icon={Key} />
          <form autoComplete="off" noValidate onSubmit={handlePasswordUpdate} className="space-y-4 p-6">
            <Field
              label="Current Password"
              name="currentPassword"
              defaultValue=""
              value={currentPassword}
              placeholder="Current password"
              type="password"
              autoComplete="off"
              error={passwordErrors.currentPassword}
              maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
              onValueChange={(value) => {
                setCurrentPassword(value);
                setPasswordErrors((current) => ({ ...current, currentPassword: undefined }));
              }}
            />
            <div className="grid items-start gap-4 md:grid-cols-2">
              <div>
                <Field
                  label="New Password"
                  name="newPassword"
                  defaultValue=""
                  value={newPassword}
                  placeholder="Use a long password"
                  type="password"
                  autoComplete="new-password"
                  error={passwordErrors.newPassword}
                  minLength={PASSWORD_MIN_LENGTH}
                  maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
                  onValueChange={(value) => {
                    setNewPassword(value);
                    setPasswordErrors((current) => ({ ...current, newPassword: undefined }));
                  }}
                />
                <PasswordRequirements password={newPassword} />
              </div>
              <div>
                <Field
                  label="Confirm New Password"
                  name="confirmPassword"
                  defaultValue=""
                  value={passwordConfirmation}
                  placeholder="Repeat the password"
                  type="password"
                  autoComplete="new-password"
                  error={passwordErrors.confirmPassword}
                  minLength={PASSWORD_MIN_LENGTH}
                  maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
                  onValueChange={(value) => {
                    setPasswordConfirmation(value);
                    setPasswordErrors((current) => ({ ...current, confirmPassword: undefined }));
                  }}
                />
                <PasswordMatchIndicator password={newPassword} confirmation={passwordConfirmation} />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isPasswordLoading}
                className="bg-tanaw-green disabled:bg-tanaw-green/70 inline-flex min-w-48 items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#044a1e]"
              >
                {isPasswordLoading ? <RefreshCw size={16} className="animate-spin" /> : isPasswordSuccess ? <Check size={16} /> : <Key size={16} />}
                {isPasswordLoading ? "Updating..." : isPasswordSuccess ? "Password Updated" : "Update Password"}
              </button>
            </div>
          </form>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Active Sessions" icon={MonitorSmartphone} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-160 text-left text-sm">
              <thead className="bg-slate-50 text-[10px] font-black tracking-widest text-slate-500 uppercase">
                <tr>
                  <th className="border-b border-slate-200 p-3">Device</th>
                  <th className="border-b border-slate-200 p-3">Location</th>
                  <th className="border-b border-slate-200 p-3">Last Active</th>
                  <th className="border-b border-slate-200 p-3">IP Address</th>
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
      </div>
    </PageMotion>
  );
}

function Field({
  label,
  defaultValue,
  editable = false,
  name,
  type = "text",
  placeholder,
  minLength,
  maxLength,
  onValueChange,
  value,
  autoComplete,
  error,
}: {
  label: string;
  defaultValue: string;
  editable?: boolean;
  name?: string;
  type?: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  onValueChange?: (value: string) => void;
  value?: string;
  autoComplete?: string;
  error?: string;
}) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const isPassword = type === "password";
  const inputType = isPassword && isPasswordVisible ? "text" : type;
  const canEdit = Boolean(name && editable && !isPassword);
  const isReadOnly = !isPassword && (!name || !editable || (canEdit && !isEditing));

  const input = (
    <input
      ref={inputRef}
      id={inputId}
      name={name}
      type={inputType}
      defaultValue={value === undefined ? defaultValue : undefined}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      minLength={minLength}
      maxLength={maxLength}
      onChange={(event) => onValueChange?.(event.target.value)}
      required={isPassword}
      aria-invalid={Boolean(error)}
      aria-describedby={error && name ? `${name}-error` : undefined}
      data-form-error-focus={isPassword ? true : undefined}
      readOnly={isReadOnly}
      aria-readonly={isReadOnly}
      tabIndex={isReadOnly ? -1 : undefined}
      className={`focus:ring-tanaw-green/20 w-full rounded-lg border p-3 text-sm font-semibold text-slate-900 transition outline-none focus:ring-2 dark:text-slate-100 ${
        isReadOnly ? "cursor-default border-slate-200 bg-slate-50" : "border-tanaw-green bg-white shadow-sm dark:bg-(--tanaw-control-bg)"
      } ${isPassword || canEdit ? "pr-12" : ""} ${isPassword ? "tanaw-sensitive-input" : ""} ${error ? "border-red-400" : ""}`}
    />
  );

  return (
    <div data-field-name={name} className="block">
      <label htmlFor={inputId} className="mb-2 block text-xs font-bold tracking-wide text-slate-500 uppercase">
        {label}
      </label>
      {isPassword ? (
        <span className="relative block">
          {input}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setIsPasswordVisible((current) => !current)}
            className="hover:text-tanaw-green focus-visible:ring-tanaw-green/30 absolute top-1/2 right-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-emerald-50 focus-visible:ring-2 focus-visible:outline-none"
            aria-label={isPasswordVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          >
            {isPasswordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </span>
      ) : (
        <span className="relative block">
          {input}
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                if (isEditing) {
                  setIsEditing(false);
                  return;
                }

                setIsEditing(true);
                window.requestAnimationFrame(() => {
                  inputRef.current?.focus();
                  inputRef.current?.select();
                });
              }}
              className={`focus-visible:ring-tanaw-green/30 absolute top-1/2 right-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition focus-visible:ring-2 focus-visible:outline-none ${
                isEditing ? "text-tanaw-green bg-emerald-50" : "hover:text-tanaw-green text-slate-400 hover:bg-emerald-50"
              }`}
              aria-label={isEditing ? `Lock ${label.toLowerCase()}` : `Edit ${label.toLowerCase()}`}
              aria-pressed={isEditing}
            >
              <Pencil size={16} />
            </button>
          )}
        </span>
      )}
      {error && name ? (
        <span id={`${name}-error`} role="alert" className="mt-1.5 block text-xs font-semibold text-(--tanaw-error)">
          {error}
        </span>
      ) : null}
    </div>
  );
}
