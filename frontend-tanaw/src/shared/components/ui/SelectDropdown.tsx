import { Select, type SelectOption, type SelectProps } from "../../ui-kit";

export type SelectDropdownOption = SelectOption;

/** The UI-kit Select. Search appears for lists of eight or more options. */
export function SelectDropdown(props: Omit<SelectProps, "options"> & { options: readonly SelectDropdownOption[] }) {
  return <Select focusOnFormError {...props} />;
}
