import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { MailCheck } from "lucide-react";
import { Alert } from "../../../design-system";
import { useSettingsDraft } from "../../../design-system/lib/settingsDraft";
import { SettingsActions, SettingsGroup, SettingsImageUpload, SettingsReadOnly } from "../../../design-system/patterns/GeneralSettings";
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
import { notifyError, notifyInfo, notifySuccess } from "../../toasts/services/toast-service";
import { readProfileImageFile } from "../../../utils/image-upload";
import { PHILIPPINE_MOBILE_ERROR, type PersonNameParts, formatPersonName, normalizeEmail, normalizeMiddleInitial, parsePersonName, toPhilippineLocalDigits } from "../../../utils/form-validation";

import { ProfileDisplayField, ProfileEditModal, ReadOnlyIdentityField } from "./ProfileEditor";
import { getInitials, getRequestErrorMessage, validateModalValue, validateStructuredName, type EditableProfileField } from "../model/profile-edit";

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
  const buildingCapacity = user?.buildingCapacity ?? 100;
  const phoneLocal = toPhilippineLocalDigits(user?.phone ?? "");
  const phoneDisplay = phoneLocal ? `+63 ${phoneLocal}` : "Not provided";
  const initials = getInitials(enterpriseName);
  const [displayImageDataUrl, setDisplayImageDataUrl] = useState<string | null>(() => user?.displayImageDataUrl ?? null);
  const [displayImageFileName, setDisplayImageFileName] = useState("");
  const [isReadingImage, setIsReadingImage] = useState(false);
  const [imageError, setImageError] = useState("");
  const [saveError, setSaveError] = useState("");
  const imageVersion = useRef(0);
  const logoChanged = displayImageDataUrl !== (user?.displayImageDataUrl ?? null);
  const modalDirty =
    activeModal === "managerName"
      ? formatPersonName(modalName) !== formatPersonName(parsePersonName(user?.managerName ?? ""))
      : activeModal === "email"
        ? modalValue !== (user?.email ?? "")
        : activeModal === "phone"
          ? Boolean(modalPhoneLocal)
          : activeModal === "buildingCapacity" && modalValue !== String(buildingCapacity);
  const draftMarker = useSettingsDraft(logoChanged || isReadingImage || modalDirty);

  useEffect(() => {
    imageVersion.current++;
    setDisplayImageDataUrl(user?.displayImageDataUrl ?? null);
    setDisplayImageFileName("");
    setIsReadingImage(false);
    setImageError("");
  }, [user?.id, user?.displayImageDataUrl]);

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
    if (isLoading || isReadingImage || !logoChanged) return;
    setIsSuccess(false);
    setIsLoading(true);
    setSaveError("");
    try {
      const updated = await updateProfileImage(displayImageDataUrl);
      updateUser(updated);
      setIsLoading(false);
      setIsSuccess(true);
      setTimeout(() => setIsSuccess(false), 3000);
      notifySuccess("Profile logo saved.");
    } catch {
      setIsLoading(false);
      setSaveError("Unable to update profile logo.");
    }
  };

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const version = ++imageVersion.current;
    setIsReadingImage(true);
    setImageError("");
    setIsSuccess(false);

    try {
      const upload = await readProfileImageFile(file);
      if (version !== imageVersion.current) return;
      setDisplayImageDataUrl(upload.dataUrl);
      setDisplayImageFileName(upload.fileName);
    } catch (error) {
      if (version === imageVersion.current) setImageError(error instanceof Error ? error.message : "Unable to load image.");
    } finally {
      if (version === imageVersion.current) setIsReadingImage(false);
      event.target.value = "";
    }
  };

  return (
    <>
      <form data-settings-draft={draftMarker} onSubmit={handleSave} noValidate aria-busy={isLoading}>
        <fieldset disabled={isLoading} className="tanaw-settings-body">
          <SettingsImageUpload
            account={{ name: enterpriseName, email: user?.email, role: "Enterprise Account" }}
            onEditEmail={() => openEditModal("email")}
            title="Establishment logo"
            initials={initials}
            image={displayImageDataUrl}
            fileName={displayImageFileName}
            error={imageError}
            loading={isReadingImage}
            onChange={handleImageChange}
            removeLabel="Remove logo"
            onRemove={() => {
              setDisplayImageDataUrl(null);
              setDisplayImageFileName("");
              setImageError("");
              setIsSuccess(false);
            }}
          />

          {accountChangeStatus && (
            <div
              className={`enterprise-profile-change-notice rounded-2xl border px-4 py-3 text-sm font-semibold ${
                accountChangeStatus.tone === "success" ? "text-tanaw-ledger border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
              data-tone={accountChangeStatus.tone}
            >
              {accountChangeStatus.message}
            </div>
          )}

          {pendingEmailChange ? (
            <div className="enterprise-profile-pending-email flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="enterprise-profile-pending-email__icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-300/60 bg-white/70 text-amber-700 shadow-sm">
                  <MailCheck className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="enterprise-profile-pending-email__title text-sm font-bold">Business email change pending</p>
                  <p className="enterprise-profile-pending-email__copy mt-1.5 text-sm leading-6 text-amber-900/80">
                    <span className="font-semibold">Proposed address:</span> <strong className="enterprise-profile-pending-email__address wrap-break-word">{pendingEmailChange.requestedEmail}</strong>.{" "}
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
                className="enterprise-profile-pending-email__cancel shrink-0 rounded-xl border border-amber-300 bg-white px-3.5 py-2.5 text-xs font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-60"
              >
                {isEmailChangeCancelling ? "Cancelling..." : "Cancel request"}
              </button>
            </div>
          ) : null}

          <div className="tanaw-profile-layout">
            <SettingsGroup title="Contact and operations" description="Edit each field individually. Phone changes follow the account review process.">
              <div className="tanaw-settings-fields">
                <ProfileDisplayField label="Lead Admin Name" value={managerName} onEdit={() => openEditModal("managerName")} />
                <ProfileDisplayField label="Contact Number" value={phoneDisplay} onEdit={() => openEditModal("phone")} />
                <ProfileDisplayField label="Building Capacity" value={buildingCapacity.toLocaleString() + " people"} onEdit={() => openEditModal("buildingCapacity")} />
              </div>
            </SettingsGroup>
            <SettingsGroup title="Enterprise registration">
              <div className="mb-2">
                <SettingsReadOnly>Contact the LGU Administrator to update registration details.</SettingsReadOnly>
              </div>
              <dl className="tanaw-settings-fields rounded-tanaw-sm bg-(--tanaw-surface-inset) p-3">
                <ReadOnlyIdentityField label="Enterprise ID" value={user?.enterpriseId ?? "Not assigned"} />
                <ReadOnlyIdentityField label="Registered Address" value={user?.address ?? "Not provided"} />
                <ReadOnlyIdentityField label="LGU Affiliation" value={[user?.category ?? "Registered Enterprise", user?.barangay ? "Barangay " + user.barangay : "San Pedro City"].join(" - ")} />
              </dl>
            </SettingsGroup>
          </div>
          {saveError && <Alert tone="danger">{saveError}</Alert>}
        </fieldset>
        <SettingsActions
          busy={isLoading}
          dirty={logoChanged}
          saveDisabled={!logoChanged || isReadingImage}
          detail={isSuccess ? "Logo saved" : "Logo changes are saved here."}
          onCancel={() => {
            imageVersion.current++;
            setDisplayImageDataUrl(user?.displayImageDataUrl ?? null);
            setDisplayImageFileName("");
            setIsSuccess(false);
            setIsReadingImage(false);
            setImageError("");
            setSaveError("");
          }}
        >
          Save Changes
        </SettingsActions>
      </form>

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
    </>
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
    if (field === "email") return user?.email ?? "Not provided";
    if (field === "buildingCapacity") return `${buildingCapacity.toLocaleString()} people`;
    return phoneDisplay;
  }

  async function handleModalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeModal || isModalSaving) return;

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
        setAccountChangeStatus({ message: response.message, tone: "info" });
        notifyInfo("Business email change requested. Follow the verification instructions.");
        void getBusinessEmailChangeStatus()
          .then(setPendingEmailChange)
          .catch(() => undefined);
      } else if (activeModal === "phone") {
        const response = await requestContactNumberChange(`+63${modalPhoneLocal}`);
        setAccountChangeStatus({ message: response.message, tone: "info" });
        notifyInfo("Contact number change request recorded.");
      } else {
        const updated = await updateBuildingCapacity(Number(modalValue));
        updateUser(updated);
        setAccountChangeStatus({ message: "Building capacity updated.", tone: "success" });
        notifySuccess("Building capacity updated.");
      }
      closeEditModal();
    } catch (error) {
      setIsModalSaving(false);
      const message = getRequestErrorMessage(error, "Unable to save this change. Please try again.");
      setModalError(message);
      notifyError(message);
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
