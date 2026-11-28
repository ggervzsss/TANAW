import { LogOut, Monitor, ShieldCheck, Smartphone } from "lucide-react";
import { Badge, Button, Skeleton } from "@/shared/ui-kit";
import { SettingsGroup } from "@/shared/ui-kit/patterns/GeneralSettings";

type TwoStepSessionsPanelProps = {
  twoFactorEnabled: boolean;
  onSetUpTwoFactor: () => void;
  onTurnOffTwoFactor: () => void;
  deviceLabel: string;
  isPhone: boolean;
  /** "Signed in Nov 26, 2026 · 8:15 AM", or null while it loads. */
  signedInText: string | null;
  onSignOutOthers: () => void;
  signingOutOthers: boolean;
};

/** The side panel of Password & Security: two-step verification and this device's session. */
export function TwoStepSessionsPanel({ twoFactorEnabled, onSetUpTwoFactor, onTurnOffTwoFactor, deviceLabel, isPhone, signedInText, onSignOutOthers, signingOutOthers }: TwoStepSessionsPanelProps) {
  const DeviceIcon = isPhone ? Smartphone : Monitor;
  return (
    <SettingsGroup title="Two-Step Verification & Sessions" description="Protect your sign-in and see where your account is signed in.">
      <section className="tanaw-account-security-section" aria-labelledby="two-step-heading">
        <h4 id="two-step-heading">Two-Step Verification (2FA)</h4>
        <div className="tanaw-account-status-row">
          <span className="tanaw-account-status-icon" data-on={twoFactorEnabled} aria-hidden="true">
            <ShieldCheck size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="tanaw-account-status-title">
              Authenticator app
              <Badge tone={twoFactorEnabled ? "success" : "neutral"} dot={twoFactorEnabled} size="sm">
                {twoFactorEnabled ? "Enabled" : "Off"}
              </Badge>
            </p>
            <p className="tanaw-account-status-detail">
              {twoFactorEnabled
                ? "Signing in asks for your password and a 6-digit code from your authenticator app."
                : "Ask for a 6-digit code from an app on your phone each time you sign in, as well as your password."}
            </p>
          </div>
        </div>
        <div className="tanaw-account-status-actions">
          {twoFactorEnabled ? (
            <Button variant="danger" size="sm" onClick={onTurnOffTwoFactor}>
              Turn off 2FA
            </Button>
          ) : (
            <Button variant="secondary" size="sm" leadingIcon={<ShieldCheck size={15} aria-hidden="true" />} onClick={onSetUpTwoFactor}>
              Set up 2FA
            </Button>
          )}
        </div>
      </section>

      <section className="tanaw-account-security-section" aria-labelledby="active-session-heading">
        <h4 id="active-session-heading">Active Session</h4>
        <div className="tanaw-account-status-row">
          <span className="tanaw-account-status-icon" data-on="true" aria-hidden="true">
            <DeviceIcon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="tanaw-account-status-title">
              {deviceLabel}
              <Badge tone="success" dot size="sm">
                This device
              </Badge>
            </p>
            {signedInText === null ? <Skeleton className="mt-1.5 h-3.5 w-44" label="Loading when this device signed in" /> : <p className="tanaw-account-status-detail">{signedInText}</p>}
          </div>
        </div>
        <div className="tanaw-account-status-actions">
          <Button variant="secondary" size="sm" leadingIcon={<LogOut size={15} aria-hidden="true" />} loading={signingOutOthers} onClick={onSignOutOthers}>
            Sign out other devices
          </Button>
        </div>
      </section>
    </SettingsGroup>
  );
}
