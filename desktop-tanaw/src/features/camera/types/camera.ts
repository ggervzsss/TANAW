import type { Camera } from "../../../types/enterprise";

export type CameraFormValues = {
  name: string;
  cameraHost: string;
  rtspStream: "stream1" | "stream2";
  rtsp: string;
  zone: string;
  username: string;
  password: string;
};

export type CameraConfig = Camera["config"];
