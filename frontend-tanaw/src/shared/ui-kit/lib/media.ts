import { useCallback, useSyncExternalStore } from "react";

/** Phones: below Tailwind's `sm` breakpoint (40rem, 640px). Matches the `max-sm:` variant. */
export const PHONE_QUERY = "(width < 40rem)";

const canMatch = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

/** Whether a media query matches now, updating when it starts or stops matching. False on the server. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!canMatch()) return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => canMatch() && window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Whether the window is phone-sized, where dialogs and menus become bottom sheets. */
export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
