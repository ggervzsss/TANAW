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
    const labels = [
      "Camera Name",
      "Assigned Zone",
      "Camera Type",
      "Camera IP / Host",
      "RTSP Stream",
      "Username",
      "Password",
      "Stream URL",
    ];
    const positions = labels.map((label) => markup.indexOf(label));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(markup).toContain("readonly=\"\"");
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
});

function render(newCam: CameraFormValues, errors: Partial<Record<keyof CameraFormValues, string>>) {
  return renderToStaticMarkup(
    <CameraAddModal
      newCam={newCam}
      errors={errors}
      isValidating={false}
      onChange={() => undefined}
      onClose={() => undefined}
      onSubmit={() => undefined}
    />,
  );
}

function values(overrides: Partial<CameraFormValues> = {}): CameraFormValues {
  return {
    cameraHost: "192.168.1.9",
    cameraType: "RTSP_CCTV",
    name: "Tapo C310",
    password: "",
    rtsp: "rtsp://192.168.1.9/stream2",
    rtspStream: "stream2",
    username: "",
    zone: "Main Lobby",
    ...overrides,
  };
}
