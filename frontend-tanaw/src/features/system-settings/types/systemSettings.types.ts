import type { ComponentType } from "react";

export type SettingValue = string | boolean | number;

export type SettingField =
  | {
      key?: string;
      label: string;
      description?: string;
      type: "select";
      value: string | number;
      options: Array<string | number>;
    }
  | {
      key?: string;
      label: string;
      description?: string;
      type: "toggle";
      value: boolean;
    };

export type SettingSection = {
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  fields: SettingField[];
};
