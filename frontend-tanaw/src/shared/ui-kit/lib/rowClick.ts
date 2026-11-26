import type { MouseEvent } from "react";

/** Controls inside a clickable row that keep their own click. */
const NESTED_CONTROLS = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='combobox']",
  "[role='menuitem']",
  "[contenteditable='true']",
].join(", ");

type RowClick = {
  target: EventTarget | null;
  currentTarget: Element;
};

/** The control the click landed on inside the row, if any; the row leaves such clicks alone. */
export function nestedRowControl({ target, currentTarget }: RowClick): Element | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest(NESTED_CONTROLS);
  return control && control !== currentTarget && currentTarget.contains(control) ? control : null;
}

/** True when the click finished selecting text inside the row, so copying a name does not open it. */
export function endsTextSelection(row: Element, selection: Pick<Selection, "isCollapsed" | "anchorNode" | "toString"> | null | undefined): boolean {
  if (!selection || selection.isCollapsed || selection.toString().trim() === "") return false;
  return Boolean(selection.anchorNode && row.contains(selection.anchorNode));
}

/**
 * Makes a whole table row or list item open what its primary control opens. Put `data-row-primary` on
 * that one real link or button (usually the name), so keyboard and screen reader users reach it as
 * usual, and pass this as the row's `onClick`. A click elsewhere on the row focuses and presses the
 * primary control; clicks on other buttons and links in the row, and text selections, are left alone.
 */
export function openRowFromClick(event: MouseEvent<HTMLElement>) {
  if (event.defaultPrevented || event.button !== 0) return;
  const row = event.currentTarget;
  if (nestedRowControl({ target: event.target, currentTarget: row })) return;
  if (endsTextSelection(row, typeof window === "undefined" ? null : window.getSelection())) return;
  const primary = row.querySelector<HTMLElement>("[data-row-primary]");
  if (!primary) return;
  primary.focus({ preventScroll: true });
  primary.click();
}
