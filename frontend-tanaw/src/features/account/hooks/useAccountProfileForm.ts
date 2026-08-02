import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
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
    email: authUser?.email ?? "",
    department: authUser?.title ?? "City Tourism Operations",
    phone: authUser?.phone ?? "",
  };
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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const firstName = String(formData.get("firstName") ?? "");
    const middleInitial = normalizeMiddleInitial(String(formData.get("middleInitial") ?? ""));
    const lastName = String(formData.get("lastName") ?? "");
    const validationError = validatePersonName(firstName, "First name") || validateMiddleInitial(middleInitial) || validatePersonName(lastName, "Last name");
    if (validationError) return void toast.error(validationError);
    const phoneInput = String(formData.get("phone") ?? "");
    const phoneError = validatePhilippineContactNumber(phoneInput, false);
    if (phoneError) return void toast.error(phoneError);
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
  }

  async function changeImage(event: ChangeEvent<HTMLInputElement>) {
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
  }

  return {
    changeImage,
    displayImageDataUrl,
    displayImageFileName,
    fieldResetSignal,
    initials,
    isLoading,
    isSuccess,
    profileName,
    removeImage: () => setDisplayImageDraft({ dataUrl: null, fileName: "", sourceDataUrl: authDisplayImageDataUrl }),
    save,
    user,
  };
}
