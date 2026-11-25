export const SAN_PEDRO_GATEWAY_IMAGE = "/images/dsc00386.jpg";

export const SAN_PEDRO_GATEWAY_NIGHT_IMAGE = "/images/dsc00386-night.jpg";

let backgroundPreloadPromise: Promise<void> | null = null;

export function preloadLoginBackgroundImages() {
  if (typeof Image === "undefined") return Promise.resolve();
  backgroundPreloadPromise ??= Promise.all([preloadImage(SAN_PEDRO_GATEWAY_IMAGE), preloadImage(SAN_PEDRO_GATEWAY_NIGHT_IMAGE)]).then(() => undefined);
  return backgroundPreloadPromise;
}

function preloadImage(source: string) {
  return new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = "sync";
    image.fetchPriority = "high";
    image.onload = () => {
      void image
        .decode()
        .catch(() => undefined)
        .finally(resolve);
    };
    image.onerror = () => resolve();
    image.src = source;
  });
}
