import type { ComponentType } from "react";

export type SettingField =
  | {
      label: string;
      type: "select";
      value: string;
      options: string[];
    }
  | {
      label: string;
      type: "toggle";
      value: boolean;
    };

export type SettingSection = {
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  modified: string;
  fields: SettingField[];
};
