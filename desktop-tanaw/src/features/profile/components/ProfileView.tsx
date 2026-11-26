import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { MailCheck } from "lucide-react";
import { Alert, Button } from "../../../ui-kit";
import { useSettingsDraft } from "../../../ui-kit/lib/settingsDraft";
import { SettingsActions, SettingsGroup, SettingsImageUpload, SettingsReadOnly } from "../../../ui-kit/patterns/GeneralSettings";
import { useAuthStore } from "../../login/stores/auth-store";
import {
  type BusinessEmailChangeStatus,
  cancelBusinessEmailChange,
  getBusinessEmailChangeStatus,
  requestBusinessEmailChange,
  requestContactNumberChange,
  requestEnterpriseNameChange,
  updateBuildingCapacity,
  updateLeadAdminName,
  updateOpeningHours,
  updateProfileImage,
} from "../../login/api/login";
import { notifyError, notifyInfo, notifySuccess } from "../../toasts/services/toast-service";
import { readProfileImageFile } from "../../../utils/image-upload";
import { PHILIPPINE_MOBILE_ERROR, type PersonNameParts, formatPersonName, normalizeEmail, normalizeMiddleInitial, parsePersonName, toPhilippineLocalDigits } from "../../../utils/form-validation";

import { ProfileDisplayField, ProfileEditModal, ReadOnlyIdentityField } from "./ProfileEditor";
import { OpeningHoursSettings, PendingAccountChanges, TemporaryClosuresSettings } from "./ProfileHoursSettings";
import { getInitials, getRequestErrorMessage, validateModalValue, validateStructuredName, type EditableProfileField } from "../model/profile-edit";
import { openingHoursKey, savedOpeningHours, validateOpeningHours, type OpeningHours } from "../model/opening-hours";

const HOURS_INVALID_MESSAGE = "Fix the opening hours before saving. No changes were saved.";

type AccountChangeStatus = {
  message: string;
  tone: "success" | "info";
};

