import { Check, RefreshCw, Save, Upload } from "lucide-react";
import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import toast from "react-hot-toast/headless";
import { useAuthStore } from "@/app/store/authStore";
import { PageHeader } from "@/shared/components/layout";
import { roleAccessLabel, rolePortalLabel } from "@/shared/components/layout/navigation";
import { Panel, PanelHeader } from "@/shared/components/panel";
import { PageMotion } from "@/shared/components/ui";
import { updateCurrentProfile } from "@/shared/services/accountManagement";
import type { UserRole } from "@/shared/types/role.types";
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
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { readProfileImageFile } from "@/shared/utils/imageUpload";
import { AccountField } from "../components";

type ProfileUser = { name: string; email: string; department: string; phone: string };

export function AccountProfilePage({ role }: { role: UserRole }) {
  const authUser = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const user = useAccountProfile();
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [fieldResetSignal, setFieldResetSignal] = useState(0);
  const authDisplayImageDataUrl = authUser?.displayImageDataUrl ?? null;
  const [displayImageDraft, setDisplayImageDraft] = useState(() => ({ dataUrl: authDisplayImageDataUrl, fileName: "", sourceDataUrl: authDisplayImageDataUrl }));
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
    const validationError = validatePersonName(firstName, "First name") || validateMiddleInitial(middleInitial) || validatePersonName(lastName, "Last name");
    if (validationError) {
      toast.error(validationError);
      return;
    }
    const phoneInput = String(formData.get("phone") ?? "");
    const phoneError = validatePhilippineContactNumber(phoneInput, false);
    if (phoneError) {
      toast.error(phoneError);
      return;
    }
    const apiName = composeApiPersonName({ firstName, middleInitial, lastName });
    setIsLoading(true);
    try {
      const updated = await updateCurrentProfile({
        firstName: apiName.firstName,
        lastName: apiName.lastName,
        email: user.email,
        phone: normalizePhilippineContactNumber(phoneInput) || undefined,
        displayImageDataUrl,
      });
      updateUser(updated);
      setIsSuccess(true);
      setFieldResetSignal((current) => current + 1);
      window.setTimeout(() => setIsSuccess(false), 2600);
      toast.success("Profile updated.");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to update profile."));
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const upload = await readProfileImageFile(file);
      setDisplayImageDraft({ dataUrl: upload.dataUrl, fileName: upload.fileName, sourceDataUrl: authDisplayImageDataUrl });
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
              <ProfileImageInput role={role} displayImageDataUrl={displayImageDataUrl} initials={initials} onChange={handleImageChange} />
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-950">Profile Photo</h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">This profile is shown in the {rolePortalLabel[role]} header, reports, and other account-related records.</p>
                <span className="mt-3 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black tracking-wide text-emerald-700 uppercase">{roleAccessLabel[role]}</span>
                {displayImageFileName && <p className="mt-2 text-xs font-semibold text-emerald-700">{displayImageFileName}</p>}
                {displayImageDataUrl && (
                  <button
                    type="button"
                    onClick={() => setDisplayImageDraft({ dataUrl: null, fileName: "", sourceDataUrl: authDisplayImageDataUrl })}
                    className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                  >
                    Remove photo
                  </button>
                )}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <AccountField
                key={`firstName-${profileName.firstName}-${fieldResetSignal}`}
                name="firstName"
                label="First Name"
                defaultValue={profileName.firstName}
                maxLength={PERSON_NAME_MAX_LENGTH}
                editable
              />
              <AccountField
                key={`middleInitial-${profileName.middleInitial}-${fieldResetSignal}`}
                name="middleInitial"
                label="Middle Initial"
                defaultValue={profileName.middleInitial}
                maxLength={1}
                editable
              />
              <AccountField
                key={`lastName-${profileName.lastName}-${fieldResetSignal}`}
                name="lastName"
                label="Last Name"
                defaultValue={profileName.lastName}
                maxLength={PERSON_NAME_MAX_LENGTH}
                editable
              />
              <AccountField label="Professional Email" defaultValue={user.email} type="email" />
              <AccountField label="Department" defaultValue={user.department} />
              <AccountField key={`phone-${user.phone}-${fieldResetSignal}`} name="phone" label="Phone" defaultValue={user.phone} type="tel" maxLength={18} editable />
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

function useAccountProfile(): ProfileUser {
  const authUser = useAuthStore((state) => state.user);
  return { name: authUser?.managerName ?? authUser?.displayName ?? "TANAW User", email: authUser?.email ?? "", department: authUser?.title ?? "City Tourism Operations", phone: authUser?.phone ?? "" };
}

function ProfileImageInput({
  displayImageDataUrl,
  initials,
  onChange,
  role,
}: {
  displayImageDataUrl: string | null;
  initials: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  role: UserRole;
}) {
  return (
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
      <input id={`profile-image-${role}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={onChange} className="sr-only" />
    </label>
  );
}
