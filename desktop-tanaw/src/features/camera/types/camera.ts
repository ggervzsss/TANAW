import type { Camera } from "../../../types/enterprise";

export type CameraFormValues = {
  analysisMode?: Camera["analysisMode"];
  name: string;
  cameraHost: string;
  cameraBrand?: Camera["cameraBrand"];
  connectionProfile?: Camera["connectionProfile"];
  rtspStream: "stream1" | "stream2";
  rtsp: string;
  zone: string;
  username: string;
  password: string;
};

export type CameraConfig = Camera["config"];
