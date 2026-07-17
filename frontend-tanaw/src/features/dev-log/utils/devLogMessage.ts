export type DevLogMessageSegment = { type: "text"; value: string } | { type: "link"; value: string };

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;

export function splitDevLogMessage(message: string): DevLogMessageSegment[] {
  const segments: DevLogMessageSegment[] = [];
  let cursor = 0;

  for (const match of message.matchAll(HTTP_URL_PATTERN)) {
    const matchIndex = match.index;
    if (matchIndex > cursor) {
      segments.push({ type: "text", value: message.slice(cursor, matchIndex) });
    }
    segments.push({ type: "link", value: match[0] });
    cursor = matchIndex + match[0].length;
  }

  if (cursor < message.length) {
    segments.push({ type: "text", value: message.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: message }];
}
