export const profileFieldNames = ["firstName", "middleInitial", "lastName", "phone"] as const;

export type ProfileFieldName = (typeof profileFieldNames)[number];
export type ProfileValues = Record<ProfileFieldName, string>;
export type ProfileDraft = Partial<ProfileValues>;

/** The value a field shows: the typed draft when there is one, otherwise the saved value. */
export function profileFieldValue(saved: ProfileValues, draft: ProfileDraft, name: ProfileFieldName) {
  return draft[name] ?? saved[name];
}

/** True when a field differs from the saved profile or a new photo is waiting to be saved. */
export function isProfileDraftDirty(saved: ProfileValues, draft: ProfileDraft, imageChanged = false) {
  return imageChanged || profileFieldNames.some((name) => profileFieldValue(saved, draft, name) !== saved[name]);
}
