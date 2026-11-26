import type { Tone } from "../model/enterprises";

/** Text colour for each tone of a state line. */
export const toneText: Record<Tone, string> = {
  ok: "text-(--tanaw-accent-ink)",
  warn: "text-(--tanaw-warn-ink)",
  danger: "text-(--tanaw-danger)",
  muted: "text-(--tanaw-text-muted)",
  ink: "text-(--tanaw-text)",
};

/** Dot colour for each tone. */
export const toneDot: Record<Tone, string> = {
  ok: "bg-(--tanaw-accent-ink)",
  warn: "bg-(--tanaw-warn-ink)",
  danger: "bg-(--tanaw-danger)",
  muted: "bg-(--tanaw-text-muted)",
  ink: "bg-(--tanaw-text)",
};
