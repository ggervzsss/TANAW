const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type ImageUploadResult = {
  dataUrl: string;
  fileName: string;
};

export async function readProfileImageFile(file: File): Promise<ImageUploadResult> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Upload a PNG, JPG, or WebP image.");
  }
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error("Image must be 2 MB or smaller.");
  }

  const dataUrl = await readAsDataUrl(file);
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    throw new Error("Upload a valid image file.");
  }

  return { dataUrl, fileName: file.name };
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
