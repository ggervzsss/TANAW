import { PasswordMatchIndicator as DesignPasswordMatchIndicator, PasswordRequirements as DesignPasswordRequirements } from "../ui-kit";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, getPasswordRequirementStatus, normalizePassword } from "@/shared/utils/passwordPolicy";

/** The UI-kit checklist, fed by this app's password policy. */
export function PasswordRequirements({ password, className = "mt-2 mb-4", showTip }: { password: string; className?: string; showTip?: boolean }) {
  return <DesignPasswordRequirements status={getPasswordRequirementStatus(password)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} className={className} showTip={showTip} />;
}

export function PasswordMatchIndicator({ password, confirmation, className = "mt-2", id }: { password: string; confirmation: string; className?: string; id?: string }) {
  return <DesignPasswordMatchIndicator password={password} confirmation={confirmation} normalize={normalizePassword} className={className} id={id} />;
}
