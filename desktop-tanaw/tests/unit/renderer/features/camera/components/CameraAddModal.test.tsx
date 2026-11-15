import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CameraFormValues } from "../../../../../../src/features/camera/types/camera";
import { CameraAddModal } from "../../../../../../src/features/camera/components/CameraAddModal";

vi.mock("../../../../../../src/components/ModalPortal", () => ({
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
  it("opens with the reference information fields and keeps connection setup in a second step", () => {
    const markup = render(values(), {});
    const labels = ["Camera Name", "Camera Brand", "Camera Location (optional)", "Area Type"];
    const positions = labels.map((label) => markup.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(markup).toContain("Camera Information");
    expect(markup).toContain('hidden="" class="camera-add-connection"');
    expect(markup).toContain('form="camera-add-form"');
  });

  it("keeps IPv4 validation attached to the connection field", () => {
    const markup = render(values({ cameraHost: "999.168.1.9", rtsp: "" }), {});
    expect(markup).toContain("Enter a valid IPv4 address, such as 192.168.1.9.");
    expect(markup).toContain('aria-invalid="true"');
  });

  it("requires camera credentials in the connection step and masks the password", () => {
    const markup = render(values(), { password: "Enter the camera password.", username: "Enter the camera username." });
    expect(markup).toContain("Enter the camera username.");
    expect(markup).toContain("Enter the camera password.");
    expect(markup).toContain('type="password"');
    expect(markup).toContain('aria-required="true"');
  });

  it("shows an existing camera IP conflict alongside the connection field", () => {
    const markup = render(values(), {}, "A camera with this IP address is already configured for this Enterprise.");
    expect(markup).toContain("A camera with this IP address is already configured");
    expect(markup).toContain('aria-describedby="camera-ip-host-error"');
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
