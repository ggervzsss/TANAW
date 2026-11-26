import { useEffect } from "react";

const draftSelector = '[data-settings-draft="true"]';

export function useSettingsDraft(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  return dirty || undefined;
}

export function hasSettingsDraft() {
  return document.querySelector(draftSelector) !== null;
}

export type SettingsSaveBarStatus = "idle" | "dirty" | "saving";

/**
 * A settings form shows its save bar only while there is something to keep or discard, or while
 * it is saving.
 */
export function getSettingsSaveBarState({ dirty, busy }: { dirty: boolean; busy: boolean }) {
  const status: SettingsSaveBarStatus = busy ? "saving" : dirty ? "dirty" : "idle";
  return { status, visible: status !== "idle", showDiscard: dirty };
}
