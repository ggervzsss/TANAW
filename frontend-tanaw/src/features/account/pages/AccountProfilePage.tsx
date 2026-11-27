import { useState } from "react";
import { SettingsGroup, SettingsImageUpload, SettingsNote, SettingsReadOnly, SettingsSaveBar } from "@/shared/ui-kit/patterns/GeneralSettings";
import { useSettingsDraft } from "@/shared/ui-kit/lib/settingsDraft";
import { roleAccessLabel } from "@/shared/constants/roleLabels";
import type { UserRole } from "@/shared/types/role.types";
import { PERSON_NAME_MAX_LENGTH } from "@/shared/utils/accountValidation";
import { AccountField } from "../components";
import { useAccountProfileForm } from "../hooks";
import { isProfileDraftDirty, profileFieldValue, type ProfileDraft, type ProfileFieldName } from "../model";

const profileFields: ReadonlyArray<{ name: ProfileFieldName; label: string; maxLength: number; type?: string; autoComplete: string; hint?: string }> = [
  { name: "firstName", label: "First Name", maxLength: PERSON_NAME_MAX_LENGTH, autoComplete: "given-name" },
  { name: "middleInitial", label: "Middle Initial", maxLength: 1, autoComplete: "additional-name", hint: "Optional. One letter." },
  { name: "lastName", label: "Last Name", maxLength: PERSON_NAME_MAX_LENGTH, autoComplete: "family-name" },
  { name: "phone", label: "Phone", maxLength: 18, type: "tel", autoComplete: "tel", hint: "Optional. Philippine mobile number, such as +63 917 123 4567." },
];

export function AccountProfilePage({ role }: { role: UserRole }) {
  const profile = useAccountProfileForm();
  const [draft, setDraft] = useState<ProfileDraft>({});
  const saved = { ...profile.profileName, phone: profile.user.phone };
  const dirty = isProfileDraftDirty(saved, draft, profile.imageChanged);
  const draftMarker = useSettingsDraft(dirty || profile.isReadingImage);

  return (
    <form
      data-settings-draft={draftMarker}
      noValidate
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
          <SettingsGroup title="Name and contact" description="The name and phone number shown on your account.">
            <div className="tanaw-settings-fields">
              {profileFields.map((field) => (
                <AccountField
                  key={`${field.name}-${profile.fieldResetSignal}`}
                  {...field}
                  defaultValue={saved[field.name]}
                  value={profileFieldValue(saved, draft, field.name)}
                  onValueChange={(value) => {
                    setDraft((current) => ({ ...current, [field.name]: value }));
                    profile.clearFieldError(field.name);
                  }}
                  error={profile.errors[field.name]}
                />
              ))}
            </div>
          </SettingsGroup>
          <SettingsGroup title="Account details">
            <div className="tanaw-settings-readonly-note">
              <SettingsReadOnly>Read-only account details</SettingsReadOnly>
            </div>
            <dl className="tanaw-settings-readonly">
              <div>
                <dt>Department</dt>
                <dd>{profile.user.department}</dd>
              </div>
            </dl>
          </SettingsGroup>
        </div>
        {profile.saveError && <SettingsNote tone="danger">{profile.saveError}</SettingsNote>}
      </fieldset>
      <SettingsSaveBar
        busy={profile.isLoading}
        dirty={dirty}
        saveDisabled={profile.isReadingImage}
        onDiscard={() => {
          setDraft({});
          profile.reset();
        }}
      >
        Save changes
      </SettingsSaveBar>
    </form>
  );
}
