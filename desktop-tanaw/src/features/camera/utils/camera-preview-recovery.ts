const MAX_PREVIEW_RETRY_DELAY_MS = 10_000;

export function getPreviewRetryDelayMs(attempt: number) {
  const exponent = Math.max(0, Math.min(attempt, 4));
  return Math.min(1000 * 2 ** exponent, MAX_PREVIEW_RETRY_DELAY_MS);
}

export function withPreviewRetryVersion(streamUrl: string, attempt: number) {
  if (!streamUrl || attempt <= 0) return streamUrl;
  const url = new URL(streamUrl);
  url.searchParams.set("preview_retry", String(attempt));
  return url.toString();
}