export function ProfileView() {
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const [isLoading, setIsLoading] = useState(false);
  const [activeModal, setActiveModal] = useState<EditableProfileField | null>(null);
  const [modalValue, setModalValue] = useState("");
  const [modalName, setModalName] = useState<PersonNameParts>({ firstName: "", middleInitial: "", lastName: "" });
  const [modalNameErrors, setModalNameErrors] = useState<Partial<Record<keyof PersonNameParts, string>>>({});
  const [modalPhoneLocal, setModalPhoneLocal] = useState("");
  const [modalError, setModalError] = useState("");
  const [isModalSaving, setIsModalSaving] = useState(false);
  const [accountChangeStatus, setAccountChangeStatus] = useState<AccountChangeStatus | null>(null);
  const [accountChangesVersion, setAccountChangesVersion] = useState(0);
  const onAccountChangeRequested = () => setAccountChangesVersion((version) => version + 1);
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
  // Opening hours are a draft of this form too: they save and discard with the logo.
  const savedHours = savedOpeningHours(user?.openingHours);
  const savedHoursKey = openingHoursKey(savedHours);
  const [hours, setHours] = useState<OpeningHours>(savedHours);
  const [hoursError, setHoursError] = useState("");
  const hoursChanged = openingHoursKey(hours) !== savedHoursKey;
  const formDirty = logoChanged || hoursChanged || isReadingImage;
  const modalDirty =
    activeModal === "managerName"
      ? formatPersonName(modalName) !== formatPersonName(parsePersonName(user?.managerName ?? ""))
      : activeModal === "email"
        ? modalValue !== (user?.email ?? "")
        : activeModal === "phone"
          ? Boolean(modalPhoneLocal)
          : activeModal === "buildingCapacity" && modalValue !== String(buildingCapacity);
  const draftMarker = useSettingsDraft(formDirty || modalDirty);

  useEffect(() => {
    imageVersion.current++;
    setDisplayImageDataUrl(user?.displayImageDataUrl ?? null);
    setDisplayImageFileName("");
    setIsReadingImage(false);
    setImageError("");
  }, [user?.id, user?.displayImageDataUrl]);

  // Start again from the saved hours only when their content changes (a save, another account),
  // not when an unrelated profile edit replaces the user object.
  useEffect(() => {
    setHours(savedOpeningHours(useAuthStore.getState().user?.openingHours));
    setHoursError("");
  }, [user?.id, savedHoursKey]);

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
    if (isLoading || isReadingImage || !(logoChanged || hoursChanged)) return;
    if (hoursChanged) {
      const problem = validateOpeningHours(hours);
      if (problem) {
        // The detail stays beside the hours; the summary sits by the save bar, and the hours scroll
        // into view because the sticky bar can be far from them. Nothing is saved, the logo included.
        setHoursError(problem);
        setSaveError(HOURS_INVALID_MESSAGE);
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        event.currentTarget
          .querySelector<HTMLElement>('[data-testid="opening-hours"]')
          ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        return;
      }
    }
    setIsLoading(true);
    setSaveError("");
    const failures: string[] = [];
    if (logoChanged) {
      try {
        updateUser(await updateProfileImage(displayImageDataUrl));
        notifySuccess("Profile logo saved.");
      } catch {
        failures.push("Unable to update profile logo.");
      }
    }
    if (hoursChanged) {
      try {
        updateUser(await updateOpeningHours(hours));
        notifySuccess("Opening hours saved.");
      } catch (failure) {
        // The detailed message shows inside the Opening hours group; the form alert only names it,
        // so the same text is not shown or announced twice.
        setHoursError(getRequestErrorMessage(failure, "Unable to save the opening hours."));
        failures.push("Opening hours were not saved.");
      }
    }
    setIsLoading(false);
    if (failures.length > 0) setSaveError(failures.join(" "));
  };

  const discardChanges = () => {
    imageVersion.current++;
    setDisplayImageDataUrl(user?.displayImageDataUrl ?? null);
    setDisplayImageFileName("");
    setIsReadingImage(false);
    setImageError("");
    setHours(savedHours);
    setHoursError("");
    setSaveError("");
  };

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const version = ++imageVersion.current;
    setIsReadingImage(true);
    setImageError("");

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
            }}
          />

          <div className="tanaw-settings-notes">
            {accountChangeStatus && (
              <div className="enterprise-profile-change-notice tanaw-settings-note tanaw-enter font-semibold" data-tone={accountChangeStatus.tone} role="status">
                {accountChangeStatus.message}
              </div>
            )}

            {pendingEmailChange ? (
              <div className="enterprise-profile-pending-email tanaw-settings-note tanaw-enter flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <MailCheck className="enterprise-profile-pending-email__icon mt-0.5 h-4.5 w-4.5 shrink-0 text-(--tanaw-gold-ink)" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="enterprise-profile-pending-email__title font-semibold text-(--tanaw-text)">Business email change pending</p>
                    <p className="enterprise-profile-pending-email__copy mt-1 leading-6 text-(--tanaw-text-secondary)">
                      Proposed address: <strong className="enterprise-profile-pending-email__address font-semibold wrap-break-word text-(--tanaw-text)">{pendingEmailChange.requestedEmail}</strong>.{" "}
                      {pendingEmailChange.status === "verified"
                        ? "Ownership is verified and TANAW IT can now review it."
                        : pendingEmailChange.status === "expired"
                          ? "The verification link expired. Cancel this request and submit a new address."
                          : "Open the verification link sent to that address before IT can approve it."}
                    </p>
                  </div>
                </div>
                <Button variant="secondary" size="sm" className="enterprise-profile-pending-email__cancel" disabled={isEmailChangeCancelling} onClick={() => void handleCancelEmailChange()}>
                  {isEmailChangeCancelling ? "Cancelling..." : "Cancel request"}
                </Button>
              </div>
            ) : null}

            <PendingAccountChanges refreshKey={accountChangesVersion} />
          </div>

          <div className="tanaw-profile-layout">
            <SettingsGroup title="Contact and operations" description="Edit each field individually. Contact number and enterprise name changes need IT's approval.">
              <div className="tanaw-settings-fields">
                <ProfileDisplayField label="Enterprise Name" value={enterpriseName} onEdit={() => openEditModal("enterpriseName")} />
                <ProfileDisplayField label="Lead Admin Name" value={managerName} onEdit={() => openEditModal("managerName")} />
                <ProfileDisplayField label="Contact Number" value={phoneDisplay} onEdit={() => openEditModal("phone")} />
                <ProfileDisplayField label="Building Capacity" value={buildingCapacity.toLocaleString() + " people"} onEdit={() => openEditModal("buildingCapacity")} />
              </div>
            </SettingsGroup>
            <SettingsGroup title="Enterprise registration">
              <div className="tanaw-settings-readonly-note">
                <SettingsReadOnly>Contact IT personnel to update registration and attraction classification.</SettingsReadOnly>
              </div>
              <dl className="tanaw-settings-fields tanaw-settings-readonly">
                <ReadOnlyIdentityField label="Enterprise ID" value={user?.enterpriseId ?? "Not assigned"} />
                <ReadOnlyIdentityField label="Registered Address" value={user?.address ?? "Not provided"} />
                <ReadOnlyIdentityField label="LGU Affiliation" value={user?.barangay ? `Barangay ${user.barangay}` : "San Pedro City"} />
                {user?.attraction && (
                  <>
                    <ReadOnlyIdentityField label="DOT Attraction Category" value={`${user.attraction.code} · ${user.attraction.category}`} />
                    {user.attractionDescription && <ReadOnlyIdentityField label="Attraction Description" value={user.attractionDescription} />}
                    <ReadOnlyIdentityField label="Attraction Type" value={`${user.attraction.typeCode} · ${user.attraction.type}`} />
                    <ReadOnlyIdentityField label="NTDP Portfolio" value={user.attraction.portfolioCategory} />
                    <ReadOnlyIdentityField label="NTDP Code" value={user.attraction.ntdpCode} />
                  </>
                )}
              </dl>
            </SettingsGroup>
            <OpeningHoursSettings
              hours={hours}
              error={hoursError}
              onChange={(next) => {
                setHours(next);
                setHoursError("");
                setSaveError((current) => (current === HOURS_INVALID_MESSAGE ? "" : current));
              }}
            />
            <TemporaryClosuresSettings />
          </div>
          {saveError && <Alert tone="danger">{saveError}</Alert>}
        </fieldset>
        <SettingsActions busy={isLoading} dirty={formDirty} saveDisabled={isReadingImage} onDiscard={discardChanges}>
          Save changes
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
    } else if (field === "enterpriseName") {
      setModalValue(enterpriseName);
      setModalPhoneLocal("");
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
    if (field === "enterpriseName") return enterpriseName;
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
        notifyInfo("Contact number change sent to IT for approval.");
        onAccountChangeRequested();
      } else if (activeModal === "enterpriseName") {
        const response = await requestEnterpriseNameChange(modalValue.trim());
        setAccountChangeStatus({ message: response.message, tone: "info" });
        notifyInfo("Enterprise name change sent to IT for approval.");
        onAccountChangeRequested();
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
