export { default as TANAW_LOGO } from "../../assets/tanaw-logo.png";

const publicAsset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export const CAMERA_PLACEHOLDER_CITY_HALL_IMAGE = publicAsset("images/camera-placeholder-city-hall.jpg");
export const CITY_HALL_DAY_IMAGE = publicAsset("images/dsc00386.jpg");
export const CITY_HALL_NIGHT_IMAGE = publicAsset("images/dsc00386-night.jpg");
