import type { SupportTicketAttachment, SupportTicketAttachmentCreate, SupportTicketSort } from "../services/tickets";
import { isSupportTicketCategory, type TicketFormState } from "./ticket-form-validation";

export const maxTicketPhotoCount = 5;
export const emptyTicketPhotos: SupportTicketAttachmentCreate[] = [];

export const emptyTicketForm: TicketFormState = {
  affectedArea: "",
  cameraNode: "",
  category: "Desktop app or camera problem",
  description: "",
  subject: "",
};

export const initialTicketSort: SupportTicketSort = "recommended";
export const ticketSortOptions: [SupportTicketSort, string][] = [
  ["recommended", "Recommended"],
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["status", "Status"],
  ["recently-updated", "Recently updated"],
];

const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const allowedImageExtensions = new Set(["png", "jpg", "jpeg", "webp"]);
const maxPhotoBytes = 5 * 1024 * 1024;

export async function readTicketPhoto(file: File): Promise<SupportTicketAttachmentCreate> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!allowedImageTypes.has(file.type) || !allowedImageExtensions.has(extension)) {
    throw new Error("Only image files are allowed.");
  }
  if (file.size > maxPhotoBytes) {
    throw new Error("Each photo must be under 5 MB.");
  }

  const dataUrl = await readAsDataUrl(file);
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    throw new Error("Only image files are allowed.");
  }

  return {
    dataUrl,
    fileName: file.name.replace(/\\/g, "/").split("/").pop() || "request-photo",
    mediaType: file.type as SupportTicketAttachment["mediaType"],
    sizeBytes: file.size,
  };
}

export function isTicketFormState(value: unknown): value is TicketFormState {
  if (!value || typeof value !== "object") return false;
  const form = value as Partial<TicketFormState>;
  return (
    typeof form.affectedArea === "string" &&
    typeof form.cameraNode === "string" &&
    typeof form.category === "string" &&
    isSupportTicketCategory(form.category) &&
    typeof form.description === "string" &&
    typeof form.subject === "string"
  );
}

export function isTicketPhotoDraft(value: unknown): value is SupportTicketAttachmentCreate[] {
  return (
    Array.isArray(value) &&
    value.length <= maxTicketPhotoCount &&
    value.every((photo) =>
      Boolean(
        photo &&
        typeof photo === "object" &&
        "dataUrl" in photo &&
        typeof photo.dataUrl === "string" &&
        photo.dataUrl.startsWith("data:image/") &&
        "fileName" in photo &&
        typeof photo.fileName === "string" &&
        "sizeBytes" in photo &&
        typeof photo.sizeBytes === "number",
      ),
    )
  );
}

export function isSupportTicketSort(value: unknown): value is SupportTicketSort {
  return ticketSortOptions.some(([sort]) => sort === value);
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Unable to read image file."));
      }
    };
    reader.onerror = () => reject(new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });
}
