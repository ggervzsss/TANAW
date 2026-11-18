import { PasswordMatchIndicator as DesignPasswordMatchIndicator, PasswordRequirements as DesignPasswordRequirements } from "../design-system";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, getPasswordRequirementStatus, normalizePassword } from "../utils/password-policy";

/** The design-system checklist, fed by this app's password policy. */
export function PasswordRequirements({ password }: { password: string }) {
  return <DesignPasswordRequirements status={getPasswordRequirementStatus(password)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} />;
}

export function PasswordMatchIndicator({ password, confirmation }: { password: string; confirmation: string }) {
  return <DesignPasswordMatchIndicator password={password} confirmation={confirmation} normalize={normalizePassword} />;
}
