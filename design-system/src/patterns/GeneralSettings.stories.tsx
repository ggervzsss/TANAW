import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Field } from "../components/Field";
import { Input } from "../components/Input";
import { GeneralSettings, SettingsActions, SettingsGroup, SettingsImageUpload, ThemeSelector, type SettingsSection, type SettingsTheme } from "./GeneralSettings";

const meta = { title: "Patterns/General Settings", component: GeneralSettings } satisfies Meta<typeof GeneralSettings>;
export default meta;

export const Account: StoryObj = { render: () => <SettingsStory initialSection="profile" /> };
export const Appearance: StoryObj = { render: () => <SettingsStory initialSection="appearance" /> };

function SettingsStory({ initialSection }: { initialSection: SettingsSection }) {
  const [active, setActive] = useState(initialSection);
  const [theme, setTheme] = useState<SettingsTheme>("system");

  return (
    <GeneralSettings
      active={active}
      sections={["profile", "appearance"]}
      onSelect={setActive}
      onBack={() => setActive("profile")}
      description={active === "profile" ? "Edit your contact information." : "Choose a theme for the application."}
    >
      {active === "profile" ? (
        <form onSubmit={(event) => event.preventDefault()}>
          <div className="tanaw-settings-body">
            <SettingsImageUpload account={{ name: "Sample Account", role: "Enterprise Account", email: "sample@example.com" }} onEditEmail={() => undefined} title="Establishment logo" initials="SA" removeLabel="Remove logo" onChange={() => undefined} onRemove={() => undefined} />
            <SettingsGroup title="Contact details">
              <Field label="Name"><Input defaultValue="Sample Account" /></Field>
            </SettingsGroup>
          </div>
          <SettingsActions busy={false} onCancel={() => undefined}>
            Save Changes
          </SettingsActions>
        </form>
      ) : (
        <div className="tanaw-settings-body">
          <ThemeSelector value={theme} onChange={setTheme} />
        </div>
      )}
    </GeneralSettings>
  );
}
