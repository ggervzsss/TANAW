/*
 * GENERATED FILE. Do not edit; change design-system/src/lib/settingsDraft.ts instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: 9abf3c5ac1e8a00330e227ba24a4686659ad9ebc3328391a063cc3490f99fbc8
 */
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
