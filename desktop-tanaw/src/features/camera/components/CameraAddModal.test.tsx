import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CameraFormValues } from "../types/camera";
import { CameraAddModal } from "./CameraAddModal";

vi.mock("../../../components/ModalPortal", () => ({
  ModalPortal: ({ children }: { children: React.ReactNode }) => children,
}));

describe("CameraAddModal", () => {
  it("renders the required field order and a copyable read-only generated URL", () => {
    const markup = render(values(), {});
    const labels = ["Camera Name", "Assigned Zone", "Camera IP / Host", "RTSP Stream", "Username", "Password", "Stream URL"];
    const positions = labels.map((label) => markup.indexOf(label));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(markup).toContain('readonly=""');
    expect(markup).toContain("rtsp://192.168.1.9/stream2");
    expect(markup).not.toContain("Optional");
    expect(markup).not.toContain("Credentials and video processing");
    expect(markup).not.toContain("Read Only");
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
