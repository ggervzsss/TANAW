import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { Check, Pencil, RefreshCw, Save, Shield, Upload, X } from "lucide-react";
import { Card } from "../../../components/Card";
import { ModalPortal } from "../../../components/ModalPortal";
import { useAuthStore } from "../../login/stores/auth-store";
import { requestBusinessEmailChange, requestContactNumberChange, updateLeadAdminName, updateProfileImage } from "../../login/api/login";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import { readProfileImageFile } from "../../../utils/image-upload";
import { normalizeEmail, normalizeName, toPhilippineLocalDigits, validateEmail, validateName, validatePhilippineContactNumber } from "../../../utils/form-validation";

type EditableProfileField = "managerName" | "email" | "phone";

type AccountChangeStatus = {
  message: string;
  tone: "success" | "info";
};

export function ProfileView() {
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [activeModal, setActiveModal] = useState<EditableProfileField | null>(null);
  const [modalValue, setModalValue] = useState("");
  const [modalPhoneLocal, setModalPhoneLocal] = useState("");
  const [modalError, setModalError] = useState("");
  const [isModalSaving, setIsModalSaving] = useState(false);
  const [accountChangeStatus, setAccountChangeStatus] = useState<AccountChangeStatus | null>(null);
  const enterpriseName = user?.enterpriseName ?? user?.displayName ?? user?.name ?? "Enterprise Account";
  const managerName = user?.managerName ?? user?.name ?? user?.displayName ?? "Not provided";
  const businessEmail = user?.email ?? "Not provided";
  const phoneLocal = toPhilippineLocalDigits(user?.phone ?? "");
  const phoneDisplay = phoneLocal ? `+63 ${phoneLocal}` : "Not provided";
  const initials = getInitials(enterpriseName);
  const [displayImageDataUrl, setDisplayImageDataUrl] = useState<string | null>(() => user?.displayImageDataUrl ?? null);
  const [displayImageFileName, setDisplayImageFileName] = useState("");

  useEffect(() => {
    setDisplayImageDataUrl(user?.displayImageDataUrl ?? null);
    setDisplayImageFileName("");
  }, [user?.displayImageDataUrl, user?.email, user?.managerName, user?.phone]);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    try {
      const updated = await updateProfileImage(displayImageDataUrl);
      updateUser(updated);
      setIsLoading(false);
      setIsSuccess(true);
      setTimeout(() => setIsSuccess(false), 3000);
      notifySuccess("Profile logo saved.");
    } catch {
      setIsLoading(false);
      notifyError("Unable to update profile logo.");
    }
  };

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const upload = await readProfileImageFile(file);
      setDisplayImageDataUrl(upload.dataUrl);
      setDisplayImageFileName(upload.fileName);
      notifySuccess("Logo ready to save.");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Unable to load image.");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="animate-in fade-in mx-auto w-full max-w-260 space-y-6 pt-2 font-['Inter'] duration-500">
      <div className="mx-auto w-full">
        <p className="mb-2 text-[11px] font-black tracking-[0.24em] text-[#b7952b] uppercase">Enterprise Account</p>
        <h2 className="text-2xl font-bold tracking-tight text-[#111827]">Enterprise Profile</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500">Manage your establishment's identity and primary contact details.</p>
      </div>

      <Card className="overflow-hidden rounded-[28px] border-emerald-100/80 shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
        <div className="h-1.5 bg-linear-to-r from-[#065f46] via-[#45a549] to-[#d6ad33]" />
        <div className="p-6 md:p-8">
          <div className="enterprise-profile-logo-panel mb-8 flex flex-col items-start gap-6 rounded-3xl border border-emerald-100 bg-linear-to-r from-emerald-50/80 via-white to-amber-50/60 p-5 sm:flex-row sm:items-center">
            <label
              htmlFor="enterprise-logo-upload"
              className="group relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-emerald-200 bg-white shadow-sm"
            >
              {displayImageDataUrl ? (
                <img src={displayImageDataUrl} alt="Enterprise logo preview" className="h-full w-full object-cover" />
              ) : (
                <span className="text-tanaw-navy font-['Bai_Jamjuree'] text-2xl font-bold transition-opacity group-hover:opacity-0">{initials}</span>
              )}
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <Upload size={20} className="text-white" />
              </div>
              <input id="enterprise-logo-upload" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageChange} className="sr-only" />
            </label>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-[#111827]">Establishment Logo</h3>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-gray-500">
                Upload a professional logo or primary display picture.
                <br />
                Recommended format: 256x256px PNG or JPG.
              </p>
              {displayImageFileName && <p className="mt-2 text-xs font-semibold text-emerald-700">{displayImageFileName}</p>}
              {displayImageDataUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setDisplayImageDataUrl(null);
                    setDisplayImageFileName("");
                  }}
                  className="mt-3 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                >
                  Remove logo
                </button>
              )}
            </div>
          </div>

          {accountChangeStatus && (
            <div
              className={`mb-6 rounded-2xl border px-4 py-3 text-sm font-semibold ${
                accountChangeStatus.tone === "success" ? "border-emerald-200 bg-emerald-50 text-[#065f46]" : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              {accountChangeStatus.message}
            </div>
          )}

          <form onSubmit={handleSave} noValidate className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <ProfileDisplayField label="Full Name / Lead Admin" value={managerName} onEdit={() => openEditModal("managerName")} />
              <ProfileDisplayField label="Business Email" value={businessEmail} onEdit={() => openEditModal("email")} />
              <ProfileDisplayField label="Contact Number" value={phoneDisplay} onEdit={() => openEditModal("phone")} />
              <ProfileDisplayField label="Enterprise Name" value={enterpriseName} locked />
              <div className="md:col-span-2">
                <ProfileDisplayField label="Registered Address" value={user?.address ?? "Not provided"} locked />
              </div>
            </div>

            <div className="enterprise-profile-identity-panel mt-8 space-y-4 rounded-3xl border border-emerald-100 bg-linear-to-br from-emerald-50/70 via-white to-slate-50 p-5 shadow-inner">
              <h4 className="flex items-center gap-2 text-xs font-bold tracking-wider text-[#111827] uppercase">
                <Shield size={14} className="text-[#065f46]" /> Enterprise Identity (Read-Only)
              </h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <ReadOnlyIdentityField label="Current Node" value={enterpriseName} />
                <ReadOnlyIdentityField label="LGU Affiliation" value={[user?.category ?? "Registered Enterprise", user?.barangay ? `Barangay ${user.barangay}` : "San Pedro City"].join(" - ")} />
                <ReadOnlyIdentityField label="Enterprise ID" value={user?.enterpriseId ?? "Not assigned"} />
              </div>
              <p className="text-[10px] font-medium text-gray-500">To modify your establishment's structural identity, please contact the LGU Administrator.</p>
            </div>

            <div className="flex justify-end pt-4">
              <button
                type="submit"
                disabled={isLoading}
                className="flex min-w-42.5 items-center justify-center gap-2 rounded-full bg-[#065f46] px-6 py-2.5 text-sm font-bold text-white shadow-[0_12px_24px_rgba(6,95,70,0.2)] transition-colors hover:bg-[#044a36] disabled:bg-[#065f46]/70"
              >
                {isLoading ? <RefreshCw size={16} className="animate-spin" /> : isSuccess ? <Check size={16} /> : <Save size={16} />}
                {isLoading ? "Saving..." : isSuccess ? "Saved Successfully" : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </Card>

      {activeModal && (
        <ProfileEditModal
          field={activeModal}
          currentValue={getCurrentModalDisplay(activeModal)}
          error={modalError}
          isSaving={isModalSaving}
          phoneLocal={modalPhoneLocal}
          value={modalValue}
          onCancel={closeEditModal}
          onPhoneChange={(value) => {
            setModalPhoneLocal(toPhilippineLocalDigits(value));
            setModalError("");
          }}
          onSubmit={handleModalSubmit}
          onValueChange={(value) => {
            setModalValue(value);
            setModalError("");
          }}
        />
      )}
    </div>
  );

  function openEditModal(field: EditableProfileField) {
    setActiveModal(field);
    setModalError("");
    setAccountChangeStatus(null);
    if (field === "managerName") {
      setModalValue(user?.managerName ?? "");
      setModalPhoneLocal("");
    } else if (field === "email") {
      setModalValue(user?.email ?? "");
      setModalPhoneLocal("");
    } else {
      setModalValue("");
      setModalPhoneLocal(toPhilippineLocalDigits(user?.phone ?? ""));
    }
  }

  function closeEditModal() {
    setActiveModal(null);
    setModalValue("");
    setModalPhoneLocal("");
    setModalError("");
    setIsModalSaving(false);
  }

  function getCurrentModalDisplay(field: EditableProfileField) {
    if (field === "managerName") return managerName;
    if (field === "email") return businessEmail;
    return phoneDisplay;
  }

  async function handleModalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeModal) return;

    const error = validateModalValue(activeModal, modalValue, modalPhoneLocal);
    if (error) {
      setModalError(error);
      return;
    }

    setIsModalSaving(true);
    try {
      if (activeModal === "managerName") {
        const updated = await updateLeadAdminName(normalizeName(modalValue));
        updateUser(updated);
        setAccountChangeStatus({ message: "Lead admin name updated.", tone: "success" });
        notifySuccess("Lead admin name updated.");
      } else if (activeModal === "email") {
        const response = await requestBusinessEmailChange(normalizeEmail(modalValue));
        setAccountChangeStatus({ message: response.message, tone: "info" });
        notifySuccess("Business email change request recorded.");
      } else {
        const response = await requestContactNumberChange(`+63${modalPhoneLocal}`);
        setAccountChangeStatus({ message: response.message, tone: "info" });
        notifySuccess("Contact number change request recorded.");
      }
      closeEditModal();
    } catch (error) {
      setIsModalSaving(false);
      setModalError(getRequestErrorMessage(error, "Unable to save this change."));
    }
  }
}

type ProfileDisplayFieldProps = {
  label: string;
  locked?: boolean;
  onEdit?: () => void;
  prefix?: string;
  value: string;
};

function ProfileDisplayField({ label, locked = false, onEdit, prefix, value }: ProfileDisplayFieldProps) {
  return (
    <div>
      <label className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase">{label}</label>
      <div className="flex min-h-12.5 overflow-hidden rounded-xl border border-gray-200 bg-white text-sm text-[#111827] shadow-sm" aria-readonly="true">
        {prefix && <span className="flex items-center border-r border-gray-200 bg-emerald-50/70 px-3 font-bold text-gray-700">{prefix}</span>}
        <div className="flex min-w-0 flex-1 items-center px-3.5 py-3">
          <span className="truncate">{value}</span>
        </div>
        {onEdit && !locked && (
          <button
            type="button"
            aria-label={`Edit ${label}`}
            onClick={onEdit}
            className="m-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-emerald-50 hover:text-[#065f46]"
          >
            <Pencil size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

type ReadOnlyIdentityFieldProps = {
  label: string;
  value: string;
};

function ReadOnlyIdentityField({ label, value }: ReadOnlyIdentityFieldProps) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-bold tracking-wider text-gray-400 uppercase">{label}</label>
      <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm font-semibold text-[#111827] shadow-sm">{value}</div>
    </div>
  );
}

type ProfileEditModalProps = {
  currentValue: string;
  error: string;
  field: EditableProfileField;
  isSaving: boolean;
  onCancel: () => void;
  onPhoneChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onValueChange: (value: string) => void;
  phoneLocal: string;
  value: string;
};

function ProfileEditModal({ currentValue, error, field, isSaving, onCancel, onPhoneChange, onSubmit, onValueChange, phoneLocal, value }: ProfileEditModalProps) {
  const isPhone = field === "phone";
  const title = field === "managerName" ? "Update Lead Admin Name" : field === "email" ? "Change Business Email" : "Change Contact Number";
  const label = field === "managerName" ? "New lead admin name" : field === "email" ? "New business email" : "New contact number";
  const description =
    field === "managerName"
      ? "This updates the primary enterprise contact name after validation."
      : field === "email"
        ? "A verified email-change flow is required before the active business email changes."
        : "A verified contact-number flow is required before the active contact number changes.";

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
        <div role="dialog" aria-modal="true" aria-labelledby="profile-edit-title" className="w-full max-w-lg rounded-3xl border border-emerald-100 bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
            <div>
              <h3 id="profile-edit-title" className="text-lg font-bold text-[#111827]">
                {title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-gray-500">{description}</p>
            </div>
            <button type="button" aria-label="Close profile edit modal" onClick={onCancel} className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
              <X size={18} />
            </button>
          </div>

          <form onSubmit={onSubmit} noValidate className="space-y-5 px-6 py-5">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-[10px] font-bold tracking-wider text-gray-500 uppercase">Current value</p>
              <p className="mt-1 text-sm font-semibold wrap-break-word text-[#111827]">{currentValue}</p>
            </div>

            <label className="block">
              <span className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase">{label}</span>
              {isPhone ? (
                <div
                  className={`flex overflow-hidden rounded-xl border bg-white shadow-sm transition-colors focus-within:border-[#065f46] focus-within:ring-2 focus-within:ring-[#065f46]/12 ${error ? "border-tanaw-red" : "border-gray-200"}`}
                >
                  <span className="flex items-center border-r border-gray-200 bg-emerald-50/70 px-3 text-sm font-bold text-gray-700">+63</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    autoFocus
                    value={phoneLocal}
                    onChange={(event) => onPhoneChange(event.target.value)}
                    onPaste={(event) => {
                      event.preventDefault();
                      onPhoneChange(event.clipboardData.getData("text"));
                    }}
                    placeholder="9123456789"
                    className="min-w-0 flex-1 p-3.5 text-sm text-[#111827] outline-none"
                  />
                </div>
              ) : (
                <input
                  type={field === "email" ? "email" : "text"}
                  autoComplete={field === "email" ? "email" : "name"}
                  autoFocus
                  value={value}
                  onChange={(event) => onValueChange(event.target.value)}
                  className={`w-full rounded-xl border bg-white p-3.5 text-sm text-[#111827] shadow-sm transition-colors outline-none focus:border-[#065f46] focus:ring-2 focus:ring-[#065f46]/12 ${error ? "border-tanaw-red" : "border-gray-200"}`}
                />
              )}
              {error && <p className="text-tanaw-red mt-1.5 text-xs font-semibold">{error}</p>}
            </label>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={isSaving}
                className="rounded-full border border-gray-200 px-5 py-2.5 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex min-w-32 items-center justify-center gap-2 rounded-full bg-[#065f46] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#044a36] disabled:cursor-not-allowed disabled:bg-[#065f46]/70"
              >
                {isSaving && <RefreshCw size={15} className="animate-spin" />}
                {isSaving ? "Saving..." : field === "managerName" ? "Update Name" : "Submit Request"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

function validateModalValue(field: EditableProfileField, value: string, phoneLocal: string) {
  if (field === "managerName") return validateName(value, "Full name");
  if (field === "email") return validateEmail(value);
  return validatePhilippineContactNumber(phoneLocal ? `+63${phoneLocal}` : "", true);
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response;
    const detail = response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (typeof detail === "object" && detail && "message" in detail) {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  }
  return fallback;
}

function getInitials(value: string) {
  const initials = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return initials || "EA";
}
