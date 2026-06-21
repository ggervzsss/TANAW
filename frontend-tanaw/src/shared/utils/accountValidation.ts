export const PHILIPPINE_MOBILE_ERROR = "Enter a valid Philippine mobile number starting with +63.";
export const NAME_ERROR = "Use letters, spaces, hyphen, or apostrophe only.";
export const EMAIL_ERROR = "Enter a valid email address.";

const namePattern = /^[\p{L}][\p{L}\s'-]*$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePersonName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function validatePersonName(value: string, label: string) {
  const normalized = normalizePersonName(value);
  if (!normalized) return `${label} is required.`;
  if (normalized.length < 2) return `${label} must be at least 2 characters.`;
  if (!namePattern.test(normalized)) return NAME_ERROR;
  return "";
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string) {
  const normalized = normalizeEmail(value);
  if (!normalized) return "Email address is required.";
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
