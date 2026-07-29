export const DEFAULT_ENTERPRISE_CAMERA_LIMIT = 6;

export function hasReachedCameraConfigurationLimit(
  configuredCameraCount: number,
  configuredCameraLimit = DEFAULT_ENTERPRISE_CAMERA_LIMIT,
) {
  return configuredCameraCount >= configuredCameraLimit;
}

export function cameraConfigurationLimitMessage(
  configuredCameraLimit = DEFAULT_ENTERPRISE_CAMERA_LIMIT,
) {
  return `This Enterprise account can register up to ${configuredCameraLimit} cameras.`;
}
