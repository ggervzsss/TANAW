export const PHILIPPINE_MOBILE_ERROR = "Enter 10 digits starting with 9 after +63.";
export const NAME_ERROR = "Use letters, spaces, hyphen, or apostrophe only.";
export const EMAIL_ERROR = "Enter a valid email address.";
export const PERSON_NAME_MAX_LENGTH = 50;

export type PersonNameParts = {
  firstName: string;
  middleInitial: string;
  lastName: string;
};

const namePattern = /^[\p{L}][\p{L}\s'-]*$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const middleInitialPattern = /^\p{L}$/u;
const surnameParticles = new Set(["da", "das", "de", "del", "dela", "della", "di", "dos", "san", "santa", "van", "von"]);

export function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function validateName(value: string, label: string) {
  const normalized = normalizeName(value);
  if (!normalized) return `${label} is required.`;
  if (normalized.length < 2) return `${label} must be at least 2 characters.`;
  if (normalized.length > PERSON_NAME_MAX_LENGTH) return `${label} cannot exceed ${PERSON_NAME_MAX_LENGTH} characters.`;
  if (!namePattern.test(normalized)) return NAME_ERROR;
  return "";
}

export function normalizeMiddleInitial(value: string) {
  return value.trim().toLocaleUpperCase();
}

export function validateMiddleInitial(value: string) {
  const normalized = normalizeMiddleInitial(value);
  if (!normalized) return "";
  return middleInitialPattern.test(normalized) ? "" : "Middle initial must be one letter.";
}

export function formatPersonName(parts: PersonNameParts) {
  return [normalizeName(parts.firstName), normalizeMiddleInitial(parts.middleInitial), normalizeName(parts.lastName)].filter(Boolean).join(" ");
}

export function parsePersonName(value: string): PersonNameParts {
  const parts = normalizeName(value).split(" ").filter(Boolean);
  if (parts.length === 0) return { firstName: "", middleInitial: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], middleInitial: "", lastName: "" };

  const middleInitialIndex = parts.findIndex((part, index) => index > 0 && index < parts.length - 1 && middleInitialPattern.test(part.replace(/\.$/, "")));
  if (middleInitialIndex > 0) {
    return {
      firstName: parts.slice(0, middleInitialIndex).join(" "),
      middleInitial: normalizeMiddleInitial(parts[middleInitialIndex].replace(/\.$/, "")),
      lastName: parts.slice(middleInitialIndex + 1).join(" "),
    };
  }

  const particleIndex = parts.findIndex((part, index) => index > 0 && surnameParticles.has(part.toLocaleLowerCase()));
  const lastNameIndex = particleIndex > 0 ? particleIndex : parts.length - 1;
  return {
    firstName: parts.slice(0, lastNameIndex).join(" "),
    middleInitial: "",
    lastName: parts.slice(lastNameIndex).join(" "),
  };
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string) {
  const normalized = normalizeEmail(value);
  if (!normalized) return "Email is required.";
  if (!emailPattern.test(normalized)) return EMAIL_ERROR;
  return "";
}

export function normalizePhilippineContactNumber(value: string) {
  const raw = value.trim();
  if (!raw) return "";

  const compact = raw.replace(/[\s()-]/g, "");
  if (compact.includes("+") && !compact.startsWith("+")) return null;
  if ((compact.match(/\+/g) ?? []).length > 1) return null;

  let localDigits = compact;
  if (compact.startsWith("+63")) {
    localDigits = compact.slice(3);
  } else if (compact.startsWith("63")) {
    localDigits = compact.slice(2);
  } else if (compact.startsWith("0")) {
    localDigits = compact.slice(1);
  }

  if (!/^\d+$/.test(localDigits)) return null;
  if (localDigits.length !== 10 || !localDigits.startsWith("9")) return null;

  return `+63${localDigits}`;
}

export function validatePhilippineContactNumber(value: string, required = false) {
  const normalized = normalizePhilippineContactNumber(value);
  if (!normalized) {
    return required || value.trim() ? PHILIPPINE_MOBILE_ERROR : "";
  }
  return "";
}

export function toPhilippineLocalDigits(value: string) {
  const normalized = normalizePhilippineContactNumber(value);
  if (normalized) return normalized.slice(3);

  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("63")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  return digits.slice(0, 10);
}

export function validateRequiredText(value: string, label: string, minLength = 1) {
  const normalized = value.trim();
  if (!normalized) return `${label} is required.`;
  if (normalized.length < minLength) return `${label} must be at least ${minLength} characters.`;
  return "";
}

export function validateRtspUrl(value: string) {
  const normalized = value.trim();
  if (!normalized) return "RTSP Stream URL is required.";
  try {
    const url = new URL(normalized);
    if (url.protocol !== "rtsp:") return "Enter a valid RTSP URL starting with rtsp://.";
  } catch {
    return "Enter a valid RTSP URL starting with rtsp://.";
  }
  return "";
}

export function validateCameraStreamUrl(value: string) {
  const normalized = value.trim();
  if (!normalized) return "Stream URL is required.";
  if (/^\d+$/.test(normalized)) return "";

  try {
    const url = new URL(normalized);
    if (["http:", "https:", "rtsp:"].includes(url.protocol)) return "";
  } catch {
    return "Enter a valid HTTP, HTTPS, RTSP, or numeric webcam source.";
  }

  return "Enter a valid HTTP, HTTPS, RTSP, or numeric webcam source.";
}
