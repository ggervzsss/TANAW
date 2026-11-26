import { useEffect, useState } from "react";

/**
 * True while `loading` holds, for at most `limitMs`. Placeholders then give way to the real
 * "unavailable" state, so a reading that never arrives is never shown as still on its way.
 */
export function useBoundedLoading(loading: boolean, limitMs = 5000) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setExpired(true), limitMs);
    return () => {
      window.clearTimeout(timer);
      setExpired(false);
    };
  }, [loading, limitMs]);
  return loading && !expired;
}
