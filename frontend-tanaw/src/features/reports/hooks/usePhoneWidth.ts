import { useSyncExternalStore } from "react";

/** Phones: below 640px, where the report tables stack and the filters fold away (reports.css). */
const PHONE_WIDTH = "(width < 40rem)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE_WIDTH);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether the window is phone-sized, updating as it crosses 640px. */
export function usePhoneWidth() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE_WIDTH).matches);
}
