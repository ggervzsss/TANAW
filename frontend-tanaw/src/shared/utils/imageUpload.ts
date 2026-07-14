const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type ImageUploadResult = {
  file: File;
  fileName: string;
  previewUrl: string;
};

export async function readProfileImageFile(file: File): Promise<ImageUploadResult> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Upload a PNG, JPG, or WebP image.");
  }
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error("Image must be 2 MB or smaller.");
  }

  return { file, fileName: file.name, previewUrl: URL.createObjectURL(file) };
}
