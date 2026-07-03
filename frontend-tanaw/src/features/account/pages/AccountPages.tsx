import { Check, Eye, EyeOff, Key, Monitor, MonitorSmartphone, RefreshCw, Save, Shield, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useAuthStore } from "@/app/store/authStore";
import { PageHeader } from "@/shared/components/layout";
import { Panel, PanelHeader } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { changePassword, updateCurrentProfile } from "@/shared/services/accountManagement";
import type { UserRole } from "@/shared/types/role.types";
import { readProfileImageFile } from "@/shared/utils/imageUpload";
import { PASSWORD_MIN_LENGTH, validatePasswordPolicy } from "@/shared/utils/passwordPolicy";
import { roleAccessLabel, rolePortalLabel } from "@/shared/components/layout/navigation";

type AccountPageProps = {
  role: UserRole;
};

type ProfileUser = {
  name: string;
  email: string;
  department: string;
  phone: string;
  enterpriseName: string;
  enterpriseId: string;
  category: string;
  barangay: string;
  address: string;
};

const roleIdentity: Record<UserRole, { node: string; affiliation: string }> = {
  admin: {
    node: "LGU Command Center",
    affiliation: "San Pedro City Tourism Office",
  },
  it: {
    node: "Technical Operations Desk",
    affiliation: "TANAW Infrastructure",
  },
  staff: {
    node: "Tourism Reporting Desk",
    affiliation: "San Pedro City Tourism Office",
  },
  enterprise: {
    node: "Enterprise Portal",
    affiliation: "Registered Enterprise",
  },
};

function useAccountProfile(): ProfileUser {
  const authUser = useAuthStore((state) => state.user);

  return {
    name: authUser?.managerName ?? authUser?.displayName ?? "TANAW User",
    email: authUser?.email ?? "",
    department: authUser?.title ?? "City Tourism Operations",
    phone: authUser?.phone ?? "",
    enterpriseName: authUser?.enterpriseName ?? "",
    enterpriseId: authUser?.enterpriseId ?? "",
    category: authUser?.category ?? "",
    barangay: authUser?.barangay ?? "",
    address: authUser?.address ?? "",
  };
}

export function AccountProfilePage({ role }: AccountPageProps) {
  const authUser = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const user = useAccountProfile();
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const authDisplayImageDataUrl = authUser?.displayImageDataUrl ?? null;
  const [displayImageDraft, setDisplayImageDraft] = useState(() => ({
    dataUrl: authDisplayImageDataUrl,
    fileName: "",
    sourceDataUrl: authDisplayImageDataUrl,
  }));
  const isImageDraftCurrent = displayImageDraft.sourceDataUrl === authDisplayImageDataUrl;
  const displayImageDataUrl = isImageDraftCurrent ? displayImageDraft.dataUrl : authDisplayImageDataUrl;
  const displayImageFileName = isImageDraftCurrent ? displayImageDraft.fileName : "";
  const identity = {
    node: role === "enterprise" ? user.enterpriseName || "Enterprise Account" : roleIdentity[role].node,
    affiliation: role === "enterprise" ? [user.category || "Registered Enterprise", user.barangay ? `Barangay ${user.barangay}` : ""].filter(Boolean).join(" - ") : roleIdentity[role].affiliation,
  };
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
    const fullName = String(formData.get("fullName") ?? "").trim();
    const [firstName, ...lastNameParts] = fullName.split(/\s+/);
    const lastName = lastNameParts.join(" ");
    if (!firstName || !lastName) {
      toast.error("Enter both first and last name.");
      return;
    }
    setIsLoading(true);
    try {
      const updated = await updateCurrentProfile({
        firstName,
        lastName,
        email: String(formData.get("email") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        displayImageDataUrl,
      });
      updateUser(updated);
      setIsLoading(false);
      setIsSuccess(true);
      window.setTimeout(() => setIsSuccess(false), 2600);
      toast.success("Profile updated.");
    } catch {
      setIsLoading(false);
      toast.error("Unable to update profile.");
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
      <PageHeader title="Profile Settings" description="Manage your account identity and primary contact details." />

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
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">This profile is shown in the {rolePortalLabel[role]} header, reports, audit trails, and account activity logs.</p>
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
              <Field name="fullName" label={role === "enterprise" ? "Contact Person / Manager" : "Full Name"} defaultValue={user.name} />
              <Field name="email" label={role === "enterprise" ? "Business Email" : "Professional Email"} defaultValue={user.email} type="email" />
              <Field label={role === "enterprise" ? "Enterprise Name" : "Department"} defaultValue={role === "enterprise" ? user.enterpriseName : user.department} />
              <Field name="phone" label="Phone" defaultValue={user.phone} type="tel" />
              {role === "enterprise" && <Field label="Registered Address" defaultValue={user.address} />}
              {role === "enterprise" && <Field label="Barangay" defaultValue={user.barangay} />}
            </div>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Account Identity" icon={Shield} />
          <div className="p-6">
            <div className="grid gap-4 md:grid-cols-3">
              <ReadOnlyField label="Current Node" value={identity.node} />
              <ReadOnlyField label="Affiliation" value={identity.affiliation} />
              <ReadOnlyField label={role === "enterprise" ? "Enterprise ID" : "Directory ID"} value={role === "enterprise" ? user.enterpriseId || "Not assigned" : (authUser?.id ?? "Not assigned")} />
            </div>
            <p className="mt-4 text-xs font-medium text-slate-500">Structural role and affiliation changes are controlled through LGU account management.</p>
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
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);
  const [isPasswordSuccess, setIsPasswordSuccess] = useState(false);

  const handlePasswordUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match.");
      return;
    }
    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) {
      toast.error(policyError);
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
          <form onSubmit={handlePasswordUpdate} className="space-y-4 p-6">
            <Field label="Current Password" name="currentPassword" defaultValue="" placeholder="********" type="password" />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="New Password" name="newPassword" defaultValue="" placeholder="******" type="password" minLength={PASSWORD_MIN_LENGTH} />
              <Field label="Confirm New Password" name="confirmPassword" defaultValue="" placeholder="******" type="password" minLength={PASSWORD_MIN_LENGTH} />
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

function Field({ label, defaultValue, name, type = "text", placeholder, minLength }: { label: string; defaultValue: string; name?: string; type?: string; placeholder?: string; minLength?: number }) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && isPasswordVisible ? "text" : type;
  const input = (
    <input
      key={`${label}-${defaultValue}`}
      name={name}
      type={inputType}
      defaultValue={defaultValue}
      placeholder={placeholder}
      minLength={minLength}
      required={isPassword}
      readOnly={!name}
      className={`focus:ring-tanaw-green/20 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-900 transition outline-none focus:ring-2 ${isPassword ? "pr-12" : ""}`}
    />
  );

  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold tracking-wide text-slate-500 uppercase">{label}</span>
      {isPassword ? (
        <span className="relative block">
          {input}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setIsPasswordVisible((current) => !current)}
            className="absolute top-1/2 right-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-emerald-50 hover:text-tanaw-green focus-visible:ring-2 focus-visible:ring-tanaw-green/30 focus-visible:outline-none"
            aria-label={isPasswordVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          >
            {isPasswordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </span>
      ) : (
        input
      )}
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-2 block text-[10px] font-bold tracking-wide text-slate-400 uppercase">{label}</span>
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}
