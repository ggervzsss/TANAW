export function recordedText(value: string | null | undefined, fallback = "Not recorded") {
  const normalized = value?.trim();
  return normalized || fallback;
}

const KNOWN_ACTOR_PLACEHOLDERS = new Set(["lgu staff", "system pipeline"]);

export function recordedActor(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || KNOWN_ACTOR_PLACEHOLDERS.has(normalized.toLowerCase())) return "Not recorded";
  return normalized;
}
