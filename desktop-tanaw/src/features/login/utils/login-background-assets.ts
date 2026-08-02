import { CITY_HALL_DAY_IMAGE, CITY_HALL_NIGHT_IMAGE } from "../../../lib/assets";

export { CITY_HALL_DAY_IMAGE, CITY_HALL_NIGHT_IMAGE };

let backgroundPreloadPromise: Promise<void> | null = null;

export function preloadLoginBackgroundImages() {
  if (typeof Image === "undefined") return Promise.resolve();
  backgroundPreloadPromise ??= Promise.all([preloadImage(CITY_HALL_DAY_IMAGE), preloadImage(CITY_HALL_NIGHT_IMAGE)]).then(() => undefined);
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
