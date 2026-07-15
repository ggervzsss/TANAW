import { settingSections } from "./data";
import type { SettingField, SettingValue } from "./types";

const visibleSettingKeys = new Set(settingSections.flatMap((section) => section.fields.map((field) => settingKey(section.id, field))));

export function filterVisibleSettings(values: Record<string, SettingValue>) {
  return Object.fromEntries(Object.entries(values).filter(([key]) => visibleSettingKeys.has(key)));
}

function settingKey(sectionId: string, field: SettingField) {
  return `${sectionId}.${field.key ?? field.label}`;
}
