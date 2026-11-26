/*
 * Whole months for the month picker: a year and a month index (0 for January), with a first and
 * last month that may be chosen.
 */

export type PickerMonth = { year: number; monthIndex: number };

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** "October 2026" */
export function pickerMonthLabel(month: PickerMonth) {
  return `${MONTHS_LONG[month.monthIndex]} ${month.year}`;
}

function ordinal(month: PickerMonth) {
  return month.year * 12 + month.monthIndex;
}

/** Whether a month can be chosen between the optional first and last months. */
export function isMonthInRange(month: PickerMonth, min?: PickerMonth | null, max?: PickerMonth | null) {
  return (!min || ordinal(month) >= ordinal(min)) && (!max || ordinal(month) <= ordinal(max));
}
