import { useEffect, type RefObject } from "react";

const BARANGAY_IDLE_MS = 10_000;

export function useBarangayInactivity(
  workspaceRef: RefObject<HTMLElement | null>,
  selectedBarangay: string | null,
  paused: boolean,
  onInactive: () => void,
) {
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || !selectedBarangay || paused) return;

    let timer: number | undefined;
    const heldPointers = new Set<number>();
    const clearTimer = () => window.clearTimeout(timer);
    const resetTimer = () => {
      clearTimer();
      if (heldPointers.size === 0) timer = window.setTimeout(onInactive, BARANGAY_IDLE_MS);
    };
    const startPointer = (event: PointerEvent) => {
      heldPointers.add(event.pointerId);
      clearTimer();
    };
    const endPointer = (event: PointerEvent) => {
      if (heldPointers.delete(event.pointerId)) resetTimer();
    };
    const releasePointers = () => {
      heldPointers.clear();
      resetTimer();
    };
    const activityEvents = ["click", "pointermove", "wheel", "keydown", "input", "scroll"];
    activityEvents.forEach((event) => workspace.addEventListener(event, resetTimer, { capture: true, passive: true }));
    workspace.addEventListener("pointerdown", startPointer, true);
    window.addEventListener("pointerup", endPointer, true);
    window.addEventListener("pointercancel", endPointer, true);
    window.addEventListener("blur", releasePointers);
    resetTimer();

    return () => {
      clearTimer();
      activityEvents.forEach((event) => workspace.removeEventListener(event, resetTimer, true));
      workspace.removeEventListener("pointerdown", startPointer, true);
      window.removeEventListener("pointerup", endPointer, true);
      window.removeEventListener("pointercancel", endPointer, true);
      window.removeEventListener("blur", releasePointers);
    };
  }, [onInactive, paused, selectedBarangay, workspaceRef]);
}
