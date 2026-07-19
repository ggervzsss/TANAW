export const INACTIVITY_WARNING_AFTER_MS = 5 * 60 * 1000;
export const INACTIVITY_COUNTDOWN_MS = 60 * 1000;

export type InactivitySnapshot = {
  phase: "active" | "warning" | "expired";
  remainingSeconds: number;
};

export function getInactivitySnapshot(lastActivityAt: number, currentTime: number): InactivitySnapshot {
  const elapsed = Math.max(0, currentTime - lastActivityAt);
  const expiresAfter = INACTIVITY_WARNING_AFTER_MS + INACTIVITY_COUNTDOWN_MS;
  if (elapsed >= expiresAfter) return { phase: "expired", remainingSeconds: 0 };
  if (elapsed < INACTIVITY_WARNING_AFTER_MS) return { phase: "active", remainingSeconds: 60 };

  return {
    phase: "warning",
    remainingSeconds: Math.max(1, Math.ceil((expiresAfter - elapsed) / 1000)),
  };
}
