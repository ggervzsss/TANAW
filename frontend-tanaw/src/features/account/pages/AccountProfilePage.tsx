import { useState } from "react";
import { Alert } from "@/shared/ui-kit";
import { SettingsActions, SettingsGroup, SettingsImageUpload, SettingsReadOnly } from "@/shared/ui-kit/patterns/GeneralSettings";
import { useSettingsDraft } from "@/shared/ui-kit/lib/settingsDraft";
import { roleAccessLabel } from "@/shared/constants/roleLabels";
import type { UserRole } from "@/shared/types/role.types";
import { PERSON_NAME_MAX_LENGTH } from "@/shared/utils/accountValidation";
import { AccountField } from "../components";
import { useAccountProfileForm } from "../hooks";

const profileFields = [
  { name: "firstName", label: "First Name", maxLength: PERSON_NAME_MAX_LENGTH },
  { name: "middleInitial", label: "Middle Initial", maxLength: 1 },
  { name: "lastName", label: "Last Name", maxLength: PERSON_NAME_MAX_LENGTH },
  { name: "phone", label: "Phone", maxLength: 18, type: "tel" },
] as const;

type ProfileFieldName = (typeof profileFields)[number]["name"];

export function AccountProfilePage({ role }: { role: UserRole }) {
  const profile = useAccountProfileForm();
  const [draft, setDraft] = useState<Partial<Record<ProfileFieldName, string>>>({});
  const saved = { ...profile.profileName, phone: profile.user.phone };
  const dirty = profile.imageChanged || profileFields.some(({ name }) => (draft[name] ?? saved[name]) !== saved[name]);
  const draftMarker = useSettingsDraft(dirty || profile.isReadingImage);

  return (
    <form
      data-settings-draft={draftMarker}
      onSubmit={async (event) => {
        event.preventDefault();
        if (dirty && (await profile.save(event))) setDraft({});
      }}
      aria-busy={profile.isLoading}
    >
      <fieldset disabled={profile.isLoading} className="tanaw-settings-body">
        <SettingsImageUpload
          account={{ name: profile.user.displayName, email: profile.user.email, role: roleAccessLabel[role] }}
          title="Profile photo"
          initials={profile.initials}
          image={profile.displayImageDataUrl}
          fileName={profile.displayImageFileName}
          error={profile.imageError}
          loading={profile.isReadingImage}
          onChange={profile.changeImage}
          onRemove={profile.removeImage}
          removeLabel="Remove photo"
        />
        <div className="tanaw-profile-layout">
          <SettingsGroup title="Name and contact" description="Edit the name and phone number shown on your account.">
            <div className="tanaw-settings-fields">
              {profileFields.map((field) => (
                <AccountField
                  key={`${field.name}-${profile.fieldResetSignal}`}
                  {...field}
                  defaultValue={saved[field.name]}
                  value={draft[field.name] ?? saved[field.name]}
                  onValueChange={(value) => {
                    setDraft((current) => ({ ...current, [field.name]: value }));
                    profile.clearFieldError(field.name);
                  }}
                  error={profile.errors[field.name]}
                  editable
                />
              ))}
            </div>
          </SettingsGroup>
          <SettingsGroup title="Account details">
            <div className="mb-2">
              <SettingsReadOnly>Read-only account details</SettingsReadOnly>
            </div>
            <dl className="tanaw-settings-account-details">
              <div>
                <dt>Department</dt>
                <dd>{profile.user.department}</dd>
              </div>
            </dl>
          </SettingsGroup>
        </div>
        {profile.saveError && <Alert tone="danger">{profile.saveError}</Alert>}
      </fieldset>
      <SettingsActions
        busy={profile.isLoading}
        dirty={dirty}
        saveDisabled={!dirty || profile.isReadingImage}
        detail={profile.isSuccess ? "Profile saved" : undefined}
        onCancel={() => {
          setDraft({});
          profile.reset();
        }}
      >
        Save Changes
      </SettingsActions>
    </form>
  );
}
