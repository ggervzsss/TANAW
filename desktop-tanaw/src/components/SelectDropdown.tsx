import { Select, type SelectOption } from "../design-system";

export type SelectDropdownOption = SelectOption;

type SelectDropdownProps = {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectDropdownOption[];
  ariaLabel: string;
  className?: string;
  menuClassName?: string;
  restoreFocusOnTab?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  size?: "compact" | "default";
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  focusOnFormError?: boolean;
  /** Reports popups close each other, and an outside click only dismisses. */
  reportsDismissal?: boolean;
};

/** The design-system Select with this app's prop names. Searchable lists always show search here. */
export function SelectDropdown({ size = "default", ariaInvalid = false, reportsDismissal = false, ...props }: SelectDropdownProps) {
  return <Select {...props} size={size === "compact" ? "sm" : "md"} invalid={ariaInvalid} dismissal={reportsDismissal ? "exclusive" : "backdrop"} searchMinOptions={0} />;
}
