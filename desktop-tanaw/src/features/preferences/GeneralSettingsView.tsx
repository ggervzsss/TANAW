import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { getEnterpriseSettingsBackPath, routePaths } from "../../app/router/routePaths";
import { GeneralSettings, ThemeSelector, type SettingsSection } from "../../ui-kit/patterns/GeneralSettings";
import { ProfileView } from "../profile/components/ProfileView";
import { SecurityView } from "../security/components/SecurityView";
import { useThemePreference } from "../security/hooks/useThemePreference";
import { TicketsView } from "../tickets/components/TicketsView";
import { DeveloperSettingsView } from "./DeveloperSettingsView";
import { DisplayPreferencesView } from "./DisplayPreferencesView";

const sections = ["profile", "security", "appearance", "support", "developer"] as const satisfies readonly SettingsSection[];
const descriptions = {
  profile: "Manage your establishment’s identity and primary contact details.",
  security: "Update the password you use to sign in to your enterprise account.",
  appearance: "Choose a theme and adjust the readability of your workspace.",
  support: "Ask IT for help with the desktop app, a camera or a report, and follow their replies.",
  developer: "Configure detection models and diagnostic overlays for cameras on this computer.",
};

export function GeneralSettingsView() {
  const { section = "profile" } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const active = sections.find((id) => id === section);
  if (!active) return <Navigate to={routePaths.enterpriseSettings} state={state} replace />;

  return (
    <GeneralSettings
      sections={sections}
      active={active}
      description={descriptions[active]}
      onSelect={(next) => {
        if (next !== active) navigate(`${routePaths.enterpriseSettings}/${next}`, { state });
      }}
      onBack={() => navigate(getEnterpriseSettingsBackPath(state?.returnTo), { replace: true })}
    >
      {active === "profile" && <ProfileView />}
      {active === "security" && <SecurityView />}
      {active === "appearance" && <Appearance />}
      {active === "support" && (
        <div className="tanaw-settings-body">
          <TicketsView />
        </div>
      )}
      {active === "developer" && (
        <div className="tanaw-settings-body">
          <DeveloperSettingsView />
        </div>
      )}
    </GeneralSettings>
  );
}

function Appearance() {
  const { theme, selectTheme } = useThemePreference();
  return (
    <div className="tanaw-settings-body">
      <ThemeSelector value={theme} onChange={selectTheme} />
      <DisplayPreferencesView />
    </div>
  );
}
