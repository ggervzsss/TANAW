import passwordPolicyData from "../data/commonPasswords.json";

export const PASSWORD_MIN_LENGTH = passwordPolicyData.minimumLength;
export const PASSWORD_MAX_LENGTH = passwordPolicyData.maximumLength;
export const PASSWORD_INPUT_MAX_CODE_UNITS = PASSWORD_MAX_LENGTH * 2;
export const PASSWORD_TOO_SHORT_MESSAGE = passwordPolicyData.tooShortMessage;
export const PASSWORD_TOO_LONG_MESSAGE = passwordPolicyData.tooLongMessage;
export const PASSWORD_COMMON_MESSAGE = passwordPolicyData.commonMessage;

const COMMON_PASSWORD_BLOCKLIST = buildCommonPasswordBlocklist();

export type PasswordRequirementStatus = {
  characterCount: number;
  hasValue: boolean;
  isLengthValid: boolean;
  isNotCommon: boolean;
};

export function normalizePassword(value: string) {
  return value.normalize("NFC");
}

export function validatePasswordPolicy(value: string) {
  const status = getPasswordRequirementStatus(value);
  if (status.characterCount < PASSWORD_MIN_LENGTH) return PASSWORD_TOO_SHORT_MESSAGE;
  if (status.characterCount > PASSWORD_MAX_LENGTH) return PASSWORD_TOO_LONG_MESSAGE;
  if (!status.isNotCommon) return PASSWORD_COMMON_MESSAGE;
  return "";
}

export function getPasswordRequirementStatus(value: string): PasswordRequirementStatus {
  const normalized = normalizePassword(value);
  const characterCount = Array.from(normalized).length;
  const hasValue = characterCount > 0;
  return {
    characterCount,
    hasValue,
    isLengthValid: characterCount >= PASSWORD_MIN_LENGTH && characterCount <= PASSWORD_MAX_LENGTH,
    isNotCommon: hasValue && Boolean(normalized.trim()) && !COMMON_PASSWORD_BLOCKLIST.has(normalized.toLowerCase()),
  };
}

function buildCommonPasswordBlocklist() {
  const candidates = new Set(passwordPolicyData.exact.map((value) => normalizePassword(value).toLowerCase()));
  for (const stemValue of passwordPolicyData.stems) {
    const stem = normalizePassword(stemValue).toLowerCase();
    for (let repeatCount = 2; repeatCount < 5; repeatCount += 1) {
      for (const separator of passwordPolicyData.separators) {
        const candidate = Array.from({ length: repeatCount }, () => stem).join(separator);
        const length = Array.from(candidate).length;
        if (length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH) candidates.add(candidate);
      }
    }
    for (const suffix of passwordPolicyData.suffixes) {
      const candidate = `${stem}${suffix}`;
      const length = Array.from(candidate).length;
      if (length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH) candidates.add(candidate);
    }
  }
  return candidates;
}
