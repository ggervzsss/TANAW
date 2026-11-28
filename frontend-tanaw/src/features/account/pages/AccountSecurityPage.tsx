import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { useAuthStore } from "@/app/store/authStore";
import { ConfirmDialog } from "@/shared/ui-kit";
import { PasswordChangePanel, TwoFactorDisableDialog, TwoFactorSetupDialog, TwoStepSessionsPanel } from "../components";
import { useAccountSessions, usePasswordChangeForm } from "../hooks";
import "../account.css";

type TwoFactorDialog = "setup" | "disable" | null;

export function AccountSecurityPage() {
  const password = usePasswordChangeForm();
  const sessions = useAccountSessions();
  const twoFactorEnabled = useAuthStore((state) => state.user?.twoFactorEnabled === true);
  const [twoFactorDialog, setTwoFactorDialog] = useState<TwoFactorDialog>(null);
  const closeTwoFactorDialog = () => setTwoFactorDialog(null);
  return (
    <>
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
        aside={
          <TwoStepSessionsPanel
            twoFactorEnabled={twoFactorEnabled}
            onSetUpTwoFactor={() => setTwoFactorDialog("setup")}
            onTurnOffTwoFactor={() => setTwoFactorDialog("disable")}
            deviceLabel={sessions.deviceLabel}
            isPhone={sessions.isPhone}
            signedInText={sessions.signedInText}
            onSignOutOthers={sessions.askToSignOutOthers}
            signingOutOthers={sessions.isSigningOut}
          />
        }
      />
      {/* Outside the password form, so a dialog's own form never submits the password change. */}
      <AnimatePresence>
        {twoFactorDialog === "setup" && <TwoFactorSetupDialog key="two-factor-setup" onClose={closeTwoFactorDialog} />}
        {twoFactorDialog === "disable" && <TwoFactorDisableDialog key="two-factor-disable" onClose={closeTwoFactorDialog} />}
        {sessions.confirmingSignOut && (
          <ConfirmDialog
            key="sign-out-others"
            title="Sign out other devices?"
            confirmLabel="Sign out other devices"
            icon={<LogOut size={19} />}
            busy={sessions.isSigningOut}
            onConfirm={() => void sessions.signOutOthers()}
            onCancel={sessions.cancelSignOutOthers}
          >
            Every other browser and device signed in to your account will be signed out and will need your password to sign in again. This device stays signed in.
          </ConfirmDialog>
        )}
      </AnimatePresence>
    </>
  );
}
