import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CameraFormValues } from "../types/camera";
import { CameraAddModal } from "./CameraAddModal";

vi.mock("../../../components/ModalPortal", () => ({
  ModalPortal: ({ children }: { children: React.ReactNode }) => children,
}));

describe("CameraAddModal", () => {
  it("offers Dahua with IP, device credentials, quality and port controls", () => {
    const markup = render(values({ cameraBrand: "dahua", rtsp: "rtsp://192.168.1.9:554/cam/realmonitor?channel=1&subtype=1", username: "admin", password: "device-password" }), {});
    expect(markup).toContain("Dahua");
    expect(markup).toContain("Camera IP Address");
    expect(markup).toContain("device username and password");
    expect(markup).toContain("Standard quality (Recommended)");
    expect(markup).toContain("RTSP port");
    expect(markup).not.toContain("Stream path and query");
    expect(markup).not.toContain("RTSP stream address");
    expect(markup).not.toContain("Tenda connection profile");
  });

  it("shows Tenda profiles and advanced port/path controls", () => {
    const markup = render(values({ cameraBrand: "tenda", rtsp: "rtsp://192.168.1.9:8554/profile1", connectionProfile: "profile" }), {});
    expect(markup).toContain("Tenda connection profile");
    expect(markup).toContain("CH3 profile stream (port 8554)");
    expect(markup).toContain("RTSP port");
    expect(markup).toContain("Stream path and query");
  });

  it("shows the full stream address for Custom RTSP", () => {
    const markup = render(values({ cameraBrand: "custom", rtsp: "rtsp://192.168.1.9:8554/live?channel=2" }), {});
    expect(markup).toContain("RTSP stream address");
    expect(markup).toContain("rtsp://192.168.1.9:8554/live?channel=2");
    expect(markup).not.toContain("Tenda connection profile");
  });
  it("renders a simple camera setup without exposing stream internals", () => {
    const markup = render(values(), {});
    const labels = ["Camera Name", "Assigned Zone", "Camera IP Address", "Username", "Password"];
    const positions = labels.map((label) => markup.indexOf(label));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(markup).toContain("Camera Connection");
    expect(markup).toContain("Test &amp; Add Camera");
    expect(markup).not.toContain("RTSP Stream");
    expect(markup).not.toContain("Stream URL");
    expect(markup).not.toContain("rtsp://");
    expect(markup).not.toContain("stream1");
    expect(markup).not.toContain("stream2");
  });

  it("disables saving and shows an inline error for an invalid IPv4 address", () => {
    const markup = render(values({ cameraHost: "999.168.1.9", rtsp: "" }), {});
    expect(markup).toContain("Enter a valid IPv4 address, such as 192.168.1.9.");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("requires camera credentials and keeps save disabled until both are present", () => {
    const missingMarkup = render(values(), {
      password: "Enter the camera password.",
      username: "Enter the camera username.",
    });
    expect(missingMarkup).toContain("Enter the camera username.");
    expect(missingMarkup).toContain("Enter the camera password.");
    expect(missingMarkup).toContain('aria-required="true"');
    expect(missingMarkup).toMatch(/<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/);

    const validMarkup = render(values({ username: "camera-user", password: "device pass" }), {});
    expect(validMarkup).not.toMatch(/<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("keeps the form open and disables saving when the tenant already uses the IP", () => {
    const markup = render(values({ username: "camera-user", password: "device pass" }), {}, "A camera with this IP address is already configured for this Enterprise.");

    expect(markup).toContain("A camera with this IP address is already configured");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("shows camera connection failures without exposing the generated URL", () => {
    const markup = render(values({ username: "camera-user", password: "device pass" }), {
      rtsp: "Unable to connect to this camera. Check its address and credentials.",
    });

    expect(markup).toContain("Unable to connect to this camera");
    expect(markup).not.toContain("rtsp://");
  });
});

function render(newCam: CameraFormValues, errors: Partial<Record<keyof CameraFormValues, string>>, duplicateIpError?: string) {
  return renderToStaticMarkup(
    <CameraAddModal newCam={newCam} errors={errors} duplicateIpError={duplicateIpError} isValidating={false} onChange={() => undefined} onClose={() => undefined} onSubmit={() => undefined} />,
  );
}

function values(overrides: Partial<CameraFormValues> = {}): CameraFormValues {
  return {
    cameraHost: "192.168.1.9",
    name: "Tapo C310",
    password: "",
    rtsp: "rtsp://192.168.1.9/stream2",
    rtspStream: "stream2",
    username: "",
    zone: "Main Lobby",
    ...overrides,
  };
}
