import { type ChangeEvent, type FormEvent, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast/headless";
import { useAuthStore } from "@/app/store/authStore";
import { updateCurrentProfile } from "@/shared/services/accountService";
import {
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

export function useAccountProfileForm() {
  const authUser = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const user = {
    name: authUser?.managerName ?? authUser?.displayName ?? "TANAW User",
    displayName: authUser?.displayName ?? "TANAW User",
    email: authUser?.email ?? "",
    department: authUser?.title ?? "City Tourism Operations",
    phone: authUser?.phone ?? "",
  };
  const [isLoading, setIsLoading] = useState(false);
  const [fieldResetSignal, setFieldResetSignal] = useState(0);
  const [isReadingImage, setIsReadingImage] = useState(false);
  const [imageError, setImageError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"firstName" | "middleInitial" | "lastName" | "phone", string>>>({});
  const imageVersion = useRef(0);
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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoading || isReadingImage) return false;
    const formData = new FormData(event.currentTarget);
    const firstName = String(formData.get("firstName") ?? "");
    const middleInitial = normalizeMiddleInitial(String(formData.get("middleInitial") ?? ""));
    const lastName = String(formData.get("lastName") ?? "");
    const phoneInput = String(formData.get("phone") ?? "");
    const validation = {
      firstName: validatePersonName(firstName, "First name") || undefined,
      middleInitial: validateMiddleInitial(middleInitial) || undefined,
      lastName: validatePersonName(lastName, "Last name") || undefined,
      phone: validatePhilippineContactNumber(phoneInput, false) || undefined,
    };
    setSaveError("");
    setErrors(validation);
    const firstInvalid = Object.keys(validation).find((name) => validation[name as keyof typeof validation]);
    if (firstInvalid) {
      const form = event.currentTarget;
      requestAnimationFrame(() => (form.elements.namedItem(firstInvalid) as HTMLInputElement | null)?.focus());
      return false;
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
      setDisplayImageDraft({ dataUrl: updated.displayImageDataUrl ?? null, fileName: "", sourceDataUrl: updated.displayImageDataUrl ?? null });
      setFieldResetSignal((current) => current + 1);
      toast.success("Profile updated.");
      return true;
    } catch (error) {
      setSaveError(getApiErrorMessage(error, "Unable to update profile."));
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  async function changeImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const version = ++imageVersion.current;
    setIsReadingImage(true);
    setImageError("");
    try {
      const upload = await readProfileImageFile(file);
      if (version !== imageVersion.current) return;
      setDisplayImageDraft({ dataUrl: upload.dataUrl, fileName: upload.fileName, sourceDataUrl: authDisplayImageDataUrl });
    } catch (error) {
      if (version === imageVersion.current) setImageError(error instanceof Error ? error.message : "Unable to load image.");
    } finally {
      if (version === imageVersion.current) setIsReadingImage(false);
      event.target.value = "";
    }
  }

  return {
    changeImage,
    displayImageDataUrl,
    displayImageFileName,
    errors,
    fieldResetSignal,
    initials,
    imageError,
    imageChanged: displayImageDataUrl !== authDisplayImageDataUrl,
    isReadingImage,
    isLoading,
    profileName,
    saveError,
    clearFieldError: (field: keyof typeof errors) => {
      setErrors((current) => ({ ...current, [field]: undefined }));
      setSaveError("");
    },
    removeImage: () => {
      imageVersion.current++;
      setImageError("");
      setDisplayImageDraft({ dataUrl: null, fileName: "", sourceDataUrl: authDisplayImageDataUrl });
    },
    reset: () => {
      imageVersion.current++;
      setIsReadingImage(false);
      setImageError("");
      setErrors({});
      setSaveError("");
      setFieldResetSignal((current) => current + 1);
      setDisplayImageDraft({ dataUrl: authDisplayImageDataUrl, fileName: "", sourceDataUrl: authDisplayImageDataUrl });
    },
    save,
    user,
  };
}
