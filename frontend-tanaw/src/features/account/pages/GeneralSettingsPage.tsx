import { Navigate, useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { getRoleSettingsBackPath, getRoleSettingsPath } from "@/app/routers/roleRoutes";
import type { usePortalThemePreference } from "@/app/layouts/portal/hooks/usePortalThemePreference";
import { GeneralSettings, ThemeSelector, type SettingsSection } from "@/shared/ui-kit/patterns/GeneralSettings";
import { DisplayPreferencesPage } from "@/features/display-preferences";
import { SupportTicketsPage } from "@/features/support-tickets";
import { ITSystemSettingsPage } from "@/features/system-settings";
import { AccountProfilePage } from "./AccountProfilePage";
import { AccountSecurityPage } from "./AccountSecurityPage";

const accountSections = ["profile", "security", "appearance"] as const;
const sectionsByRole = {
  admin: [...accountSections, "support"],
  it: [...accountSections, "support", "system"],
  staff: accountSections,
} as const satisfies Record<string, readonly SettingsSection[]>;

const descriptions = {
  profile: "Edit your profile photo and contact information.",
  security: "Update the password you use to sign in to TANAW.",
  appearance: "Choose a theme and adjust the readability of your workspace.",
  support: "Review enterprise support requests, conversations, and status.",
  system: "Manage account safety, activity history, Philippine time display, and technical issue notifications.",
};

export function GeneralSettingsPage({ role }: { role: keyof typeof sectionsByRole }) {
  const { section = "profile" } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const { theme, selectTheme } = useOutletContext<ReturnType<typeof usePortalThemePreference>>();
  const path = getRoleSettingsPath(role);
  const sections = sectionsByRole[role];
  const active = sections.find((id) => id === section);
  if (!active) return <Navigate to={path} state={state} replace />;

  return (
    <GeneralSettings
      sections={sections}
      active={active}
      description={descriptions[active]}
      onSelect={(next) => {
        if (next !== active) navigate(`${path}/${next}`, { state });
      }}
      onBack={() => navigate(getRoleSettingsBackPath(role, state?.returnTo), { replace: true })}
    >
      {active === "profile" && <AccountProfilePage role={role} />}
      {active === "security" && <AccountSecurityPage />}
      {active === "appearance" && (
        <div className="tanaw-settings-body">
          <ThemeSelector value={theme} onChange={selectTheme} />
          <DisplayPreferencesPage />
        </div>
      )}
      {active === "support" && role !== "staff" && (
        <div className="tanaw-settings-body">
          <SupportTicketsPage mode={role} embedded inSettings />
        </div>
      )}
      {active === "system" && role === "it" && (
        <div className="tanaw-settings-body">
          <ITSystemSettingsPage />
        </div>
      )}
    </GeneralSettings>
  );
}
