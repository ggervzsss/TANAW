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
