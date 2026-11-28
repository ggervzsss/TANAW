import { useCallback, useSyncExternalStore } from "react";

/** Phones: below the app's `md` breakpoint (48rem). */
export const PHONE_MEDIA_QUERY = "(width < 48rem)";

/**
 * Whether a media query matches now, following it as the window changes. False where matchMedia is
 * missing (tests, server), so the desktop layout is the default.
 *
 * Kit candidate: a shared media query hook. It lives here until the UI kit offers one.
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

/** Whether the window is phone width (below 48rem). */
export function usePhoneWidth() {
  return useMediaQuery(PHONE_MEDIA_QUERY);
}
