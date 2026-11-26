import { PasswordChangePanel } from "../components";
import { usePasswordChangeForm } from "../hooks";

export function AccountSecurityPage() {
  const password = usePasswordChangeForm();
  return (
    <PasswordChangePanel
      currentPassword={password.currentPassword}
      errors={password.errors}
      formRef={password.formRef}
      isLoading={password.isLoading}
      newPassword={password.newPassword}
      passwordConfirmation={password.passwordConfirmation}
      resetSignal={password.resetSignal}
      saveError={password.saveError}
      onCurrentPasswordChange={(value) => password.updateField("currentPassword", value)}
      onNewPasswordChange={(value) => password.updateField("newPassword", value)}
      onConfirmationChange={(value) => password.updateField("confirmPassword", value)}
      onSubmit={password.submit}
      onClear={password.reset}
    />
  );
}
