import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Camera } from "../../../types/enterprise";
import { CameraList, CameraSidebarToggle } from "./CameraList";

describe("CameraList", () => {
  it("keeps one Add Camera action above an empty camera list", () => {
    const markup = renderToStaticMarkup(<CameraList cameras={[]} activeCamId={null} cameraLimit={6} onAdd={() => undefined} onSelect={() => undefined} />);
    expect(markup.indexOf("Add Camera")).toBeLessThan(markup.indexOf("No cameras registered."));
    expect(markup.match(/Add Camera/g)).toHaveLength(1);
  });

  it("keeps an accessible edge control for both sidebar states", () => {
    const expanded = renderToStaticMarkup(<CameraSidebarToggle collapsed={false} onToggle={() => undefined} />);
    const collapsed = renderToStaticMarkup(<CameraSidebarToggle collapsed onToggle={() => undefined} />);
    expect(expanded).toContain('aria-label="Collapse configured cameras"');
    expect(expanded).toContain('aria-expanded="true"');
    expect(collapsed).toContain('aria-label="Expand configured cameras"');
    expect(collapsed).toContain('aria-expanded="false"');
  });

  it("shows independent running cards and retains one sidebar action", () => {
    const markup = renderToStaticMarkup(<CameraList cameras={[camera(1), camera(2)]} activeCamId={2} cameraLimit={6} onAdd={() => undefined} onSelect={() => undefined} />);
    expect(markup.match(/Status: running/g)).toHaveLength(2);
    expect(markup.match(/Add Camera/g)).toHaveLength(1);
    expect(markup.indexOf("Add Camera")).toBeLessThan(markup.indexOf("Camera 1"));
  });

  it("renders six independent cards and disables registration at the policy limit", () => {
    const markup = renderToStaticMarkup(
      <CameraList cameras={Array.from({ length: 6 }, (_, index) => camera(index + 1))} activeCamId={6} cameraLimit={6} onAdd={() => undefined} onSelect={() => undefined} />,
    );

    expect(markup.match(/Status: running/g)).toHaveLength(6);
    expect(markup).toContain("This Enterprise account can register up to 6 cameras.");
    expect(markup).toContain("disabled");
  });
});

function camera(id: number): Camera {
  return {
    id,
    name: `Camera ${id}`,
    status: "running",
    zone: `Zone ${id}`,
    rtsp: `rtsp://192.168.1.${id}/stream2`,
    cameraHost: `192.168.1.${id}`,
    rtspStream: "stream2",
    processingProfile: "auto",
    confidence: 0.35,
    config: {
      tripwire: 50,
      tripwires: {
        entry: { start: { x: 40, y: 0 }, end: { x: 40, y: 100 } },
        exit: { start: { x: 60, y: 0 }, end: { x: 60, y: 100 } },
      },
      roi: { top: 0, left: 0, width: 100, height: 100 },
      reverse: false,
    },
  };
}
