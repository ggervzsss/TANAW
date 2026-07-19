import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { Check, MailCheck, Pencil, RefreshCw, Save, Shield, Upload, X } from "lucide-react";
import { Card } from "../../../components/Card";
import { ModalPortal } from "../../../components/ModalPortal";
import { useAuthStore } from "../../login/stores/auth-store";
import {
  type BusinessEmailChangeStatus,
  cancelBusinessEmailChange,
  getBusinessEmailChangeStatus,
  requestBusinessEmailChange,
  requestContactNumberChange,
  updateBuildingCapacity,
  updateLeadAdminName,
  updateProfileImage,
} from "../../login/api/login";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import { readProfileImageFile } from "../../../utils/image-upload";
import {
  PHILIPPINE_MOBILE_ERROR,
  PERSON_NAME_MAX_LENGTH,
  type PersonNameParts,
  formatPersonName,
  normalizeEmail,
  normalizeMiddleInitial,
  parsePersonName,
  toPhilippineLocalDigits,
  validateEmail,
  validateMiddleInitial,
  validateName,
  validatePhilippineContactNumber,
} from "../../../utils/form-validation";

type EditableProfileField = "managerName" | "email" | "phone" | "buildingCapacity";

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
  const [modalName, setModalName] = useState<PersonNameParts>({ firstName: "", middleInitial: "", lastName: "" });
  const [modalNameErrors, setModalNameErrors] = useState<Partial<Record<keyof PersonNameParts, string>>>({});
  const [modalPhoneLocal, setModalPhoneLocal] = useState("");
  const [modalError, setModalError] = useState("");
  const [isModalSaving, setIsModalSaving] = useState(false);
  const [accountChangeStatus, setAccountChangeStatus] = useState<AccountChangeStatus | null>(null);
  const [pendingEmailChange, setPendingEmailChange] = useState<BusinessEmailChangeStatus | null>(null);
  const [isEmailChangeCancelling, setIsEmailChangeCancelling] = useState(false);
  const enterpriseName = user?.enterpriseName ?? user?.displayName ?? user?.name ?? "Enterprise Account";
  const managerName = user?.managerName ?? user?.name ?? user?.displayName ?? "Not provided";
  const businessEmail = user?.email ?? "Not provided";
  const buildingCapacity = user?.buildingCapacity ?? 100;
  const phoneLocal = toPhilippineLocalDigits(user?.phone ?? "");
  const phoneDisplay = phoneLocal ? `+63 ${phoneLocal}` : "Not provided";
  const initials = getInitials(enterpriseName);
  const [displayImageDataUrl, setDisplayImageDataUrl] = useState<string | null>(() => user?.displayImageDataUrl ?? null);
  const [displayImageFileName, setDisplayImageFileName] = useState("");

  useEffect(() => {
    setDisplayImageDataUrl(user?.displayImageDataUrl ?? null);
    setDisplayImageFileName("");
  }, [user?.buildingCapacity, user?.displayImageDataUrl, user?.email, user?.managerName, user?.phone]);

  useEffect(() => {
    if (!user?.id) return undefined;
    let isCurrent = true;
    void getBusinessEmailChangeStatus()
      .then((status) => {
        if (isCurrent) setPendingEmailChange(status);
      })
      .catch(() => {
        if (isCurrent) setPendingEmailChange(null);
      });
    return () => {
      isCurrent = false;
    };
  }, [user?.id]);

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

          {pendingEmailChange ? (
            <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-amber-950 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                <div>
                  <p className="text-sm font-bold">Business email change pending</p>
                  <p className="mt-1 text-sm leading-6 text-amber-900/80">
                    Proposed address: <strong className="wrap-break-word">{pendingEmailChange.requestedEmail}</strong>.{" "}
                    {pendingEmailChange.status === "verified"
                      ? "Ownership is verified and TANAW IT can now review it."
                      : pendingEmailChange.status === "expired"
                        ? "The verification link expired. Cancel this request and submit a new address."
                        : "Open the verification link sent to that address before IT can approve it."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isEmailChangeCancelling}
                onClick={() => void handleCancelEmailChange()}
                className="shrink-0 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-60"
              >
                {isEmailChangeCancelling ? "Cancelling..." : "Cancel request"}
              </button>
            </div>
          ) : null}

          <form onSubmit={handleSave} noValidate className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <ProfileDisplayField label="Lead Admin Name" value={managerName} onEdit={() => openEditModal("managerName")} />
              <ProfileDisplayField label="Business Email" value={businessEmail} onEdit={() => openEditModal("email")} />
              <ProfileDisplayField label="Contact Number" value={phoneDisplay} onEdit={() => openEditModal("phone")} />
              <ProfileDisplayField label="Building Capacity" value={`${buildingCapacity.toLocaleString()} people`} onEdit={() => openEditModal("buildingCapacity")} />
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
          nameValue={modalName}
          nameErrors={modalNameErrors}
          value={modalValue}
          onCancel={closeEditModal}
          onPhoneChange={(value) => {
            const nextValue = toPhilippineLocalDigits(value);
            if ((value && !/^\d*$/.test(value)) || (nextValue && !nextValue.startsWith("9"))) {
              setModalError(PHILIPPINE_MOBILE_ERROR);
              return;
            }
            setModalPhoneLocal(nextValue);
            setModalError("");
          }}
          onNameChange={(field, value) => {
            setModalName((current) => ({ ...current, [field]: field === "middleInitial" ? normalizeMiddleInitial(value) : value }));
            setModalNameErrors((current) => ({ ...current, [field]: undefined }));
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
    setModalNameErrors({});
    setAccountChangeStatus(null);
    if (field === "managerName") {
      setModalName(parsePersonName(user?.managerName ?? ""));
      setModalValue("");
      setModalPhoneLocal("");
    } else if (field === "email") {
      setModalValue(user?.email ?? "");
      setModalPhoneLocal("");
    } else if (field === "phone") {
      setModalValue("");
      setModalPhoneLocal(toPhilippineLocalDigits(user?.phone ?? ""));
    } else {
      setModalValue(String(buildingCapacity));
      setModalPhoneLocal("");
    }
  }

  function closeEditModal() {
    setActiveModal(null);
    setModalValue("");
    setModalName({ firstName: "", middleInitial: "", lastName: "" });
    setModalNameErrors({});
    setModalPhoneLocal("");
    setModalError("");
    setIsModalSaving(false);
  }

  function getCurrentModalDisplay(field: EditableProfileField) {
    if (field === "managerName") return managerName;
    if (field === "email") return businessEmail;
    if (field === "buildingCapacity") return `${buildingCapacity.toLocaleString()} people`;
    return phoneDisplay;
  }

  async function handleModalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeModal) return;

    if (activeModal === "managerName") {
      const nameErrors = validateStructuredName(modalName);
      setModalNameErrors(nameErrors);
      if (Object.keys(nameErrors).length > 0) return;
    }

    const error = activeModal === "managerName" ? "" : validateModalValue(activeModal, modalValue, modalPhoneLocal);
    if (error) {
      setModalError(error);
      return;
    }

    setIsModalSaving(true);
    try {
      if (activeModal === "managerName") {
        const updated = await updateLeadAdminName(formatPersonName(modalName));
        updateUser(updated);
        setAccountChangeStatus({ message: "Lead admin name updated.", tone: "success" });
        notifySuccess("Lead admin name updated.");
      } else if (activeModal === "email") {
        const response = await requestBusinessEmailChange(normalizeEmail(modalValue));
        setPendingEmailChange(await getBusinessEmailChangeStatus());
        setAccountChangeStatus({ message: response.message, tone: "info" });
        notifySuccess("Email ownership verification queued.");
      } else if (activeModal === "phone") {
        const response = await requestContactNumberChange(`+63${modalPhoneLocal}`);
        setAccountChangeStatus({ message: response.message, tone: "info" });
        notifySuccess("Contact number change request recorded.");
      } else {
        const updated = await updateBuildingCapacity(Number(modalValue));
        updateUser(updated);
        setAccountChangeStatus({ message: "Building capacity updated.", tone: "success" });
        notifySuccess("Building capacity updated.");
      }
      closeEditModal();
    } catch (error) {
      setIsModalSaving(false);
      setModalError(getRequestErrorMessage(error, "Unable to save this change."));
    }
  }

  async function handleCancelEmailChange() {
    setIsEmailChangeCancelling(true);
    try {
      const response = await cancelBusinessEmailChange();
      setPendingEmailChange(null);
      setAccountChangeStatus({ message: response.message, tone: "info" });
      notifySuccess("Business email change request cancelled.");
    } catch (error) {
      notifyError(getRequestErrorMessage(error, "Unable to cancel this email change."));
    } finally {
      setIsEmailChangeCancelling(false);
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
  nameErrors: Partial<Record<keyof PersonNameParts, string>>;
  nameValue: PersonNameParts;
  onCancel: () => void;
  onNameChange: (field: keyof PersonNameParts, value: string) => void;
  onPhoneChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onValueChange: (value: string) => void;
  phoneLocal: string;
  value: string;
};

function ProfileEditModal({ currentValue, error, field, isSaving, nameErrors, nameValue, onCancel, onNameChange, onPhoneChange, onSubmit, onValueChange, phoneLocal, value }: ProfileEditModalProps) {
  const isPhone = field === "phone";
  const isName = field === "managerName";
  const title = field === "managerName" ? "Update Lead Admin Name" : field === "email" ? "Change Business Email" : field === "phone" ? "Change Contact Number" : "Update Building Capacity";
  const label = field === "managerName" ? "New lead admin name" : field === "email" ? "New business email" : field === "phone" ? "New contact number" : "Building capacity";
  const description =
    field === "managerName"
      ? "This updates the primary enterprise contact name after validation."
      : field === "email"
        ? "TANAW sends a single-use verification link to the proposed address and a warning to your current address. IT can approve the change only after ownership is verified."
        : field === "phone"
          ? "This sends a contact number change request to IT and Admin for review."
          : "This updates the occupancy capacity used by TANAW alerts and simulation defaults.";

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-edit-title"
          className={`enterprise-profile-edit-modal w-full rounded-3xl border border-emerald-100 bg-white shadow-2xl dark:border-emerald-300/20 dark:bg-[#121c31] dark:text-slate-100 ${isName ? "max-w-2xl" : "max-w-lg"}`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5 dark:border-slate-700">
            <div>
              <h3 id="profile-edit-title" className="text-lg font-bold text-[#111827] dark:text-slate-100">
                {title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-gray-500 dark:text-slate-400">{description}</p>
            </div>
            <button
              type="button"
              aria-label="Close profile edit modal"
              onClick={onCancel}
              className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={onSubmit} noValidate className="space-y-5 px-6 py-5">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-[#0f172a]">
              <p className="text-[10px] font-bold tracking-wider text-gray-500 uppercase">Current value</p>
              <p className="mt-1 text-sm font-semibold wrap-break-word text-[#111827] dark:text-slate-100">{currentValue}</p>
            </div>

            {isName ? (
              <fieldset>
                <legend className="mb-3 block text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-400">Structured lead admin name</legend>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)]">
                  <ProfileNameInput
                    name="firstName"
                    label="First Name"
                    value={nameValue.firstName}
                    error={nameErrors.firstName}
                    maxLength={PERSON_NAME_MAX_LENGTH}
                    autoComplete="given-name"
                    autoFocus
                    onChange={onNameChange}
                  />
                  <ProfileNameInput
                    name="middleInitial"
                    label="Middle Initial"
                    value={nameValue.middleInitial}
                    error={nameErrors.middleInitial}
                    maxLength={1}
                    autoComplete="additional-name"
                    helperText="Optional"
                    onChange={onNameChange}
                  />
                  <ProfileNameInput
                    name="lastName"
                    label="Last Name"
                    value={nameValue.lastName}
                    error={nameErrors.lastName}
                    maxLength={PERSON_NAME_MAX_LENGTH}
                    autoComplete="family-name"
                    onChange={onNameChange}
                  />
                </div>
              </fieldset>
            ) : (
              <label className="block">
                <span className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-400">{label}</span>
                {isPhone ? (
                  <div
                    className={`flex overflow-hidden rounded-xl border bg-white shadow-sm transition-colors focus-within:border-[#065f46] focus-within:ring-2 focus-within:ring-[#065f46]/12 dark:bg-[#0f172a] ${error ? "border-tanaw-red" : "border-gray-200 dark:border-slate-700"}`}
                  >
                    <span className="flex items-center border-r border-gray-200 bg-emerald-50/70 px-3 text-sm font-bold text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      +63
                    </span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      autoFocus
                      value={phoneLocal}
                      maxLength={10}
                      pattern="9[0-9]{9}"
                      aria-invalid={Boolean(error)}
                      onChange={(event) => onPhoneChange(event.target.value)}
                      onPaste={(event) => {
                        event.preventDefault();
                        onPhoneChange(event.clipboardData.getData("text"));
                      }}
                      placeholder="9123456789"
                      className="min-w-0 flex-1 bg-transparent p-3.5 text-sm text-[#111827] outline-none dark:text-slate-100"
                    />
                  </div>
                ) : (
                  <input
                    type={field === "email" ? "email" : field === "buildingCapacity" ? "number" : "text"}
                    autoComplete={field === "email" ? "email" : field === "buildingCapacity" ? "off" : "name"}
                    autoFocus
                    value={value}
                    maxLength={field === "email" ? 254 : undefined}
                    aria-invalid={Boolean(error)}
                    onChange={(event) => onValueChange(event.target.value)}
                    className={`w-full rounded-xl border bg-white p-3.5 text-sm text-[#111827] shadow-sm transition-colors outline-none focus:border-[#065f46] focus:ring-2 focus:ring-[#065f46]/12 dark:bg-[#0f172a] dark:text-slate-100 ${error ? "border-tanaw-red" : "border-gray-200 dark:border-slate-700"}`}
                  />
                )}
                {(error || !isPhone) && (
                  <p className={`mt-1.5 text-xs font-semibold ${error ? "text-tanaw-red" : "text-gray-500 dark:text-slate-400"}`}>
                    {error || (field === "email" ? "Enter a valid email address." : "Use a whole number from 1 to 100,000.")}
                  </p>
                )}
              </label>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={isSaving}
                className="rounded-full border border-gray-200 px-5 py-2.5 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex min-w-32 items-center justify-center gap-2 rounded-full bg-[#065f46] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#044a36] disabled:cursor-not-allowed disabled:bg-[#065f46]/70"
              >
                {isSaving && <RefreshCw size={15} className="animate-spin" />}
                {isSaving ? "Saving..." : field === "managerName" ? "Update Name" : field === "buildingCapacity" ? "Update Capacity" : "Submit Request"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

function ProfileNameInput({
  autoComplete,
  autoFocus = false,
  error,
  helperText,
  label,
  maxLength,
  name,
  onChange,
  value,
}: {
  autoComplete: string;
  autoFocus?: boolean;
  error?: string;
  helperText?: string;
  label: string;
  maxLength: number;
  name: keyof PersonNameParts;
  onChange: (field: keyof PersonNameParts, value: string) => void;
  value: string;
}) {
  const descriptionId = `profile-${name}-description`;
  return (
    <label className="block min-w-0">
      <span className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-400">{label}</span>
      <input
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        value={value}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        aria-describedby={error || helperText ? descriptionId : undefined}
        onChange={(event) => onChange(name, event.target.value)}
        className={`w-full min-w-0 rounded-xl border bg-white p-3.5 text-sm text-[#111827] shadow-sm transition-colors outline-none focus:border-[#065f46] focus:ring-2 focus:ring-[#065f46]/12 dark:bg-[#0f172a] dark:text-slate-100 ${error ? "border-tanaw-red" : "border-gray-200 dark:border-slate-700"}`}
      />
      {(error || helperText) && (
        <p id={descriptionId} role={error ? "alert" : undefined} className={`mt-1.5 text-xs font-semibold ${error ? "text-tanaw-red" : "text-gray-500 dark:text-slate-400"}`}>
          {error || helperText}
        </p>
      )}
    </label>
  );
}

function validateModalValue(field: EditableProfileField, value: string, phoneLocal: string) {
  if (field === "email") return validateEmail(value);
  if (field === "buildingCapacity") return validateBuildingCapacity(value);
  return validatePhilippineContactNumber(phoneLocal ? `+63${phoneLocal}` : "", true);
}

function validateStructuredName(value: PersonNameParts) {
  const errors: Partial<Record<keyof PersonNameParts, string>> = {};
  const firstNameError = validateName(value.firstName, "First name");
  const middleInitialError = validateMiddleInitial(value.middleInitial);
  const lastNameError = validateName(value.lastName, "Last name");
  if (firstNameError) errors.firstName = firstNameError;
  if (middleInitialError) errors.middleInitial = middleInitialError;
  if (lastNameError) errors.lastName = lastNameError;
  return errors;
}

function validateBuildingCapacity(value: string) {
  const capacity = Number(value);
  if (!value.trim()) return "Building capacity is required.";
  if (!Number.isInteger(capacity)) return "Building capacity must be a whole number.";
  if (capacity < 1) return "Building capacity must be at least 1.";
  if (capacity > 100000) return "Building capacity cannot exceed 100,000.";
  return "";
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
