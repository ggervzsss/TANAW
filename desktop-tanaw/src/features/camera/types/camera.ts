import type { Camera, CameraType } from "../../../types/enterprise";

export type CameraFormValues = {
  name: string;
  cameraType: CameraType;
  rtsp: string;
  zone: string;
  username: string;
  password: string;
};

export type CameraConfig = Camera["config"];
