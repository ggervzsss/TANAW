import { nativeImage } from "electron";
import path from "node:path";

const FALLBACK_ICON_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNgi3f7TwlmGDVg1IBRA4aLAQAdsKoQzBu6fQAAAABJRU5ErkJggg==";

export function getTrayIcon(publicDirectory: string) {
  const pngIcon = nativeImage.createFromPath(path.join(publicDirectory, "favicon.png")).resize({ width: 16, height: 16 });
  if (!pngIcon.isEmpty()) return pngIcon;
  const icoIcon = nativeImage.createFromPath(path.join(publicDirectory, "favicon.ico")).resize({ width: 16, height: 16 });
  if (!icoIcon.isEmpty()) return icoIcon;
  return nativeImage.createFromBuffer(Buffer.from(FALLBACK_ICON_PNG_BASE64, "base64")).resize({ width: 16, height: 16 });
}

export function getWindowIcon(publicDirectory: string) {
  const pngIcon = nativeImage.createFromPath(path.join(publicDirectory, "favicon.png")).resize({ width: 256, height: 256 });
  if (!pngIcon.isEmpty()) return pngIcon;
  const icoIcon = nativeImage.createFromPath(path.join(publicDirectory, "favicon.ico")).resize({ width: 256, height: 256 });
  if (!icoIcon.isEmpty()) return icoIcon;
  return nativeImage.createFromBuffer(Buffer.from(FALLBACK_ICON_PNG_BASE64, "base64"));
}
