import { PageHeader } from "@/shared/components/layout";
import { PageMotion } from "@/shared/components/ui";
import { PasswordChangePanel } from "../components";
import { usePasswordChangeForm } from "../hooks";

export function AccountSecurityPage() {
  const password = usePasswordChangeForm();
  return (
    <PageMotion>
      <PageHeader title="Password Settings" description="Update your account password." />
      <div className="mx-auto max-w-5xl">
        <PasswordChangePanel
          currentPassword={password.currentPassword}
          errors={password.errors}
          formRef={password.formRef}
          isLoading={password.isLoading}
          isSuccess={password.isSuccess}
          newPassword={password.newPassword}
          passwordConfirmation={password.passwordConfirmation}
          resetSignal={password.resetSignal}
          onCurrentPasswordChange={(value) => password.updateField("currentPassword", value)}
          onNewPasswordChange={(value) => password.updateField("newPassword", value)}
          onConfirmationChange={(value) => password.updateField("confirmPassword", value)}
          onSubmit={password.submit}
        />
      </div>
    </PageMotion>
  );
}
