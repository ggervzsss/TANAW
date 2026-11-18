import { Select, type SelectOption, type SelectProps } from "../../../design-system";

export type SelectDropdownOption = SelectOption;

/** The design-system Select. Search appears for lists of eight or more options. */
export function SelectDropdown(props: Omit<SelectProps, "options"> & { options: readonly SelectDropdownOption[] }) {
  return <Select focusOnFormError {...props} />;
}
