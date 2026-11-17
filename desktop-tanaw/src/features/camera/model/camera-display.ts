/** Per-camera preview display. Labels on people's boxes are a developer setting (this computer). */
export type CameraDisplayPreferences = { people: boolean; area: boolean };
export const DEFAULT_CAMERA_DISPLAY: CameraDisplayPreferences = { people: true, area: true };
export function cameraDisplayKey(scope: string, cameraId: number) {
  return `${scope}:display:${cameraId}`;
}
export function readCameraDisplay(key: string): CameraDisplayPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return {
      people: typeof value?.people === "boolean" ? value.people : true,
      area: typeof value?.area === "boolean" ? value.area : true,
    };
  } catch {
    return { ...DEFAULT_CAMERA_DISPLAY };
  }
}
